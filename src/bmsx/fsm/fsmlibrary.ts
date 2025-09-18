import type { EventScope } from "../core/eventemitter";
import { $ } from '../core/game';
import { deepClone, deepEqual } from '../utils/utils';
import type { Identifier } from '../rompack/rompack';
import { getDeclaredFsmHandlers, StateDefinitionBuilders } from "./fsmdecorators";
import type { EventBagName, listed_sdef_event, StateActionBlendProfileSpec, StateActionCondition, StateActionConditionalSpec, StateActionDispatchEventSpec, StateActionEmitSpec, StateActionMontageSpec, StateActionSetPropertySpec, StateActionSetTicksSpec, StateActionSpec, StateEventDefinition, StateEventHandler, StateExitHandler, Stateful, StateGuard, StateMachineBlueprint, StateNextHandler } from "./fsmtypes";
import { State } from './state';
import { StateDefinition, validateStateMachine } from './statedefinition';

/**
 * Represents the machine definitions.
 */
export var StateDefinitions: Record<string, StateDefinition>;
export var ActiveStateMachines: Map<string, State<Stateful>[]> = new Map();

export class HandlerRegistry {
	private static _instance: HandlerRegistry;
	private map = new Map<string, GenericHandler>();
	register(id: string, fn: GenericHandler) { this.map.set(id, fn); }
	get(id: string): GenericHandler | undefined { return this.map.get(id); }
	replaceBulk(entries: Record<string, GenericHandler>) { for (const k in entries) this.map.set(k, entries[k]); }
	static get instance(): HandlerRegistry {
		if (!this._instance) {
			this._instance = new HandlerRegistry();
		}
		return this._instance;
	}
}

// assign-fsm-augment.ts (unchanged logic, now gets keys from decorator)
const HANDLERS_REGISTERED = Symbol('fsm:handlersRegistered');

export function registerHandlersForLinkedMachines(ctor: any, linkedMachines: Set<string>) {
	const reg = HandlerRegistry.instance;
	const className = ctor.name;
	const entries = getDeclaredFsmHandlers(ctor);
	if (!entries.length || !linkedMachines?.size) return;
	const registered: Set<string> = (ctor as any)[HANDLERS_REGISTERED] ?? new Set<string>();

	for (const { name: memberName, keys } of entries) {
		for (const machine of linkedMachines) {
			for (const key of keys) {
				const id = `${machine}.handlers.${className}.${key}`;
				if (registered.has(id)) continue;
				const fn: GenericHandler = function (this: any, ...args) {
					let impl = this[memberName] ?? Object.getPrototypeOf(this)?.[memberName];
					if (typeof impl !== 'function') {
						throw new Error(`Registered FSM handler "${id}" is not callable (member: ${memberName})`);
					}
					return impl.apply(this, args);
				};
				reg.register(id, fn);
				registered.add(id);
			}
		}
	}
	(ctor as any)[HANDLERS_REGISTERED] = registered;
}

// ---------- Diff-based, tree-aware migration ----------
export function migrateMachineDiff(root: State<Stateful>, oldRootDef: StateDefinition | undefined, newRootDef: StateDefinition) {
	// Reconcile subtree shape (add/remove child State instances to match new defs)
	reconcileStateTree(root, oldRootDef, newRootDef);

	// Fix current state if invalid under new definition
	if (!root.states || !root.states[root.currentid]) {
		const start = safeStartStateId(newRootDef);
		root.currentid = start;
	}

	// Adjust tape head/ticks if tape changed size
	clampTape(root);

	// Migrate 'data' for this node and all descendants
	migrateDataTree(root, oldRootDef, newRootDef);
}

/** Ensure the instance’s children match the new StateDefinition tree. */
function reconcileStateTree(node: State<Stateful>, oldDef: StateDefinition | undefined, newDef: StateDefinition) {
	const newChildren = Object.keys(newDef.states ?? {});
	const oldChildren = Object.keys(node.states ?? {});

	// Remove stale children
	for (const id of oldChildren) {
		if (!newChildren.includes(id)) {
			node.states[id]?.dispose?.();
			delete node.states[id];
		}
	}

	// Add missing children
	for (const def_id of newChildren) {
		if (!node.states) node.states = {};
		if (!node.states[def_id]) {
			const child = new State({ def_id, target_id: node.target_id, parent: node, root: node.root });
			node.states[def_id] = child;
			// Build deeper children from definition
			reconcileStateTree(child, undefined, newDef.states![def_id] as StateDefinition);
		}
	}

	// Recurse into common children
	for (const id of newChildren) {
		const childInst = node.states?.[id];
		if (childInst) {
			const oldChildDef = oldDef?.states?.[id] as StateDefinition | undefined;
			const newChildDef = newDef.states![id] as StateDefinition;
			reconcileStateTree(childInst, oldChildDef, newChildDef);

			// Fix child's currentid if needed
			if (!childInst.states || !childInst.states[childInst.currentid]) {
				childInst.currentid = safeStartStateId(newChildDef);
			}
			clampTape(childInst);
		}
	}
}

/** Merge runtime data with new defaults, respecting old defaults to detect user-changed values. */
function migrateDataTree(node: State<Stateful>, oldDef: StateDefinition | undefined, newDef: StateDefinition) {
	node.data = mergeDataWithDefaults(node.data, oldDef?.data ?? {}, newDef.data ?? {});
	// Recurse
	for (const id in node.states ?? {}) {
		const child = node.states[id];
		const oldChildDef = oldDef?.states?.[id] as StateDefinition | undefined;
		const newChildDef = newDef.states?.[id] as StateDefinition | undefined;
		if (child && newChildDef) {
			migrateDataTree(child, oldChildDef, newChildDef);
		}
	}
}

/** Keep existing values unless they equal the old default and that default changed → then adopt new default. */
function mergeDataWithDefaults(
	live: Record<string, any>,
	oldDefaults: Record<string, any>,
	newDefaults: Record<string, any>,
) {
	const out: Record<string, any> = { ...live };

	// Add new keys or update keys whose value was still equal to the old default
	for (const key of Object.keys(newDefaults)) {
		const liveVal = out[key];
		const oldDefVal = oldDefaults[key];
		const newDefVal = newDefaults[key];

		if (!(key in out)) {
			out[key] = deepClone(newDefVal);
			continue;
		}

		const liveWasOldDefault = deepEqual(liveVal, oldDefVal);
		const defaultChanged = !deepEqual(oldDefVal, newDefVal);

		if (liveWasOldDefault && defaultChanged) {
			out[key] = deepClone(newDefVal);
		}
	}

	// Drop keys that no longer exist in defaults
	for (const key of Object.keys(out)) {
		if (!(key in newDefaults)) delete out[key];
	}

	return out;
}

function clampTape(node: State<Stateful>) {
	const tape = node.tape;
	if (!tape) {
		node.setHeadNoSideEffect(-1);
		node.setTicksNoSideEffect(0);
		return;
	}
	const maxHead = tape.length - 1;
	if (node.tapehead_position > maxHead) {
		node.setHeadNoSideEffect(Math.max(-1, maxHead));
		node.setTicksNoSideEffect(0);
	}
}

function safeStartStateId(def: StateDefinition): Identifier {
	if (def.initial && def.states?.[def.initial]) return def.initial;
	const first = def.states ? Object.keys(def.states)[0] : undefined;
	if (!first) throw new Error(`StateDefinition '${def.id}' has no states.`);
	return first;
}

/**
 * Builds the state machine definitions and sets them in the `MachineDefinitions` object.
 * Loops through all the `MachineDefinitionBuilders` and calls them to get the state machine definition.
 * If a definition is returned, it creates a new `sdef` object with the machine name and definition.
 * If the `sdef` object is created successfully, it sets the machine definition in the `MachineDefinitions` object.
 */
export function setupFSMlibrary(): void {
	StateDefinitions = {};
	for (const machine_name in StateDefinitionBuilders) {
		const raw = StateDefinitionBuilders[machine_name]();
		if (!raw) continue;

		const built = createMachine(machine_name, raw);
		// HOIST before validate so you can also validate handler existence if you switch to ID strings
		walkAndHoist(machine_name, built, HandlerRegistry.instance, [], /*useProxyThunks=*/true);

		validateStateMachine(built);
		StateDefinitions[machine_name] = built;
		addEventsToDef(built);
	}

	for (const [key, bp] of Object.entries($.rompack.fsm)) {
		const machineName = key; // je hebt zowel id als naam keys
		const def = createMachine(machineName as Identifier, bp);
		walkAndHoist(machineName, def, HandlerRegistry.instance, [], true);
		validateStateMachine(def);
		// Hot-swap: vervang als bestond, anders voeg toe
		// const existed = !!StateDefinitions[machineName];
		StateDefinitions[machineName] = def;
		// if (existed) {
		// for (const st of ActiveStateMachines.get(machineName) ?? []) {
		// optioneel: migrate(st, def);
		// }
		// }
		addEventsToDef(def); // jouw helper
	}
}

/**
 * Creates a new machine with the given machine name and machine definition.
 * If the machine definition has states, it creates a new machine definition for each state.
 * If a state has states, it creates a new machine definition for each substate.
 *
 * @param machine_name - The name of the machine.
 * @param machine_definition - The definition of the machine, including its states and states.
 */
function createMachine(machine_name: Identifier, machine_definition: StateMachineBlueprint): StateDefinition {
	// If the machine has states defined, create a new machine definition for each state
	return new StateDefinition(machine_name, machine_definition, null);
}

/**
 * Adds events to the machine definition.
 * If the machine has events defined, this function adds them to the event list of the machine definition.
 * @param machine - The StateMachineBlueprint object representing the machine definition.
 */
function addEventsToDef(machine: StateMachineBlueprint): void {
	// If the machine has events defined, add them to the event list of the machine definition
	const eventMap = getMachineEvents(machine); // Get the events from the machine definition
	if (eventMap && eventMap.size > 0) {
		machine.event_list = []; // Create a new event list for the machine definition
		eventMap.forEach(event_entry => { // Add the events to the event list of the machine definition
			// Check for duplicate events and raise a warning if found
			if (machine.event_list.some(e => e.name === event_entry.name && e.scope === event_entry.scope)) {
				console.warn(`Duplicate event found in machine ${machine.id}: ${event_entry.name} with scope ${event_entry.scope}`);
				debugger;
			}
			machine.event_list.push({ name: event_entry.name, scope: event_entry.scope }); // Add the event to the event list of the machine definition
		});
	}
}

/**
 * Retrieves the events from a state machine blueprint.
 * The events are retrieved from the machine definition and its submachines. The events are returned as a set of event names and scopes.
 * The reason for using a set is to prevent duplicate events from being added to the set.
 * The reason for creating the set itself is so that the {@link StateMachineController} can subscribe to all the events that are defined in the machine definition and its submachines.
 * Note that the events are returned as a set of event names and scopes, where the scope is 'all' if the event is not prefixed with '$', otherwise it is 'self'.
 * Also note that any existing events with the same name and scope will be replaced if the scope is 'all', otherwise it will not be replaced.
 *
 * @param machine - The state machine blueprint.
 * @param eventNamesAndScopes - Optional set of event names and scopes to filter the events.
 * @returns A set of events from the state machine blueprint.
 */
function getMachineEvents(machine: StateMachineBlueprint, eventNamesAndScopes?: Set<listed_sdef_event>, eventMap?: Map<string, boolean>) {
	/**
	 * Adds a state event to the list of events, where the name of the event is the key and the scope is the value.
	 * Note that the scope is 'all' if the event is not prefixed with '$', otherwise it is 'self'.
	 * Also note that any existing events with the same name and scope will be replaced if the scope is 'all', otherwise it will not be replaced.
	 * See {@link addAndReplace} for more information.
	 *
	 * @param name - The name of the state event.
	 * @param definition - The definition of the state event.
	 */
	function add(name: string, definition: string | StateEventDefinition): void {
		if (typeof definition === 'string') {
			addAndReplace(removeScopeFromEventName(name), parseEventScope(name));
		}
		else {
			addAndReplace(removeScopeFromEventName(name), definition.scope ?? parseEventScope(name));
		}
	}

	/**
	 * Adds an event to the `events` set and marks it as added in the `addedEvents` map.
	 * Ensures that duplicate events are not added based on their name and scope.
	 *
	 * @param name - The name of the event to be added.
	 * @param scope - The scope of the event, which can be a specific scope or 'all' for global scope.
	 *
	 * The function follows these rules:
	 * - If the event is already marked as added in `addedEvents`, it will not be added again.
	 * - If a global-scoped event (`scope: 'all'`) is already added, it prevents adding a specific-scoped event with the same name.
	 * - If the event is not already added, it is added to the `events` set and marked in `addedEvents`.
	 */
	function addAndReplace(name: string, scope: string): void {
		const key = `${name}-${scope}`; // Create a unique key for the event based on its name and scope

		if (addedEvents.has(key)) return; // If the event is already added, don't add it again
		if (addedEvents.has(`${name}-all`)) return; // If the event is already in the set, and the scope is global, don't replace it with a specific scoped event

		// If the event is not in the set, add it
		events.add({ name: name, scope: scope });

		// Mark the event as added in the map to prevent duplicates
		addedEvents.set(key, true);
	}

	/**
	 * Checks if the event name has a scope.
	 * @param name The event name.
	 * @returns True if the event name has a scope, false otherwise.
	 */
	function hasScope(name: string): boolean {
		return name.startsWith('$');
	}

	/**
	 * Parses the event scope from the event name.
	 * @param name The event name.
	 * @returns The event scope ('self' or 'all').
	 */
	function parseEventScope(name: string): EventScope {
		return hasScope(name) ? 'self' : 'all';
	}

	/**
	 * Removes the scope from an event name.
	 * If the event name starts with '$', the scope is removed by slicing the first character.
	 * Otherwise, the event name is returned as is.
	 *
	 * @param name - The event name to remove the scope from.
	 * @returns The event name without the scope.
	 */
	function removeScopeFromEventName(name: string): string {
		return hasScope(name) ? name.slice(1) : name;
	}

	// Get the events from the machine definition
	const events = eventNamesAndScopes ?? new Set<listed_sdef_event>();
	const addedEvents = eventMap ?? new Map<string, boolean>(); // Map to track added events to prevent duplicates
	// Start with the events defined in the machine definition
	if (machine.on) {
		// Add all events from the machine definition
		for (const name in machine.on) {
			// Get the event definition
			const definition = machine.on[name];
			// Add the event to the list of events
			add(name, definition);
		}
		// Remove all '$' prefixes from the event names
		machine.on = Object.fromEntries(Object.entries(machine.on).map(([name, value]) => [removeScopeFromEventName(name), value]));
	}

	// Get the events from the submachines
	for (const stateId in machine.states) {
		// Get the state definition
		const state = machine.states[stateId];
		// Skip the state if it doesn't have a definition
		const state_def = state;
		if (!state_def) continue;
		if (state_def.on) {
			// Add all events from the state definition
			for (const name in state_def.on) {
				// Get the event definition
				const definition = state_def.on[name];
				// Add the event to the list of events
				add(name, definition);
			}
			// Remove all '$' prefixes from the event names
			state_def.on = Object.fromEntries(Object.entries(state_def.on).map(([name, value]) => [removeScopeFromEventName(name), value]));
		}

		// If the state has a submachine, recursively subscribe to its events
		if (state_def.states) {
			getMachineEvents(state, events, addedEvents);
		}
	}

	return events;
}

function makeId(parts: string[]) { return parts.join('.'); }

type GenericHandler = (this: any, ...args: any[]) => any;
function annotateHandler(fn: Function, id: string): void {
	try {
		Object.defineProperty(fn, '_handlerId', { value: id, configurable: true, writable: true });
	} catch {
		// Fallback if defineProperty fails (shouldn't on functions)
		(fn as { _handlerId?: string })._handlerId = id;
	}
}

type HandlerInvokeOptions = {
	defaultValue?: any;
	coerceBoolean?: boolean;
	debugRef?: string;
};

type BuiltinExecutionContext = {
	self: any;
	state: State | undefined;
	args: any[];
	slot: string;
};

function buildContext(self: any, state: State | undefined, args: any[], slot: string): BuiltinExecutionContext {
	return { self, state, args, slot };
}

function parsePathSegments(path: string): (string | number)[] {
	const segments: (string | number)[] = [];
	if (!path) return segments;
	const parts = path.split('.');
	for (const part of parts) {
		if (!part) continue;
		const regex = /([^\[\]]+)|(\[(\d+)\])/g;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(part)) !== null) {
			if (match[1]) {
				segments.push(match[1]);
			}
			else if (match[3]) {
				segments.push(Number(match[3]));
			}
		}
	}
	return segments;
}

function resolveBinding(binding: string, ctx: BuiltinExecutionContext): any {
	if (!binding) return undefined;
	const segments = parsePathSegments(binding);
	if (!segments.length) return undefined;
	const first = segments.shift()!;
	let current: any;
	switch (first) {
		case 'self':
			current = ctx.self;
			break;
		case 'state':
			current = ctx.state;
			break;
		case 'args':
			current = ctx.args;
			break;
		default:
			current = ctx.self;
			segments.unshift(first);
			break;
	}
	for (const token of segments) {
		if (current == null) return undefined;
		current = current[token as any];
	}
	return current;
}

function resolveTemplateValue(value: any, ctx: BuiltinExecutionContext): any {
	if (typeof value === 'string') {
		if (value.startsWith('@')) {
			return resolveBinding(value.slice(1), ctx);
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(item => resolveTemplateValue(item, ctx));
	}
	if (value && typeof value === 'object') {
		const result: Record<string, any> = {};
		for (const [key, item] of Object.entries(value)) {
			result[key] = resolveTemplateValue(item, ctx);
		}
		return result;
	}
	return value;
}

function setPathValue(target: any, segments: (string | number)[], value: any): void {
	if (!target || !segments.length) return;
	let obj = target;
	for (let i = 0; i < segments.length - 1; i++) {
		const token = segments[i];
		if (obj[token as any] == null) {
			obj[token as any] = typeof segments[i + 1] === 'number' ? [] : {};
		}
		obj = obj[token as any];
		if (obj == null) return;
	}
	const last = segments[segments.length - 1];
	obj[last as any] = value;
}

function applySetProperty(targetSpec: string, valueSpec: any, ctx: BuiltinExecutionContext): void {
	if (!targetSpec) return;
	const resolvedValue = resolveTemplateValue(valueSpec, ctx);
	if (targetSpec.startsWith('@')) {
		const segments = parsePathSegments(targetSpec.slice(1));
		if (!segments.length) return;
		const rootToken = segments.shift()!;
		let base: any;
		switch (rootToken) {
			case 'self':
				base = ctx.self;
				break;
			case 'state':
				base = ctx.state;
				break;
			case 'args':
				base = ctx.args;
				break;
			default:
				return;
		}
		if (base == null) return;
		setPathValue(base, segments, resolvedValue);
		return;
	}
	const segments = parsePathSegments(targetSpec);
	setPathValue(ctx.self, segments, resolvedValue);
}

function resolveTarget(targetSpec: any, ctx: BuiltinExecutionContext): any {
	if (targetSpec === undefined || targetSpec === null) return ctx.self;
	return resolveTemplateValue(targetSpec, ctx);
}

function evaluateCondition(condition: StateActionCondition | undefined, ctx: BuiltinExecutionContext): boolean {
	if (!condition) return true;
	if (condition.arg_equals) {
		const actual = ctx.args?.[condition.arg_equals.index];
		const expected = resolveTemplateValue(condition.arg_equals.equals, ctx);
		if (actual !== expected) return false;
	}
	if (condition.value_equals) {
		const left = resolveTemplateValue(condition.value_equals.left, ctx);
		const right = resolveTemplateValue(condition.value_equals.equals, ctx);
		if (!deepEqual(left, right)) return false;
	}
	if (condition.value_not_equals) {
		const left = resolveTemplateValue(condition.value_not_equals.left, ctx);
		const right = resolveTemplateValue(condition.value_not_equals.equals, ctx);
		if (deepEqual(left, right)) return false;
	}
	if (condition.state_matches) {
		if (!stateMatchesCondition(condition.state_matches, ctx)) return false;
	}
	if (condition.state_not_matches) {
		if (stateMatchesCondition(condition.state_not_matches, ctx)) return false;
	}
	if (condition.and) {
		for (const sub of condition.and) {
			if (!evaluateCondition(sub, ctx)) return false;
		}
	}
	if (condition.or && condition.or.length > 0) {
		let matched = false;
		for (const sub of condition.or) {
			if (evaluateCondition(sub, ctx)) {
				matched = true;
				break;
			}
		}
		if (!matched) return false;
	}
	if (condition.not && evaluateCondition(condition.not, ctx)) return false;
	return true;
}

function stateMatchesCondition(spec: string | { path: string; machine?: string }, ctx: BuiltinExecutionContext): boolean {
	const controller = ctx.self?.sc;
	if (!controller?.matches_state_path) return false;
	let path: string;
	if (typeof spec === 'string') {
		path = spec;
	}
	else {
		path = spec.path;
		if (spec.machine && !path.startsWith(spec.machine)) {
			path = `${spec.machine}.${path}`;
		}
	}
	try {
		return controller.matches_state_path(path);
	}
	catch {
		return false;
	}
}

const MissingHandlerWarnings = new Set<string>();

function warnMissingHandler(refId: string, debugRef?: string): void {
	const key = `${refId}::${debugRef ?? ''}`;
	if (MissingHandlerWarnings.has(key)) return;
	MissingHandlerWarnings.add(key);
	console.warn(`[FSM] Handler '${refId}' referenced by '${debugRef ?? 'unknown slot'}' is not registered.`);
}

function createDelegatedHandler(targetId: string, registry: HandlerRegistry, opts: HandlerInvokeOptions): GenericHandler {
	return function (this: any, ...args: any[]) {
		const handler = registry.get(targetId);
		if (!handler) {
			warnMissingHandler(targetId, opts.debugRef);
			return opts.coerceBoolean ? !!opts.defaultValue : opts.defaultValue;
		}
		const result = handler.apply(this, args);
		return opts.coerceBoolean ? !!result : result;
	};
}

function createProxyForRegistryId(id: string, registry: HandlerRegistry, opts: HandlerInvokeOptions): GenericHandler {
	return function (this: any, ...args: any[]) {
		const handler = registry.get(id);
		if (!handler) return opts.coerceBoolean ? !!opts.defaultValue : opts.defaultValue;
		const result = handler.apply(this, args);
		return opts.coerceBoolean ? !!result : result;
	};
}

function createBuiltinHandlerFromString(slot: string, value: string): GenericHandler | undefined {
	if (slot === 'tape_next' || slot === 'tape_end') {
		const path = value.trim();
		if (!path) return undefined;
		return function () { return path; };
	}
	return undefined;
}

function createEmitHandler(spec: StateActionEmitSpec, slot: string): GenericHandler {
	const normalized = typeof spec === 'string' ? { event: spec } : spec;
	if (!normalized?.event) throw new Error('FSM builtin emit action requires an event name.');
	const emitterMode = normalized.emitter ?? 'self';
	return function (this: any, state?: State, ...invokeArgs: any[]) {
		const ctx = buildContext(this, state, invokeArgs, slot);
		const emitter = emitterMode === 'state' ? (state?.target ?? state) : this;
		const payload = normalized.payload ? resolveTemplateValue(normalized.payload, ctx) : undefined;
		$.emit(normalized.event, emitter ?? this, payload);
	};
}

function createDispatchEventHandler(spec: StateActionDispatchEventSpec['dispatch_event'], slot: string): GenericHandler {
	return function (this: any, state?: State, ...invokeArgs: any[]) {
		if (!spec?.event) return;
		const controller = this?.sc;
		if (!controller?.dispatch_event) return;
		const ctx = buildContext(this, state, invokeArgs, slot);
		const emitterResolved = spec.emitter !== undefined ? resolveTemplateValue(spec.emitter, ctx) : this;
		const argsResolvedRaw = spec.args === undefined ? [] : (Array.isArray(spec.args) ? spec.args : [spec.args]);
		const argsResolved = argsResolvedRaw.map(arg => resolveTemplateValue(arg, ctx));
		const emitter = emitterResolved ?? this;
		controller.dispatch_event(spec.event, emitter, ...argsResolved);
	};
}

function createBlendProfileHandler(spec: StateActionBlendProfileSpec['blend_profile'], slot: string): GenericHandler {
	return function (this: any, state?: State, ...invokeArgs: any[]): void {
		if (!spec) return;
		const ctx = buildContext(this, state, invokeArgs, slot);
		const target = resolveTarget(spec.target, ctx);
		if (!target) return;
		const profile = resolveTemplateValue(spec.profile, ctx);
		const fadeRaw = spec.fade !== undefined ? resolveTemplateValue(spec.fade, ctx) : undefined;
		const fade = typeof fadeRaw === 'number' ? fadeRaw : (fadeRaw != null ? Number(fadeRaw) : undefined);
		const methodName = spec.method ?? 'applyBlendProfile';
		const method = target?.[methodName as keyof typeof target];
		if (typeof method === 'function') {
			(method as Function).call(target, profile, fade);
			return;
		}
		if (spec.property) {
			const segments = parsePathSegments(spec.property);
			setPathValue(target, segments, profile);
			return;
		}
		const eventName = spec.event ?? 'animation.blend_profile';
		$.emit(eventName, target, { profile, fade, slot });
	};
}

function createPlayMontageHandler(spec: StateActionMontageSpec['play_montage'], slot: string): GenericHandler {
	return function (this: any, state?: State, ...invokeArgs: any[]): void {
		if (!spec) return;
		const ctx = buildContext(this, state, invokeArgs, slot);
		const target = resolveTarget(spec.target, ctx);
		if (!target) return;
		const montage = resolveTemplateValue(spec.montage, ctx);
		const rate = spec.rate !== undefined ? resolveTemplateValue(spec.rate, ctx) : undefined;
		const blendIn = spec.blend_in !== undefined ? resolveTemplateValue(spec.blend_in, ctx) : undefined;
		const blendOut = spec.blend_out !== undefined ? resolveTemplateValue(spec.blend_out, ctx) : undefined;
		const startSection = spec.start_section !== undefined ? resolveTemplateValue(spec.start_section, ctx) : undefined;
		const options = { rate, blendIn, blendOut, startSection, slot };
		const methodName = spec.method ?? 'playMontage';
		const method = target?.[methodName as keyof typeof target];
		if (typeof method === 'function') {
			try {
				if ((method as Function).length >= 2) {
					(method as Function).call(target, montage, options);
				} else {
					(method as Function).call(target, montage);
				}
			} catch (err) {
				console.warn(`[FSM] playMontage handler '${methodName}' on`, target, 'threw', err);
			}
			return;
		}
		const eventName = spec.event ?? 'animation.play_montage';
		$.emit(eventName, target ?? this, { montage, ...options });
	};
}

function createSetTicksToLastFrameHandler(): GenericHandler {
	return function (_state: State) {
		if (!_state) return;
		const current = _state.current;
		const def = current?.definition;
		if (!current || !def) return;
		const ticks = Math.max(0, (def.ticks2advance_tape ?? 0) - 1);
		current.setTicksNoSideEffect(ticks);
	};
}

function createBuiltinHandlerFromSpec(slot: string, spec: StateActionSpec | undefined): GenericHandler | undefined {
	const compiled = compileAction(slot, spec);
	if (!compiled) return undefined;
	return function (this: any, state?: State, ...args: any[]) {
		return compiled.call(this, state, ...args);
	};
}

function compileAction(slot: string, spec: StateActionSpec | undefined): GenericHandler | undefined {
	if (spec == null) return undefined;
	if (Array.isArray(spec)) {
		const handlers = spec
			.map(item => compileAction(slot, item))
			.filter((fn): fn is GenericHandler => typeof fn === 'function');
		if (handlers.length === 0) return undefined;
		return function (this: any, state?: State, ...args: any[]) {
			let result: any;
			for (const handler of handlers) {
				result = handler.call(this, state, ...args);
			}
			return result;
		};
	}
	if (typeof spec !== 'object') return undefined;
	if ('when' in spec && (spec as StateActionConditionalSpec).when) {
		const conditional = spec as StateActionConditionalSpec;
		const thenHandler = compileAction(slot, conditional.then);
		const elseHandler = compileAction(slot, conditional.else);
		if (!thenHandler && !elseHandler) return undefined;
		return function (this: any, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot);
			if (evaluateCondition(conditional.when, ctx)) {
				return thenHandler?.call(this, state, ...args);
			}
			return elseHandler?.call(this, state, ...args);
		};
	}
	if ('set_property' in spec) {
		const { target, value } = (spec as StateActionSetPropertySpec).set_property;
		return function (this: any, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot);
			applySetProperty(target, value, ctx);
		};
	}
	if ('emit' in spec) {
		return createEmitHandler((spec as { emit: StateActionEmitSpec }).emit, slot);
	}
	if ('set_ticks_to_last_frame' in spec && (spec as StateActionSetTicksSpec).set_ticks_to_last_frame) {
		return createSetTicksToLastFrameHandler();
	}
	if ('dispatch_event' in spec) {
		return createDispatchEventHandler((spec as StateActionDispatchEventSpec).dispatch_event, slot);
	}
	if ('blend_profile' in spec) {
		return createBlendProfileHandler((spec as StateActionBlendProfileSpec).blend_profile, slot);
	}
	if ('play_montage' in spec) {
		return createPlayMontageHandler((spec as StateActionMontageSpec).play_montage, slot);
	}
	return undefined;
}

function hoistSlot(
	owner: Record<string, any>,
	slot: string,
	id: string,
	registry: HandlerRegistry,
	useProxyThunks: boolean,
	options: HandlerInvokeOptions = {}
): void {
	const current = owner[slot];
	if (typeof current === 'function') {
		registry.register(id, current as GenericHandler);
		if (useProxyThunks) {
			const proxy = createProxyForRegistryId(id, registry, options);
			annotateHandler(proxy as Function, id);
			owner[slot] = proxy;
		} else {
			annotateHandler(current as Function, id);
			owner[slot] = current;
		}
		return;
	}
	if (typeof current === 'string') {
		const builtin = createBuiltinHandlerFromString(slot, current);
		if (builtin) {
			registry.register(id, builtin);
			if (useProxyThunks) {
				const proxy = createProxyForRegistryId(id, registry, options);
				annotateHandler(proxy as Function, id);
				owner[slot] = proxy;
			} else {
				annotateHandler(builtin as Function, id);
				owner[slot] = builtin;
			}
			return;
		}
		const delegated = createDelegatedHandler(current, registry, { ...options, debugRef: id });
		registry.register(id, delegated);
		annotateHandler(delegated as Function, id);
		if (useProxyThunks) {
			const proxy = createProxyForRegistryId(id, registry, options);
			annotateHandler(proxy as Function, id);
			owner[slot] = proxy;
		} else {
			owner[slot] = delegated;
		}
		return;
	}
	if (typeof current === 'object' && current) {
		const builtin = createBuiltinHandlerFromSpec(slot, current as StateActionSpec);
		if (builtin) {
			registry.register(id, builtin);
			if (useProxyThunks) {
				const proxy = createProxyForRegistryId(id, registry, options);
				annotateHandler(proxy as Function, id);
				owner[slot] = proxy;
			} else {
				annotateHandler(builtin as Function, id);
				owner[slot] = builtin;
			}
		}
	}
}

// @ts-ignore
type EventSlots = { [K in keyof StateEventDefinition]-?: StateEventDefinition[K] extends Function | undefined ? K : never }[keyof StateEventDefinition];
// @ts-ignore
type GuardSlots = { [K in keyof StateGuard]-?: StateGuard[K] extends Function | undefined ? K : never }[keyof StateGuard];
type StateDefHandlerValue = StateEventHandler | StateExitHandler | StateNextHandler;
// @ts-ignore
type StateSlots = { [K in keyof StateDefinition]-?: StateDefinition[K] extends StateDefHandlerValue | undefined ? K : never }[keyof StateDefinition];

// Removed unused proxy factory (thunks not used in current code path)

// Event definition handlers
function hoistEventIf(ownerDef: StateEventDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
	hoistSlot(ownerDef as unknown as Record<string, any>, 'if', id, registry, useProxyThunks, { defaultValue: false, coerceBoolean: true });
}

function hoistEventDo(ownerDef: StateEventDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
	hoistSlot(ownerDef as unknown as Record<string, any>, 'do', id, registry, useProxyThunks);
}

// Guard handlers
function hoistGuardCanEnter(ownerDef: StateGuard, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
	hoistSlot(ownerDef as unknown as Record<string, any>, 'can_enter', id, registry, useProxyThunks, { defaultValue: false, coerceBoolean: true });
}

function hoistGuardCanExit(ownerDef: StateGuard, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
	hoistSlot(ownerDef as unknown as Record<string, any>, 'can_exit', id, registry, useProxyThunks, { defaultValue: false, coerceBoolean: true });
}

// StateDefinition handlers
function hoistStateTick(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
	hoistSlot(ownerDef as unknown as Record<string, any>, 'tick', id, registry, useProxyThunks);
}

function hoistStateTapeEnd(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
	hoistSlot(ownerDef as unknown as Record<string, any>, 'tape_end', id, registry, useProxyThunks);
}

function hoistStateTapeNext(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
	hoistSlot(ownerDef as unknown as Record<string, any>, 'tape_next', id, registry, useProxyThunks);
}

function hoistStateEntering(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
	hoistSlot(ownerDef as unknown as Record<string, any>, 'entering_state', id, registry, useProxyThunks);
}

function hoistStateExiting(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
	hoistSlot(ownerDef as unknown as Record<string, any>, 'exiting_state', id, registry, useProxyThunks);
}

function hoistStateProcessInput(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
	hoistSlot(ownerDef as unknown as Record<string, any>, 'process_input', id, registry, useProxyThunks);
}

function normalizeEventNameForId(name: string) {
	return name.startsWith('$') ? name.slice(1) : name;
}

function hoistEventDef(
	machineName: string,
	statePath: string[],
	bagName: keyof Pick<StateDefinition, 'on' | 'input_event_handlers'>,
	rawEventName: string,
	eventDefinition: StateEventDefinition,
	registry: HandlerRegistry,
	useProxyThunks: boolean
) {
	if (!eventDefinition || typeof eventDefinition === 'string') return;

	const eventName = normalizeEventNameForId(rawEventName);
	const base = [machineName, ...statePath, bagName, eventName];

	if (typeof eventDefinition.if !== 'undefined') {
		hoistEventIf(eventDefinition, makeId([...base, 'if']), registry, useProxyThunks);
	}
	if (typeof eventDefinition.do !== 'undefined') {
		hoistEventDo(eventDefinition, makeId([...base, 'do']), registry, useProxyThunks);
	}
}

function walkAndHoist(
	machineName: string,
	sdef: StateDefinition,
	registry: HandlerRegistry,
	path: string[] = [],
	useProxyThunks = true
) {
	// direct slots — aligned with StateDefinition handler properties
	if (typeof sdef.tick !== 'undefined') hoistStateTick(sdef, makeId([machineName, ...path, 'tick']), registry, useProxyThunks);
	if (typeof sdef.tape_end !== 'undefined') hoistStateTapeEnd(sdef, makeId([machineName, ...path, 'tape_end']), registry, useProxyThunks);
	if (typeof sdef.tape_next !== 'undefined') hoistStateTapeNext(sdef, makeId([machineName, ...path, 'tape_next']), registry, useProxyThunks);
	if (typeof sdef.entering_state !== 'undefined') hoistStateEntering(sdef, makeId([machineName, ...path, 'entering_state']), registry, useProxyThunks);
	if (typeof sdef.exiting_state !== 'undefined') hoistStateExiting(sdef, makeId([machineName, ...path, 'exiting_state']), registry, useProxyThunks);
	if (typeof sdef.process_input !== 'undefined') hoistStateProcessInput(sdef, makeId([machineName, ...path, 'process_input']), registry, useProxyThunks);

	// on / input_event_handlers
	for (const bagName of ['on', 'input_event_handlers'] as EventBagName[]) {
		const bag = (sdef as StateDefinition)[bagName];
		if (!bag) continue;
		for (const rawEventName of Object.keys(bag)) {
			const evDef = bag[rawEventName];
			if (typeof evDef === 'object') {
				hoistEventDef(machineName, path, bagName, rawEventName, evDef, registry, useProxyThunks);
			}
		}
	}

	// run_checks
	const rc = sdef.run_checks;
	if (Array.isArray(rc)) {
		rc.forEach((chk, i) => {
			if (!chk || typeof chk !== 'object') return;
			const base = [machineName, ...path, `run_checks[${i}]`];
			if (typeof chk.if !== 'undefined') {
				hoistEventIf(chk, makeId([...base, 'if']), registry, useProxyThunks);
			}
			if (typeof chk.do !== 'undefined') {
				hoistEventDo(chk, makeId([...base, 'do']), registry, useProxyThunks);
			}
		});
	}

	// guards
	const g = sdef.transition_guards;
	if (g && typeof g === 'object') {
		if (typeof g.can_enter !== 'undefined') {
			hoistGuardCanEnter(g, makeId([machineName, ...path, 'guards', 'can_enter']), registry, useProxyThunks);
		}
		if (typeof g.can_exit !== 'undefined') {
			hoistGuardCanExit(g, makeId([machineName, ...path, 'guards', 'can_exit']), registry, useProxyThunks);
		}
	}

	// recurse children
	if (sdef.states) {
		for (const [childId, child] of Object.entries(sdef.states) as [string, StateDefinition][]) {
			walkAndHoist(machineName, child, registry, [...path, childId], useProxyThunks);
		}
	}
}
