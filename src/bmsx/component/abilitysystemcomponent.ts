import { Component, type ComponentAttachOptions } from './basecomponent';
import { EventEmitter } from '../core/eventemitter';
import { $ } from '../core/game';
import type { Identifier } from '../rompack/rompack';
import type { WorldObject } from '../core/object/worldobject';
import { excludepropfromsavegame, insavegame } from '../serializer/serializationhooks';
import { TickGroup } from '../ecs/ecsystem';
import { abilityRegistry, gameplayActions } from '../gas/ability_registry';
import {
	type AbilityId,
	type AbilityPayloadFor,
	type AbilityRequestOptions,
	type AbilityRequestResult,
	type AbilitySpec,
	type ActiveEffect,
	type AbilitySystemRef,
	type AttributeSet,
	type GameplayEffect,
	type TagId,
} from '../gas/gastypes';
import {
	GameplayActionRegistry,
	GameplayAbilityExecution,
	type AbilityWaitInstruction,
	type GameplayAbilityDefinition
} from '../gas/gameplay_ability';
import { GameplayCommandBuffer } from '../ecs/gameplay_command_buffer';
import type { GameplayCommand } from '../ecs/gameplay_command_buffer';
import { GameEvent } from '../core/game_event';

export type AbilityTagSnapshot = {
	explicit: TagId[];
	granted: Array<{ tag: TagId; stacks: number }>;
	combined: TagId[];
};

type EventWaitState = { kind: 'event'; instruction: AbilityWaitInstruction & { kind: 'event' }; unsub: () => void };

type WaitState =
	| { kind: 'time'; until: number }
	| { kind: 'tag'; tag: TagId; present: boolean }
	| EventWaitState;

type ActiveAbilityRun = {
	id: AbilityId;
	definition: GameplayAbilityDefinition;
	execution: GameplayAbilityExecution;
	wait?: WaitState;
	granted_tags: TagId[];
	remove_on_end: TagId[];
};

type TagMutationOperation = 'add' | 'remove';
const TagMutationPhases = new Set([null, TickGroup.AbilityUpdate, TickGroup.ModeResolution, TickGroup.Animation ]);

@insavegame
export class AbilitySystemComponent extends Component {
	static override get unique(): boolean { return true; }

	public readonly attrs: AttributeSet = {};
	// Explicit tags set by gameplay (not derived from effects)
	public readonly tags: Set<TagId> = new Set();

	private assertExplicitTagMutationAllowed(op: TagMutationOperation, tag: TagId): void {
		const phase = $.world.currentPhase;
		// Allow mutations while the world is constructing objects (no active phase yet)
		if (TagMutationPhases.has(phase)) return;
		const phaseName = TickGroup[phase] ?? `${phase}`;
		throw new Error(`Gameplay tag '${tag}' ${op} denied: phase '${phaseName}' is not permitted. Only AbilityUpdate (Phase 2), ModeResolution (Phase 3), or Animation (Phase 5) may mutate gameplay tags.`);
	}

	// Reference counts for effect-granted tags
	@excludepropfromsavegame
	private readonly grantedTagRefs = new Map<TagId, number>();

	private readonly _abilities = new Map<AbilityId, GameplayAbilityDefinition>();
	private readonly _gameplayActions = new Map<AbilityId, GameplayActionRegistry>();

	@excludepropfromsavegame
	private readonly _active = new Map<string, ActiveAbilityRun>();

	@excludepropfromsavegame
	private readonly _cooldownUntil = new Map<AbilityId, number>(); // ms timestamp

	@excludepropfromsavegame
	public readonly effects: ActiveEffect[] = [];

	@excludepropfromsavegame
	private _timeMs = 0;

	@excludepropfromsavegame
	private _ref?: AbilitySystemRef;

	private _runnerCounter = 0;

	public request_ability<Id extends AbilityId>(id: Id, opts?: AbilityRequestOptions<Id>): AbilityRequestResult {
		const payload = opts && 'payload' in opts ? (opts as { payload?: AbilityPayloadFor<Id> }).payload : undefined;
		abilityRegistry.validate(id, payload);
		const failure = this.can_activate_reason(id);
		if (failure) {
			this.notify_ability_failed(id, failure);
			if (this.isStructuralActivationFailure(failure)) {
				throw new Error(`[AbilitySystemComponent] Ability '${id}' request on '${this.parent?.id}' failed: ${failure}`);
			}
			return { ok: false as const, reason: failure };
		}
		const command: GameplayCommand = {
			kind: 'activateability',
			owner: this.parent.id,
			ability_id: id,
		};
	if (payload !== undefined) (command as any).payload = payload as AbilityPayloadFor<AbilityId>;
		GameplayCommandBuffer.instance.push(command);
		return { ok: true };
	}

	constructor(opts: ComponentAttachOptions) {
		super(opts);
	}

	public add_tag(tag: TagId): void {
		this.assertExplicitTagMutationAllowed('add', tag);
		this.tags.add(tag);
	}
	public remove_tag(tag: TagId): void {
		this.assertExplicitTagMutationAllowed('remove', tag);
		this.tags.delete(tag);
	}

	public add_tags(...tags: TagId[]): void {
		for (const tag of tags) this.add_tag(tag);
	}

	public remove_tags(...tags: TagId[]): void {
		for (const tag of tags) this.remove_tag(tag);
	}

	public has_tag(tag: TagId): boolean {
		return this.tags.has(tag);
	}

	public has_all_tags(...tags: TagId[]): boolean {
		return tags.every(tag => this.has_processing_tag(tag));
	}

	public has_any_tag(...tags: TagId[]): boolean {
		return tags.some(tag => this.has_processing_tag(tag));
	}

	public toggle_tag(tag: TagId): void {
		if (this.tags.has(tag)) {
			this.remove_tag(tag);
		} else if (this.grantedTagRefs.has(tag)) {
			throw new Error(`[AbilitySystemComponent] Cannot toggle granted tag '${tag}'.`);
		} else {
			this.add_tags(tag);
		}
	}

	public toggle_tags(...tags: TagId[]): void {
		for (const tag of tags) this.toggle_tag(tag);
	}
	public has_gameplay_tag(tag: TagId): boolean { return this.tags.has(tag) || ((this.grantedTagRefs.get(tag) ?? 0) > 0); }

	public snapshot_tags(): AbilityTagSnapshot {
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

	public grant_ability(definition: GameplayAbilityDefinition, actions?: GameplayActionRegistry): void {
		if (!definition || !definition.id) {
			throw new Error('[AbilitySystemComponent] Cannot grant ability without a valid definition id.');
		}
		const registry = actions ?? gameplayActions;
		this._abilities.set(definition.id, definition);
		this._gameplayActions.set(definition.id, registry);
	}
	public has_ability(id: AbilityId): boolean {
		return this._abilities.has(id);
	}
	public revoke_ability(id: AbilityId): void {
		this._abilities.delete(id);
		this._gameplayActions.delete(id);
		// remove any active instances of this ability
		for (const [key, run] of [...this._active]) {
			if (run.id !== id) continue;
			this.cancelAbilityRun(key, run);
		}
	}

	public apply_effect(effect: GameplayEffect): void {
		const duration = effect.durationMs;
		const remaining = duration === undefined ? Number.POSITIVE_INFINITY : Math.max(0, duration);
		this.effects.push({ effect, remainingMs: remaining, elapsedSinceTickMs: 0 });
		if (effect.grantedTags) for (const t of effect.grantedTags) this.incTagRef(t);
		if (effect.modifiers && effect.modifiers.length > 0) this.recompute_attributes();
	}

	public remove_effect(id: string): void {
		const idx = this.effects.findIndex(e => e.effect.id === id);
		if (idx >= 0) {
			const eff = this.effects[idx].effect;
			this.effects.splice(idx, 1);
			if (eff.grantedTags) for (const t of eff.grantedTags) this.decTagRef(t);
			if (eff.modifiers && eff.modifiers.length > 0) this.recompute_attributes();
		}
	}

	public recompute_attributes(): void {
		const mods = this.effects.flatMap(e => e.effect.modifiers ?? []);
		const byAttr = new Map<string, { override?: number; mul: number; add: number }>();
		for (const m of mods) {
			// Ignore modifiers for unknown attributes
			if (!this.attrs[m.attr]) continue;
			let b = byAttr.get(m.attr);
			if (!b) { b = { mul: 1, add: 0 }; byAttr.set(m.attr, b); }
			switch (m.op) {
				case 'override':
					b.override = m.value;
					break;
				case 'mul':
					b.mul *= m.value;
					break;
				case 'add':
					b.add += m.value;
					break;
			}
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

	public try_activate<Id extends AbilityId>(id: Id, payload?: AbilityPayloadFor<Id>): boolean {
		const definition = this._abilities.get(id);
		const actions = this._gameplayActions.get(id);
		if (!definition || !actions) return false;
		abilityRegistry.validate(id, payload);

		const reason = this.can_activate_reason(id);
		if (reason) {
			this.notify_ability_failed(id, reason, 'AbilitySystemComponent.tryActivate');
			return false;
		}

		const unique = definition.unique ?? 'ignore';
		if (unique !== 'stack') {
			const existingKey = this.find_active_by_ability(id);
			if (existingKey) {
				if (unique === 'restart') {
					const entry = this._active.get(existingKey);
					if (entry) this.cancelAbilityRun(existingKey, entry);
				} else {
					return false;
				}
			}
		}

		const owner = this.ownerOrThrow();
		const execution = new GameplayAbilityExecution(definition, this, actions, owner, payload);

		this.pay(definition);
		const now = this.current_time_ms();
		if (definition.cooldownMs) {
			const until = now + definition.cooldownMs;
			this._cooldownUntil.set(id, until);
			owner.events.emit('AbilityCooldownStart', { id, until });
		}

		const grantedTags: TagId[] = [];
		const removeOnEnd: TagId[] = [];
		const tagOps = definition.tags;
		if (tagOps) {
			if (tagOps.grant) {
				for (let i = 0; i < tagOps.grant.length; i++) {
					const tag = tagOps.grant[i];
					if (!tag) continue;
					this.add_tag(tag);
					grantedTags.push(tag);
				}
			}
			if (tagOps.removeOnActivate) {
				for (let i = 0; i < tagOps.removeOnActivate.length; i++) {
					const tag = tagOps.removeOnActivate[i];
					if (!tag) continue;
					this.remove_tag(tag);
				}
			}
			if (tagOps.removeOnEnd) {
				for (let i = 0; i < tagOps.removeOnEnd.length; i++) {
					const tag = tagOps.removeOnEnd[i];
					if (tag) removeOnEnd.push(tag);
				}
			}
		}

		const key = `${id}#${this._runnerCounter++}`;
		this._active.set(key, {
			id,
			definition,
			execution,
			granted_tags: grantedTags,
			remove_on_end: removeOnEnd,
		});
		return true;
	}

	// Called by runtime system each frame
	public step(dtMs: number): void {
		if (!Number.isFinite(dtMs)) {
			throw new Error('[AbilitySystemComponent] step received invalid delta time.');
		}
		this._timeMs += dtMs;
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
		if (needRecompute) this.recompute_attributes();

		// Abilities
		const now = this.current_time_ms();
		for (const [aid, until] of [...this._cooldownUntil]) {
			if (now >= until) {
				this._cooldownUntil.delete(aid);
				const owner = this.ownerOrThrow();
				owner.events.emit('AbilityCooldownEnd', { id: aid });
			}
		}
		for (const [key, run] of [...this._active]) {
			if (run.wait) {
				switch (run.wait.kind) {
					case 'time':
						if (now < run.wait.until) continue;
						run.wait = undefined;
						break;
					case 'tag': {
						const satisfied = this.has_gameplay_tag(run.wait.tag) === run.wait.present;
						if (!satisfied) continue;
						run.wait = undefined;
						break;
					}
					case 'event':
						// Event listeners clear the wait state when delivered.
						continue;
				}
			}

			const result = run.execution.advance(now);
			if (result.kind === 'wait') {
				this.applyWaitState(key, run, result.wait);
				continue;
			}
			if (result.kind === 'completed') {
				this.finishAbilityRun(key, run);
			}
		}
	}

	private ref(): AbilitySystemRef {
		if (!this._ref) {
			this._ref = {
				owner: this.parent,
				hasTag: (tag: TagId) => this.has_gameplay_tag(tag),
				tryActivate: <Id extends AbilityId>(abilityId: Id, payload?: AbilityPayloadFor<Id>) => this.try_activate(abilityId, payload),
				requestAbility: <Id extends AbilityId>(abilityId: Id, opts?: AbilityRequestOptions<Id>) => this.request_ability(abilityId, opts),
			};
		} else {
			this._ref.owner = this.parent;
		}
		return this._ref;
	}

	public can_activate_reason(id: AbilityId): string | null {
		const spec = this._abilities.get(id);
		if (!spec) return `unknown ability: '${id}'`;
		const now = this.current_time_ms();
		const cdUntil = this._cooldownUntil.get(id);
		if (cdUntil !== undefined && now < cdUntil) return `on cooldown: ${cdUntil - now}`;
		if (spec.requiredTags && !spec.requiredTags.every(t => this.has_gameplay_tag(t))) {
			const missing = spec.requiredTags.filter(t => !this.has_gameplay_tag(t));
			return `missing required tags: ${missing.join(',')}`;
		}
		if (spec.blockedTags && spec.blockedTags.some(t => this.has_gameplay_tag(t))) {
			const blocking = spec.blockedTags.filter(t => this.has_gameplay_tag(t));
			return `blocked by tags: ${blocking.join(',')}`;
		}
		if (spec.cost && !this.can_pay(spec)) return `insufficient resource: ${spec.cost.map(c => `${c.amount} ${c.attr}`).join(',')}`;
		return null;
	}

	public override dispose(): void {
		// Unsubscribe pending event waits and clear actives
		for (const [key, run] of [...this._active]) {
			this.cancelAbilityRun(key, run);
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
			this.cancelAbilityRun(key, run);
		}
		this.effects.length = 0;
		this.grantedTagRefs.clear();
		this._cooldownUntil.clear();
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

	private applyWaitState(key: string, run: ActiveAbilityRun, instruction: AbilityWaitInstruction): void {
		if (run.wait && run.wait.kind === 'event') run.wait.unsub();
			switch (instruction.kind) {
			case 'time':
				run.wait = { kind: 'time', until: instruction.until };
				return;
			case 'tag': {
				const satisfied = this.has_gameplay_tag(instruction.tag) === instruction.present;
				if (satisfied) {
					run.wait = undefined;
				} else {
					run.wait = { kind: 'tag', tag: instruction.tag, present: instruction.present };
				}
				return;
			}
			case 'event': {
				const token: any = { __ascWait: true, key };
				const listener = (_event: GameEvent) => {
					const entry = this._active.get(key);
					if (!entry) return;
					const pending = entry.wait;
					if (pending && pending.kind === 'event') {
						pending.unsub();
						entry.wait = undefined;
					}
				};
				const options: { emitter?: Identifier; persistent?: boolean } = { persistent: false };
				if (instruction.emitter) options.emitter = instruction.emitter;
				EventEmitter.instance.on(instruction.event, listener, token, options, false);
				const unsub = () => EventEmitter.instance.removeSubscriber(token);
				run.wait = { kind: 'event', instruction, unsub };
				return;
			}
		}
	}

	private finishAbilityRun(key: string, run: ActiveAbilityRun): void {
		if (run.wait && run.wait.kind === 'event') run.wait.unsub();
		run.wait = undefined;
		this.cleanupAbilityTags(run);
		this._active.delete(key);
	}

	private cancelAbilityRun(key: string, run: ActiveAbilityRun): void {
		if (run.wait && run.wait.kind === 'event') run.wait.unsub();
		run.wait = undefined;
		try {
			run.execution.cancel();
		} catch (error) {
			console.warn('[AbilitySystemComponent] Ability cancel handler failed', { id: run.id, error });
		}
		this.cleanupAbilityTags(run);
		this._active.delete(key);
	}

	private cleanupAbilityTags(run: ActiveAbilityRun): void {
		for (let i = 0; i < run.granted_tags.length; i++) {
			const tag = run.granted_tags[i];
			if (tag) this.remove_tag(tag);
		}
		for (let i = 0; i < run.remove_on_end.length; i++) {
			const tag = run.remove_on_end[i];
			if (tag) this.remove_tag(tag);
		}
	}

	private current_time_ms(): number {
		return this._timeMs;
	}

	private notify_ability_failed(id: AbilityId, reason: string, source?: string): void {
		const owner = this.ownerOrThrow();
		const now = this.current_time_ms();
		const cdUntil = this._cooldownUntil.get(id);
		const timeLeftMs = cdUntil !== undefined ? Math.max(0, cdUntil - now) : undefined;
		const detail: Record<string, unknown> = { id, reason };
		if (source !== undefined) detail.source = source;
		if (timeLeftMs !== undefined) detail.timeLeftMs = timeLeftMs;
		owner.events.emit('AbilityFailed', detail);
	}

	private find_active_by_ability(id: AbilityId): string | undefined {
		for (const [key, run] of this._active) if (run.id === id) return key;
		return undefined;
	}

	private can_pay(spec: AbilitySpec): boolean {
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
		const owner = this.parent;
		if (!owner) throw new Error(`[AbilitySystemComponent] Owner '${this.parent?.id}' not found.`);
		return owner;
	}

	private isStructuralActivationFailure(reason: string): boolean {
		return reason.startsWith('unknown ability:');
	}
}
