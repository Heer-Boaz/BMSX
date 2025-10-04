import { Component, type ComponentAttachOptions } from './basecomponent';
import { EventEmitter } from '../core/eventemitter';
import { $ } from '../core/game';
import type { Identifier } from '../rompack/rompack';
import type { WorldObject } from '../core/object/worldobject';
import { excludepropfromsavegame, insavegame } from '../serializer/serializationhooks';
import { TickGroup } from '../ecs/ecsystem';
import {
	Ability,
	type AbilityContext,
	type AbilityCoroutine,
	type AbilityId,
	type AbilityRequestResult,
	type AbilitySpec,
	type AbilityYield,
	type ActiveEffect,
	type AbilitySystemRef,
	type AttributeSet,
	type GameplayEffect,
	type TagId
} from '../gas/gastypes';
import type { AbilityRuntimeBindings } from '../gas/ability_blueprint';
import { AbilityBlueprint, AbilityActionRegistry, AbilityBlueprintRunner } from '../gas/ability_blueprint';
import { GameplayCommandBuffer } from '../ecs/gameplay_command_buffer';
import type { GameplayCommand } from '../ecs/gameplay_command_buffer';

export type AbilityTagSnapshot = {
	explicit: TagId[];
	granted: Array<{ tag: TagId; stacks: number }>;
	combined: TagId[];
};

type NowFn = () => number;

type WaitState =
	| { kind: 'time'; until: number }
	| { kind: 'tag'; tag: TagId; present: boolean }
	| { kind: 'event'; name: string; unsub: () => void };

@insavegame
export class AbilitySystemComponent extends Component {
	static override get unique(): boolean { return true; }

	public readonly attrs: AttributeSet = {};
	// Explicit tags set by gameplay (not derived from effects)
	public readonly tags: Set<TagId> = new Set();

	private assertExplicitTagMutationAllowed(op: 'add' | 'remove', tag: TagId): void {
		const phase = $.world.currentPhase;
		// Allow mutations while the world is constructing objects (no active phase yet)
		if (phase === null) return;
		if (phase === TickGroup.AbilityUpdate || phase === TickGroup.ModeResolution) return;
		const phaseName = TickGroup[phase] ?? `${phase}`;
		throw new Error(`Gameplay tag '${tag}' ${op} denied: phase '${phaseName}' is not permitted. Only AbilityUpdate (Phase 2) or ModeResolution (Phase 3) may mutate gameplay tags.`);
	}

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

	@excludepropfromsavegame
	private _ref?: AbilitySystemRef;

	private _runnerCounter = 0;

	public requestAbility(id: AbilityId, opts: { source?: string; payload?: Record<string, unknown> } = {}): AbilityRequestResult {
		const reason = this.canActivateReason(id);
		if (reason) {
			this.notifyAbilityFailed(id, reason);
			return { ok: false as const, reason };
		}
		GameplayCommandBuffer.instance.push({ kind: 'ActivateAbility', owner: this.parentid, ability_id: id, payload: opts.payload, source: opts.source });
		return { ok: true as const };
	}

	constructor(opts: ComponentAttachOptions & { now?: NowFn }) {
		super(opts);
		// Normalize the time provider so calling this.now() never loses the receiver.
		// If a custom provider is supplied, use it. Otherwise bind performance.now
		// to the performance object (avoids "Illegal invocation"), or fall back to Date.now.
		if (opts.now) {
			this.now = opts.now;
		} else if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
			this.now = performance.now.bind(performance);
		} else {
			this.now = Date.now.bind(Date);
		}
	}

	public addTag(tag: TagId): void {
		this.assertExplicitTagMutationAllowed('add', tag);
		this.tags.add(tag);
	}
	public removeTag(tag: TagId): void {
		this.assertExplicitTagMutationAllowed('remove', tag);
		this.tags.delete(tag);
	}
	public hasGameplayTag(tag: TagId): boolean { return this.tags.has(tag) || ((this.grantedTagRefs.get(tag) ?? 0) > 0); }

	public snapshotTags(): AbilityTagSnapshot {
		const explicitList: TagId[] = [];
		for (const tag of this.tags.values()) {
			explicitList.push(tag);
		}
		explicitList.sort((a, b) => a.localeCompare(b));
		const grantedList: Array<{ tag: TagId; stacks: number }> = [];
		for (const entry of this.grantedTagRefs.entries()) {
			const stacks = entry[1];
			if (stacks <= 0) {
				continue;
			}
			grantedList.push({ tag: entry[0], stacks });
		}
		grantedList.sort((a, b) => a.tag.localeCompare(b.tag));
		const combined: TagId[] = [];
		for (const tag of explicitList) combined.push(tag);
		for (const entry of grantedList) {
			if (this.tags.has(entry.tag)) {
				continue;
			}
			combined.push(entry.tag);
		}
		combined.sort((a, b) => a.localeCompare(b));
		return { explicit: explicitList, granted: grantedList, combined };
	}

	public grantAbility(spec: AbilitySpec, factory: () => Ability): void {
		this._abilities.set(spec.id, spec);
		this._abilityFactory.set(spec.id, factory);
	}

	public grantBlueprint(blueprint: AbilityBlueprint, actions: AbilityActionRegistry): void {
		this.grantAbility(blueprint, () => new BlueprintAbility(this, blueprint, actions));
	}
	public revokeAbility(id: AbilityId): void {
		this._abilities.delete(id);
		this._abilityFactory.delete(id);
		// remove any active instances of this ability
		for (const [key, run] of [...this._active]) {
			if (run.id !== id) continue;
			this.stopAbilityRun(key, run);
		}
	}

	public applyEffect(effect: GameplayEffect): void {
		const duration = effect.durationMs;
		const remaining = duration === undefined ? Number.POSITIVE_INFINITY : Math.max(0, duration);
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

	public tryActivate(id: AbilityId, payload?: Record<string, unknown>): boolean {
		const spec = this._abilities.get(id);
		const factory = this._abilityFactory.get(id);
		if (!spec || !factory) return false;

		const reason = this.canActivateReason(id);
		if (reason) {
			// Optional UX/debug hook
			const owner = this.ownerOrThrow();
			$.emitGameplay('AbilityFailed', owner, { id, reason });
			return false;
		}

		const unique = spec.unique ?? 'ignore';
		if (unique !== 'stack') {
			const existingKey = this.findActiveByAbility(id);
			if (existingKey) {
				if (unique === 'restart') {
					const entry = this._active.get(existingKey);
					if (entry) this.stopAbilityRun(existingKey, entry);
				} else {
					return false;
				}
			}
		}

		const ctx: AbilityContext = {
			parentid: this.parentid,
			asc: this.ref(),
			emit: (name: string, payload?: unknown) => {
				const owner = this.ownerOrThrow();
				EventEmitter.instance.emit(name, owner, payload);
			},
			intent: { id, payload }
		};
		const ability = factory();
		if (!ability.canActivate(ctx)) return false;

		this.pay(spec);
		const now = this.now();
		if (spec.cooldownMs) {
			this._cooldownUntil.set(id, now + spec.cooldownMs);
			const owner = this.ownerOrThrow();
			EventEmitter.instance.emit('AbilityCooldownStart', owner, { id, until: now + spec.cooldownMs });
		}
		const key = `${id}#${this._runnerCounter++}`;
		this._active.set(key, { id, co: ability.activate(ctx) });
		return true;
	}

	// Called by runtime system each frame
	public step(dtMs: number): void {
		// Effects
		let needRecompute = false;
		for (let i = this.effects.length - 1; i >= 0; --i) {
			const entry = this.effects[i]!;
			const effect = entry.effect;
			if (entry.remainingMs !== Number.POSITIVE_INFINITY) entry.remainingMs -= dtMs;
			const period = effect.periodMs ?? 0;
			if (period > 0) {
				entry.elapsedSinceTickMs += dtMs;
				while (entry.elapsedSinceTickMs >= period) {
					entry.elapsedSinceTickMs -= period;
					effect.onTick?.(this.ref());
					if (effect.modifiers && effect.modifiers.length > 0) needRecompute = true;
				}
			}
			if (entry.remainingMs <= 0) {
				this.effects.splice(i, 1);
				if (effect.grantedTags) {
					for (const tag of effect.grantedTags) this.decTagRef(tag);
				}
				if (effect.modifiers && effect.modifiers.length > 0) needRecompute = true;
				continue;
			}
		}
		if (needRecompute) this.recomputeAttributes();

		// Abilities
		const now = this.now();
		// Cooldown end notifications
		for (const [aid, until] of [...this._cooldownUntil]) {
			if (now >= until) {
				this._cooldownUntil.delete(aid);
				const owner = this.ownerOrThrow();
				EventEmitter.instance.emit('AbilityCooldownEnd', owner, { id: aid });
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
				this.stopAbilityRun(key, run);
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
						const listener = (evName: string) => { if (evName === name) handler(evName); };
						EventEmitter.instance.on(name, listener, token, undefined, false);
						unsub = () => EventEmitter.instance.removeSubscriber(token);
					} else {
						const filter: Identifier = (scope === 'self') ? (this.parentid as Identifier) : (scope as Identifier);
						const listener = (evName: string) => { if (evName === name) handler(evName); };
						EventEmitter.instance.on(name, listener, token, filter, false);
						unsub = () => EventEmitter.instance.removeSubscriber(token);
					}
					run.wait = { kind: 'event', name, unsub };
					break;
				}
			}
		}
	}

	private ref(): AbilitySystemRef {
		if (!this._ref) {
			this._ref = {
				parentid: this.parentid,
				hasTag: (tag: TagId) => this.hasGameplayTag(tag),
				tryActivate: (abilityId: AbilityId, payload?: Record<string, unknown>) => this.tryActivate(abilityId, payload),
				requestAbility: (abilityId: AbilityId, opts?: { source?: string; payload?: Record<string, unknown> }) => this.requestAbility(abilityId, opts ?? {})
			};
		} else {
			this._ref.parentid = this.parentid;
		}
		return this._ref;
	}

	public canActivateReason(id: AbilityId): string | null {
		const spec = this._abilities.get(id);
		if (!spec) return `unknown ability: '${id}'`;
		const now = this.now();
		const cdUntil = this._cooldownUntil.get(id);
		if (cdUntil !== undefined && now < cdUntil) return `on cooldown: ${cdUntil - now}`;
		if (spec.requiredTags && !spec.requiredTags.every(t => this.hasGameplayTag(t))) return `missing required tags: ${spec.requiredTags.filter(t => !this.hasGameplayTag(t)).join(',')}`;
		if (spec.blockedTags && spec.blockedTags.some(t => this.hasGameplayTag(t))) return `blocked by tag: ${spec.blockedTags.filter(t => this.hasGameplayTag(t)).join(',')}`;
		if (spec.cost && !this.canPay(spec)) return `insufficient resource: ${spec.cost.map(c => `${c.amount} ${c.attr}`).join(',')}`;
		return null;
	}

	public override dispose(): void {
		// Unsubscribe pending event waits and clear actives
		for (const [key, run] of [...this._active]) {
			this.stopAbilityRun(key, run);
		}
		// Clear effects and derived tags
		this.effects.length = 0;
		this.grantedTagRefs.clear();
		// Clear cooldowns
		this._cooldownUntil.clear();
		super.dispose();
	}

	public override detach(): void {
		for (const [key, run] of [...this._active]) {
			this.stopAbilityRun(key, run);
		}
		this.effects.length = 0;
		this.grantedTagRefs.clear();
		this._cooldownUntil.clear();
		super.detach();
	}

	public getAbilityOwner(): WorldObject {
		return this.ownerOrThrow();
	}

	public createBlueprintRuntimeBindings(owner: WorldObject): AbilityRuntimeBindings {
		const ownerId = this.parentid;
		return {
			owner,
			ownerId,
			hasTag: (tag: TagId) => this.hasGameplayTag(tag),
			addTag: (tag: TagId) => this.addTag(tag),
			removeTag: (tag: TagId) => this.removeTag(tag),
			dispatchMode: (event: string, payload: Record<string, unknown> | undefined, target: Identifier | undefined) => this.dispatchBlueprintModeEvent(ownerId, event, payload, target),
			emitGameplay: (event: string, payload: unknown) => $.emitGameplay(event, owner, payload),
			pushCommand: (command: GameplayCommand) => GameplayCommandBuffer.instance.push(command),
			requestAbility: (abilityId: AbilityId, opts?: { source?: string; payload?: Record<string, unknown> }) => this.requestAbility(abilityId, opts ?? {}),
		};
	}

	private incTagRef(tag: TagId) {
		this.grantedTagRefs.set(tag, (this.grantedTagRefs.get(tag) ?? 0) + 1);
	}

	private decTagRef(tag: TagId) {
		const n = (this.grantedTagRefs.get(tag) ?? 0) - 1;
		if (n > 0) this.grantedTagRefs.set(tag, n);
		else this.grantedTagRefs.delete(tag);
	}

	private dispatchBlueprintModeEvent(ownerId: Identifier, event: string, payload: Record<string, unknown> | undefined, target: Identifier | undefined): void {
		const targetId = target ?? ownerId;
		GameplayCommandBuffer.instance.push({
			kind: 'dispatchEvent',
			event,
			target_id: targetId,
			emitter_id: ownerId,
			payload,
		});
	}

	private stopAbilityRun(key: string, run: { id: AbilityId; co: AbilityCoroutine; wait?: WaitState }): void {
		if (run.wait && run.wait.kind === 'event') {
			run.wait.unsub();
		}
		const ret = run.co.return;
		if (typeof ret === 'function') {
			try {
				ret.call(run.co);
			} catch (error) {
				console.warn('[AbilitySystemComponent] Ability coroutine return failed', { id: run.id, error });
			}
		}
		this._active.delete(key);
	}

	private notifyAbilityFailed(id: AbilityId, reason: string): void {
		const owner = this.ownerOrThrow();
		$.emitGameplay('AbilityFailed', owner, { id, reason });
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

	private ownerOrThrow(): WorldObject {
		const owner = $.world.getWorldObject(this.parentid);
		if (!owner) throw new Error(`[AbilitySystemComponent] Owner '${this.parentid}' not found.`);
		return owner;
	}
}

class BlueprintAbility extends Ability {
	private readonly component: AbilitySystemComponent;
	private readonly blueprint: AbilityBlueprint;
	private readonly actions: AbilityActionRegistry;

	constructor(component: AbilitySystemComponent, blueprint: AbilityBlueprint, actions: AbilityActionRegistry) {
		super(blueprint.id, blueprint.unique);
		this.component = component;
		this.blueprint = blueprint;
		this.actions = actions;
	}

	public override activate(ctx: AbilityContext): AbilityCoroutine {
		const owner = this.component.getAbilityOwner();
		const runtimeBindings = this.component.createBlueprintRuntimeBindings(owner);
		const intent = ctx.intent;
		let intentPayload: Record<string, unknown> | undefined;
		if (intent && intent.payload) intentPayload = intent.payload;
		return AbilityBlueprintRunner.createCoroutine(this.blueprint, {
			runtime: runtimeBindings,
			actionRegistry: this.actions,
			intentPayload,
		});
	}
}

function isAbilityYield(x: unknown): x is AbilityYield {
	return !!x && typeof x === 'object' && 'type' in (x as Record<string, unknown>);
}
