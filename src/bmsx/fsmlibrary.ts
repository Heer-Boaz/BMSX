import type { EventScope } from "./eventemitter";
import { StateDefinition, validateStateMachine } from "./fsm";
import { StateDefinitionBuilders } from "./fsmdecorators";
import type { StateMachineBlueprint, listed_sdef_event, StateEventDefinition } from "./fsmtypes";
import type { Identifier } from "./game";

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
        eventMap.forEach(event_entry => { // Add the events to the event list of the
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
function getMachineEvents(machine: StateMachineBlueprint, eventNamesAndScopes?: Set<listed_sdef_event>) {
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
     * Adds an event to the set if it doesn't already exist.
     * If the event is already in the set with the same scope, it won't be added again.
     * If the event is already in the set with a global scope, it won't be added again.
     * @param name - The name of the event.
     * @param scope - The scope of the event.
     */
    function addAndReplace(name: string, scope: string): void {
        if (events.has({ name: name, scope: 'all' })) return; // If the event is already in the set, and the scope is global, don't add it again
        if (events.has({ name: name, scope: scope })) return; // If the event is already in the set, and the scope is the same, don't add it again
        events.add({ name: name, scope: scope });
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
            getMachineEvents(state, events);
        }
    }

    return events;
}
