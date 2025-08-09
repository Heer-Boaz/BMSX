import type { EventScope } from "../core/eventemitter";
import type { Identifier } from '../rompack/rompack';
import { getDeclaredFsmHandlers, StateDefinitionBuilders } from "./fsmdecorators";
import type { listed_sdef_event, StateEventDefinition, StateMachineBlueprint } from "./fsmtypes";
import { State } from './state';
import { StateDefinition, validateStateMachine } from './statedefinition';

/**
 * Represents the machine definitions.
 */
export var StateDefinitions: Record<string, StateDefinition>;
export var ActiveStateMachines: Map<string, State<any>[]> = new Map();

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
    const className = ctor.name || 'Anonymous';
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
                reg.register(id, fn as any);
            }
        }
    }
}

// ---------- Diff-based, tree-aware migration ----------
export function migrateMachineDiff(root: State<any>, oldRootDef: StateDefinition | undefined, newRootDef: StateDefinition) {
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
function reconcileStateTree(node: State<any>, oldDef: StateDefinition | undefined, newDef: StateDefinition) {
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
    for (const id of newChildren) {
        if (!node.states) node.states = {};
        if (!node.states[id]) {
            const child = new State(id, node.target_id, node.id, node.root_id);
            node.states[id] = child;
            // Build deeper children from definition
            reconcileStateTree(child, undefined, newDef.states![id] as StateDefinition);
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
function migrateDataTree(node: State<any>, oldDef: StateDefinition | undefined, newDef: StateDefinition) {
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

function clampTape(node: State<any>) {
    const tape = node.tape;
    if (!tape) {
        node.setHeadNoSideEffect(-1);
        node.setTicksNoSideEffect(0);
        return;
    }
    const maxHead = tape.length - 1;
    if (node.head > maxHead) {
        node.setHeadNoSideEffect(Math.max(-1, maxHead));
        node.setTicksNoSideEffect(0);
    }
}

function safeStartStateId(def: StateDefinition): Identifier {
    if (def.start_state_id && def.states?.[def.start_state_id]) return def.start_state_id;
    const first = def.states ? Object.keys(def.states)[0] : undefined;
    if (!first) throw new Error(`StateDefinition '${def.id}' has no states.`);
    return first;
}

// ------- small utils -------

function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a && b && typeof a === 'object') {
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        if (Array.isArray(a)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
            return true;
        }
        const ak = Object.keys(a), bk = Object.keys(b);
        if (ak.length !== bk.length) return false;
        for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
        return true;
    }
    return false;
}

function deepClone<T>(v: T): T {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(deepClone) as any;
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, deepClone(val)])) as T;
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

    for (const [key, bp] of Object.entries($.rom.fsm)) {
        const machineName = key; // je hebt zowel id als naam keys
        const def = createMachine(machineName as Identifier, bp);
        walkAndHoist(machineName, def, HandlerRegistry.instance, [], true);
        validateStateMachine(def);
        // Hot-swap: vervang als bestond, anders voeg toe
        const existed = !!StateDefinitions[machineName];
        StateDefinitions[machineName] = def;
        if (existed) {
            for (const st of ActiveStateMachines.get(machineName) ?? []) {
                // optioneel: migrate(st, def);
            }
        }
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

type HandlerArgs = [state: State<any>, ...args: any[]];
type AnyHandler = (this: any, ...args: HandlerArgs) => any;

function hoistHandler(
    ownerDef: any,
    slot: string,
    id: string,
    registry: HandlerRegistry,
    useProxyThunks: boolean
) {
    const fn = ownerDef[slot] as AnyHandler;
    if (typeof fn !== 'function') return;

    registry.register(id, fn);

    if (useProxyThunks) {
        const proxy: AnyHandler = function proxy(this: any, ...args: HandlerArgs) {
            const h = registry.get(id);
            if (!h) return;
            return h.apply(this, args); // args is a tuple: [State, ...]
        };
        Object.defineProperty(proxy, 'name', { value: `proxy_${id}`, configurable: true });
        (proxy as any)._handlerId = id;
        ownerDef[slot] = proxy as unknown; // satisfies the slot’s function type structurally
    } else {
        ownerDef[slot] = id;
    }
}

function normalizeEventNameForId(name: string) {
    return name.startsWith('$') ? name.slice(1) : name;
}

function hoistEventDef(
    machineName: string,
    statePath: string[],
    bagName: 'on' | 'on_input',
    rawEventName: string,
    def: any,
    registry: HandlerRegistry,
    useProxyThunks: boolean
) {
    if (!def || typeof def === 'string') return;

    const eventName = normalizeEventNameForId(rawEventName);
    const base = [machineName, ...statePath, bagName, eventName];

    if (typeof def.if === 'function') {
        hoistHandler(def, 'if', makeId([...base, 'if']), registry, useProxyThunks);
    }
    if (typeof def.do === 'function') {
        hoistHandler(def, 'do', makeId([...base, 'do']), registry, useProxyThunks);
    }
}

function walkAndHoist(
    machineName: string,
    sdef: StateDefinition,
    registry: HandlerRegistry,
    path: string[] = [],
    useProxyThunks = true
) {
    // direct slots
    for (const slot of ['enter', 'exit', 'run', 'next', 'end', 'process_input'] as const) {
        if (typeof (sdef as any)[slot] === 'function') {
            hoistHandler(sdef, slot, makeId([machineName, ...path, slot]), registry, useProxyThunks);
        }
    }

    // on / on_input
    for (const bagName of ['on', 'on_input'] as const) {
        const bag = (sdef as any)[bagName];
        if (!bag) continue;
        for (const rawEventName of Object.keys(bag)) {
            const evDef = bag[rawEventName];
            if (typeof evDef === 'object') {
                hoistEventDef(machineName, path, bagName, rawEventName, evDef, registry, useProxyThunks);
            }
        }
    }

    // run_checks
    const rc = (sdef as any).run_checks as any[] | undefined;
    if (Array.isArray(rc)) {
        rc.forEach((chk, i) => {
            if (!chk || typeof chk !== 'object') return;
            const base = [machineName, ...path, `run_checks[${i}]`];
            if (typeof chk.if === 'function') {
                hoistHandler(chk, 'if', makeId([...base, 'if']), registry, useProxyThunks);
            }
            if (typeof chk.do === 'function') {
                hoistHandler(chk, 'do', makeId([...base, 'do']), registry, useProxyThunks);
            }
        });
    }

    // guards
    const g = (sdef as any).guards;
    if (g && typeof g === 'object') {
        if (typeof g.canEnter === 'function') {
            hoistHandler(g, 'canEnter', makeId([machineName, ...path, 'guards', 'canEnter']), registry, useProxyThunks);
        }
        if (typeof g.canExit === 'function') {
            hoistHandler(g, 'canExit', makeId([machineName, ...path, 'guards', 'canExit']), registry, useProxyThunks);
        }
    }

    // recurse children
    if (sdef.states) {
        for (const [childId, child] of Object.entries(sdef.states) as [string, StateDefinition][]) {
            walkAndHoist(machineName, child, registry, [...path, childId], useProxyThunks);
        }
    }
}
