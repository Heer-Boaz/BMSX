import type { EventLane, EventPayload, EventScope } from "../core/eventemitter";
import { $ } from '../core/game';
import { deepClone, deepEqual } from '../utils/utils';
import type { Identifier } from '../rompack/rompack';
import { AbilitySystemComponent } from '../component/abilitysystemcomponent';
import { GameplayCommandBuffer, type GameplayCommand } from '../ecs/gameplay_command_buffer';
import { getDeclaredFsmHandlers, StateDefinitionBuilders } from "./fsmdecorators";
import type {
	EventBagName,
	listed_sdef_event,
	StateActionActivateAbilitySpec,
	StateActionAddTagSpec,
	StateActionAdjustPropertySpec,
	StateActionAdjustSpec,
	StateActionCondition,
	StateActionConditionalSpec,
	StateActionConsumeActionSpec,
	StateActionDispatchEventSpec,
	StateActionDispatchSpec,
	StateActionEmitSpec,
	StateActionInvokeSpec,
	StateActionRemoveTagSpec,
	StateActionSetPropertySpec,
	StateActionSetSpec,
	StateActionSetTicksSpec,
	StateActionSpec,
	StateActionSubmitCommandSpec,
	StateActionTagOps,
	StateActionTagsSpec,
	StateActionTransitionCompositeSpec,
	StateTransition,
	StateEventDefinition,
	StateEventHandler,
	StateExitHandler,
	Stateful,
	StateGuard,
	StateMachineBlueprint,
	StateNextHandler,
	TransitionType
} from "./fsmtypes";
import { State } from './state';
import { StateDefinition, validateStateMachine } from './statedefinition';
import type { StateMachineController } from './fsmcontroller';
import type { WorldObject } from 'bmsx/core/object/worldobject';

/**
 * Represents the machine definitions.
 */
export const StateDefinitions: Record<string, StateDefinition> = {};
export const ActiveStateMachines: Map<string, State<Stateful>[]> = new Map();

function clearDefinitionsForMachine(machineId: Identifier): void {
	const prefix = `${machineId}:/`;
	for (const key of Object.keys(StateDefinitions)) {
		if (key === machineId || key.startsWith(prefix)) {
			delete StateDefinitions[key];
		}
	}
}

function registerDefinitionTree(def: StateDefinition): void {
	const defKey = def.def_id ?? def.id;
	if (!defKey) {
		throw new Error(`StateDefinition '${def.id ?? '<anonymous>'}' is missing a def_id and id.`);
	}
	if (!def.def_id) {
		def.def_id = defKey as Identifier;
	}
	StateDefinitions[defKey] = def;
	if (def.root === def && def.id && def.id !== defKey) {
		StateDefinitions[def.id] = def;
	}
	if (!def.states) return;
	for (const stateId of Object.keys(def.states)) {
		const child = def.states[stateId] as StateDefinition | undefined;
		if (child) registerDefinitionTree(child);
	}
}

export class HandlerRegistry {
	public static readonly instance: HandlerRegistry = new HandlerRegistry();
	private map = new Map<string, GenericHandler>();
	register(id: string, fn: GenericHandler) { this.map.set(id, fn); }
	get(id: string): GenericHandler | undefined { return this.map.get(id); }
	replaceBulk(entries: Record<string, GenericHandler>) { for (const k in entries) this.map.set(k, entries[k]); }
}

// assign-fsm-augment.ts (unchanged logic, now gets keys from decorator)
const HANDLERS_REGISTERED = Symbol('fsm:handlersRegistered');

export function registerHandlersForLinkedMachines(ctor: any, linkedMachines: Set<string>) {
	const reg = HandlerRegistry.instance;
	const className = ctor.name;
	const entries = getDeclaredFsmHandlers(ctor);
	if (!entries.length || !linkedMachines?.size) return;
	const registered: Set<string> = ctor[HANDLERS_REGISTERED] ?? new Set<string>();

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
	ctor[HANDLERS_REGISTERED] = registered;
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
			const child = new State({ localdef_id: def_id, target_id: node.target_id, parent: node, root: node.root });
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
	// Combine built-in FSMs from decorators with ones from ROM pack
	for (const [key, bp] of Object.entries($.rompack.fsm)) {
		StateDefinitionBuilders[key] = () => bp;
	}

	for (const machine_name in StateDefinitionBuilders) {
		const raw = StateDefinitionBuilders[machine_name]();
		if (!raw) continue;

		const built = createMachine(machine_name, raw);
		// HOIST before validate so you can also validate handler existence if you switch to ID strings
		walkAndHoist(machine_name, built, HandlerRegistry.instance, [], /*useProxyThunks=*/true);

		validateStateMachine(built);
		clearDefinitionsForMachine(machine_name);
		registerDefinitionTree(built);

		addEventsToDef(built);
	}

	// for (const [key, bp] of Object.entries($.rompack.fsm)) {
	// 	const machineName = key; // je hebt zowel id als naam keys
	// 	const def = createMachine(machineName as Identifier, bp);
	// 	walkAndHoist(machineName, def, HandlerRegistry.instance, [], true);
	// 	validateStateMachine(def);
	// 	// Hot-swap: vervang als bestond, anders voeg toe
	// 	// const existed = !!StateDefinitions[machineName];
	// 	StateDefinitions[machineName] = def;
	// 	// if (existed) {
	// 	// for (const st of ActiveStateMachines.get(machineName) ?? []) {
	// 	// optioneel: migrate(st, def);
	// 	// }
	// 	// }
	// 	addEventsToDef(def);
	// }
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
			machine.event_list.push({ name: event_entry.name, scope: event_entry.scope, lane: event_entry.lane ?? 'any' }); // Add the event to the event list of the machine definition
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
		const baseName = removeScopeFromEventName(name);
		const scope = typeof definition === 'string' ? parseEventScope(name) : (definition.scope ?? parseEventScope(name));
		const lane = inferLaneForEvent(baseName, definition);
		addAndReplace(baseName, scope, lane);
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
	function inferLaneForEvent(name: string, definition: string | StateEventDefinition): EventLane | 'any' {
		if (typeof definition !== 'string') {
			const lane = (definition as StateEventDefinition & { lane?: EventLane | 'any' }).lane;
			if (lane) return lane;
		}
		const lowered = name.toLowerCase();
		if (lowered.startsWith('mode.') || lowered.startsWith('state.') || lowered.startsWith('combat.') || lowered.startsWith('ability.') || lowered.startsWith('input.') || lowered.startsWith('hit') || lowered.startsWith('ai.')) {
			return 'gameplay';
		}
		if (lowered.startsWith('animate') || lowered.startsWith('fx.') || lowered.startsWith('sfx.') || lowered.startsWith('ui.') || lowered.startsWith('camera.') || lowered.startsWith('music.') || lowered.startsWith('screen') || lowered.startsWith('presentation.')) {
			return 'presentation';
		}
		return 'any';
	}

	function addAndReplace(name: string, scope: string, lane: EventLane | 'any'): void {
		const key = `${name}-${scope}`; // Create a unique key for the event based on its name and scope

		if (addedEvents.has(key)) return; // If the event is already added, don't add it again
		if (addedEvents.has(`${name}-all`)) return; // If the event is already in the set, and the scope is global, don't replace it with a specific scoped event

		// If the event is not in the set, add it
		events.add({ name: name, scope: scope, lane });

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
	self: Stateful;
	state: State | undefined;
	payload?: EventPayload;
	slot: string;
};

function buildContext(self: Stateful, state: State | undefined, rawArgs: any[] | undefined, slot: string): BuiltinExecutionContext {
	const args = Array.isArray(rawArgs) ? rawArgs : rawArgs != null ? [rawArgs] : [];
	let payload: EventPayload | undefined;
	for (let i = args.length - 1; i >= 0; i--) {
		const candidate = args[i];
		if (candidate != null && typeof candidate === 'object' && !Array.isArray(candidate)) {
			payload = candidate;
			break;
		}
	}
	if (payload === undefined && args.length > 0) payload = args[0];
	return { self, state, payload, slot };
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
		case 'payload':
			current = ctx.payload;
			if (segments.length > 0 && (current === null || typeof current !== 'object' || Array.isArray(current))) {
				throw new Error(`[FSMLibrary] Payload is not an object, but a ${typeof current}, cannot get property ${segments.join('.')}.`);
			}
			break;
		case 'component': {
			const owner = ctx.self as { componentMap?: Record<string, any[]> } | undefined;
			if (!owner) return undefined;
			const compKey = segments.shift();
			if (typeof compKey !== 'string') return undefined;
			const list = owner.componentMap?.[compKey];
			if (!list || list.length === 0) return undefined;
			let index = 0;
			if (typeof segments[0] === 'number') {
				index = segments.shift() as number;
			}
			current = list[index];
			break;
		}
		default:
			current = ctx.self;
			segments.unshift(first);
			break;
	}
	for (const token of segments) {
		if (current == null) return undefined;
		let next = current[token];
		if (next === undefined && typeof token === 'string') {
			let ctor = typeof current === 'function' ? current : current.constructor;
			while (ctor && ctor !== Object && ctor !== Function) {
				if (Object.prototype.hasOwnProperty.call(ctor, token)) {
					next = ctor[token];
					break;
				}
				ctor = Object.getPrototypeOf(ctor);
			}
		}
		current = next;
	}
	return current;
}

function resolveTemplateValue(value: any, ctx: BuiltinExecutionContext): any {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		const signedMatch = trimmed.match(/^([+-])['"]?@([^'"\s]+)['"]?$/);
		if (signedMatch) {
			const [, signChar, path] = signedMatch;
			const resolved = resolveBinding(path, ctx);
			const numeric = toNumber(resolved);
			return signChar === '-' ? -numeric : numeric;
		}
		const quotedBindingMatch = trimmed.match(/^["']@([^"']+)["']$/);
		if (quotedBindingMatch) {
			return resolveBinding(quotedBindingMatch[1], ctx);
		}
		if (trimmed.startsWith('@')) {
			return resolveBinding(trimmed.slice(1), ctx);
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

function setPathValue(target: any, segments: (string | number)[], modifier: string | undefined, value: any): void {
	if (!target || !segments.length) return;
	let obj = target;
	for (let i = 0; i < segments.length - 1; i++) {
		const token = segments[i];
		if (obj[token] == null) {
			obj[token] = typeof segments[i + 1] === 'number' ? [] : {};
		}
		obj = obj[token];
		if (obj == null) return;
	}
	const last = segments[segments.length - 1];
	if (modifier) {
		switch (modifier) {
			case '-':
				obj[last] = (obj[last] || 0) - value;
				break;
			case '+':
				obj[last] = (obj[last] || 0) + value;
				break;
			case '!':
				obj[last] = !value;
				break;
			case '!!':
				obj[last] = !!value;
				break;
			case '~':
				if (typeof obj[last] === 'number' && typeof value === 'number') {
					obj[last] = obj[last] & ~value;
				} else if (Array.isArray(obj[last])) {
					const idx = obj[last].indexOf(value);
					if (idx >= 0) obj[last].splice(idx, 1);
				}
				break;
			case '~~':
				if (typeof obj[last] === 'number' && typeof value === 'number') {
					obj[last] = obj[last] ^ value;
				} else if (Array.isArray(obj[last])) {
					const idx = obj[last].indexOf(value);
					if (idx >= 0) {
						obj[last].splice(idx, 1);
					} else {
						obj[last].push(value);
					}
				}
				break;
			case '=':
				// No-op, just set the value
				obj[last] = value;
				break;
			default:
				throw new Error(`[FSMLibrary] Unsupported modifier '${modifier}' in path.`);
		}
	} else {
		obj[last] = value;
	}
}

function getPathValue(target: any, segments: (string | number)[]): any {
	if (!segments.length) return target;
	let current = target;
	for (const token of segments) {
		if (current == null) return undefined;
		current = current[token];
	}
	return current;
}

function resolveComponentFromSegments(self: any, segments: (string | number)[]): { component: any; rest: (string | number)[] } | null {
	if (!self) return null;
	const compKey = segments.shift();
	if (typeof compKey !== 'string') return null;
	const list = self.componentMap?.[compKey];
	if (!list || list.length === 0) return null;
	let index = 0;
	if (typeof segments[0] === 'number') {
		index = segments.shift() as number;
	}
	const component = list[index];
	if (!component) return null;
	return { component, rest: segments };
}

function resolveTargetReference(targetSpec: string, ctx: BuiltinExecutionContext): { base: any; path: (string | number)[]; modifier?: string } | null {
	if (!targetSpec) return null;

	// Extract leading modifiers like '-', '!', '~~', etc.
	// We accept one or more of the characters -, !, ~ as a modifier prefix.
	// If present, strip it and keep it in the returned result so callers can react.
	let spec = targetSpec.trim();
	let modifier: string | undefined;
	const modMatch = spec.match(/^([\-!~]+)(.*)$/);
	if (modMatch) {
		modifier = modMatch[1];
		spec = modMatch[2].trim();
		if (!spec) return null;
	}

	let segments: (string | number)[];
	let base: any;
	if (spec.startsWith('@')) {
		segments = parsePathSegments(spec.slice(1));
		if (!segments.length) return null;
		const rootToken = segments.shift()!;
		switch (rootToken) {
			case 'self':
				base = ctx.self;
				break;
			case 'state':
				base = ctx.state;
				break;
			case 'payload':
				base = ctx.payload;
				if (typeof base !== 'object') throw new Error(`[FSMLibrary] Payload is not an object, cannot set property on it.`);
				break;
			case 'component': {
				const resolved = resolveComponentFromSegments(ctx.self, segments);
				if (!resolved) return null;
				base = resolved.component;
				segments = resolved.rest;
				break;
			}
			default:
				return null; // Not a referenced path
		}
	}
	else {
		segments = parsePathSegments(spec);
		base = ctx.self;
	}
	if (base == null) throw new Error(`[FSMLibrary] Cannot resolve target reference for path '${targetSpec}'.`);
	return { base, path: segments, modifier };
}

function applySetProperty(targetSpec: string, valueSpec: any, ctx: BuiltinExecutionContext): void {
	if (!targetSpec) return;
	const resolvedValue = resolveTemplateValue(valueSpec, ctx);
	const target = resolveTargetReference(targetSpec, ctx);
	if (!target) throw new Error(`[FSMLibrary] Cannot resolve target reference for path '${targetSpec}'.`);
	if (!target.path.length) throw new Error(`[FSMLibrary] Target reference for path '${targetSpec}' has no property path.`);
	setPathValue(target.base, target.path, target.modifier, resolvedValue);
}

function resolveNumberOperand(spec: any, ctx: BuiltinExecutionContext): number {
	if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
		if (Object.prototype.hasOwnProperty.call(spec, 'mul')) {
			const factors = ensureArray((spec as { mul: any }).mul);
			if (factors.length === 0) return 0;
			let result = 1;
			for (const factor of factors) {
				result *= resolveNumberOperand(factor, ctx);
			}
			return result;
		}
		if (Object.prototype.hasOwnProperty.call(spec, 'neg')) {
			return -resolveNumberOperand((spec as { neg: any }).neg, ctx);
		}
	}
	const resolved = resolveTemplateValue(spec, ctx);
	return toNumber(resolved);
}

function toNumber(value: any): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		if (!Number.isNaN(parsed)) return parsed;
	}
	return 0;
}

// function resolveCommandTarget(targetSpec: any, ctx: BuiltinExecutionContext, fallback: any): { id: Identifier; entity?: any } | null {
// 	if (targetSpec === undefined || targetSpec === null) {
// 		const entity = ctx.self ?? fallback;
// 		const id = typeof entity?.id === 'string' ? entity.id as Identifier : undefined;
// 		return id ? { id, entity } : null;
// 	}
// 	const resolved = resolveTemplateValue(targetSpec, ctx);
// 	if (typeof resolved === 'string') {
// 		return { id: resolved as Identifier };
// 	}
// 	if (typeof resolved === 'number') {
// 		return { id: String(resolved) as Identifier };
// 	}
// 	if (resolved && typeof resolved === 'object') {
// 		const idValue = (resolved as { id?: unknown }).id;
// 		if (typeof idValue === 'string') {
// 			return { id: idValue as Identifier, entity: resolved };
// 		}
// 	}
// 	return null;
// }

function applyAdjustProperty(targetSpec: string, adjust: { add?: any; sub?: any; mul?: any; div?: any; set?: any }, ctx: BuiltinExecutionContext): void {
	if (!targetSpec) return;
	const target = resolveTargetReference(targetSpec, ctx);
	if (!target) return;
	if (!target.path.length) return;
	const currentValue = getPathValue(target.base, target.path);
	let result = typeof currentValue === 'number' ? currentValue : 0;
	if (adjust.set !== undefined) {
		result = resolveNumberOperand(adjust.set, ctx);
	}
	if (adjust.add !== undefined) {
		result += resolveNumberOperand(adjust.add, ctx);
	}
	if (adjust.sub !== undefined) {
		result -= resolveNumberOperand(adjust.sub, ctx);
	}
	if (adjust.mul !== undefined) {
		result *= resolveNumberOperand(adjust.mul, ctx);
	}
	if (adjust.div !== undefined) {
		const divisor = resolveNumberOperand(adjust.div, ctx);
		if (divisor !== 0) result /= divisor;
	}
	setPathValue(target.base, target.path, target.modifier, result);
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function applyGameplayTagOperation(target: WorldObject, tags: string | string[], op: StateActionTagOps): void {
	const asc = target.getUniqueComponent(AbilitySystemComponent);
	if (!asc) throw new Error(`[FSMLibrary] Target entity ${target.id} does not have an AbilitySystemComponent, cannot ${op} gameplay tags ${tags}.`);

	switch (op) {
		case 'add':
			if (typeof tags === 'string') {
				asc.addTag(tags);
			}
			else {
				tags.forEach(tag => asc.addTag(tag));
			}
			break;
		case 'remove':
			if (typeof tags === 'string') {
				asc.removeTag(tags);
			}
			else {
				tags.forEach(tag => asc.removeTag(tag));
			}
			break;
		case 'toggle':
			if (typeof tags === 'string') {
				if (asc.hasTag(tags)) {
					asc.removeTag(tags);
				}
				else {
					asc.addTag(tags);
				}
			}
			else {
				tags.forEach(tag => {
					if (asc.hasTag(tag)) {
						asc.removeTag(tag);
					}
					else {
						asc.addTag(tag);
					}
				});
			}
			break;
		default:
			throw new Error(`[FSMLibrary] Unknown gameplay tag operation: ${op}`);
	}
}

function evaluateCondition(condition: StateActionCondition | undefined, ctx: BuiltinExecutionContext): boolean {
	if (!condition) return true;
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
	const controller = ctx.self?.sc as StateMachineController;
	if (!controller?.matches_state_path) return false;
	let path: string;
	if (typeof spec === 'string') {
		path = spec;
	}
	else {
		path = spec.path;
		if (spec.machine && !path.startsWith(spec.machine)) {
			path = `${spec.machine}:/${path}`;
		}
	}
	return controller.matches_state_path(path);
}

const MissingHandlerWarnings = new Set<string>();

function warnMissingHandler(refId: string, debugRef?: string): void {
	const key = `${refId}::${debugRef ?? ''}`;
	if (MissingHandlerWarnings.has(key)) return;
	MissingHandlerWarnings.add(key);
	console.warn(`[FSM] Handler '${refId}' referenced by '${debugRef ?? 'unknown slot'}' is not registered.`);
}

function createDelegatedHandler(targetId: string, registry: HandlerRegistry, opts: HandlerInvokeOptions): GenericHandler {
	return function (this: Stateful, ...args: any[]) {
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
	return function (this: Stateful, ...args: any[]) {
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

function resolveEmitter(emitterSpec: any, ctx: BuiltinExecutionContext, fallback: any): any {
	if (emitterSpec === undefined || emitterSpec === 'self') return fallback;
	if (emitterSpec === 'state') return ctx.state?.target ?? ctx.state;
	return resolveTemplateValue(emitterSpec, ctx);
}

function buildEventName(source: any, ctx: BuiltinExecutionContext): string {
	if (source == null) return '';
	if (Array.isArray(source)) {
		return ensureArray(source)
			.map(part => String(resolveTemplateValue(part, ctx)))
			.join('');
	}
	return String(resolveTemplateValue(source, ctx));
}

function createEmitHandler(spec: StateActionEmitSpec, slot: string): GenericHandler {
	const normalized = typeof spec === 'string' ? { event: spec } : (spec ?? {});
	const emitterSpec = normalized.emitter;
	const laneDefault = normalized.lane ?? 'presentation';
	const eventSpec = normalized.event;
	return function (this: Stateful, state?: State, ...invokeArgs: any[]) {
		const ctx = buildContext(this, state, invokeArgs, slot);
		const emitter = resolveEmitter(emitterSpec, ctx, this) ?? this;
		const payload = normalized.payload !== undefined ? resolveTemplateValue(normalized.payload, ctx) : undefined;
		const lane = laneDefault as EventLane;
		const eventName = buildEventName(eventSpec, ctx);
		if (!eventName) throw new Error(`[FSMLibrary] Cannot emit event with empty name in slot '${slot}'.`);
		switch (lane) {
			case 'any':
				$.emit(eventName, emitter, payload);
			case 'gameplay':
				$.emitGameplay(eventName, emitter, payload);
				break;
			case 'presentation':
				$.emitPresentation(eventName, emitter, payload);
				break;
			default:
				throw new Error(`[FSMLibrary] Cannot emit event with invalid lane '${lane}' in slot '${slot}'.`);
		}
		if (typeof eventName !== 'string' || !eventName.trim()) {
			throw new Error(`[FSMLibrary] Cannot emit event with empty name in slot '${slot}'.`);
		}
	};
}

function createDispatchEventHandler(spec: StateActionDispatchEventSpec['dispatch_event'], slot: string): GenericHandler {
	return function (this: Stateful, state?: State, ...invokeArgs: any[]) {
		if (!spec?.event) throw new Error(`[FSMLibrary] Cannot dispatch event with empty name in slot '${slot}'.`);
		const controller = this.sc;
		const ctx = buildContext(this, state, invokeArgs, slot);
		const emitterResolved = spec.emitter !== undefined ? resolveTemplateValue(spec.emitter, ctx) : this;
		const argsResolvedRaw = spec.payload === undefined ? [] : (Array.isArray(spec.payload) ? spec.payload : [spec.payload]);
		const argsResolved = argsResolvedRaw.map(arg => resolveTemplateValue(arg, ctx));
		const emitter = emitterResolved ?? this;
		controller.dispatch_event(spec.event, emitter, ...argsResolved);
	};
}

function createSetTicksToLastFrameHandler(): GenericHandler {
	return function (state: State) {
		if (!state) throw new Error(`[FSMLibrary] Cannot set ticks to last frame on undefined state.`);
		const current = state.current;
		if (!current) throw new Error(`[FSMLibrary] Cannot set ticks to last frame on state '${state.path}' with no current state.`);
		const def = current.definition;
		if (!def) throw new Error(`[FSMLibrary] Cannot set ticks to last frame on state '${state.path}' with invalid current state.`);
		const ticks = Math.max(0, (def.ticks2advance_tape ?? 0) - 1);
		current.setTicksNoSideEffect(ticks);
	};
}

const CONDITION_COMPATIBLE_SLOTS = new Set(['if', 'can_enter', 'can_exit']);
const CONDITION_SPEC_KEYS = new Set([
	'value_equals',
	'value_not_equals',
	'state_matches',
	'state_not_matches',
	'and',
	'or',
	'not'
]);
const TRANSITION_SPEC_KEYS = ['to', 'switch', 'force_leaf', 'revert'] as const;
const TRANSITION_TYPE_VALUES = new Set<TransitionType>(['to', 'switch', 'force_leaf', 'revert']);
type TransitionSpecKey = typeof TRANSITION_SPEC_KEYS[number];

type TransitionLikeSpec = Partial<Record<TransitionSpecKey, unknown>> & { do?: StateActionSpec | StateActionSpec[] };

function hasOwn(obj: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function hasDoContainer(spec: unknown): spec is { do: StateActionSpec | StateActionSpec[] } {
	return !!spec && typeof spec === 'object' && !Array.isArray(spec) && hasOwn(spec as object, 'do');
}

function isConditionSlot(slot: string): boolean {
	return CONDITION_COMPATIBLE_SLOTS.has(slot);
}

function looksLikeConditionSpec(spec: unknown): spec is StateActionCondition {
	if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return false;
	return Object.keys(spec).some(key => CONDITION_SPEC_KEYS.has(key));
}

function looksLikeTransitionSpec(spec: unknown): spec is TransitionLikeSpec {
	if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return false;
	return TRANSITION_SPEC_KEYS.some(key => hasOwn(spec as object, key));
}

function resolveTransitionInstruction(key: TransitionSpecKey, value: unknown, ctx: BuiltinExecutionContext, slot: string): any {
	if (value === undefined || value === null) return undefined;
	if (key === 'revert') {
		const resolved = resolveTemplateValue(value, ctx);
		return resolved ? { transition_type: 'revert' as TransitionType } : undefined;
	}

	let stateSpec: unknown = value;
	let payloadSpec: unknown;
	let forceSameSpec: unknown;
	let transitionType: TransitionType = key;

	if (typeof value === 'object' && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;
		if ('state_id' in obj) {
			stateSpec = obj.state_id;
		}
		else if ('state' in obj) {
			stateSpec = obj.state;
		}
		else if ('target' in obj) {
			stateSpec = obj.target;
		}
		payloadSpec = obj.payload;
		forceSameSpec = obj.force_transition_to_same_state;
		if (typeof obj.transition_type === 'string' && TRANSITION_TYPE_VALUES.has(obj.transition_type as TransitionType)) {
			transitionType = obj.transition_type as TransitionType;
		}
	}

	const resolvedState = resolveTemplateValue(stateSpec, ctx);
	if (resolvedState === undefined || resolvedState === null) {
		throw new Error(`[FSMLibrary] Transition '${key}' in slot '${slot}' resolved to null or undefined.`);
	}
	if (Array.isArray(resolvedState)) {
		throw new Error(`[FSMLibrary] Transition '${key}' in slot '${slot}' resolved to an array, expected a string.`);
	}
	if (typeof resolvedState !== 'string' && typeof resolvedState !== 'number') {
		throw new Error(`[FSMLibrary] Transition '${key}' in slot '${slot}' must resolve to a string.`);
	}
	const state_id = typeof resolvedState === 'string' ? resolvedState : String(resolvedState);
	const resolvedPayload = payloadSpec !== undefined ? resolveTemplateValue(payloadSpec, ctx) : undefined;
	const resolvedForceSame = forceSameSpec !== undefined ? !!resolveTemplateValue(forceSameSpec, ctx) : false;
	const instruction: Record<string, unknown> = { state_id, transition_type: transitionType };
	if (resolvedPayload !== undefined) instruction.payload = resolvedPayload;
	if (resolvedForceSame) instruction.force_transition_to_same_state = true;
	return instruction;
}

function normalizeTransitionResult(result: unknown): StateTransition | Identifier | undefined {
	if (!result) return undefined;
	if (typeof result === 'string') return result;
	if (typeof result === 'object') return result as StateTransition;
	throw new Error(`[FSMLibrary] Transition action returned invalid result of type '${typeof result}'.`);
}

function compileTransitionAction(slot: string, spec: StateActionTransitionCompositeSpec): GenericHandler {
	const doSpec = hasDoContainer(spec) ? spec.do : undefined;
	const doHandler = doSpec !== undefined ? compileAction(slot, doSpec) : undefined;
	return function (this: Stateful, state?: State, ...args: any[]): any {
		if (doHandler) {
			const doResult = doHandler.call(this, state, ...args);
			const normalized = normalizeTransitionResult(doResult);
			if (normalized !== undefined) return normalized;
		}
		const ctx = buildContext(this, state, args, slot);
		for (const key of TRANSITION_SPEC_KEYS) {
			if (!hasOwn(spec, key)) continue;
			const instruction = resolveTransitionInstruction(key, (spec as Record<TransitionSpecKey, unknown>)[key], ctx, slot);
			if (instruction !== undefined) return instruction;
		}
		throw new Error(`[FSMLibrary] Transition action in slot '${slot}' has no valid transition instruction.`);
	};
}

function createBuiltinHandlerFromSpec(slot: string, spec: StateActionSpec | StateActionCondition | undefined): GenericHandler | undefined {
	const compiled = compileAction(slot, spec);
	if (!compiled) throw new Error(`[FSMLibrary] Action spec in slot '${slot}' could not be compiled.`);
	return function (this: Stateful, state?: State, ...args: any[]) {
		return compiled.call(this, state, ...args);
	};
}

function compileAction(slot: string, spec: StateActionSpec | StateActionCondition | undefined): GenericHandler | undefined {
	if (spec == null) throw new Error(`[FSMLibrary] Action spec is null or undefined in slot '${slot}'.`);
	if (isConditionSlot(slot) && looksLikeConditionSpec(spec)) {
		return function (this: Stateful, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot);
			return evaluateCondition(spec, ctx);
		};
	}
	if (hasDoContainer(spec) && !looksLikeTransitionSpec(spec)) {
		const doSpec = (spec as { do: StateActionSpec | StateActionSpec[] }).do;
		return compileAction(slot, doSpec as StateActionSpec | StateActionSpec[]);
	}
	if (looksLikeTransitionSpec(spec)) {
		return compileTransitionAction(slot, spec as StateActionTransitionCompositeSpec);
	}
	if (Array.isArray(spec)) {
		const handlers = spec
			.map(item => compileAction(slot, item))
			.filter((fn): fn is GenericHandler => typeof fn === 'function');
		if (handlers.length === 0) throw new Error(`[FSMLibrary] Action spec array in slot '${slot}' contains no valid actions.`);
		return function (this: Stateful, state?: State, ...args: any[]) {
			let result: any;
			for (const handler of handlers) {
				result = handler.call(this, state, ...args);
			}
			return result;
		};
	}
	if (typeof spec !== 'object') throw new Error(`[FSMLibrary] Action spec in slot '${slot}' is not an object or array.`);
	if ('when' in spec && (spec as StateActionConditionalSpec).when) {
		const conditional = spec as StateActionConditionalSpec;
		const thenHandler = conditional.then ? compileAction(slot, conditional.then) : undefined;
		const elseHandler = conditional.else ? compileAction(slot, conditional.else) : undefined;
		if (!thenHandler && !elseHandler) throw new Error(`[FSMLibrary] Action spec in slot '${slot}' is not valid.`);
		return function (this: Stateful, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot);
			if (evaluateCondition(conditional.when, ctx)) {
				return thenHandler.call(this, state, ...args);
			}
			return elseHandler?.call(this, state, ...args);
		};
	}
	if ('set' in spec) {
		const setSpec = (spec as StateActionSetSpec).set;
		if (!setSpec || !setSpec.target) throw new Error(`[FSMLibrary] Action spec in slot '${slot}' is not valid.`);
		const { target, value } = setSpec;
		return function (this: Stateful, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot);
			applySetProperty(target, value, ctx);
		};
	}
	if ('adjust' in spec) {
		const adjustSpec = (spec as StateActionAdjustSpec).adjust;
		if (!adjustSpec || !adjustSpec.target) throw new Error(`[FSMLibrary] Action spec in slot '${slot}' is not valid.`);
		const { target } = adjustSpec;
		return function (this: Stateful, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot);
			applyAdjustProperty(target, { add: adjustSpec.add, sub: adjustSpec.sub, mul: adjustSpec.mul, div: adjustSpec.div, set: adjustSpec.set }, ctx);
		};
	}
	if ('tags' in spec) {
		const tagsSpec = (spec as StateActionTagsSpec).tags ?? {};
		return function (this: Stateful, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot) as BuiltinExecutionContext & { self: WorldObject };
			if (tagsSpec.add !== undefined) {
				const addResolved = resolveTemplateValue(tagsSpec.add, ctx);
				applyGameplayTagOperation(ctx.self, addResolved, 'add');
			}
			if (tagsSpec.remove !== undefined) {
				const removeResolved = resolveTemplateValue(tagsSpec.remove, ctx);
				applyGameplayTagOperation(ctx.self, removeResolved, 'remove');
			}
			if (tagsSpec.toggle !== undefined) {
				const toggleResolved = resolveTemplateValue(tagsSpec.toggle, ctx);
				applyGameplayTagOperation(ctx.self, toggleResolved, 'toggle');
			}
		};
	}
	if ('set_property' in spec) {
		const { target, value } = (spec as StateActionSetPropertySpec).set_property;
		return function (this: Stateful, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot);
			applySetProperty(target, value, ctx);
		};
	}
	if ('adjust_property' in spec) {
		const adjust = (spec as StateActionAdjustPropertySpec).adjust_property;
		const { target, add, sub, mul, div, set } = adjust;
		return function (this: Stateful, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot);
			applyAdjustProperty(target, { add, sub, mul, div, set }, ctx);
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
	if ('dispatch' in spec) {
		const config = (spec as StateActionDispatchSpec).dispatch;
		return function (this: Stateful, state?: State, ...args: any[]) {
			const controller = this?.sc;
			if (!controller?.dispatch_event) return;
			const ctx = buildContext(this, state, args, slot);
			const eventName = String(resolveTemplateValue(config.event, ctx));
			if (!eventName) throw new Error(`[FSMLibrary] Cannot dispatch event with empty name in slot '${slot}'.`);
			const emitter = resolveEmitter(config.emitter, ctx, this) ?? this;
			const payloadResolved = config.payload !== undefined ? resolveTemplateValue(config.payload, ctx) : undefined;
			if (payloadResolved === undefined) {
				controller.dispatch_event(eventName, emitter);
				return;
			}
			if (Array.isArray(payloadResolved)) {
				controller.dispatch_event(eventName, emitter, ...payloadResolved);
				return;
			}
			controller.dispatch_event(eventName, emitter, payloadResolved);
		};
	}
	if ('add_tag' in spec) {
		const tagsSpec = (spec as StateActionAddTagSpec).add_tag;
		return function (this: WorldObject, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot) as BuiltinExecutionContext & { self: WorldObject };
			applyGameplayTagOperation(ctx.self, resolveTemplateValue(tagsSpec, ctx), 'add');
		};
	}
	if ('remove_tag' in spec) {
		const tagsSpec = (spec as StateActionRemoveTagSpec).remove_tag;
		return function (this: WorldObject, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot) as BuiltinExecutionContext & { self: WorldObject };
			applyGameplayTagOperation(ctx.self, resolveTemplateValue(tagsSpec, ctx), 'remove');
		};
	}
	if ('activate_ability' in spec) {
		const config = (spec as StateActionActivateAbilitySpec).activate_ability;
		return function (this: WorldObject, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot) as BuiltinExecutionContext & { self: WorldObject };
			const asc = ctx.self.getUniqueComponent(AbilitySystemComponent);
			if (!asc) throw new Error(`[FSMLibrary] Entity ${ctx.self.id} does not have an AbilitySystemComponent, cannot activate ability.`);
			const resolved = resolveTemplateValue(config, ctx);
			if (!resolved) throw new Error(`[FSMLibrary] Ability spec in slot '${slot}' did not resolve to a valid ability identifier or object.`);
			const id = typeof resolved === 'string' ? resolved : resolved.id;
			if (!id) throw new Error(`[FSMLibrary] Ability spec in slot '${slot}' did not resolve to a valid ability identifier.`);
			const opts: { source?: string; payload?: Record<string, unknown> } = {};
			if (typeof resolved === 'object' && resolved) {
				if ('payload' in resolved) opts.payload = resolved.payload as Record<string, unknown> | undefined;
				if ('source' in resolved && typeof resolved.source === 'string') opts.source = resolved.source;
			}
			const result = asc.requestAbility(id, opts);
			if (!result.ok) {
				if ($.debug) {
					const reason = 'reason' in result ? result.reason : 'unknown';
					console.debug('[FSM] activate_ability', id, 'rejected:', reason);
				}
			}
		};
	}
	if ('invoke' in spec) {
		const { fn, payload } = (spec as StateActionInvokeSpec).invoke ?? {};
		return function (this: Stateful, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot);
			const resolvedFn = typeof fn === 'string' && fn.startsWith('@')
				? resolveBinding(fn.slice(1), ctx)
				: resolveTemplateValue(fn, ctx);
			if (typeof resolvedFn !== 'function') throw new Error(`[FSMLibrary] Cannot invoke non-function in slot '${slot}'.`);
			let payloadValue = payload !== undefined ? resolveTemplateValue(payload, ctx) : undefined;
			if (payloadValue === undefined) payloadValue = { state, payload: ctx.payload };
			resolvedFn.call(ctx.self ?? this, payloadValue);
		};
	}
	if ('consume_action' in spec) {
		const consume = (spec as StateActionConsumeActionSpec).consume_action;
		return function (this: Stateful, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot);
			const actions = ensureArray(consume).map(item => resolveTemplateValue(item, ctx)).filter(v => typeof v === 'string' && v.length > 0) as string[];
			if (actions.length === 0) throw new Error(`[FSMLibrary] consume_action spec in slot '${slot}' did not resolve to any valid action names.`);
			const player = $.input.getPlayerInput(ctx.self.player_index);
			if (!player) throw new Error(`[FSMLibrary] Cannot find player input for player index ${ctx.self.player_index}.`);
			for (const action of actions) player.consumeAction(action);
		};
	}
	if ('command' in spec) {
		const commandSpec = (spec as StateActionSubmitCommandSpec).command;
		if (!commandSpec) throw new Error(`[FSMLibrary] Command spec in slot '${slot}' is not valid.`);
		return function (this: Stateful, state?: State, ...args: any[]) {
			const ctx = buildContext(this, state, args, slot);
			const command = resolveTemplateValue(commandSpec, ctx);
			if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error(`[FSMLibrary] Command spec in slot '${slot}' did not resolve to a valid command object.`);
			GameplayCommandBuffer.instance.push(command as GameplayCommand);
		};
	}
	throw new Error(`[FSMLibrary] Action spec in slot '${slot}' is not valid. No recognized action keys found in spec "${JSON.stringify(spec)}".`);
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
	bagName: EventBagName,
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
		const bag = sdef[bagName];
		if (!bag) continue;
		for (const rawEventName of Object.keys(bag)) {
			const evDef = bag[rawEventName];
			switch (typeof evDef) {
				case 'object':
					hoistEventDef(machineName, path, bagName, rawEventName, evDef, registry, useProxyThunks);
					break;
				case 'string':
					// string definitions are just direct event names, no handlers to hoist
					break;
				case 'undefined':
					// skip
					break;
				default:
					// unsupported event definition
					throw new Error(`Unsupported event definition for ${rawEventName}: ${JSON.stringify(evDef)}`);
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
