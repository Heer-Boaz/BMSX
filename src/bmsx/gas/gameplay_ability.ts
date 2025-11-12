import type { EventScope } from '../core/eventemitter';
import { createGameEvent, EventLane, type GameEvent } from '../core/game_event';
import type { GameplayCommand } from '../ecs/gameplay_command_buffer';
import type { WorldObject } from '../core/object/worldobject';
import type { Facing, Identifier } from '../rompack/rompack';
import type { AbilityId, AbilityRequestOptions, AbilityRequestResult, AbilitySpec, TagId } from './gastypes';

export interface AbilityRuntimeBindings {
	readonly owner: WorldObject;
	readonly ownerId: Identifier;
	hasTag(tag: TagId): boolean;
	addTag(tag: TagId): void;
	removeTag(tag: TagId): void;
	dispatchMode(event: GameEvent, target: Identifier | undefined): void;
	emitGameplay(event: GameEvent): void;
	pushCommand(command: GameplayCommand): void;
	requestAbility<Id extends AbilityId>(id: Id, opts?: AbilityRequestOptions<Id>): AbilityRequestResult;
}

export interface AbilityActionContext {
	readonly owner: WorldObject;
	readonly ownerId: Identifier;
	readonly vars: Record<string, unknown>;
	readonly intentPayload?: unknown;
	hasTag(tag: TagId): boolean;
	addTag(tag: TagId): void;
	removeTag(tag: TagId): void;
	dispatchMode(event: GameEvent, target: Identifier | undefined): void;
	emitGameplay(event: GameEvent): void;
	pushCommand(command: GameplayCommand): void;
	requestAbility<Id extends AbilityId>(id: Id, opts?: AbilityRequestOptions<Id>): AbilityRequestResult;
}

export type AbilityAction = (ctx: AbilityActionContext, params: Record<string, unknown> | undefined) => void;

export class AbilityActionRegistry {
	private readonly map = new Map<string, AbilityAction>();

	public register(id: string, action: AbilityAction): void {
		if (!id) {
			throw new Error('[AbilityActionRegistry] Cannot register action without id.');
		}
		this.map.set(id, action);
	}

	public unregister(id: string): void {
		if (!id) {
			return;
		}
		this.map.delete(id);
	}

	public get(id: string): AbilityAction {
		const action = this.map.get(id);
		if (!action) {
			throw new Error(`[AbilityActionRegistry] Action '${id}' is not registered.`);
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

export interface CallActionStep {
	type: 'call';
	action: string;
	params?: Record<string, AbilityValueSpec>;
}

export interface DispatchStep {
	type: 'dispatch';
	event: string;
	payload?: Record<string, AbilityValueSpec>;
	target?: AbilityValueSpec;
	lane?: EventLane;
}

export interface EmitStep {
	type: 'emit';
	event: string;
	payload?: Record<string, AbilityValueSpec>;
	lane?: EventLane;
}

export interface WaitEventStep {
	type: 'waitEvent';
	event: string;
	scope?: AbilityEventScopeSpec;
	lane?: EventLane;
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
	| CallActionStep
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
	| { kind: 'event'; event: string; scope?: EventScope; lane?: EventLane };

export type AbilityAdvanceResult =
	| { kind: 'wait'; wait: AbilityWaitInstruction }
	| { kind: 'completed' }
	| { kind: 'continue' };

interface AbilityExecutionFrame {
	steps: ReadonlyArray<AbilityStep>;
	index: number;
}

interface AbilityExecutionContext {
	readonly definition: GameplayAbilityDefinition;
	readonly runtime: AbilityRuntimeBindings;
	readonly actions: AbilityActionRegistry;
	readonly vars: Record<string, unknown>;
	readonly intentPayload?: unknown;
}

export class GameplayAbilityExecution {
	private readonly ctx: AbilityExecutionContext;
	private readonly stack: AbilityExecutionFrame[];
	private finished: boolean;
	private completionRan: boolean;

	constructor(definition: GameplayAbilityDefinition, runtime: AbilityRuntimeBindings, actions: AbilityActionRegistry, intentPayload?: unknown) {
		this.ctx = { definition, runtime, actions, vars: {}, intentPayload };
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
				this.executeAction(step);
				return { kind: 'continue' };
			case 'dispatch': {
				const payload = step.payload ? resolveRecord(step.payload, this.ctx) : undefined;
				const target = step.target ? resolveIdentifier(step.target, this.ctx) : undefined;
				const event = createGameEvent({ type: step.event, lane: step.lane ?? 'gameplay', ...(payload ?? {}) });
				this.ctx.runtime.dispatchMode(event, target);
				return { kind: 'continue' };
			}
			case 'emit': {
				const payload = step.payload ? resolveRecord(step.payload, this.ctx) : undefined;
				const event = createGameEvent({ type: step.event, lane: step.lane ?? 'gameplay', ...(payload ?? {}) });
				this.ctx.runtime.emitGameplay(event);
				return { kind: 'continue' };
			}
			case 'waitEvent': {
				const scope = resolveEventScope(step.scope, this.ctx);
				return { kind: 'wait', wait: { kind: 'event', event: step.event, scope, lane: step.lane } };
			}
			case 'waitTime': {
				const until = nowMs + step.durationMs;
				return { kind: 'wait', wait: { kind: 'time', until } };
			}
			case 'waitTag': {
				return { kind: 'wait', wait: { kind: 'tag', tag: step.tag, present: step.present } };
			}
			case 'setVar': {
				const value = resolveValue(step.value, this.ctx);
				this.ctx.vars[step.name] = value;
				return { kind: 'continue' };
			}
			case 'clearVar': {
				if (Object.prototype.hasOwnProperty.call(this.ctx.vars, step.name)) delete this.ctx.vars[step.name];
				return { kind: 'continue' };
			}
			case 'modifyTags': {
				if (step.add) {
					for (let i = 0; i < step.add.length; i++) {
						const tag = step.add[i];
						if (tag) this.ctx.runtime.addTag(tag);
					}
				}
				if (step.remove) {
					for (let i = 0; i < step.remove.length; i++) {
						const tag = step.remove[i];
						if (tag) this.ctx.runtime.removeTag(tag);
					}
				}
				return { kind: 'continue' };
			}
			case 'face': {
				this.applyFaceStep(step.value);
				return { kind: 'continue' };
			}
			case 'requestAbility': {
				const payload = step.payload ? resolveRecord(step.payload, this.ctx) : undefined;
				if (payload === undefined) {
					this.ctx.runtime.requestAbility(step.ability);
				} else {
					this.ctx.runtime.requestAbility(step.ability, { payload } as any);
				}
				return { kind: 'continue' };
			}
		}
	}

	private runCompletion(): void {
		if (this.completionRan) return;
		this.completionRan = true;
		const steps = this.ctx.definition.completion;
		if (!steps || steps.length === 0) return;
		for (let i = 0; i < steps.length; i++) {
			this.executeImmediateStep(steps[i]);
		}
	}

	private runCancel(): void {
		const steps = this.ctx.definition.cancel;
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
				this.executeAction(step);
				return;
			case 'dispatch': {
				const payload = step.payload ? resolveRecord(step.payload, this.ctx) : undefined;
				const target = step.target ? resolveIdentifier(step.target, this.ctx) : undefined;
				const event = createGameEvent({ type: step.event, lane: step.lane ?? 'gameplay', ...(payload ?? {}) });
				this.ctx.runtime.dispatchMode(event, target);
				return;
			}
			case 'emit': {
				const payload = step.payload ? resolveRecord(step.payload, this.ctx) : undefined;
				const event = createGameEvent({ type: step.event, lane: step.lane ?? 'gameplay', ...(payload ?? {}) });
				this.ctx.runtime.emitGameplay(event);
				return;
			}
			case 'setVar': {
				const value = resolveValue(step.value, this.ctx);
				this.ctx.vars[step.name] = value;
				return;
			}
			case 'clearVar': {
				if (Object.prototype.hasOwnProperty.call(this.ctx.vars, step.name)) delete this.ctx.vars[step.name];
				return;
			}
			case 'modifyTags': {
				if (step.add) for (let i = 0; i < step.add.length; i++) { const tag = step.add[i]; if (tag) this.ctx.runtime.addTag(tag); }
				if (step.remove) for (let i = 0; i < step.remove.length; i++) { const tag = step.remove[i]; if (tag) this.ctx.runtime.removeTag(tag); }
				return;
			}
			case 'face':
				this.applyFaceStep(step.value);
				return;
			case 'requestAbility': {
				const payload = step.payload ? resolveRecord(step.payload, this.ctx) : undefined;
				if (payload === undefined) {
					this.ctx.runtime.requestAbility(step.ability);
				} else {
					this.ctx.runtime.requestAbility(step.ability, { payload } as any);
				}
				return;
			}
			case 'waitEvent':
			case 'waitTime':
			case 'waitTag':
				throw new Error('[GameplayAbilityExecution] Wait steps are not allowed in completion or cancel sequences.');
		}
	}

	private applyFaceStep(value: AbilityValueSpec): void {
		const resolved = resolveValue(value, this.ctx) as FacingString;
		const owner = this.ctx.runtime.owner;
		owner.facing = resolved;
	}

	private executeAction(step: CallActionStep): void {
		const action = this.ctx.actions.get(step.action);
		const params = step.params ? resolveRecord(step.params, this.ctx) : undefined;
			const runtime = this.ctx.runtime;
			const callCtx: AbilityActionContext = {
				owner: runtime.owner,
				ownerId: runtime.ownerId,
				vars: this.ctx.vars,
				intentPayload: this.ctx.intentPayload,
				hasTag: (tag: TagId) => runtime.hasTag(tag),
				addTag: (tag: TagId) => runtime.addTag(tag),
				removeTag: (tag: TagId) => runtime.removeTag(tag),
				dispatchMode: (event: GameEvent, target: Identifier | undefined) => runtime.dispatchMode(event, target),
				emitGameplay: (event: GameEvent) => runtime.emitGameplay(event),
				pushCommand: (command: GameplayCommand) => runtime.pushCommand(command),
				requestAbility: <Id extends AbilityId>(abilityId: Id, opts?: AbilityRequestOptions<Id>) => runtime.requestAbility(abilityId, opts),
			};
		action(callCtx, params as Record<string, unknown> | undefined);
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
	if ('optional' in options && options.optional === true) {
		return { kind: 'intent', path, optional: true };
	}
	const { optional, fallback } = options;
	return { kind: 'intent', path, optional, fallback };
}

export function fromVar(name: string, options?: VarOptions): VarValueSpec {
	if (!options) return { kind: 'var', name };
	if ('optional' in options && options.optional === true) {
		return { kind: 'var', name, optional: true };
	}
	const { optional, fallback } = options;
	return { kind: 'var', name, optional, fallback };
}

export function record(entries: Record<string, AbilityValueSpec>): RecordValueSpec {
	return { kind: 'record', entries };
}

function resolveValue(spec: AbilityValueSpec, ctx: AbilityExecutionContext) {
	switch (spec.kind) {
		case 'literal':
			return spec.value;
		case 'intent':
			return resolveIntent(spec, ctx);
		case 'var':
			return resolveVar(spec, ctx);
		case 'record':
			return resolveRecord(spec.entries, ctx);
		case 'array':
			return resolveArray(spec.items, ctx);
		default:
			throw new Error(`[GameplayAbilityExecution] Unknown AbilityValueSpec kind '${(spec as any).kind}'.`);
	}
}

function resolveIntent(spec: IntentValueSpec, ctx: AbilityExecutionContext): unknown {
	const payload = ctx.intentPayload;
	if (!payload) {
		if (spec.optional) return undefined;
		if (spec.fallback) return resolveValue(spec.fallback, ctx);
		throw new Error('[GameplayAbilityExecution] Ability intent payload is not available.');
	}
	if (!spec.path) return payload;
	const pathParts = spec.path.split('.');
	let current: any = payload;
	for (let i = 0; i < pathParts.length; i++) {
		const key = pathParts[i];
		if (!key) continue;
		if (current == null || !(key in current)) {
			if (spec.optional) return undefined;
			if (spec.fallback) return resolveValue(spec.fallback, ctx);
			throw new Error(`[GameplayAbilityExecution] Intent path '${spec.path}' is undefined.`);
		}
		current = current[key];
	}
	return current;
}

function resolveVar(spec: VarValueSpec, ctx: AbilityExecutionContext): unknown {
	if (Object.prototype.hasOwnProperty.call(ctx.vars, spec.name)) {
		return ctx.vars[spec.name];
	}
	if (spec.optional) return undefined;
	if (spec.fallback) return resolveValue(spec.fallback, ctx);
	throw new Error(`[GameplayAbilityExecution] Ability variable '${spec.name}' is undefined.`);
}

function resolveRecord(source: Record<string, AbilityValueSpec>, ctx: AbilityExecutionContext): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const keys = Object.keys(source);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const spec = source[key];
		if (spec) result[key] = resolveValue(spec, ctx);
	}
	return result;
}

function resolveArray(items: AbilityValueSpec[], ctx: AbilityExecutionContext): unknown[] {
	const result: unknown[] = [];
	for (let i = 0; i < items.length; i++) {
		const spec = items[i];
		if (spec) result.push(resolveValue(spec, ctx));
	}
	return result;
}

function resolveIdentifier(spec: AbilityValueSpec, ctx: AbilityExecutionContext): Identifier {
	const value = resolveValue(spec, ctx);
	if (typeof value === 'string') return value as Identifier;
	throw new Error(`[GameplayAbilityExecution] Expected identifier string, got '${String(value)}'.`);
}

function resolveEventScope(spec: AbilityEventScopeSpec | undefined, ctx: AbilityExecutionContext): EventScope | undefined {
	if (!spec) return undefined;
	if (spec.kind === 'self') return ctx.runtime.ownerId;
	if (spec.kind === 'world') return undefined;
	if (spec.kind === 'object') return resolveIdentifier(spec.target, ctx);
	return undefined;
}
