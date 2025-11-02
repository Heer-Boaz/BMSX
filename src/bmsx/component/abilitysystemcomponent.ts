import { Component, type ComponentAttachOptions } from './basecomponent';
import { EventEmitter, type EventLane, type EventPayload, type StructuredEventPayload } from '../core/eventemitter';
import { $ } from '../core/game';
import type { Identifier } from '../rompack/rompack';
import type { WorldObject } from '../core/object/worldobject';
import { excludepropfromsavegame, insavegame } from '../serializer/serializationhooks';
import { TickGroup } from '../ecs/ecsystem';
import { abilityRegistry, abilityActions } from '../gas/ability_registry';
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
	AbilityActionRegistry,
	GameplayAbilityExecution,
	type AbilityRuntimeBindings,
	type AbilityWaitInstruction,
	type GameplayAbilityDefinition
} from '../gas/gameplay_ability';
import { GameplayCommandBuffer } from '../ecs/gameplay_command_buffer';
import type { GameplayCommand } from '../ecs/gameplay_command_buffer';

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
	grantedTags: TagId[];
	removeOnEnd: TagId[];
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
	private readonly _abilityActions = new Map<AbilityId, AbilityActionRegistry>();

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

	public requestAbility<Id extends AbilityId>(id: Id, opts?: AbilityRequestOptions<Id>): AbilityRequestResult {
		const payload = opts && 'payload' in opts ? (opts as { payload?: AbilityPayloadFor<Id> }).payload : undefined;
		abilityRegistry.validate(id, payload);
		const failure = this.canActivateReason(id);
		if (failure) {
			this.notifyAbilityFailed(id, failure);
			return { ok: false as const, reason: failure };
		}
		const command: GameplayCommand = {
			kind: 'activateability',
			owner: this.parentid,
			ability_id: id,
		};
	if (payload !== undefined) (command as any).payload = payload as AbilityPayloadFor<AbilityId>;
		GameplayCommandBuffer.instance.push(command);
		return { ok: true };
	}

	constructor(opts: ComponentAttachOptions) {
		super(opts);
	}

	public addTag(tag: TagId): void {
		this.assertExplicitTagMutationAllowed('add', tag);
		this.tags.add(tag);
	}
	public removeTag(tag: TagId): void {
		this.assertExplicitTagMutationAllowed('remove', tag);
		this.tags.delete(tag);
	}

	public addTags(...tags: TagId[]): void {
		for (const tag of tags) this.addTag(tag);
	}

	public removeTags(...tags: TagId[]): void {
		for (const tag of tags) this.removeTag(tag);
	}

	public hasTag(tag: TagId): boolean {
		return this.tags.has(tag);
	}

	public hasAllTags(...tags: TagId[]): boolean {
		return tags.every(tag => this.hasProcessingTag(tag));
	}

	public hasAnyTag(...tags: TagId[]): boolean {
		return tags.some(tag => this.hasProcessingTag(tag));
	}

	public toggleTag(tag: TagId): void {
		if (this.tags.has(tag)) {
			this.removeTag(tag);
		} else if (this.grantedTagRefs.has(tag)) {
			throw new Error(`[AbilitySystemComponent] Cannot toggle granted tag '${tag}'.`);
		} else {
			this.addTags(tag);
		}
	}

	public toggleTags(...tags: TagId[]): void {
		for (const tag of tags) this.toggleTag(tag);
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

	public grantAbility(definition: GameplayAbilityDefinition, actions?: AbilityActionRegistry): void {
		if (!definition || !definition.id) {
			throw new Error('[AbilitySystemComponent] Cannot grant ability without a valid definition id.');
		}
		const registry = actions ?? abilityActions;
		this._abilities.set(definition.id, definition);
		this._abilityActions.set(definition.id, registry);
	}
	public hasAbility(id: AbilityId): boolean {
		return this._abilities.has(id);
	}
	public revokeAbility(id: AbilityId): void {
		this._abilities.delete(id);
		this._abilityActions.delete(id);
		// remove any active instances of this ability
		for (const [key, run] of [...this._active]) {
			if (run.id !== id) continue;
			this.cancelAbilityRun(key, run);
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

	public tryActivate<Id extends AbilityId>(id: Id, payload?: AbilityPayloadFor<Id>): boolean {
		const definition = this._abilities.get(id);
		const actions = this._abilityActions.get(id);
		if (!definition || !actions) return false;
		abilityRegistry.validate(id, payload);

		const reason = this.canActivateReason(id);
		if (reason) {
			this.notifyAbilityFailed(id, reason, 'AbilitySystemComponent.tryActivate');
			return false;
		}

		const unique = definition.unique ?? 'ignore';
		if (unique !== 'stack') {
			const existingKey = this.findActiveByAbility(id);
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
		const runtime = this.createRuntimeBindings(owner);
		const execution = new GameplayAbilityExecution(definition, runtime, actions, payload as EventPayload);

		this.pay(definition);
		const now = this.currentTimeMs();
		if (definition.cooldownMs) {
			const until = now + definition.cooldownMs;
			this._cooldownUntil.set(id, until);
			EventEmitter.instance.emit('AbilityCooldownStart', owner, { id, until });
		}

		const grantedTags: TagId[] = [];
		const removeOnEnd: TagId[] = [];
		const tagOps = definition.tags;
		if (tagOps) {
			if (tagOps.grant) {
				for (let i = 0; i < tagOps.grant.length; i++) {
					const tag = tagOps.grant[i];
					if (!tag) continue;
					this.addTag(tag);
					grantedTags.push(tag);
				}
			}
			if (tagOps.removeOnActivate) {
				for (let i = 0; i < tagOps.removeOnActivate.length; i++) {
					const tag = tagOps.removeOnActivate[i];
					if (!tag) continue;
					this.removeTag(tag);
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
			grantedTags,
			removeOnEnd,
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
		if (needRecompute) this.recomputeAttributes();

		// Abilities
		const now = this.currentTimeMs();
		for (const [aid, until] of [...this._cooldownUntil]) {
			if (now >= until) {
				this._cooldownUntil.delete(aid);
				const owner = this.ownerOrThrow();
				EventEmitter.instance.emit('AbilityCooldownEnd', owner, { id: aid });
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
						const satisfied = this.hasGameplayTag(run.wait.tag) === run.wait.present;
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
				parentid: this.parentid,
				hasTag: (tag: TagId) => this.hasGameplayTag(tag),
				tryActivate: <Id extends AbilityId>(abilityId: Id, payload?: AbilityPayloadFor<Id>) => this.tryActivate(abilityId, payload),
				requestAbility: <Id extends AbilityId>(abilityId: Id, opts?: AbilityRequestOptions<Id>) => this.requestAbility(abilityId, opts),
			};
		} else {
			this._ref.parentid = this.parentid;
		}
		return this._ref;
	}

	public canActivateReason(id: AbilityId): string | null {
		const spec = this._abilities.get(id);
		if (!spec) return `unknown ability: '${id}'`;
		const now = this.currentTimeMs();
		const cdUntil = this._cooldownUntil.get(id);
		if (cdUntil !== undefined && now < cdUntil) return `on cooldown: ${cdUntil - now}`;
		if (spec.requiredTags && !spec.requiredTags.every(t => this.hasGameplayTag(t))) {
			const missing = spec.requiredTags.filter(t => !this.hasGameplayTag(t));
			return `missing required tags: ${missing.join(',')}`;
		}
		if (spec.blockedTags && spec.blockedTags.some(t => this.hasGameplayTag(t))) {
			const blocking = spec.blockedTags.filter(t => this.hasGameplayTag(t));
			return `blocked by tags: ${blocking.join(',')}`;
		}
		if (spec.cost && !this.canPay(spec)) return `insufficient resource: ${spec.cost.map(c => `${c.amount} ${c.attr}`).join(',')}`;
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

	private createRuntimeBindings(owner: WorldObject): AbilityRuntimeBindings {
		const ownerId = this.parentid;
		return {
			owner,
			ownerId,
			hasTag: (tag: TagId) => this.hasGameplayTag(tag),
			addTag: (tag: TagId) => this.addTag(tag),
			removeTag: (tag: TagId) => this.removeTag(tag),
			dispatchMode: (event: string, payload: EventPayload | undefined, target: Identifier | undefined, lane?: EventLane) => {
				this.dispatchModeEvent(ownerId, event, payload, target, lane);
			},
			emitGameplay: (event: string, payload: EventPayload, lane?: EventLane) => {
				if (lane === 'presentation') {
					$.emitPresentation(event, owner, payload);
					return;
				}
				if (lane === 'any') {
					$.emit(event, owner, payload);
					return;
				}
				if (lane && lane !== 'gameplay') {
					throw new Error(`[AbilitySystemComponent] Unsupported event lane '${lane}' for emitGameplay.`);
				}
				$.emitGameplay(event, owner, payload);
			},
			pushCommand: (command: GameplayCommand) => GameplayCommandBuffer.instance.push(command),
			requestAbility: <Id extends AbilityId>(abilityId: Id, opts?: AbilityRequestOptions<Id>) => {
				if (opts && 'payload' in (opts as any)) return this.requestAbility(abilityId, { payload: (opts as any).payload } as any);
				return this.requestAbility(abilityId);
			},
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

	private dispatchModeEvent(ownerId: Identifier, event: string, payload: EventPayload | undefined, target: Identifier | undefined, lane?: EventLane): void {
		if (lane && (payload === undefined || typeof payload !== 'object')) {
			throw new Error(`[AbilitySystemComponent] Cannot attach lane '${lane}' to non-object payload for event '${event}'.`);
		}
		const targetId = target ?? ownerId;
		const finalPayload = lane && payload ? { ...(payload as Record<string, unknown>), lane } : payload;
		GameplayCommandBuffer.instance.push({
			kind: 'dispatchEvent',
			event,
			target_id: targetId,
			emitter_id: ownerId,
			payload: finalPayload,
		});
	}

	private applyWaitState(key: string, run: ActiveAbilityRun, instruction: AbilityWaitInstruction): void {
		if (run.wait && run.wait.kind === 'event') run.wait.unsub();
		switch (instruction.kind) {
			case 'time':
				run.wait = { kind: 'time', until: instruction.until };
				return;
			case 'tag': {
				const satisfied = this.hasGameplayTag(instruction.tag) === instruction.present;
				if (satisfied) {
					run.wait = undefined;
				} else {
					run.wait = { kind: 'tag', tag: instruction.tag, present: instruction.present };
				}
				return;
			}
			case 'event': {
				const token: any = { __ascWait: true, key };
				const listener = (eventName: string) => {
					if (eventName !== instruction.event) return;
					const entry = this._active.get(key);
					if (!entry) return;
					const pending = entry.wait;
					if (pending && pending.kind === 'event') {
						pending.unsub();
						entry.wait = undefined;
					}
				};
				const options: { emitter?: Identifier; persistent?: boolean; lane?: EventLane } = { persistent: false };
				if (instruction.scope !== undefined) options.emitter = instruction.scope as Identifier;
				if (instruction.lane) options.lane = instruction.lane;
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
		for (let i = 0; i < run.grantedTags.length; i++) {
			const tag = run.grantedTags[i];
			if (tag) this.removeTag(tag);
		}
		for (let i = 0; i < run.removeOnEnd.length; i++) {
			const tag = run.removeOnEnd[i];
			if (tag) this.removeTag(tag);
		}
	}

	private currentTimeMs(): number {
		return this._timeMs;
	}

	private notifyAbilityFailed(id: AbilityId, reason: string, source?: string): void {
		const owner = this.ownerOrThrow();
		const now = this.currentTimeMs();
		const cdUntil = this._cooldownUntil.get(id);
		const timeLeftMs = cdUntil !== undefined ? Math.max(0, cdUntil - now) : undefined;
		const payload: StructuredEventPayload = { id, reason };
		if (source !== undefined) payload.source = source;
		if (timeLeftMs !== undefined) payload.timeLeftMs = timeLeftMs;
		$.emitGameplay('AbilityFailed', owner, payload);
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
