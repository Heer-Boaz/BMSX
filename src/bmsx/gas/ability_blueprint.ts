import type { Identifier } from '../rompack/rompack';
import type { AbilityCoroutine, AbilityId, AbilityRequestResult, AbilitySpec, TagId } from './gastypes';
import type { EventScope } from '../core/eventemitter';
import type { GameplayCommand } from '../ecs/gameplay_command_buffer';
import type { WorldObject } from '../core/object/worldobject';

export interface LiteralValueSpec {
	kind: 'literal';
	value: unknown;
}

export interface IntentValueSpec {
	kind: 'intent';
	path?: string;
	optional?: boolean;
	fallback?: AbilityValueSpec;
}

export interface VarValueSpec {
	kind: 'var';
	name: string;
	optional?: boolean;
	fallback?: AbilityValueSpec;
}

export interface RecordValueSpec {
	kind: 'record';
	entries: Record<string, AbilityValueSpec>;
}

export interface ArrayValueSpec {
	kind: 'array';
	items: AbilityValueSpec[];
}

export type AbilityValueSpec = LiteralValueSpec | IntentValueSpec | VarValueSpec | RecordValueSpec | ArrayValueSpec;

export interface TagConditionSpec {
	kind: 'tag';
	tag: TagId;
	present: boolean;
}

export interface VarPresentConditionSpec {
	kind: 'var.present';
	name: string;
}

export interface IntentPresentConditionSpec {
	kind: 'intent.present';
	path?: string;
}

export interface CompareConditionSpec {
	kind: 'compare';
	op: 'eq' | 'neq';
	left: AbilityValueSpec;
	right: AbilityValueSpec;
}

export interface NotConditionSpec {
	kind: 'not';
	condition: AbilityConditionSpec;
}

export interface AndConditionSpec {
	kind: 'and';
	all: AbilityConditionSpec[];
}

export interface OrConditionSpec {
	kind: 'or';
	any: AbilityConditionSpec[];
}

export type AbilityConditionSpec =
	| TagConditionSpec
	| VarPresentConditionSpec
	| IntentPresentConditionSpec
	| CompareConditionSpec
	| NotConditionSpec
	| AndConditionSpec
	| OrConditionSpec;

export interface SelfEventScopeSpec {
	kind: 'self';
}

export interface WorldEventScopeSpec {
	kind: 'world';
}

export interface ObjectEventScopeSpec {
	kind: 'object';
	target: AbilityValueSpec;
}

export type AbilityEventScopeSpec = SelfEventScopeSpec | WorldEventScopeSpec | ObjectEventScopeSpec;

export interface SequenceTaskSpec {
	kind: 'sequence';
	steps: AbilityTaskSpec[];
}

export interface IfTaskSpec {
	kind: 'if';
	condition: AbilityConditionSpec;
	then: AbilityTaskSpec[];
	else?: AbilityTaskSpec[];
}

export interface VarSetTaskSpec {
	kind: 'vars.set';
	name: string;
	value: AbilityValueSpec;
}

export interface VarClearTaskSpec {
	kind: 'vars.clear';
	name: string;
}

export interface DispatchModeTaskSpec {
	kind: 'mode.dispatch';
	event: string;
	payload?: Record<string, AbilityValueSpec>;
	target?: AbilityValueSpec;
}

export interface EmitGameplayTaskSpec {
	kind: 'emit.gameplay';
	event: string;
	payload?: Record<string, AbilityValueSpec>;
}

export interface WaitEventTaskSpec {
	kind: 'wait.event';
	event: string;
	scope?: AbilityEventScopeSpec;
}

export interface WaitTimeTaskSpec {
	kind: 'wait.time';
	durationMs: number;
}

export interface WaitTagTaskSpec {
	kind: 'wait.tag';
	tag: TagId;
	present: boolean;
}

export interface CallActionTaskSpec {
	kind: 'call.action';
	action: string;
	params?: Record<string, AbilityValueSpec>;
}

export interface TagsAddTaskSpec {
	kind: 'tags.add';
	tags: TagId[];
}

export interface TagsRemoveTaskSpec {
	kind: 'tags.remove';
	tags: TagId[];
}

export interface AbilityRequestTaskSpec {
	kind: 'ability.request';
	ability: AbilityId;
	source?: string;
	payload?: Record<string, AbilityValueSpec>;
}

export interface DebugLogTaskSpec {
	kind: 'debug.log';
	message: string;
	context?: Record<string, AbilityValueSpec>;
}

export type AbilityTaskSpec =
	| SequenceTaskSpec
	| IfTaskSpec
	| VarSetTaskSpec
	| VarClearTaskSpec
	| DispatchModeTaskSpec
	| EmitGameplayTaskSpec
	| WaitEventTaskSpec
	| WaitTimeTaskSpec
	| WaitTagTaskSpec
	| CallActionTaskSpec
	| TagsAddTaskSpec
	| TagsRemoveTaskSpec
	| AbilityRequestTaskSpec
	| DebugLogTaskSpec;

export interface AbilityBlueprint extends AbilitySpec {
	blueprint_version: 1;
	description?: string;
	activation: AbilityTaskSpec[];
	onComplete?: AbilityTaskSpec[];
	onCancel?: AbilityTaskSpec[];
}

export interface AbilityRuntimeBindings {
	readonly ownerId: Identifier;
	readonly owner: WorldObject;
	hasTag(tag: TagId): boolean;
	addTag(tag: TagId): void;
	removeTag(tag: TagId): void;
	dispatchMode(event: string, payload: Record<string, unknown> | undefined, target: Identifier | undefined): void;
	emitGameplay(event: string, payload: unknown): void;
	pushCommand(command: GameplayCommand): void;
	requestAbility(id: AbilityId, opts?: { source?: string; payload?: Record<string, unknown> }): AbilityRequestResult;
}

export interface AbilityBlueprintContext {
	runtime: AbilityRuntimeBindings;
	actionRegistry: AbilityActionRegistry;
	intentPayload?: Record<string, unknown>;
}

export interface AbilityActionContext {
	readonly owner: WorldObject;
	readonly ownerId: Identifier;
	readonly vars: Record<string, unknown>;
	readonly intentPayload?: Record<string, unknown>;
	hasTag(tag: TagId): boolean;
	addTag(tag: TagId): void;
	removeTag(tag: TagId): void;
	dispatchMode(event: string, payload: Record<string, unknown> | undefined, target: Identifier | undefined): void;
	emitGameplay(event: string, payload: unknown): void;
	pushCommand(command: GameplayCommand): void;
	requestAbility(id: AbilityId, opts?: { source?: string; payload?: Record<string, unknown> }): AbilityRequestResult;
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

	public get(id: string): AbilityAction {
		const action = this.map.get(id);
		if (!action) {
			throw new Error(`[AbilityActionRegistry] Action '${id}' is not registered.`);
		}
		return action;
	}
}

interface AbilityExecutionState {
	readonly blueprint: AbilityBlueprint;
	readonly runtime: AbilityRuntimeBindings;
	readonly actionRegistry: AbilityActionRegistry;
	readonly vars: Record<string, unknown>;
	readonly intentPayload?: Record<string, unknown>;
}

export class AbilityBlueprintRunner {
	public static createCoroutine(blueprint: AbilityBlueprint, context: AbilityBlueprintContext): AbilityCoroutine {
		const vars: Record<string, unknown> = {};
		const state: AbilityExecutionState = {
			blueprint,
			runtime: context.runtime,
			actionRegistry: context.actionRegistry,
			vars,
			intentPayload: context.intentPayload,
		};
		let finished = false;
		const co = (function* run(): AbilityCoroutine {
			try {
				yield* runTasks(blueprint.activation, state);
				finished = true;
				executeImmediate(blueprint.onComplete, state);
			} finally {
				if (!finished) {
					executeImmediate(blueprint.onCancel, state);
				}
			}
		})();
		return co;
	}
}

function* runTasks(tasks: AbilityTaskSpec[] | undefined, state: AbilityExecutionState): AbilityCoroutine {
	if (!tasks || tasks.length === 0) return;
	for (let i = 0; i < tasks.length; i++) {
		yield* runTask(tasks[i]!, state);
	}
}

function* runTask(task: AbilityTaskSpec, state: AbilityExecutionState): AbilityCoroutine {
	switch (task.kind) {
		case 'sequence':
			yield* runTasks(task.steps, state);
			return;
		case 'if': {
			const conditionResult = evaluateCondition(task.condition, state);
			if (conditionResult) {
				yield* runTasks(task.then, state);
			} else {
				yield* runTasks(task.else, state);
			}
			return;
		}
		case 'vars.set': {
			const value = resolveValue(task.value, state);
			state.vars[task.name] = value;
			return;
		}
		case 'vars.clear': {
			if (task.name in state.vars) delete state.vars[task.name];
			return;
		}
		case 'mode.dispatch': {
			const payload = resolveRecord(task.payload, state);
			const targetId = task.target ? resolveIdentifier(task.target, state) : undefined;
			state.runtime.dispatchMode(task.event, payload, targetId);
			return;
		}
		case 'emit.gameplay': {
			const payload = resolveRecord(task.payload, state);
			state.runtime.emitGameplay(task.event, payload);
			return;
		}
		case 'wait.event': {
			const scope = resolveEventScope(task.scope, state);
			yield { type: 'waitEvent', name: task.event, scope };
			return;
		}
		case 'wait.time': {
			yield { type: 'waitTime', ms: task.durationMs };
			return;
		}
		case 'wait.tag': {
			yield { type: 'waitTag', tag: task.tag, present: task.present };
			return;
		}
		case 'call.action': {
			executeAction(task, state);
			return;
		}
		case 'tags.add': {
			for (let i = 0; i < task.tags.length; i++) {
				state.runtime.addTag(task.tags[i]!);
			}
			return;
		}
		case 'tags.remove': {
			for (let i = 0; i < task.tags.length; i++) {
				state.runtime.removeTag(task.tags[i]!);
			}
			return;
		}
		case 'ability.request': {
			const payload = resolveRecord(task.payload, state);
			state.runtime.requestAbility(task.ability, { source: task.source, payload });
			return;
		}
		case 'debug.log': {
			const message = task.message;
			const payload = resolveRecord(task.context, state);
			const ownerId = state.runtime.ownerId;
			console.debug('[AbilityBlueprint]', { ability: state.blueprint.id, ownerId, message, payload });
			return;
		}
	}
}

function executeImmediate(tasks: AbilityTaskSpec[] | undefined, state: AbilityExecutionState): void {
	if (!tasks || tasks.length === 0) return;
	for (let i = 0; i < tasks.length; i++) {
		executeImmediateTask(tasks[i]!, state);
	}
}

function executeImmediateTask(task: AbilityTaskSpec, state: AbilityExecutionState): void {
	switch (task.kind) {
		case 'sequence':
			executeImmediate(task.steps, state);
			return;
		case 'if': {
			const conditionResult = evaluateCondition(task.condition, state);
			if (conditionResult) executeImmediate(task.then, state);
			else executeImmediate(task.else, state);
			return;
		}
		case 'vars.set': {
			const value = resolveValue(task.value, state);
			state.vars[task.name] = value;
			return;
		}
		case 'vars.clear': {
			if (task.name in state.vars) delete state.vars[task.name];
			return;
		}
		case 'mode.dispatch': {
			const payload = resolveRecord(task.payload, state);
			const targetId = task.target ? resolveIdentifier(task.target, state) : undefined;
			state.runtime.dispatchMode(task.event, payload, targetId);
			return;
		}
		case 'emit.gameplay': {
			const payload = resolveRecord(task.payload, state);
			state.runtime.emitGameplay(task.event, payload);
			return;
		}
		case 'call.action': {
			executeAction(task, state);
			return;
		}
		case 'tags.add': {
			for (let i = 0; i < task.tags.length; i++) {
				state.runtime.addTag(task.tags[i]!);
			}
			return;
		}
		case 'tags.remove': {
			for (let i = 0; i < task.tags.length; i++) {
				state.runtime.removeTag(task.tags[i]!);
			}
			return;
		}
		case 'ability.request': {
			const payload = resolveRecord(task.payload, state);
			state.runtime.requestAbility(task.ability, { source: task.source, payload });
			return;
		}
		case 'debug.log': {
			const message = task.message;
			const payload = resolveRecord(task.context, state);
			const ownerId = state.runtime.ownerId;
			console.debug('[AbilityBlueprint:immediate]', { ability: state.blueprint.id, ownerId, message, payload });
			return;
		}
		case 'wait.event':
		case 'wait.time':
		case 'wait.tag':
			throw new Error(`[AbilityBlueprintRunner] Immediate handler cannot process wait task '${task.kind}'.`);
	}
}

function resolveIdentifier(spec: AbilityValueSpec, state: AbilityExecutionState): Identifier {
	const value = resolveValue(spec, state);
	if (typeof value !== 'string') {
		throw new Error(`[AbilityBlueprintRunner] Expected identifier string, got '${String(value)}'.`);
	}
	return value as Identifier;
}

function evaluateCondition(condition: AbilityConditionSpec, state: AbilityExecutionState): boolean {
	switch (condition.kind) {
		case 'tag':
			return state.runtime.hasTag(condition.tag) === condition.present;
		case 'var.present':
			return condition.name in state.vars;
		case 'intent.present': {
			const payload = state.intentPayload;
			if (!condition.path || condition.path.length === 0) {
				return payload !== undefined;
			}
			const value = readPath(payload, condition.path);
			return value !== undefined && value !== null;
		}
		case 'compare': {
			const left = resolveValue(condition.left, state);
			const right = resolveValue(condition.right, state);
			if (condition.op === 'eq') return left === right;
			return left !== right;
		}
		case 'not':
			return !evaluateCondition(condition.condition, state);
		case 'and':
			for (let i = 0; i < condition.all.length; i++) {
				if (!evaluateCondition(condition.all[i]!, state)) return false;
			}
			return true;
		case 'or':
			for (let i = 0; i < condition.any.length; i++) {
				if (evaluateCondition(condition.any[i]!, state)) return true;
			}
			return false;
	}
}

function resolveRecord(spec: Record<string, AbilityValueSpec> | undefined, state: AbilityExecutionState): Record<string, unknown> | undefined {
	if (!spec) return undefined;
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(spec)) {
		const entry = spec[key];
		if (!entry) continue;
		result[key] = resolveValue(entry, state);
	}
	return result;
}

function resolveValue(spec: AbilityValueSpec, state: AbilityExecutionState): unknown {
	switch (spec.kind) {
		case 'literal':
			return spec.value;
		case 'intent': {
			const intentPayload = state.intentPayload;
			if (!intentPayload) {
				if (spec.fallback) return resolveValue(spec.fallback, state);
				if (spec.optional) return undefined;
				throw new Error(`[AbilityBlueprintRunner] Ability '${state.blueprint.id}' requires intent payload but none provided.`);
			}
			if (!spec.path || spec.path.length === 0) return intentPayload;
			const value = readPath(intentPayload, spec.path);
			if (value === undefined) {
				if (spec.fallback) return resolveValue(spec.fallback, state);
				if (spec.optional) return undefined;
				throw new Error(`[AbilityBlueprintRunner] Intent path '${spec.path}' is undefined.`);
			}
			return value;
		}
		case 'var': {
			const exists = spec.name in state.vars;
			if (!exists) {
				if (spec.fallback) return resolveValue(spec.fallback, state);
				if (spec.optional) return undefined;
				throw new Error(`[AbilityBlueprintRunner] Ability variable '${spec.name}' is undefined.`);
			}
			return state.vars[spec.name];
		}
		case 'record': {
			const out: Record<string, unknown> = {};
			const entries = spec.entries;
			for (const key of Object.keys(entries)) {
				const child = entries[key];
				if (!child) continue;
				out[key] = resolveValue(child, state);
			}
			return out;
		}
		case 'array': {
			const out: unknown[] = [];
			for (let i = 0; i < spec.items.length; i++) {
				out.push(resolveValue(spec.items[i]!, state));
			}
			return out;
		}
	}
}

function resolveEventScope(scope: AbilityEventScopeSpec | undefined, state: AbilityExecutionState): EventScope | undefined {
	if (!scope) return undefined;
	switch (scope.kind) {
		case 'self':
			return state.runtime.ownerId;
		case 'world':
			return 'all';
		case 'object': {
			const id = resolveIdentifier(scope.target, state);
			return id;
		}
	}
}

function executeAction(task: CallActionTaskSpec, state: AbilityExecutionState): void {
	const action = state.actionRegistry.get(task.action);
	const params = resolveRecord(task.params, state);
	const ctx: AbilityActionContext = {
		owner: state.runtime.owner,
		ownerId: state.runtime.ownerId,
		vars: state.vars,
		intentPayload: state.intentPayload,
		hasTag: (tag: TagId) => state.runtime.hasTag(tag),
		addTag: (tag: TagId) => state.runtime.addTag(tag),
		removeTag: (tag: TagId) => state.runtime.removeTag(tag),
		dispatchMode: (event: string, payload: Record<string, unknown> | undefined, target: Identifier | undefined) => state.runtime.dispatchMode(event, payload, target),
		emitGameplay: (event: string, payload: unknown) => state.runtime.emitGameplay(event, payload),
		pushCommand: (command: GameplayCommand) => state.runtime.pushCommand(command),
		requestAbility: (id: AbilityId, opts?: { source?: string; payload?: Record<string, unknown> }) => state.runtime.requestAbility(id, opts),
	};
	action(ctx, params);
}

function readPath(source: unknown, path: string): unknown {
	if (source === undefined || source === null) return undefined;
	if (!path || path.length === 0) return source;
	const segments = path.split('.');
	let cursor: unknown = source;
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		if (!segment) continue;
		if (cursor === undefined || cursor === null) return undefined;
		if (typeof cursor !== 'object') return undefined;
		const record = cursor as Record<string, unknown>;
		if (!(segment in record)) return undefined;
		cursor = record[segment];
	}
	return cursor;
}

export function literal(value: unknown): LiteralValueSpec {
	return { kind: 'literal', value };
}

export function fromIntent(path?: string, fallback?: AbilityValueSpec, optional?: boolean): IntentValueSpec {
	return { kind: 'intent', path, fallback, optional };
}

export function fromVar(name: string, fallback?: AbilityValueSpec, optional?: boolean): VarValueSpec {
	return { kind: 'var', name, fallback, optional };
}

export function record(entries: Record<string, AbilityValueSpec>): RecordValueSpec {
	return { kind: 'record', entries };
}

export function array(items: AbilityValueSpec[]): ArrayValueSpec {
	return { kind: 'array', items };
}

export function abilityBlueprint(spec: Omit<AbilityBlueprint, 'blueprint_version'> & { blueprint_version?: number }): AbilityBlueprint {
	return { ...spec, blueprint_version: 1 };
}
