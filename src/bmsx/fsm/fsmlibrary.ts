import { deep_equal } from '../utils/deep_equal';
import { deep_clone } from '../utils/deep_clone';
import { computeBlueprintSignature, cloneBlueprint } from '../utils/blueprint';
import type { Identifier } from '../rompack/rompack';
import { getDeclaredFsmHandlers, StateDefinitionBuilders } from "./fsmdecorators";
import { HandlerRegistry, type HandlerDescriptor } from '../core/handlerregistry';
import type {
	EventBagName,
	listed_sdef_event,
	StateEventDefinition,
	StateEventHandler,
	StateExitHandler,
	Stateful,
	StateGuard,
	StateMachineBlueprint,
} from "./fsmtypes";
import { State } from './state';
import { StateDefinition, validateStateMachine } from './statedefinition';

/**
 * Represents the machine definitions.
 */
export const StateDefinitions: Record<string, StateDefinition> = {};
export const ActiveStateMachines: Map<string, State<Stateful>[]> = new Map();
const stateMachineBlueprintSignatures: Map<Identifier, string> = new Map();
type GenericHandler = (this: any, ...args: any[]) => any;
function filterValidStateMachineInstances(machineId: Identifier, instances: ReadonlyArray<State<Stateful>>): State<Stateful>[] {
	if (!instances || instances.length === 0) {
		ActiveStateMachines.delete(machineId);
		return [];
	}
	const valid: State<Stateful>[] = [];
	let mutated = false;
	for (const instance of instances) {
		if (!instance || !instance.target || !instance.target.sc) {
			mutated = true;
			continue;
		}
		valid.push(instance);
	}
	if (mutated) {
		if (valid.length === 0) {
			ActiveStateMachines.delete(machineId);
		} else {
			ActiveStateMachines.set(machineId, valid);
		}
	}
	return valid;
}

function collectControllers(instances: readonly State<Stateful>[]): Set<any> {
	const controllers = new Set<any>();
	for (const instance of instances) {
		const target = instance.target;
		const controller = target?.sc;
		if (controller) controllers.add(controller);
	}
	return controllers;
}

function unsubscribeStateMachineEvents(instances: readonly State<Stateful>[], definition?: StateDefinition): void {
	if (!definition || !definition.event_list || definition.event_list.length === 0) return;
	for (const instance of instances) {
		const target = instance.target;
		const controller = target?.sc;
		if (!controller) continue;
		const names = definition.event_list.map(entry => entry.name);
		controller.unsubscribeEventsFor(instance, names);
	}
}

function hotReloadStateMachine(machineId: Identifier, previousDefinition: StateDefinition, newDefinition: StateDefinition): void {
	if (!previousDefinition) return;
	const instances = filterValidStateMachineInstances(machineId, ActiveStateMachines.get(machineId));
	if (instances.length === 0) return;
	const controllers = collectControllers(instances);
	unsubscribeStateMachineEvents(instances, previousDefinition);
	for (const instance of instances) {
		migrateMachineDiff(instance, previousDefinition, newDefinition);
	}
	for (const controller of controllers) {
		controller.bind();
	}
}

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
		const child = def.states[stateId] as StateDefinition;
		if (child) registerDefinitionTree(child);
	}
}

// assign-fsm-augment.ts (unchanged logic, now gets keys from decorator)
const HANDLERS_REGISTERED = Symbol('fsm:handlersRegistered');

export function registerHandlersForLinkedMachines(ctor: any, linkedMachines: Set<string>) {
	const reg = HandlerRegistry.instance;
	const className = ctor.name;
	const entries = getDeclaredFsmHandlers(ctor);
	if (!entries.length || !linkedMachines || linkedMachines.size === 0) return;
	const registered: Set<string> = ctor[HANDLERS_REGISTERED] ?? new Set<string>();

	for (const { name: memberName, keys } of entries) {
		for (const machine of linkedMachines) {
			for (const key of keys) {
				const id = `${machine}.handlers.${className}.${key}`;
				if (registered.has(id)) continue;
				const fn: GenericHandler = function (this: any, ...args) {
					let impl = (this as Record<string, any>)[memberName];
					if (typeof impl !== 'function') {
						const proto = Object.getPrototypeOf(this);
						if (proto) impl = proto[memberName];
					}
					if (typeof impl !== 'function') {
						throw new Error(`Registered FSM handler "${id}" is not callable (member: ${memberName})`);
					}
					return impl.apply(this, args);
				};
				const desc: HandlerDescriptor = {
					id,
					category: 'fsm',
					target: { machine, component: className, hook: key },
					source: { lang: 'js', module: `js::fsm::class::${className}`, symbol: memberName },
				};
				reg.register(desc, fn);
				registered.add(id);
			}
		}
	}
	ctor[HANDLERS_REGISTERED] = registered;
}

// ---------- Diff-based, tree-aware migration ----------
export function migrateMachineDiff(root: State<Stateful>, oldRootDef: StateDefinition, newRootDef: StateDefinition) {
	// Reconcile subtree shape (add/remove child State instances to match new defs)
	reconcileStateTree(root, oldRootDef, newRootDef);

	// Fix current state if invalid under new definition
	if (!root.states || !root.states[root.currentid]) {
		const start = safeStartStateId(newRootDef);
		root.currentid = start;
	}

	// Migrate 'data' for this node and all descendants
	migrateDataTree(root, oldRootDef, newRootDef);
}

/** Ensure the instance’s children match the new StateDefinition tree. */
function reconcileStateTree(node: State<Stateful>, oldDef: StateDefinition, newDef: StateDefinition) {
	const newChildren = Object.keys(newDef.states ?? {});
	const oldChildren = Object.keys(node.states ?? {});

	// Remove stale children
	for (const id of oldChildren) {
		if (!newChildren.includes(id)) {
			if (node.states) {
				const existing = node.states[id];
				existing?.dispose?.();
				delete node.states[id];
			}
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
		const childInst = node.states ? node.states[id] : undefined;
		if (childInst) {
			const oldChildStates = oldDef ? oldDef.states : undefined;
			const oldChildDef = oldChildStates ? oldChildStates[id] as StateDefinition : undefined;
			const childStates = newDef.states;
			const newChildDef = childStates ? childStates[id] as StateDefinition : undefined;
			if (!newChildDef) {
				throw new Error(`State definition '${newDef.def_id}' missing child definition '${id}' during reconciliation.`);
			}
			reconcileStateTree(childInst, oldChildDef, newChildDef);

			const hasChildStates = !!newChildDef.states && Object.keys(newChildDef.states).length > 0;
			if (hasChildStates) {
				if (!childInst.states || !childInst.states[childInst.currentid]) {
					childInst.currentid = safeStartStateId(newChildDef);
				}
			} else {
				childInst.states = undefined;
			}
		}
	}
}

/** Merge runtime data with new defaults, respecting old defaults to detect user-changed values. */
function migrateDataTree(node: State<Stateful>, oldDef: StateDefinition, newDef: StateDefinition) {
	const oldDefaults = oldDef ? oldDef.data ?? {} : {};
	const newDefaults = newDef.data ?? {};
	node.data = mergeDataWithDefaults(node.data, oldDefaults, newDefaults);
	// Recurse
	const states = node.states ?? {};
	for (const id in states) {
		const child = states[id];
		const oldChildStates = oldDef ? oldDef.states : undefined;
		const oldChildDef = oldChildStates ? oldChildStates[id] as StateDefinition : undefined;
		const newChildStates = newDef.states;
		const newChildDef = newChildStates ? newChildStates[id] as StateDefinition : undefined;
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
			out[key] = deep_clone(newDefVal);
			continue;
		}

		const liveWasOldDefault = deep_equal(liveVal, oldDefVal);
		const defaultChanged = !deep_equal(oldDefVal, newDefVal);

		if (liveWasOldDefault && defaultChanged) {
			out[key] = deep_clone(newDefVal);
		}
	}

	// Drop keys that no longer exist in defaults
	for (const key of Object.keys(out)) {
		if (!(key in newDefaults)) delete out[key];
	}

	return out;
}

function safeStartStateId(def: StateDefinition): Identifier {
	const states = def.states;
	if (def.initial && states && states[def.initial]) return def.initial;
	const first = states ? Object.keys(states)[0] : undefined;
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
	for (const machine_name in StateDefinitionBuilders) {
		buildFSMDefinition(machine_name, StateDefinitionBuilders[machine_name]());
	}
}

export function buildFSMDefinition(machine_name: Identifier, raw: Partial<StateDefinition>): void {
		const built = createMachine(machine_name, raw);
		// HOIST before validate so you can also validate handler existence if you switch to ID strings
		walkAndHoist(machine_name, built);

		validateStateMachine(built);
		clearDefinitionsForMachine(machine_name);
		registerDefinitionTree(built);

		addEventsToDef(built);
}

export function rebuildStateMachine(machineName: Identifier, blueprint: StateMachineBlueprint): StateDefinition {
	const built = createMachine(machineName, blueprint);
	walkAndHoist(machineName, built);
	validateStateMachine(built);
	clearDefinitionsForMachine(machineName);
	registerDefinitionTree(built);
	addEventsToDef(built);
	return built;
}

export function applyPreparedStateMachine(machineName: Identifier, blueprint: StateMachineBlueprint, options?: { force?: boolean }): { changed: boolean; previousDefinition?: StateDefinition } {
	const signature = computeBlueprintSignature(blueprint);
	const previousSignature = stateMachineBlueprintSignatures.get(machineName);
	const previousDefinition = StateDefinitions[machineName];
	if (!options?.force && previousSignature === signature) {
		return { changed: false, previousDefinition };
	}
	stateMachineBlueprintSignatures.set(machineName, signature);
	const clonedBlueprint = cloneBlueprint(blueprint) as StateMachineBlueprint;
	rebuildStateMachine(machineName, clonedBlueprint);
	const newDefinition = StateDefinitions[machineName];
	if (newDefinition) {
		hotReloadStateMachine(machineName, previousDefinition, newDefinition);
	}
	return { changed: true, previousDefinition };
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

function getEventEmitterFilter(definition: string | StateEventDefinition | undefined): Identifier | boolean | null {
	if (!definition || typeof definition === 'string') {
		return null;
	}
	return (definition as StateEventDefinition & { emitter?: Identifier | boolean | null }).emitter ?? null;
}

/**
 * Adds events to the machine definition.
 * If the machine has events defined, this function adds them to the event list of the machine definition.
 * @param machine - The StateMachineBlueprint object representing the machine definition.
 */
function addEventsToDef(machine: StateMachineBlueprint): void {
	machine.event_list = [];
	machine.on = rewriteOnBag(machine.on);
	const eventMap = getMachineEvents(machine);
	eventMap?.forEach(event_entry => {
		if (machine.event_list!.some(e => e.name === event_entry.name && e.emitter === event_entry.emitter)) {
			return;
		}
		machine.event_list!.push({ name: event_entry.name, emitter: event_entry.emitter });
	});
}

/**
 * Retrieves the events from a state machine blueprint.
 * The events are gathered from the machine definition and all of its submachines, returning a set of unique event names.
 * The set ensures we only subscribe once per event even if multiple states react to the same name.
 * The set itself allows the {@link StateMachineController} to wire every distinct event upfront.
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
	function add(name: string, emitter?: Identifier | boolean | null): void {
		addAndReplace(name, emitter);
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
	function addAndReplace(name: string, emitter?: Identifier | boolean | null): void {
		const key = `${name}:${emitter}`;
		if (addedEvents.has(key)) return;
		events.add({ name, emitter });
		addedEvents.set(key, true);
	}

	// Get the events from the machine definition
	const events = eventNamesAndScopes ?? new Set<listed_sdef_event>();
	const addedEvents = eventMap ?? new Map<string, boolean>();
	machine.on = rewriteOnBag(machine.on);
	// Start with the events defined in the machine definition
	if (machine.on) {
		for (const name in machine.on) {
			const emitter = getEventEmitterFilter(machine.on[name]);
			add(name, emitter);
		}
	}

	// Get the events from the submachines
	for (const stateId in machine.states) {
		// Get the state definition
		const state = machine.states[stateId];
		// Skip the state if it doesn't have a definition
		const state_def = state;
		if (!state_def) continue;
		if (state_def.on) {
			state_def.on = rewriteOnBag(state_def.on);
			for (const name in state_def.on) {
				const emitter = getEventEmitterFilter(state_def.on[name]);
				add(name, emitter);
			}
		}

		// If the state has a submachine, recursively subscribe to its events
		if (state_def.states) {
			getMachineEvents(state, events, addedEvents);
		}
	}

	return events;
}

function makeId(parts: string[]) { return parts.join('.'); }

function annotateHandler(fn: Function, id: string): void {
	try {
		Object.defineProperty(fn, '_handlerId', { value: id, configurable: true, writable: true });
	} catch {
		(fn as { _handlerId?: string })._handlerId = id;
	}
}

function resolveHandler(value: unknown, id: string): GenericHandler {
	if (typeof value === 'function') {
		const fn = value as GenericHandler;
		annotateHandler(fn, id);
		return fn;
	}
	if (typeof value === 'string') {
		const builtin = createBuiltinHandlerFromString(value);
		if (builtin) {
			annotateHandler(builtin, id);
			return builtin;
		}
		throw new Error(`[FSMLibrary] Handler '${id}' must be a function (received string '${value}').`);
	}
	throw new Error(`[FSMLibrary] Handler '${id}' must be a function.`);
}

function looksLikeStatePath(value: string): boolean {
	if (!value) return false;
	return value.startsWith('./') ||
		value.startsWith('../') ||
		value.startsWith('/') ||
		value.startsWith('root:/') ||
		value.startsWith('parent:/') ||
		value.includes('/');
}

function createBuiltinHandlerFromString(value: string): GenericHandler {
	if (!value || value.includes('.handlers.')) return undefined;
	if (!looksLikeStatePath(value)) return undefined;
	return function () { return value; };
}

function hoistSlot(owner: Record<string, any>, slot: string, id: string): void {
	const current = owner[slot];
	if (current === undefined || current === null) return;

	if (Array.isArray(current)) {
		const cloned: GenericHandler[] = current.map((handler, index) => resolveHandler(handler, `${id}[${index}]`));
		owner[slot] = cloned;
		return;
	}

	if (typeof current === 'function') {
		owner[slot] = resolveHandler(current, id);
		return;
	}

	if (typeof current === 'string') {
		owner[slot] = resolveHandler(current, id);
		return;
	}

	throw new Error(`[FSMLibrary] Handler '${id}' must be a function.`);
}

// @ts-ignore
type EventSlots = { [K in keyof StateEventDefinition]-?: StateEventDefinition[K] extends Function ? K : never }[keyof StateEventDefinition];
// @ts-ignore
type GuardSlots = { [K in keyof StateGuard]-?: StateGuard[K] extends Function ? K : never }[keyof StateGuard];
type StateDefHandlerValue = StateEventHandler | StateExitHandler;
// @ts-ignore
type StateSlots = { [K in keyof StateDefinition]-?: StateDefinition[K] extends StateDefHandlerValue ? K : never }[keyof StateDefinition];

// Removed unused proxy factory (thunks not used in current code path)

// Event definition handlers
function hoistEventDo(
	_machineName: string,
	_stateDef: StateDefinition,
	_path: string[],
	_bagName: string,
	_eventName: string,
	ownerDef: StateEventDefinition,
	id: string,
) {
	hoistSlot(ownerDef as Record<string, any>, 'do', id);
}

// Guard handlers
function hoistGuardCanEnter(
	_machineName: string,
	_stateDef: StateDefinition,
	_path: string[],
	guard: StateGuard,
	id: string,
) {
	hoistSlot(guard as Record<string, any>, 'can_enter', id);
}

function hoistGuardCanExit(
	_machineName: string,
	_stateDef: StateDefinition,
	_path: string[],
	guard: StateGuard,
	id: string,
) {
	hoistSlot(guard as Record<string, any>, 'can_exit', id);
}

// StateDefinition handlers
function hoistStateUpdate(_machineName: string, _path: string[], ownerDef: StateDefinition, id: string) {
	hoistSlot(ownerDef as Record<string, any>, 'update', id);
}

function hoistStateEntering(_machineName: string, _path: string[], ownerDef: StateDefinition, id: string) {
	hoistSlot(ownerDef as Record<string, any>, 'entering_state', id);
}

function hoistStateExiting(_machineName: string, _path: string[], ownerDef: StateDefinition, id: string) {
	hoistSlot(ownerDef as Record<string, any>, 'exiting_state', id);
}

function hoistStateProcessInput(_machineName: string, _path: string[], ownerDef: StateDefinition, id: string) {
	hoistSlot(ownerDef as Record<string, any>, 'process_input', id);
}

function rewriteOnBag(bag: StateMachineBlueprint['on']) {
	if (!bag) return bag;
	const out: NonNullable<StateMachineBlueprint['on']> = {};
	for (const [raw, def] of Object.entries(bag)) {
		if (typeof def === 'string') {
			out[raw] = { go: def };
			continue;
		}
		out[raw] = { ...def };
	}
	return out;
}

function hoistEventDef(
	machineName: string,
	stateDef: StateDefinition,
	statePath: string[],
	bagName: EventBagName,
	rawEventName: string,
	eventDefinition: StateEventDefinition
) {
	if (!eventDefinition || typeof eventDefinition === 'string') return;

	const base = [machineName, ...statePath, bagName, rawEventName];

	if (typeof eventDefinition.go !== 'undefined') {
		hoistEventDo(machineName, stateDef, statePath, bagName, rawEventName, eventDefinition, makeId([...base, 'do']));
	}
}

function walkAndHoist(
	machineName: string,
	sdef: StateDefinition,
	path: string[] = [],
) {
	// direct slots — aligned with StateDefinition handler properties
	if (typeof sdef.update !== 'undefined') hoistStateUpdate(machineName, path, sdef, makeId([machineName, ...path, 'update']));
	if (typeof sdef.entering_state !== 'undefined') hoistStateEntering(machineName, path, sdef, makeId([machineName, ...path, 'entering_state']));
	if (typeof sdef.exiting_state !== 'undefined') hoistStateExiting(machineName, path, sdef, makeId([machineName, ...path, 'exiting_state']));
	if (typeof sdef.process_input !== 'undefined') hoistStateProcessInput(machineName, path, sdef, makeId([machineName, ...path, 'process_input']));

	// on / input_event_handlers
	for (const bagName of ['on', 'input_event_handlers'] as EventBagName[]) {
		const bag = sdef[bagName];
		if (!bag) continue;
		for (const rawEventName of Object.keys(bag)) {
			const evDef = bag[rawEventName];
			switch (typeof evDef) {
				case 'object':
					hoistEventDef(machineName, sdef, path, bagName, rawEventName, evDef);
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
			if (typeof chk.go !== 'undefined') {
				hoistEventDo(machineName, sdef, path, `run_checks`, `${i}`, chk, makeId([...base, 'do']));
			}
		});
	}

	// guards
	const g = sdef.transition_guards;
	if (g && typeof g === 'object') {
		if (typeof g.can_enter !== 'undefined') {
			hoistGuardCanEnter(machineName, sdef, path, g, makeId([machineName, ...path, 'guards', 'can_enter']));
		}
		if (typeof g.can_exit !== 'undefined') {
			hoistGuardCanExit(machineName, sdef, path, g, makeId([machineName, ...path, 'guards', 'can_exit']));
		}
	}

	// recurse children
	if (sdef.states) {
		for (const [childId, child] of Object.entries(sdef.states) as [string, StateDefinition][]) {
			walkAndHoist(machineName, child, [...path, childId]);
		}
	}
}
