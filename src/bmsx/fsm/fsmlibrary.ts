import type { EventScope } from "../core/eventemitter";
import type { Identifier } from "../core/game";
import { StateDefinitionBuilders } from "./fsmdecorators";
import type { listed_sdef_event, StateEventDefinition, StateMachineBlueprint } from "./fsmtypes";
import { StateDefinition, validateStateMachine } from './statedefinition';

/**
 * Represents the machine definitions.
 */
export var StateDefinitions: Record<string, StateDefinition>;

/**
 * Builds the state machine definitions and sets them in the `MachineDefinitions` object.
 * Loops through all the `MachineDefinitionBuilders` and calls them to get the state machine definition.
 * If a definition is returned, it creates a new `sdef` object with the machine name and definition.
 * If the `sdef` object is created successfully, it sets the machine definition in the `MachineDefinitions` object.
 */
export function setupFSMlibrary(): void {
    StateDefinitions = {};
    for (let machine_name in StateDefinitionBuilders) {
        let machine_definition = StateDefinitionBuilders[machine_name]();
        if (machine_definition) {
            const machineBuilt = createMachine(machine_name, machine_definition);
            validateStateMachine(machineBuilt); // Check if the machine definition is valid before adding it to the library of machine definitions
            StateDefinitions[machine_name] = machineBuilt; // Add the machine definition to the library of machine definitions
            addEventsToDef(machineBuilt); // Add the events to the event list of the machine definition
        }
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
