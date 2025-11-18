import { $ } from '../core/game';
import { create_gameevent, type GameEvent } from '../core/game_event';
import type { WorldObject } from '../core/object/worldobject';
import type { Facing, Identifier } from '../rompack/rompack';
import type { AbilityId, AbilityRequestOptions, AbilityRequestResult, AbilitySpec, TagId } from './gastypes';
import type { AbilitySystemComponent } from '../component/abilitysystemcomponent';

export type GameplayAction = (ctx: GameplayAbilityExecution, params: Record<string, unknown> | undefined) => void;

export class GameplayActionRegistry {
	private readonly map = new Map<string, GameplayAction>();

	public register(id: string, action: GameplayAction): void {
		if (!id) {
			throw new Error('[GameplayActionRegistry] Cannot register action without id.');
		}
		this.map.set(id, action);
	}

	public unregister(id: string): void {
		if (!id) {
			return;
		}
		this.map.delete(id);
	}

	public get(id: string): GameplayAction {
		const action = this.map.get(id);
		if (!action) {
			throw new Error(`[GameplayActionRegistry] Action '${id}' is not registered.`);
		}
		return action;
	}
}

export interface LiteralValueSpec {
	kind: 'literal';
	value: unknown;
}

export type IntentValueSpec =
	| {
		kind: 'intent';
		path?: string;
		optional?: false | undefined;
		fallback?: AbilityValueSpec;
	}
	| {
		kind: 'intent';
		path?: string;
		optional: true;
		fallback?: undefined;
	};

export type VarValueSpec =
	| {
		kind: 'var';
		name: string;
		optional?: false | undefined;
		fallback?: AbilityValueSpec;
	}
	| {
		kind: 'var';
		name: string;
		optional: true;
		fallback?: undefined;
	};

export interface RecordValueSpec {
	kind: 'record';
	entries: Record<string, AbilityValueSpec>;
}

export interface ArrayValueSpec {
	kind: 'array';
	items: AbilityValueSpec[];
}

export type AbilityValueSpec = LiteralValueSpec | IntentValueSpec | VarValueSpec | RecordValueSpec | ArrayValueSpec;

type FacingString = Facing extends string ? Facing : never;

export type AbilityEventScopeSpec =
	| { kind: 'self' }
	| { kind: 'world' }
	| { kind: 'object'; target: AbilityValueSpec };

export interface CallGameplayActionStep {
	type: 'call';
	gameplayAction: string;
	params?: Record<string, AbilityValueSpec>;
}

export interface DispatchStep {
	type: 'dispatch';
	event: string;
	payload?: Record<string, AbilityValueSpec>;
	target?: AbilityValueSpec;
}

export interface EmitStep {
	type: 'emit';
	event: string;
	payload?: Record<string, AbilityValueSpec>;
}

export interface WaitEventStep {
	type: 'waitEvent';
	event: string;
	scope?: AbilityEventScopeSpec;
}

export interface WaitTimeStep {
	type: 'waitTime';
	durationMs: number;
}

export interface WaitTagStep {
	type: 'waitTag';
	tag: TagId;
	present: boolean;
}

export interface SetVarStep {
	type: 'setVar';
	name: string;
	value: AbilityValueSpec;
}

export interface ClearVarStep {
	type: 'clearVar';
	name: string;
}

export interface ModifyTagsStep {
	type: 'modifyTags';
	add?: ReadonlyArray<TagId>;
	remove?: ReadonlyArray<TagId>;
}

export interface RequestAbilityStep {
	type: 'requestAbility';
	ability: AbilityId;
	payload?: Record<string, AbilityValueSpec>;
}

export interface SequenceStep {
	type: 'sequence';
	steps: ReadonlyArray<AbilityStep>;
}

export interface FaceStep {
	type: 'face';
	value: AbilityValueSpec;
}

export type AbilityStep =
	| CallGameplayActionStep
	| DispatchStep
	| EmitStep
	| WaitEventStep
	| WaitTimeStep
	| WaitTagStep
	| SetVarStep
	| ClearVarStep
	| ModifyTagsStep
	| RequestAbilityStep
	| SequenceStep
	| FaceStep;

export interface GameplayAbilityDefinition extends AbilitySpec {
	displayName?: string;
	tags?: {
		grant?: ReadonlyArray<TagId>;
		removeOnActivate?: ReadonlyArray<TagId>;
		removeOnEnd?: ReadonlyArray<TagId>;
	};
	activation: ReadonlyArray<AbilityStep>;
	sustain?: ReadonlyArray<AbilityStep>;
	completion?: ReadonlyArray<AbilityStep>;
	cancel?: ReadonlyArray<AbilityStep>;
}

export type AbilityWaitInstruction =
	| { kind: 'time'; until: number }
	| { kind: 'tag'; tag: TagId; present: boolean }
	| { kind: 'event'; event: string; emitter?: Identifier };

export type AbilityAdvanceResult =
	| { kind: 'wait'; wait: AbilityWaitInstruction }
	| { kind: 'completed' }
	| { kind: 'continue' };

interface AbilityExecutionFrame {
	steps: ReadonlyArray<AbilityStep>;
	index: number;
}


export class GameplayAbilityExecution {
	private readonly definition: GameplayAbilityDefinition;
	private readonly abilitySystem: AbilitySystemComponent;
	private readonly gameplayActions: GameplayActionRegistry;
	private readonly stack: AbilityExecutionFrame[];
	public readonly owner: WorldObject;
	public readonly ownerId: Identifier;
	public readonly vars: Record<string, unknown>;
	public readonly intentPayload?: unknown;
	private finished: boolean;
	private completionRan: boolean;

	constructor(definition: GameplayAbilityDefinition, abilitySystem: AbilitySystemComponent, gameplayActions: GameplayActionRegistry, owner: WorldObject, intentPayload?: unknown) {
		this.definition = definition;
		this.abilitySystem = abilitySystem;
		this.gameplayActions = gameplayActions;
		this.owner = owner;
		this.ownerId = owner.id;
		this.intentPayload = intentPayload;
		this.vars = {};
		this.stack = [{ steps: definition.activation, index: 0 }];
		this.finished = false;
		this.completionRan = false;
	}

	public advance(nowMs: number): AbilityAdvanceResult {
		if (this.finished) return { kind: 'completed' };
		while (this.stack.length > 0) {
			const frame = this.stack[this.stack.length - 1];
			if (!frame) break;
			if (frame.index >= frame.steps.length) {
				this.stack.pop();
				continue;
			}
			const step = frame.steps[frame.index];
			frame.index += 1;
			const res = this.executeStep(step, nowMs);
			if (res.kind === 'continue') {
				continue;
			}
			if (res.kind === 'wait') {
				return res;
			}
		}
		this.finished = true;
		this.runCompletion();
		return { kind: 'completed' };
	}

	public cancel(): void {
		this.finished = true;
		this.runCancel();
	}

	private executeStep(step: AbilityStep, nowMs: number): AbilityAdvanceResult {
		switch (step.type) {
			case 'sequence': {
				if (!step.steps || step.steps.length === 0) return { kind: 'continue' };
				this.stack.push({ steps: step.steps, index: 0 });
				return { kind: 'continue' };
			}
			case 'call':
				this.executeGameplayAction(step);
				return { kind: 'continue' };
			case 'dispatch': {
				const payload = step.payload ? this.resolveRecord(step.payload) : undefined;
				const target = step.target ? this.resolveIdentifier(step.target) : undefined;
				const event = create_gameevent({ type: step.event, ...(payload ?? {}) });
				this.dispatchMode(event, target);
				return { kind: 'continue' };
			}
			case 'emit': {
				const payload = step.payload ? this.resolveRecord(step.payload) : undefined;
				const event = create_gameevent({ type: step.event, ...(payload ?? {}) });
				this.emitGameplay(event);
				return { kind: 'continue' };
			}
			case 'waitEvent': {
				const emitter = this.resolveEventScope(step.scope);
				return { kind: 'wait', wait: { kind: 'event', event: step.event, emitter } };
			}
			case 'waitTime': {
				const until = nowMs + step.durationMs;
				return { kind: 'wait', wait: { kind: 'time', until } };
			}
			case 'waitTag': {
				return { kind: 'wait', wait: { kind: 'tag', tag: step.tag, present: step.present } };
			}
			case 'setVar': {
				const value = this.resolveValue(step.value);
				this.vars[step.name] = value;
				return { kind: 'continue' };
			}
			case 'clearVar': {
				if (Object.prototype.hasOwnProperty.call(this.vars, step.name)) delete this.vars[step.name];
				return { kind: 'continue' };
			}
			case 'modifyTags': {
				if (step.add) {
					for (let i = 0; i < step.add.length; i++) {
						const tag = step.add[i];
						if (tag) this.add_tag(tag);
					}
				}
				if (step.remove) {
					for (let i = 0; i < step.remove.length; i++) {
						const tag = step.remove[i];
						if (tag) this.remove_tag(tag);
					}
				}
				return { kind: 'continue' };
			}
			case 'face': {
				this.applyFaceStep(step.value);
				return { kind: 'continue' };
			}
			case 'requestAbility': {
				const payload = step.payload ? this.resolveRecord(step.payload) : undefined;
				if (payload === undefined) this.request_ability(step.ability);
				else this.request_ability(step.ability, { payload } as any);
				return { kind: 'continue' };
			}
		}
	}

	private runCompletion(): void {
		if (this.completionRan) return;
		this.completionRan = true;
		const steps = this.definition.completion;
		if (!steps || steps.length === 0) return;
		for (let i = 0; i < steps.length; i++) {
			this.executeImmediateStep(steps[i]);
		}
	}

	private runCancel(): void {
		const steps = this.definition.cancel;
		if (!steps || steps.length === 0) return;
		for (let i = 0; i < steps.length; i++) {
			this.executeImmediateStep(steps[i]);
		}
	}

	private executeImmediateStep(step: AbilityStep): void {
		switch (step.type) {
			case 'sequence': {
				if (!step.steps || step.steps.length === 0) return;
				for (let i = 0; i < step.steps.length; i++) this.executeImmediateStep(step.steps[i]);
				return;
			}
			case 'call':
				this.executeGameplayAction(step);
				return;
		case 'dispatch': {
			const payload = step.payload ? this.resolveRecord(step.payload) : undefined;
			const target = step.target ? this.resolveIdentifier(step.target) : undefined;
			const event = create_gameevent({ type: step.event, ...(payload ?? {}) });
			this.dispatchMode(event, target);
			return;
		}
		case 'emit': {
			const payload = step.payload ? this.resolveRecord(step.payload) : undefined;
			const event = create_gameevent({ type: step.event, ...(payload ?? {}) });
			this.emitGameplay(event);
			return;
		}
			case 'setVar': {
				const value = this.resolveValue(step.value);
				this.vars[step.name] = value;
				return;
			}
			case 'clearVar': {
				if (Object.prototype.hasOwnProperty.call(this.vars, step.name)) delete this.vars[step.name];
				return;
			}
			case 'modifyTags': {
				if (step.add) for (let i = 0; i < step.add.length; i++) { const tag = step.add[i]; if (tag) this.add_tag(tag); }
				if (step.remove) for (let i = 0; i < step.remove.length; i++) { const tag = step.remove[i]; if (tag) this.remove_tag(tag); }
				return;
			}
			case 'face':
				this.applyFaceStep(step.value);
				return;
			case 'requestAbility': {
				const payload = step.payload ? this.resolveRecord(step.payload) : undefined;
				if (payload === undefined) this.request_ability(step.ability);
				else this.request_ability(step.ability, { payload } as any);
				return;
			}
			case 'waitEvent':
			case 'waitTime':
			case 'waitTag':
				throw new Error('[GameplayAbilityExecution] Wait steps are not allowed in completion or cancel sequences.');
		}
	}

	private applyFaceStep(value: AbilityValueSpec): void {
		const resolved = this.resolveValue(value) as FacingString;
		this.owner.facing = resolved;
	}

	private executeGameplayAction(step: CallGameplayActionStep): void {
		const action = this.gameplayActions.get(step.gameplayAction);
		const params = step.params ? this.resolveRecord(step.params) : undefined;
		action(this, params as Record<string, unknown> | undefined);
	}

	public has_tag(tag: TagId): boolean {
		return this.abilitySystem.has_gameplay_tag(tag);
	}

	public hasTag(tag: TagId): boolean {
		return this.has_tag(tag);
	}

	public add_tag(tag: TagId): void {
		this.abilitySystem.add_tag(tag);
	}

	public addTag(tag: TagId): void {
		this.add_tag(tag);
	}

	public remove_tag(tag: TagId): void {
		this.abilitySystem.remove_tag(tag);
	}

	public removeTag(tag: TagId): void {
		this.remove_tag(tag);
	}

	public toggle_tag(tag: TagId): void {
		this.abilitySystem.toggle_tag(tag);
	}

	public toggleTag(tag: TagId): void {
		this.toggle_tag(tag);
	}

	public dispatch_mode(event: GameEvent, target: Identifier | undefined): void {
		if (!event.emitter) event.emitter = this.owner;
		const targetId = target ?? this.owner.id;
		const targetOwner = targetId === this.owner.id ? this.owner : $.world.getWorldObject(targetId);
		if (!targetOwner) {
			throw new Error(`[GameplayAbilityExecution] Event target '${targetId}' not found for ability '${this.definition.id}'.`);
		}
		targetOwner.sc.dispatch_event(event);
	}

	public dispatchMode(event: GameEvent, target: Identifier | undefined): void {
		this.dispatch_mode(event, target);
	}

	public emit_gameplay(event: GameEvent): void {
		if (!event.emitter) event.emitter = this.owner;
		$.emit_gameplay(event);
	}

	public emitGameplay(event: GameEvent): void {
		this.emit_gameplay(event);
	}

	public request_ability<Id extends AbilityId>(id: Id, opts?: AbilityRequestOptions<Id>): AbilityRequestResult {
		return this.abilitySystem.request_ability(id, opts);
	}

	public requestAbility<Id extends AbilityId>(id: Id, opts?: AbilityRequestOptions<Id>): AbilityRequestResult {
		return this.request_ability(id, opts);
	}

	private resolveValue(spec: AbilityValueSpec): unknown {
		switch (spec.kind) {
			case 'literal':
				return spec.value;
			case 'intent':
				return this.resolveIntent(spec);
			case 'var':
				return this.resolveVar(spec);
			case 'record':
				return this.resolveRecord(spec.entries);
			case 'array':
				return this.resolveArray(spec.items);
			default:
				throw new Error(`[GameplayAbilityExecution] Unknown AbilityValueSpec kind '${(spec as any).kind}'.`);
		}
	}

	private resolveIntent(spec: IntentValueSpec): unknown {
		const payload = this.intentPayload;
		if (!payload) {
			if (spec.optional) return undefined;
			if (spec.fallback) return this.resolveValue(spec.fallback);
			throw new Error('[GameplayAbilityExecution] Ability intent payload is not available.');
		}
		if (!spec.path) return payload;
		const pathParts = spec.path.split('.');
		let current: any = payload;
		for (let i = 0; i < pathParts.length; i++) {
			const key = pathParts[i];
			if (!key) continue;
			if (current == null || current[key] === undefined) {
				if (spec.optional) return undefined;
				if (spec.fallback) return this.resolveValue(spec.fallback);
				throw new Error(`[GameplayAbilityExecution] Intent path '${spec.path}' is undefined.`);
			}
			current = current[key];
		}
		return current;
	}

	private resolveVar(spec: VarValueSpec): unknown {
		if (Object.prototype.hasOwnProperty.call(this.vars, spec.name)) {
			return this.vars[spec.name];
		}
		if (spec.optional) return undefined;
		if (spec.fallback) return this.resolveValue(spec.fallback);
		throw new Error(`[GameplayAbilityExecution] Ability variable '${spec.name}' is undefined.`);
	}

	private resolveRecord(source: Record<string, AbilityValueSpec>): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		const keys = Object.keys(source);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const spec = source[key];
			if (spec) result[key] = this.resolveValue(spec);
		}
		return result;
	}

	private resolveArray(items: AbilityValueSpec[]): unknown[] {
		const result: unknown[] = [];
		for (let i = 0; i < items.length; i++) {
			const spec = items[i];
			if (spec) result.push(this.resolveValue(spec));
		}
		return result;
	}

	private resolveIdentifier(spec: AbilityValueSpec): Identifier {
		const value = this.resolveValue(spec);
		if (typeof value === 'string') return value as Identifier;
		throw new Error(`[GameplayAbilityExecution] Expected identifier string, got '${String(value)}'.`);
	}

	private resolveEventScope(spec: AbilityEventScopeSpec | undefined): Identifier | undefined {
		if (!spec) return undefined;
		if (spec.kind === 'self') return this.ownerId;
		if (spec.kind === 'world') return $.world.id;
		if (spec.kind === 'object') return this.resolveIdentifier(spec.target);
		return undefined;
	}
}

export function literal(value: unknown): LiteralValueSpec {
	return { kind: 'literal', value };
}

type IntentOptions =
	| { optional: true }
	| { optional?: false | undefined; fallback?: AbilityValueSpec };

type VarOptions =
	| { optional: true }
	| { optional?: false | undefined; fallback?: AbilityValueSpec };

export function fromIntent(path?: string, options?: IntentOptions): IntentValueSpec {
	if (!options) return { kind: 'intent', path };
	if (options.optional === true) {
		return { kind: 'intent', path, optional: true };
	}
	const { optional, fallback } = options;
	return { kind: 'intent', path, optional, fallback };
}

export function fromVar(name: string, options?: VarOptions): VarValueSpec {
	if (!options) return { kind: 'var', name };
	if (options.optional === true) {
		return { kind: 'var', name, optional: true };
	}
	const { optional, fallback } = options;
	return { kind: 'var', name, optional, fallback };
}

export function record(entries: Record<string, AbilityValueSpec>): RecordValueSpec {
	return { kind: 'record', entries };
}
