import { Component } from '../component/basecomponent';
import type { World } from '../core/world';
import { EventEmitter } from '../core/eventemitter';
import { $ } from '../core/game';
import type { Identifier } from '../rompack/rompack';
import { excludepropfromsavegame, insavegame, type RevivableObjectArgs } from '../serializer/gameserializer';
import type {
	Ability, AbilityContext, AbilityCoroutine, AbilityId, AbilitySpec,
	AbilityYield,
	ActiveEffect,
	AttributeSet,
	GameplayEffect,
	TagId
} from './gastypes';

type NowFn = () => number;

type WaitState =
	| { kind: 'time'; until: number }
	| { kind: 'tag'; tag: TagId; present: boolean }
	| { kind: 'event'; name: string; unsub: () => void };

@insavegame
export class AbilitySystemComponent extends Component {
	readonly ownerId: string;

	public static readonly registry = new Set<AbilitySystemComponent>();

	public readonly attrs: AttributeSet = {};
	// Explicit tags set by gameplay (not derived from effects)
	public readonly tags: Set<TagId> = new Set();

	// Reference counts for effect-granted tags
	@excludepropfromsavegame
	private readonly grantedTagRefs = new Map<TagId, number>();

	private readonly _abilities = new Map<AbilityId, AbilitySpec>();
	private readonly _abilityFactory = new Map<AbilityId, () => Ability>();

	@excludepropfromsavegame
	private readonly _active = new Map<string, { id: AbilityId; co: AbilityCoroutine; wait?: WaitState }>();

	@excludepropfromsavegame
	private readonly _cooldownUntil = new Map<AbilityId, number>(); // ms timestamp

	@excludepropfromsavegame
	public readonly effects: ActiveEffect[] = [];

	private readonly now: NowFn;

	private _runnerCounter = 0;

	constructor(opts: RevivableObjectArgs & { parentid: string, now?: NowFn }) {
		super(opts);
		this.ownerId = opts.parentid;
		this.now = opts.now ?? (() => performance.now());
		AbilitySystemComponent.registry.add(this);
	}

	get model(): World { return $.world; }

	public addTag(tag: TagId): void { this.tags.add(tag); }
	public removeTag(tag: TagId): void { this.tags.delete(tag); }
	public hasGameplayTag(tag: TagId): boolean { return this.tags.has(tag) || ((this.grantedTagRefs.get(tag) ?? 0) > 0); }

	public grantAbility(spec: AbilitySpec, factory: () => Ability): void {
		this._abilities.set(spec.id, spec);
		this._abilityFactory.set(spec.id, factory);
	}
	public revokeAbility(id: AbilityId): void {
		this._abilities.delete(id);
		this._abilityFactory.delete(id);
		// remove any active instances of this ability
		for (const [key, run] of [...this._active]) if (run.id === id) {
			if (run.wait?.kind === 'event') run.wait.unsub();
			this._active.delete(key);
		}
	}

	public applyEffect(effect: GameplayEffect): void {
		const remaining = effect.durationMs ?? Number.POSITIVE_INFINITY;
		this.effects.push({ effect, remainingMs: remaining, elapsedSinceTickMs: 0 });
		if (effect.grantedTags) for (const t of effect.grantedTags) this.incTagRef(t);
		if (effect.modifiers && effect.modifiers.length > 0) this.recomputeAttributes();
	}

	public removeEffect(id: string): void {
		const idx = this.effects.findIndex(e => e.effect.id === id);
		if (idx >= 0) {
			const eff = this.effects[idx].effect;
			this.effects.splice(idx, 1);
			if (eff.grantedTags) for (const t of eff.grantedTags) this.decTagRef(t);
			if (eff.modifiers && eff.modifiers.length > 0) this.recomputeAttributes();
		}
	}

	public recomputeAttributes(): void {
		const mods = this.effects.flatMap(e => e.effect.modifiers ?? []);
		const byAttr = new Map<string, { override?: number; mul: number; add: number }>();
		for (const m of mods) {
			// Ignore modifiers for unknown attributes
			if (!this.attrs[m.attr]) continue;
			let b = byAttr.get(m.attr);
			if (!b) { b = { mul: 1, add: 0 }; byAttr.set(m.attr, b); }
			if (m.op === 'override') b.override = m.value;
			else if (m.op === 'mul') b.mul *= m.value;
			else if (m.op === 'add') b.add += m.value;
		}
		for (const key of Object.keys(this.attrs)) {
			const a = this.attrs[key];
			const bag = byAttr.get(key);
			if (!bag) { a.current = a.base; continue; }
			const base = (bag.override !== undefined) ? bag.override : a.base;
			a.current = base * bag.mul + bag.add;
			this.clampAttribute(a);
		}
	}

	public tryActivate(id: AbilityId): boolean {
		const spec = this._abilities.get(id);
		const factory = this._abilityFactory.get(id);
		if (!spec || !factory) return false;

		const reason = this.canActivateReason(id);
		if (reason) {
			// Optional UX/debug hook
			const owner = $.getWorldObject(this.ownerId) as { id: Identifier } | null;
			EventEmitter.instance.emit('AbilityFailed', owner ?? { id: this.ownerId }, { id, reason });
			return false;
		}

		const unique = spec.unique ?? 'ignore';
		if (unique !== 'stack') {
			const existingKey = this.findActiveByAbility(id);
			if (existingKey) {
				if (unique === 'restart') {
					const entry = this._active.get(existingKey);
					if (entry?.wait?.kind === 'event') entry.wait.unsub();
					this._active.delete(existingKey);
				} else {
					return false;
				}
			}
		}

		const ctx: AbilityContext = {
			ownerId: this.ownerId,
			model: this.model,
			asc: { ownerId: this.ownerId, hasTag: (t: TagId) => this.hasGameplayTag(t), tryActivate: (aid: AbilityId) => this.tryActivate(aid) },
			emit: (name: string, payload?: any) => {
				const owner = $.getWorldObject(this.ownerId) as { id: Identifier } | null;
				EventEmitter.instance.emit(name, owner ?? { id: this.ownerId }, payload);
			}
		};
		const ability = factory();
		if (!ability.canActivate(ctx)) return false;

		this.pay(spec);
		const now = this.now();
		if (spec.cooldownMs) {
			this._cooldownUntil.set(id, now + spec.cooldownMs);
			const owner = $.getWorldObject(this.ownerId) as { id: Identifier } | null;
			EventEmitter.instance.emit('AbilityCooldownStart', owner ?? { id: this.ownerId }, { id, until: now + spec.cooldownMs });
		}
		const key = `${id}#${this._runnerCounter++}`;
		this._active.set(key, { id, co: ability.activate(ctx) });
		return true;
	}

	// Called by runtime system each frame
	public step(dtMs: number): void {
		// Effects
		for (let i = this.effects.length - 1; i >= 0; --i) {
			const e = this.effects[i];
			if (e.remainingMs !== Number.POSITIVE_INFINITY) e.remainingMs -= dtMs;
			if (e.effect.periodMs) {
				e.elapsedSinceTickMs += dtMs;
				if (e.elapsedSinceTickMs >= e.effect.periodMs) {
					e.elapsedSinceTickMs = 0;
					// Periodic hooks
					e.effect.onTick?.(this);
					// Recompute attributes only when needed
					if (e.effect.modifiers && e.effect.modifiers.length > 0) this.recomputeAttributes();
				}
			}
			if (e.remainingMs <= 0) this.removeEffect(e.effect.id);
		}

		// Abilities
		const now = this.now();
		// Cooldown end notifications
		for (const [aid, until] of [...this._cooldownUntil]) {
			if (now >= until) {
				this._cooldownUntil.delete(aid);
				const owner = $.getWorldObject(this.ownerId) as { id: Identifier } | null;
				EventEmitter.instance.emit('AbilityCooldownEnd', owner ?? { id: this.ownerId }, { id: aid });
			}
		}
		for (const [key, run] of [...this._active]) {
			// honor waits
			if (run.wait) {
				if (run.wait.kind === 'time') {
					if (now < run.wait.until) continue;
					run.wait = undefined;
				} else if (run.wait.kind === 'tag') {
					const ok = this.hasGameplayTag(run.wait.tag) === run.wait.present;
					if (!ok) continue;
					run.wait = undefined;
				} else if (run.wait.kind === 'event') {
					// event will clear itself via handler
					continue;
				}
			}

			const { done, value } = run.co.next();
			if (done) {
				if (run.wait?.kind === 'event') run.wait.unsub();
				this._active.delete(key);
				continue;
			}
			if (value && isAbilityYield(value) && value.type === 'finish') {
				if (run.wait?.kind === 'event') run.wait.unsub();
				this._active.delete(key);
				continue;
			}
			if (!value || !isAbilityYield(value)) continue;

			switch (value.type) {
				case 'waitTime':
					run.wait = { kind: 'time', until: now + value.ms };
					break;
				case 'waitTag':
					if (this.hasGameplayTag(value.tag) !== value.present) {
						run.wait = { kind: 'tag', tag: value.tag, present: value.present };
					}
					break;
				case 'waitEvent': {
					const name = value.name;
					const scope = value.scope;
					const handler = (_eventName: string) => {
						const ent = this._active.get(key);
						if (!ent) return;
						if (ent.wait?.kind === 'event') {
							ent.wait.unsub();
							ent.wait = undefined;
						}
					};
					let unsub: () => void;
					// Use a unique subscriber token so we can remove precisely this handler
					const token: any = { __ascWait: true, key };
					if (!scope || scope === 'all') {
						const listener = (evName: string) => { if (evName === name) handler(evName) as unknown as (event_name: string, emitter: any, payload?: any) => any; };
						EventEmitter.instance.on(name, listener, token, undefined, false);
						unsub = () => EventEmitter.instance.removeSubscriber(token);
					} else {
						const filter: Identifier = (scope === 'self') ? (this.ownerId as Identifier) : (scope as Identifier);
						const listener = (evName: string) => { if (evName === name) handler(evName) as unknown as (event_name: string, emitter: any, payload?: any) => any; };
						EventEmitter.instance.on(name, listener, token, filter, false);
						unsub = () => EventEmitter.instance.removeSubscriber(token);
					}
					run.wait = { kind: 'event', name, unsub };
					break;
				}
			}
		}
	}

	public canActivateReason(id: AbilityId): string | null {
		const spec = this._abilities.get(id);
		if (!spec) return 'unknown_ability';
		const now = this.now();
		const cdUntil = this._cooldownUntil.get(id);
		if (cdUntil !== undefined && now < cdUntil) return 'cooldown';
		if (spec.requiredTags && !spec.requiredTags.every(t => this.hasGameplayTag(t))) return 'missing_required_tags';
		if (spec.blockedTags && spec.blockedTags.some(t => this.hasGameplayTag(t))) return 'blocked_by_tag';
		if (spec.cost && !this.canPay(spec)) return 'insufficient_resource';
		return null;
	}

	public override dispose(): void {
		// Unsubscribe pending event waits and clear actives
		for (const [, run] of this._active) if (run.wait?.kind === 'event') run.wait.unsub();
		this._active.clear();
		// Clear effects and derived tags
		this.effects.length = 0;
		this.grantedTagRefs.clear();
		// Clear cooldowns
		this._cooldownUntil.clear();
		AbilitySystemComponent.registry.delete(this);
		super.dispose();
	}

	public override detach(): void {
		for (const [, run] of this._active) if (run.wait?.kind === 'event') run.wait.unsub();
		this._active.clear();
		this.effects.length = 0;
		this.grantedTagRefs.clear();
		this._cooldownUntil.clear();
		AbilitySystemComponent.registry.delete(this);
		super.detach();
	}

	private incTagRef(tag: TagId) {
		this.grantedTagRefs.set(tag, (this.grantedTagRefs.get(tag) ?? 0) + 1);
	}
	private decTagRef(tag: TagId) {
		const n = (this.grantedTagRefs.get(tag) ?? 0) - 1;
		if (n > 0) this.grantedTagRefs.set(tag, n);
		else this.grantedTagRefs.delete(tag);
	}

	private findActiveByAbility(id: AbilityId): string | undefined {
		for (const [key, run] of this._active) if (run.id === id) return key;
		return undefined;
	}

	private canPay(spec: AbilitySpec): boolean {
		if (!spec.cost || spec.cost.length === 0) return true;
		for (const c of spec.cost) {
			const a = this.attrs[c.attr];
			if (!a || a.current < c.amount) return false;
		}
		return true;
	}
	private pay(spec: AbilitySpec): void {
		if (!spec.cost) return;
		for (const c of spec.cost) {
			const a = this.attrs[c.attr];
			if (a) { a.current -= c.amount; this.clampAttribute(a); }
		}
	}

	private clampAttribute(a: { current: number; min?: number; max?: number }): void {
		if (a.min !== undefined && a.current < a.min) a.current = a.min;
		if (a.max !== undefined && a.current > a.max) a.current = a.max;
	}
}

function isAbilityYield(x: unknown): x is AbilityYield {
	return !!x && typeof x === 'object' && 'type' in (x as Record<string, unknown>);
}
