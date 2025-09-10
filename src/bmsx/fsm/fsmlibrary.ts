import type { EventScope } from "../core/eventemitter";
import { $ } from '../core/game';
import { deepClone, deepEqual } from '../utils/utils';
import type { Identifier } from '../rompack/rompack';
import { getDeclaredFsmHandlers, StateDefinitionBuilders } from "./fsmdecorators";
import type { EventBagName, listed_sdef_event, StateEventDefinition, StateEventHandler, StateExitHandler, Stateful, StateGuard, StateMachineBlueprint, StateNextHandler } from "./fsmtypes";
import { State } from './state';
import { StateDefinition, validateStateMachine } from './statedefinition';

/**
 * Represents the machine definitions.
 */
export var StateDefinitions: Record<string, StateDefinition>;
export var ActiveStateMachines: Map<string, State<Stateful>[]> = new Map();

export class HandlerRegistry {
    private static _instance: HandlerRegistry;
    private map = new Map<string, AnyHandler>();
    register(id: string, fn: AnyHandler) { this.map.set(id, fn); }
    get(id: string): AnyHandler | undefined { return this.map.get(id); }
    replaceBulk(entries: Record<string, AnyHandler>) { for (const k in entries) this.map.set(k, entries[k]); }
    static get instance(): HandlerRegistry {
        if (!this._instance) {
            this._instance = new HandlerRegistry();
        }
        return this._instance;
    }
}

// assign-fsm-augment.ts (unchanged logic, now gets keys from decorator)
export function registerHandlersForLinkedMachines(ctor: any, linkedMachines: Set<string>) {
    const reg = HandlerRegistry.instance;
    const className = ctor.name;
    const entries = getDeclaredFsmHandlers(ctor);
    if (!entries.length || !linkedMachines?.size) return;

    for (const { name: memberName, keys } of entries) {
        for (const machine of linkedMachines) {
            for (const key of keys) {
                const id = `${machine}.handlers.${className}.${key}`;
                const fn: AnyHandler = function (this: any, ...args) {
                    let impl = this[memberName] ?? Object.getPrototypeOf(this)?.[memberName];
                    if (typeof impl !== 'function') {
                        throw new Error(`Registered FSM handler "${id}" is not callable (member: ${memberName})`);
                    }
                    return impl.apply(this, args);
                };
                reg.register(id, fn);
            }
        }
    }
}

// ---------- Diff-based, tree-aware migration ----------
export function migrateMachineDiff(root: State<Stateful>, oldRootDef: StateDefinition | undefined, newRootDef: StateDefinition) {
    // Reconcile subtree shape (add/remove child State instances to match new defs)
    reconcileStateTree(root, oldRootDef, newRootDef);

    // Fix current state if invalid under new definition
    if (!root.substates || !root.substates[root.currentid]) {
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
    const newChildren = Object.keys(newDef.substates ?? {});
    const oldChildren = Object.keys(node.substates ?? {});

    // Remove stale children
    for (const id of oldChildren) {
        if (!newChildren.includes(id)) {
            node.substates[id]?.dispose?.();
            delete node.substates[id];
        }
    }

    // Add missing children
    for (const def_id of newChildren) {
        if (!node.substates) node.substates = {};
        if (!node.substates[def_id]) {
            const child = new State({ def_id, target_id: node.target_id, parent: node, root: node.root });
            node.substates[def_id] = child;
            // Build deeper children from definition
            reconcileStateTree(child, undefined, newDef.substates![def_id] as StateDefinition);
        }
    }

    // Recurse into common children
    for (const id of newChildren) {
        const childInst = node.substates?.[id];
        if (childInst) {
            const oldChildDef = oldDef?.substates?.[id] as StateDefinition | undefined;
            const newChildDef = newDef.substates![id] as StateDefinition;
            reconcileStateTree(childInst, oldChildDef, newChildDef);

            // Fix child's currentid if needed
            if (!childInst.substates || !childInst.substates[childInst.currentid]) {
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
    for (const id in node.substates ?? {}) {
        const child = node.substates[id];
        const oldChildDef = oldDef?.substates?.[id] as StateDefinition | undefined;
        const newChildDef = newDef.substates?.[id] as StateDefinition | undefined;
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
    if (def.start_state_id && def.substates?.[def.start_state_id]) return def.start_state_id;
    const first = def.substates ? Object.keys(def.substates)[0] : undefined;
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
 * If a state has substates, it creates a new machine definition for each substate.
 *
 * @param machine_name - The name of the machine.
 * @param machine_definition - The definition of the machine, including its states and substates.
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
    if (machine.event_handlers) {
        // Add all events from the machine definition
        for (const name in machine.event_handlers) {
            // Get the event definition
            const definition = machine.event_handlers[name];
            // Add the event to the list of events
            add(name, definition);
        }
        // Remove all '$' prefixes from the event names
        machine.event_handlers = Object.fromEntries(Object.entries(machine.event_handlers).map(([name, value]) => [removeScopeFromEventName(name), value]));
    }

    // Get the events from the submachines
    for (const stateId in machine.substates) {
        // Get the state definition
        const state = machine.substates[stateId];
        // Skip the state if it doesn't have a definition
        const state_def = state;
        if (!state_def) continue;
        if (state_def.event_handlers) {
            // Add all events from the state definition
            for (const name in state_def.event_handlers) {
                // Get the event definition
                const definition = state_def.event_handlers[name];
                // Add the event to the list of events
                add(name, definition);
            }
            // Remove all '$' prefixes from the event names
            state_def.event_handlers = Object.fromEntries(Object.entries(state_def.event_handlers).map(([name, value]) => [removeScopeFromEventName(name), value]));
        }

        // If the state has a submachine, recursively subscribe to its events
        if (state_def.substates) {
            getMachineEvents(state, events, addedEvents);
        }
    }

    return events;
}

function makeId(parts: string[]) { return parts.join('.'); }

type AnyHandler = (this: any, ...args: any[]) => any;
function annotateHandler(fn: Function, id: string): void {
    try {
        Object.defineProperty(fn, '_handlerId', { value: id, configurable: true, writable: true });
    } catch {
        // Fallback if defineProperty fails (shouldn't on functions)
        (fn as { _handlerId?: string })._handlerId = id;
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
    const current = ownerDef.if;
    if (typeof current !== 'function') return;
    registry.register(id, current as AnyHandler);
    if (useProxyThunks) {
        const proxy: StateEventDefinition['if'] = function (this: any, state: any, ...args: any[]): boolean {
            const h = registry.get(id);
            if (!h) return false;
            const out = h.apply(this, [state, ...args]);
            return !!out;
        };
        annotateHandler(proxy as Function, id);
        ownerDef.if = proxy;
    } else {
        annotateHandler(current as Function, id);
        ownerDef.if = current;
    }
}

function hoistEventDo(ownerDef: StateEventDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
    const current = ownerDef.do;
    if (typeof current !== 'function') return;
    registry.register(id, current as AnyHandler);
    if (useProxyThunks) {
        const proxy: StateEventDefinition['do'] = function (this: any, state: any, ...args: any[]) {
            const h = registry.get(id);
            if (!h) return undefined;
            return h.apply(this, [state, ...args]);
        };
        annotateHandler(proxy as Function, id);
        ownerDef.do = proxy;
    } else {
        annotateHandler(current as Function, id);
        ownerDef.do = current;
    }
}

// Guard handlers
function hoistGuardCanEnter(ownerDef: StateGuard, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
    const current = ownerDef.can_enter;
    if (typeof current !== 'function') return;
    registry.register(id, current as AnyHandler);
    if (useProxyThunks) {
        const proxy: StateGuard['can_enter'] = function (this: any, state: any): boolean {
            const h = registry.get(id);
            if (!h) return false;
            return !!h.apply(this, [state]);
        };
        annotateHandler(proxy as Function, id);
        ownerDef.can_enter = proxy;
    } else {
        annotateHandler(current as Function, id);
        ownerDef.can_enter = current;
    }
}

function hoistGuardCanExit(ownerDef: StateGuard, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
    const current = ownerDef.can_exit;
    if (typeof current !== 'function') return;
    registry.register(id, current as AnyHandler);
    if (useProxyThunks) {
        const proxy: StateGuard['can_exit'] = function (this: any, state: any): boolean {
            const h = registry.get(id);
            if (!h) return false;
            return !!h.apply(this, [state]);
        };
        annotateHandler(proxy as Function, id);
        ownerDef.can_exit = proxy;
    } else {
        annotateHandler(current as Function, id);
        ownerDef.can_exit = current;
    }
}

// StateDefinition handlers
function hoistStateTick(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
    const current = ownerDef.tick;
    if (typeof current !== 'function') return;
    registry.register(id, current as AnyHandler);
    if (useProxyThunks) {
        const proxy: StateDefinition['tick'] = function (this: any, state: any, ...args: any[]) {
            const h = registry.get(id);
            if (!h) return undefined;
            return h.apply(this, [state, ...args]);
        };
        annotateHandler(proxy as Function, id);
        ownerDef.tick = proxy;
    } else {
        annotateHandler(current as Function, id);
        ownerDef.tick = current;
    }
}

function hoistStateTapeEnd(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
    const current = ownerDef.tape_end;
    if (typeof current !== 'function') return;
    registry.register(id, current as AnyHandler);
    if (useProxyThunks) {
        const proxy: StateDefinition['tape_end'] = function (this: any, state: any, ...args: any[]) {
            const h = registry.get(id);
            if (!h) return undefined;
            return h.apply(this, [state, ...args]);
        };
        annotateHandler(proxy as Function, id);
        ownerDef.tape_end = proxy;
    } else {
        annotateHandler(current as Function, id);
        ownerDef.tape_end = current;
    }
}

function hoistStateTapeNext(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
    const current = ownerDef.tape_next;
    if (typeof current !== 'function') return;
    registry.register(id, current as AnyHandler);
    if (useProxyThunks) {
        const proxy: StateDefinition['tape_next'] = function (this: any, state: any, tape_rewound: boolean, ...args: any[]) {
            const h = registry.get(id);
            if (!h) return undefined;
            return h.apply(this, [state, tape_rewound, ...args]);
        };
        annotateHandler(proxy as Function, id);
        ownerDef.tape_next = proxy;
    } else {
        annotateHandler(current as Function, id);
        ownerDef.tape_next = current;
    }
}

function hoistStateEntering(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
    const current = ownerDef.entering_state;
    if (typeof current !== 'function') return;
    registry.register(id, current as AnyHandler);
    if (useProxyThunks) {
        const proxy: StateDefinition['entering_state'] = function (this: any, state: any, ...args: any[]) {
            const h = registry.get(id);
            if (!h) return undefined;
            return h.apply(this, [state, ...args]);
        };
        annotateHandler(proxy as Function, id);
        ownerDef.entering_state = proxy;
    } else {
        annotateHandler(current as Function, id);
        ownerDef.entering_state = current;
    }
}

function hoistStateExiting(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
    const current = ownerDef.exiting_state;
    if (typeof current !== 'function') return;
    registry.register(id, current as AnyHandler);
    if (useProxyThunks) {
        const proxy: StateDefinition['exiting_state'] = function (this: any, state: any, ...args: any[]) {
            const h = registry.get(id);
            if (!h) return undefined;
            return h.apply(this, [state, ...args]);
        };
        annotateHandler(proxy as Function, id);
        ownerDef.exiting_state = proxy;
    } else {
        annotateHandler(current as Function, id);
        ownerDef.exiting_state = current;
    }
}

function hoistStateProcessInput(ownerDef: StateDefinition, id: string, registry: HandlerRegistry, useProxyThunks: boolean) {
    const current = ownerDef.process_input;
    if (typeof current !== 'function') return;
    registry.register(id, current as AnyHandler);
    if (useProxyThunks) {
        const proxy: StateDefinition['process_input'] = function (this: any, state: any, ...args: any[]) {
            const h = registry.get(id);
            if (!h) return undefined;
            return h.apply(this, [state, ...args]);
        };
        annotateHandler(proxy as Function, id);
        ownerDef.process_input = proxy;
    } else {
        annotateHandler(current as Function, id);
        ownerDef.process_input = current;
    }
}

function normalizeEventNameForId(name: string) {
    return name.startsWith('$') ? name.slice(1) : name;
}

function hoistEventDef(
    machineName: string,
    statePath: string[],
    bagName: keyof Pick<StateDefinition, 'event_handlers' | 'input_event_handlers'>,
    rawEventName: string,
    eventDefinition: StateEventDefinition,
    registry: HandlerRegistry,
    useProxyThunks: boolean
) {
    if (!eventDefinition || typeof eventDefinition === 'string') return;

    const eventName = normalizeEventNameForId(rawEventName);
    const base = [machineName, ...statePath, bagName, eventName];

    if (typeof eventDefinition.if === 'function') {
        hoistEventIf(eventDefinition, makeId([...base, 'if']), registry, useProxyThunks);
    }
    if (typeof eventDefinition.do === 'function') {
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
    if (typeof sdef.tick === 'function') hoistStateTick(sdef, makeId([machineName, ...path, 'tick']), registry, useProxyThunks);
    if (typeof sdef.tape_end === 'function') hoistStateTapeEnd(sdef, makeId([machineName, ...path, 'tape_end']), registry, useProxyThunks);
    if (typeof sdef.tape_next === 'function') hoistStateTapeNext(sdef, makeId([machineName, ...path, 'tape_next']), registry, useProxyThunks);
    if (typeof sdef.entering_state === 'function') hoistStateEntering(sdef, makeId([machineName, ...path, 'entering_state']), registry, useProxyThunks);
    if (typeof sdef.exiting_state === 'function') hoistStateExiting(sdef, makeId([machineName, ...path, 'exiting_state']), registry, useProxyThunks);
    if (typeof sdef.process_input === 'function') hoistStateProcessInput(sdef, makeId([machineName, ...path, 'process_input']), registry, useProxyThunks);

    // event_handlers / input_event_handlers
    for (const bagName of ['event_handlers', 'input_event_handlers'] as EventBagName[]) {
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
            if (typeof chk.if === 'function') {
                hoistEventIf(chk, makeId([...base, 'if']), registry, useProxyThunks);
            }
            if (typeof chk.do === 'function') {
                hoistEventDo(chk, makeId([...base, 'do']), registry, useProxyThunks);
            }
        });
    }

    // guards
    const g = sdef.transition_guards;
    if (g && typeof g === 'object') {
        if (typeof g.can_enter === 'function') {
            hoistGuardCanEnter(g, makeId([machineName, ...path, 'guards', 'can_enter']), registry, useProxyThunks);
        }
        if (typeof g.can_exit === 'function') {
            hoistGuardCanExit(g, makeId([machineName, ...path, 'guards', 'can_exit']), registry, useProxyThunks);
        }
    }

    // recurse children
    if (sdef.substates) {
        for (const [childId, child] of Object.entries(sdef.substates) as [string, StateDefinition][]) {
            walkAndHoist(machineName, child, registry, [...path, childId], useProxyThunks);
        }
    }
}
