import type { BaseModel } from '../core/basemodel';
import { $ } from '../core/game';
import { excludepropfromsavegame } from '../serializer/gameserializer';
import type {
	Ability, AbilityContext, AbilityCoroutine, AbilityId, AbilitySpec,
	ActiveEffect,
	AttributeSet,
	GameplayEffect,
	TagId
} from './types';

type NowFn = () => number;

export class AbilitySystemComponent {
	readonly ownerId: string;

	public readonly attrs: AttributeSet = {};
	public readonly tags: Set<TagId> = new Set();

	private readonly _abilities = new Map<AbilityId, AbilitySpec>();
	private readonly _abilityFactory = new Map<AbilityId, () => Ability>();

	@excludepropfromsavegame
	private readonly _active = new Map<AbilityId, { co: AbilityCoroutine; wait?: unknown }>();

	@excludepropfromsavegame
	private readonly _cooldownUntil = new Map<AbilityId, number>(); // ms timestamp

	@excludepropfromsavegame
	public readonly effects: ActiveEffect[] = [];

	private readonly now: NowFn;

	constructor(ownerId: string, now: NowFn = () => performance.now()) {
		this.ownerId = ownerId;
		this.now = now;
	}

	get model(): BaseModel { return $.model; }

	public addTag(tag: TagId): void { this.tags.add(tag); }
	public removeTag(tag: TagId): void { this.tags.delete(tag); }
	public hasTag(tag: TagId): boolean { return this.tags.has(tag); }

	public grantAbility(spec: AbilitySpec, factory: () => Ability): void {
		this._abilities.set(spec.id, spec);
		this._abilityFactory.set(spec.id, factory);
	}
	public revokeAbility(id: AbilityId): void {
		this._abilities.delete(id);
		this._abilityFactory.delete(id);
		this._active.delete(id);
	}

	public applyEffect(effect: GameplayEffect): void {
		const remaining = effect.durationMs ?? Number.POSITIVE_INFINITY;
		this.effects.push({ effect, remainingMs: remaining, elapsedSinceTickMs: 0 });
		if (effect.grantedTags) for (const t of effect.grantedTags) this.addTag(t);
		if (effect.modifiers && effect.modifiers.length > 0) this.recomputeAttributes();
	}

	public removeEffect(id: string): void {
		const idx = this.effects.findIndex(e => e.effect.id === id);
		if (idx >= 0) {
			const eff = this.effects[idx].effect;
			this.effects.splice(idx, 1);
			if (eff.grantedTags) for (const t of eff.grantedTags) this.removeTag(t);
			if (eff.modifiers && eff.modifiers.length > 0) this.recomputeAttributes();
		}
	}

	public recomputeAttributes(): void {
		const mods = this.effects.flatMap(e => e.effect.modifiers ?? []);
		const byAttr = new Map<string, { override?: number; mul: number; add: number }>();
		for (const m of mods) {
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
		}
	}

	public tryActivate(id: AbilityId): boolean {
		const spec = this._abilities.get(id);
		const factory = this._abilityFactory.get(id);
		if (!spec || !factory) return false;

		const now = this.now();
		const cdUntil = this._cooldownUntil.get(id);
		if (cdUntil !== undefined && now < cdUntil) return false;

		if (spec.requiredTags && !spec.requiredTags.every(t => this.hasTag(t))) return false;
		if (spec.blockedTags && spec.blockedTags.some(t => this.hasTag(t))) return false;

		if (spec.cost && !this.canPay(spec)) return false;

		const ctx: AbilityContext = { ownerId: this.ownerId, model: this.model };
		const ability = factory();
		if (!ability.canActivate(ctx)) return false;

		this.pay(spec);
		if (spec.cooldownMs) this._cooldownUntil.set(id, now + spec.cooldownMs);
		this._active.set(id, { co: ability.activate(ctx) });
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
					this.recomputeAttributes();
				}
			}
			if (e.remainingMs <= 0) this.removeEffect(e.effect.id);
		}

		// Abilities
		for (const [id, runner] of this._active) {
			const { done, value } = runner.co.next();
			if (done || (value && value.type === 'finish')) {
				this._active.delete(id);
				continue;
			}
			if (!value) continue;
			// Minimal interpreter; runtime system can expand with event sleeps
			if (value.type === 'waitTime') {
				const msLeft = value.ms - dtMs;
				if (msLeft > 0) {
					runner.co = (function* resume(ms: number): AbilityCoroutine {
						yield { type: 'waitTime', ms };
					})(msLeft);
				}
			}
		}
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
			if (a) a.current -= c.amount;
		}
	}
}
