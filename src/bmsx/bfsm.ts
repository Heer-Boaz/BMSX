import { exclude_save, insavegame, onload } from './gameserializer';
import { IIdentifiable, IRegisterable, Identifier } from './game';
import { BaseModel } from './basemodel';
import { EventScope, IEventSubscriber } from './eventemitter';
import { Input } from './input';

/**
 * Represents a type definition for mapping IDs to `sdef` objects.
 */
export type id2sdef = Record<Identifier, StateDefinition>;

/**
 * Represents a mapping of IDs to state contexts.
 */
export type id2mstate = Record<Identifier, State>;

/**
 * Represents a mapping of IDs to sstates.
 */
export type id2sstate = Record<Identifier, State>;

/**
 * The states defined for this state machine (key = state id, value = partial state definition), their substate machines and their additional properties are defined in {@link StateDefinition}.
 * @example
 * {
 *		parellel: true,
 *		data: { ... },
 *		on: { ... }, // Note: defines the state transitions at the *current* level (thus, not for submachines)
 *		// (Note: the state id is the key of the state in the states object)
 *		_idle: { // The state definition for the idle state which is the start state of this machine, given the prefix '_' (or '#')
 *			auto_tick: false, // `true` by default
 *			on: { ... }, // Note: defines the state transitions at the *current* level (thus, not for submachines)
 *			enter(this: TargetClass, state: sstate): { state.reset(); ... },
 *			run(this: TargetClass, state: sstate): { ++state.ticks; },
 *			next(this: TargetClass, state: sstate): { let bla = state.current_tape_value; ... },
 *		},
 *		running: { ... },
 * }
 */
export type StateMachineBlueprint = Partial<StateDefinition>;

/**
 * A type representing a mapping of state IDs to partial state definitions.
 */
export type id2partial_sdef = Record<Identifier, StateMachineBlueprint>;

// export type StateIdentifierStart = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';
// export type StatePathPart = `${StateIdentifierStart}${Identifier}`;
// export type StatePathSpecial = '#this' | '#parent' | '#root';
// export type StatePath = `${StatePathSpecial}.${StatePathPart}` | `${StatePathPart}`;

/**
 * Represents a state event handler.
 * @template T - The type of the stateful object.
 * @param state - The state object.
 * @param args - Additional arguments for the event handler.
 * @returns A string denoting the next state to transition to (or undefined if no transition should occur).
 */
export interface IStateEventHandler<T extends IStateful = any> { (state: State<T>, ...args: any[]): StateTransition | Identifier | void; }
export interface IStateExitHandler<T extends IStateful = any> { (state: State<T>, ...args: any[]): void; }
export interface IStateNextHandler<T extends IStateful = any> extends IStateEventHandler { (state: State<T>, tape_rewound: boolean, ...args: any[]): StateTransition | Identifier | void; }
export interface IStateEventCondition<T extends IStateful & IEventSubscriber = any> {
	(state: State<T>, ...args: any[]): boolean;
}

type listed_sdef_event = { name: string, scope: EventScope };

/**
 * Represents a state transition.
 */
export type StateTransition = {
	/**
	 * The next state to transition to.
	 */
	state_id: Identifier;

	/**
	 * The arguments for the state transition.
	 */
	args?: any;

	/**
	 * The transition type: 'to' or 'switch', where 'to' is the default.
	 */
	transition_type?: TransitionType;

	/**
	 * If set to `true`, the state will transition to the same state, even if the state is already the current state.
	 */
	force_transition_to_same_state?: boolean;
};

/**
 * Represents a state transition with a type (either 'to' or 'switch').
 */
type StateTransitionWithType = StateTransition & { transition_type: TransitionType };

/**
 * Represents the definition of a state event in a state machine.
 * @template T - The type of the stateful object that the event is associated with.
 */
export type StateEventDefinition<T extends IStateful & IEventSubscriber = any> = {
	/**
	 * The state ID to transition to. If not provided, the state will not transition. This is useful for defining a "transition" that only executes an action.
	 */
	to?: StateTransition | Identifier,

	/**
	 * The state ID to transition to.(as switch-type)  If not provided, the state will not transition. This is useful for defining a "transition" that only executes an action.
	 */
	switch?: StateTransition | Identifier,

	/**
	 * The condition that must be met for the transition to occur.
	 */
	if?: IStateEventCondition<T>,

	/**
	 * The action that is executed when the transition occurs.
	 */
	do?: IStateEventHandler<T>,

	/**
	 * (Optional) The ID of the emitter scope. If provided, the listener will be added to the emitter scope listeners, otherwise it will be added to the global scope listeners.
	 */
	scope?: EventScope,
};

/**
 * Represents a state guard that defines conditions for entering or exiting a state.
 * @template T - The type of the stateful object that implements `IStateful` and `IEventSubscriber`.
 */
interface IStateGuard<T extends IStateful & IEventSubscriber = any> {
	/**
	 * Checks if the state can be entered.
	 * @this {T} - The stateful object.
	 * @returns {boolean} - Returns `true` if the state can be entered, otherwise `false`.
	 */
	canEnter?: (this: T, state: State) => boolean;

	/**
	 * Checks if the state can be exited.
	 * @this {T} - The stateful object.
	 * @returns {boolean} - Returns `true` if the state can be exited, otherwise `false`.
	 */
	canExit?: (this: T, state: State) => boolean;
}

/**
 * Represents the definition of a tick check for a stateful object.
 * It defines conditions that are checked on each tick to determine if the state should transition to another state or another action should be executed.
 *
 * @template T - The type of the stateful object.
 */
type TickCheckDefinition<T extends IStateful = any> = Omit<StateEventDefinition<T>, 'scope'>;

/**
 * Represents the type of a state transition (either 'to' or 'switch').
 * - 'to': The default transition type, which transitions the whole state machine tree to the new state.
 * - 'switch': A transition type that switches only the lowest level state to the new state.
 */
type TransitionType = 'to' | 'switch';

/**
 * Represents a tape used in the BFSM.
 */
export type Tape = any[];

/**
 * Maximum history size for the state transition stack.
 */
const BST_MAX_HISTORY = 10;

/**
 * The default BST ID.
 */
export const DEFAULT_BST_ID = 'master';

/**
 * Represents an object that is stateful and can be registered, and subscribes to events.
 * It also has a player index, that is used to identify the player that the stateful object belongs to, which is used to determine which player's input to process.
 */
export interface IStateful extends IRegisterable, IEventSubscriber {
	/**
	 * The StatemachineController of the object.
	 */
	sc: StateMachineController;

	/**
	 * The player index of the stateful object.
	 * If the player index is not set, it defaults to 1 (the first/main player).
	 */
	player_index?: number;
}

/**
 * Represents the name of a Finite State Machine (FSM).
 */
export type FSMName = string;

/**
 * Represents a constructor function with an optional property for linked FSMs.
 */
export type ConstructorWithFSMProperty = Function & {
	/**
	 * A set of FSM names that are linked to this constructor.
	 */
	linkedFSMs?: Set<FSMName>;
};

/**
 * Represents the machine definitions.
 */
export var StateDefinitions: Record<string, StateDefinition>;

/**
 * A record that maps string keys to functions that build machine states.
 */
var StateDefinitionBuilders: Record<string, () => StateMachineBlueprint>;

/**
 * Decorator function that assigns FSMs to a class constructor.
 * @param fsms The FSMs to assign.
 * @returns A decorator function.
 */
export function assign_fsm(...fsms: FSMName[]) {
	return function (constructor: ConstructorWithFSMProperty) {
		if (!constructor.hasOwnProperty('linkedFSMs')) {
			constructor.linkedFSMs = new Set<FSMName>();
		}
		fsms.forEach(fsm => constructor.linkedFSMs.add(fsm));
		updateAssignedFSMs(constructor);
	};
}

/**
 * Updates all assigned FSMs for the given constructor.
 *
 * @param constructor - The constructor function.
 */
function updateAssignedFSMs(constructor: any) {
	const linkedFSMs = new Set<FSMName>();
	let currentClass: any = constructor;

	while (currentClass && currentClass !== Object) {
		if (currentClass.linkedFSMs) {
			currentClass.linkedFSMs.forEach((fsm: FSMName) => linkedFSMs.add(fsm));
		}
		currentClass = Object.getPrototypeOf(currentClass);
	}

	constructor.linkedFSMs = linkedFSMs;
}

/**
 * Returns a function that can be used as a decorator to build a finite state machine definition.
 * @param fsm_name - Optional name of the finite state machine. If not provided, the name of the decorated class will be used.
 * @returns A decorator function that can be used to build a finite state machine definition.
 */
export function build_fsm(fsm_name?: Identifier) {
	return function statedef_builder(target: any, _name: any, descriptor: PropertyDescriptor): any {
		StateDefinitionBuilders ??= {};
		StateDefinitionBuilders[fsm_name ?? target.name] = descriptor.value;
	};
}

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

/**
 * Validates the state machine definition.
 *
 * @param machinedef - The state machine definition to validate.
 * @throws Error if the state machine definition is invalid.
 */
function validateStateMachine(machinedef: StateDefinition): void {
	if (!machinedef.states) return; // A class might choose not to create a new machine_definition

	// Get all state names
	const stateNames = Object.keys(machinedef.states);

	// Check the defined event state transitions for each state in the machine definition to see if they are valid
	for (const state of stateNames) {
		const transitions = machinedef.states[state].on; // Get the transitions for the state if they exist

		// If there are transitions, check each target state
		if (transitions) {
			for (const targetState of Object.values(transitions)) { // Get the target state for each transition
				if (typeof targetState === 'string') { // If the target state is a string, check if it exists
					let targetStateParts = targetState.split('.');
					let currentContext = machinedef.states;

					for (const part of targetStateParts) {
						switch (part) {
							case '#this': // If the part is '#this', move to the current subcontext
								if (!currentContext.states) { // Check if the current context has states
									throw new Error(`Invalid event transition target '${targetState}' in state '${state}' of machine '${machinedef.id}': the current context doesn't have substates.`);
								}
								continue; // Skip '#this' parts
							case '#parent': // If the part is '#parent', move to the parent context
								if (!currentContext.parent) { // Check if the parent context exists
									throw new Error(`Invalid event transition target '${targetState}' in state '${state}' of machine '${machinedef.id}': the parent context doesn't exist.`);
								}
								if (!currentContext.parent.states) { // Check if the parent context has states
									throw new Error(`Invalid event transition target '${targetState}' in state '${state}' of machine '${machinedef.id}': the parent context doesn't have substates.`);
								}
								currentContext = currentContext.parent.states;
								continue; // Skip '#parent' parts
							case '#root': // If the part is '#root', move to the root context
								if (!currentContext.root) { // Check if the root context exists
									throw new Error(`Invalid event transition target '${targetState}' in state '${state}' of machine '${machinedef.id}': the root context doesn't exist. This might be because the root context is not defined in the machine definition.`);
								}
								currentContext = currentContext.root.states;
								continue; // Skip '#root' parts
							default:
								if (!currentContext[part]) { // Check if the part exists in the current context
									throw new Error(`Invalid event transition target '${targetState}' in state '${state}' of machine '${machinedef.id}'.`);
								}

								currentContext = currentContext[part].states; // Move to the next context
								break;
						}
					}
				}
			}
		}
	}

	// Check the defined event state transitions for each state in the machine definition to see if they are valid
	for (const state of stateNames) {
		const transitions = machinedef.states[state].on; // Get the transitions for the state if they exist

		// If there are transitions, check each target state
		if (transitions) {
			for (const targetState of Object.values(transitions)) { // Get the target state for each transition
				if (typeof targetState === 'string') { // If the target state is a string, check if it exists
					if (!stateNames.includes(targetState)) { // Check if the target state exists
						throw new Error(`Invalid event transition target '${targetState}' in state '${state}' of machine '${machinedef.id}'.`);
					}
				}
			}
		}
	}

	// Check if the start state is defined
	if (!machinedef.start_state_id) {
		throw new Error(`No start state defined for state machine '${machinedef.id}'`);
	}

	// Check if the start state exists
	if (machinedef.start_state_id && !stateNames.includes(machinedef.start_state_id)) {
		throw new Error(`Invalid start state '${machinedef.start_state_id}', as that state doesn't exist in the machine '${machinedef.id}'.`);
	}
}

@insavegame
/**
 * Represents a state machine controller that manages multiple state machines.
 */
export class StateMachineController {
	/**
	 * The substate object that holds the state context for each substate.
	 */
	statemachines: Record<Identifier, State>;

	/**
	 * Gets the state machines.
	 * @returns An object representing the state machines, where the keys are the machine IDs and the values are the corresponding states.
	 * @throws {Error} If no machine with the specified ID is found.
	 */
	public get machines(): Record<Identifier, State> {
		return new Proxy(this.statemachines, {
			get: (target, prop: string) => {
				if (target[prop]) {
					return target[prop];
				}
				throw new Error(`No machine with ID '${prop}'`);
			}
		});
	}

	/**
	 * The identifier of the current machine.
	 */
	current_machine_id: Identifier;

	/**
	 * Gets the current state machine.
	 * @returns The current state machine.
	 */
	get current_machine(): State { return this.statemachines[this.current_machine_id]; }

	/**
	 * Gets the current state of the current state machine.
	 * @returns The current state of the current state machine.
	 */
	get current_state(): State { return this.current_machine.current; }

	/**
	 * Gets the states of the current machine.
	 * @returns The states of the current machine.
	 */
	get states(): id2sstate { return this.current_machine.states; }

	/**
	 * Gets the state definition of the current machine.
	 */
	get definition(): StateDefinition { return this.current_machine.definition; }

	constructor() {
		this.statemachines = {};
	}

	/**
	 * Disposes the BFStateMachine and deregisters all machines.
	 */
	public dispose(): void {
		// Deregister all machines
		for (let id in this.statemachines) {
			this.statemachines[id].dispose();
		}
	}

	/**
	 * Starts the state machine by initializing and starting all state machines.
	 */
	start(): void {
		this.initLoadSetup();

		// Start all state machines
		for (const id in this.statemachines) {
			this.statemachines[id].start(); // Start the state machine with the given id (i.e., set the start state as the current state) and run the start state (i.e., run the start state's 'onenter' function)
		}
	}

	@onload
	/**
	 * Initializes all statemachines by subscribing to events defined in the machine definition and allowing dispatching events to the appropriate machines.
	 */
	initLoadSetup(): void {
		for (const id in this.statemachines) {
			const machine = this.statemachines[id];

			// Subscribe to all events that are defined in the machine definition for the machine and its submachines
			const events = machine.definition?.event_list;
			if (events && events.length > 0) {
				events.forEach(event => {
					let scope = event.scope;
					switch (scope) {
						case 'self':
							scope = machine.target; // If the scope is 'self', subscribe to the event with the given name and scope and dispatch it to the machine with the given id and scope, using the `target`-object as the event filter (i.e., only dispatch the event if the emitter is the target object)
							break;
						case 'all':
						default:
							scope = undefined; // If the scope is 'all' or undefined, subscribe to the event with the given name and scope and dispatch it to the machine with the given id and global scope, meaning that the event will be dispatched to all machines
							break;
					}
					// Subscribe to the event with the given name and scope and dispatch it to the machine with the given id and scope (or global scope if no scope is provided)
					$.event_emitter.on(event.name, this.auto_dispatch, machine.target, scope);
				});
			}
		}
	}

	/**
	 * Runs the current state of the current state machine.
	 * Also runs all state machines that have 'parallel' set to true.
	 */
	run(): void {
		// Runs the current state of the current state machine
		this.current_machine.run();

		// Run all state machines that have 'parallel' set to true
		for (let id in this.statemachines) {
			// Skip the current machine, as it has already been run
			if (id === this.current_machine_id) continue;
			if (this.statemachines[id].parallel) this.statemachines[id].run();
		}
	}

	/**
	 * Switches both statemachine and state, based on the newstate which is a combination of statemachine and state, written as 'statemachine.state.substate...'.
	 * If no stateid is specified, assume that the stateid is the same as the machineid.
	 * If no machineid is specified, assume that the machineid is the same as the current machine.
	 * If the machine is not running in parallel, set it as the current machine. Otherwise, only switch the state in the specified machine, without changing the current machine.
	 * Throws an error if no machine with the specified ID exists.
	 * @param newstate The new state to switch to, in the format 'statemachine.state.substate'.
	 * @param args Optional arguments to pass to the new state.
	 */
	to(newstate: Identifier, ...args: any[]): void {
		const dotIndex = newstate.indexOf('.');
		let machineid = dotIndex !== -1 ? newstate.slice(0, dotIndex) : newstate;
		let stateids = dotIndex !== -1 ? newstate.slice(dotIndex + 1) : undefined;

		// Allow for switching to a state in the same machine without having to specify the machineid
		if (!stateids) {
			stateids = machineid; // If no stateid is specified, assume that the stateid is the same as the machineid
			machineid = this.current_machine_id; // If no machineid is specified, assume that the machineid is the same as the current machine
		}

		const machine = this.statemachines[machineid];
		if (!machine) throw new Error(`No machine with ID '${machineid}'`);
		if (!machine.parallel) { // If the machine is not running in parallel, set it as the current machine
			this.current_machine_id = machineid;
		}
		machine.to_path(stateids, ...args);
	}

	/**
	 * Switches the state in the specified state machine.
	 * If no state ID is specified, it assumes that the state ID is the same as the machine ID.
	 * Throws an error if no machine with the specified ID is found.
	 *
	 * @param path - The path to the state machine and state ID, separated by a dot (e.g., 'machineID.stateID').
	 * @param args - Additional arguments to pass to the state switch function.
	 */
	switch(path: string, ...args: any[]): void {
		let parts: string[];
		if (typeof path === 'string') {
			parts = path.split('.');
		} else {
			parts = path;
		}
		const [machineid, ...stateids] = parts;

		const machine = this.statemachines[machineid];
		if (!machine) throw new Error(`No machine with ID '${machineid}'`);

		// If no stateid is specified, assume that the stateid is the same as the machineid
		const stateid = stateids.length > 0 ? stateids : machineid;

		// Only switch the state in the specified machine, without changing the current machine
		machine.switch_path(stateid, ...args);
	}

	/**
	 * Dispatches an event to the current state machine and other parallel running state machines.
	 *
	 * @param event_name - The name of the event to be dispatched.
	 * @param emitter - The identifier or identifiable object that triggered the event.
	 * @param args - Additional arguments to be passed to the event handlers.
	 */
	public do(event_name: string, emitter: Identifier | IIdentifiable, ...args: any[]): void {
		const emitter_id = typeof emitter === 'string' ? emitter : emitter.id;

		// Dispatch the event to the current machine
		this.current_machine.dispatch(event_name, emitter_id, ...args);

		for (const id in this.statemachines) {
			if (this.current_machine_id === id) continue; // Skip the current machine, as the event has already been dispatched to that machine
			if (this.statemachines[id].paused) continue; // Skip paused machines
			if (!this.statemachines[id].parallel) continue; // Skip machines that are not running in parallel
			this.statemachines[id].dispatch(event_name, emitter_id, ...args);
		}
	}

	/**
	 * Dispatches an event to the state machine.
	 *
	 * @param event_name - The name of the event to dispatch.
	 * @param emitter - The identifier or identifiable object that emitted the event.
	 * @param args - Additional arguments to pass to the event handler.
	 */
	private auto_dispatch(this: IStateful, event_name: string, emitter: Identifier | IIdentifiable, ...args: any[]): void {
		this.sc.do(event_name, emitter, ...args);
	}

	/**
	 * Adds a state machine to the Bfsm instance.
	 *
	 * @param id - The ID of the state machine.
	 * @param target_id - The ID of the target machine.
	 * @param parent_id - The ID of the target object.
	 */
	add_statemachine(id: Identifier, target_id: Identifier): void {
		this.statemachines[id] = State.create(id, target_id, target_id, null);
		// If this is the first id that was added, set it as the current machine
		if (!this.current_machine_id) this.current_machine_id = id;
	}

	/**
	 * Gets the state machine with the given ID.
	 * @param id - The ID of the state machine.
	 * @returns The state machine with the given ID.
	 */
	get_statemachine(id: Identifier): State {
		return this.statemachines[id];
	}

	/**
	 * Checks if the specified ID matches the current state of the state machine.
	 * @param id - The ID to check.
	 * @returns `true` if the ID matches the current state, `false` otherwise.
	 * @throws Error if the machine with the specified ID does not exist.
	 */
	is(id: string): boolean {
		// const [_targetid, machineid, ...stateids] = id.split(/[:.]/);
		const [machineid, ...stateids] = id.split('.');

		// If there are no more parts, check the state of the current machine
		if (stateids.length === 0) {
			return this.current_machine.is(machineid);
		}

		const machine = this.statemachines[machineid];
		if (!machine) {
			throw new Error(`No machine with ID '${machineid}'`);
		}

		// If there are more parts, check the state of the submachine with the given path
		return machine.is(stateids);
	}

	/**
	 * Runs the state machine with the given ID.
	 * @param id - The ID of the state machine.
	 */
	run_statemachine(id: Identifier): void {
		this.statemachines[id].run();
	}

	/**
	 * Runs all state machines.
	 */
	run_all_statemachines(): void {
		for (const id in this.statemachines) {
			this.run_statemachine(id);
		}
	}

	/**
	 * Resets the state machine with the given ID.
	 * @param id - The ID of the state machine.
	 */
	reset_statemachine(id: Identifier): void {
		this.statemachines[id].reset();
	}

	/**
	 * Resets all state machines.
	 */
	reset_all_statemachines(): void {
		for (const id in this.statemachines) {
			this.reset_statemachine(id);
		}
	}

	/**
	 * Goes back to the previous state of the current state machine
	 */
	pop(): void {
		this.current_machine.pop();
	}

	/**
	 * Goes back to the previous state of the state machine with the given ID.
	 * @param id - The ID of the state machine.
	 */
	pop_statemachine(id: Identifier): void {
		this.statemachines[id].pop();
	}

	/**
	 * Goes back to the previous state of all state machines.
	 */
	pop_all_statemachines(): void {
		for (const id in this.statemachines) {
			this.pop_statemachine(id);
		}
	}

	/**
	 * Sets the state of the state machine with the given ID to the state with the given ID.
	 * @param id - The ID of the state machine.
	 * @param path - The ID of the state.
	 */
	switch_state(id: Identifier, path: Identifier): void {
		this.statemachines[id].to(path);
	}

	/**
	 * Pauses the specified state machine.
	 * @param id - The identifier of the state machine to pause.
	 */
	pause_statemachine(id: Identifier): void {
		this.statemachines[id].paused = true;
	}

	/**
	 * Resumes the execution of a paused state machine.
	 *
	 * @param id - The identifier of the state machine to resume.
	 */
	resume_statemachine(id: Identifier): void {
		this.statemachines[id].paused = false;
	}

	/**
	 * Pauses all the state machines.
	 */
	pause_all_statemachines(): void {
		for (const id in this.statemachines) {
			this.pause_statemachine(id);
		}
	}

	/**
	 * Pauses all state machines except for the specified one.
	 *
	 * @param to_exclude_id - The identifier of the state machine to exclude from pausing.
	 */
	pause_all_except(to_exclude_id: Identifier): void {
		for (const id in this.statemachines) {
			if (id === to_exclude_id) continue;
			this.pause_statemachine(id);
		}
	}

	/**
	 * Resumes all the statemachines that have been paused.
	 */
	resume_all_statemachines(): void {
		for (const id in this.statemachines) {
			this.resume_statemachine(id);
		}
	}
}

const TAPE_START_INDEX = -1; // The index of the tape that is *before* the start of the tape, so that the first index of the tape is considered when the `next`-event is triggered

@insavegame
/**
 * Represents a state in a state machine.
 * @template T - The type of the game object or model associated with the state.
 */
export class State<T extends IStateful & IEventSubscriber & IRegisterable = any> implements IIdentifiable {
	/**
	 * The identifier of this specific instance of the state machine.
	* @see {@link make_id}
	 */
	id: Identifier;

	/**
	 * The identifier of this specific instance of the state machine's parent.
	 * @see {@link make_id}
	 */
	parent_id: Identifier;

	/**
	 * The parent state of the state (machine).
	 */
	public get parent() { return $.registry.get(this.parent_id); }

	/**
	 * The identifier of this specific instance of the state machine's root machine.
	 * @see {@link make_id}
	 */
	root_id: Identifier;

	/**
	 * The root state of the state (machine).
	 */
	public get root() { return $.registry.get(this.root_id); }

	/**
	 * The unique identifier for the bfsm.
	 */
	def_id: Identifier;

	/**
	 * Represents the states of the Bfsm.
	 */
	states: id2sstate;

	/**
	 * Indicates whether the state machine is running in parallel with the 'current' state machine as defined in {@link StateMachineController.current_machine}.
	 */
	get parallel(): boolean { return this.definition?.parallel; }

	/**
	 * Identifier of the current state.
	 */
	currentid!: Identifier; // Identifier of current state

	/**
	 * History of previous states.
	 */
	history!: Array<Identifier>; // History of previous state (as ids)

	/**
	 * Indicates whether the execution is paused.
	 */
	paused: boolean; // Iff paused, skip 'onrun'

	/**
	 * This state machine reflects the (partial) state of the game object with the given id
	 * @see {@link BaseModel.getGameObject}
	 */
	target_id: Identifier;

	/**
	 * Represents the state data for the state machine that is shared across its states.
	 */
	public data: { [key: string]: any } = {};

	/**
	 * Returns the game object or model that this state machine is associated with.
	 */
	public get target(): T { return $.registry.get<T>(this.target_id); }

	/**
	 * Returns the current state of the FSM
	 */
	public get current(): State { return this.states?.[this.currentid]; }

	/**
	 * Gets the state with the given id from the state machine.
	 * Used for referencing states from within the state instance, instead
	 * of referencing states from the state machine definition.
	 * @param id - id of the state, according to its definition
	 */
	public get_sstate(id: Identifier) { return this.states?.[id]; }

	/**
	 * Gets the definition of the current state machine.
	 * @returns The definition of the current state machine.
	 */
	public get definition(): StateDefinition { return this.parent ? this.parent.definition.states[this.def_id] : StateDefinitions[this.def_id]; }

	/**
	 * Gets the id of the start state of the FSM.
	 * @returns The id of the start state of the FSM.
	 */
	public get start_state_id(): Identifier { return this.definition?.start_state_id; }

	/**
	 * Represents the counter for the critical section.
	 */
	private critical_section_counter: number;

	/**
	 * Represents the transition queue of the state machine.
	 * @property {Array<{ state_id: Identifier, args: any[] }>} transition_queue - The array of transition objects.
	 */
	private transition_queue: StateTransitionWithType[];

	/**
	 * Enters the critical section.
	 * Increments the critical section counter.
	 */
	private enterCriticalSection(): void {
		++this.critical_section_counter;
	}

	/**
	 * Decreases the critical section counter by 1 and processes the transition queue if the counter reaches 0.
	 * Throws an error if the counter becomes negative.
	 */
	private leaveCriticalSection(): void {
		--this.critical_section_counter;
		if (this.critical_section_counter === 0) {
			this.process_transition_queue();
		}
		else if (this.critical_section_counter < 0) {
			throw new Error(`Critical section counter was lower than 0, which is obviously a bug. State: "${this.id}, StateDefId: "${this.def_id}.`);
		}
	}

	/**
	 * Processes the transition queue by transitioning to the next state in the queue.
	 * This method dequeues each state transition from the transition queue and transitions to the corresponding state.
	 */
	private process_transition_queue(): void {
		while (this.transition_queue.length > 0) {
			const state_transition = this.transition_queue.shift();
			// console.debug(`<< '${this.id}.${state_transition.state_id}'`);
			this.transitionToState(state_transition.state_id, state_transition.transition_type, ...state_transition.args);
		}
	}

	/**
	 * Gets the definition of the current state of the FSM.
	 * Note that the definition can be empty, as not all objects have a defined machine.
	 */
	public get current_state_definition(): StateDefinition {
		return this.current?.definition;
	}

	/**
	 * Factory for creating new FSMs.
	 * @param id - id of the FSM definition to use for this machine.
	 * @param target_id - id of the object that is stated by this FSM. @see {@link BaseModel.getGameObject}.
	 */
	public static create(id: Identifier, target_id: Identifier, parent_id: Identifier, root_id: Identifier): State {
		let result = new State(id, target_id, parent_id, root_id);
		result.populateStates(); // Populate the states of the state machine with the states from the state machine definition (if any) and their substates
		result.reset(true); // Reset the state machine to the start state to initialize the state machine and its substate machines

		return result;
	}

	/**
	 * Represents the context of a state in a finite state machine.
	 * Contains information about the current state, the state machine it belongs to, and any substate machines.
	 * @param def_id - id of the state machine definition to use for this machine.
	 * @param target_id - id of the object that is stated by this FSM. @see {@link BaseModel.getGameObject}.
	 */
	constructor(def_id: Identifier, target_id: Identifier, parent_id: Identifier, root_id: Identifier) {
		this.def_id = def_id ?? DEFAULT_BST_ID;
		this.target_id = target_id;
		this.parent_id = (target_id == parent_id ? undefined : parent_id); // If the target_id is the same as the parent_id, don't set the parent_id to denote that this is the root state
		this.paused ??= false;
		// Note: do not initailize the states here, as this will be done in the populateStates function. Also, do not initialize the currentid here, as this will be done in the reset function
		// Note: do not initialize the history here, as this will be done in the reset function
		// Note: do not set the states to an empty object, as this state might not have any states defined. Instead, leave it as undefined, so that it can be checked if the state has states defined

		// When parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
		if (def_id && target_id) {
			this.id = this.make_id();
			this.transition_queue = [];
			this.critical_section_counter = 0;
			this.onLoadSetup();
		}
		this.root_id = root_id ?? this.id;
	}

	@onload
	/**
	 * Performs the setup logic when the component is loaded.
	 * Registers the state machine with the registry.
	 */
	public onLoadSetup(): void {
		$.registry.register(this);
	}

	/**
	 * Starts the state machine by transitioning to the start state and triggering the enter event for that state.
	 * If there are no states defined, the state machine will not start and the method will return early.
	 * If there are states defined but no start state, an error will be thrown as the state machine cannot start without a start state.
	 */
	public start(): void {
		const startStateId = this.start_state_id;
		if (!startStateId) {
			if (!this.states) return; // If there are no states defined, there is no start state to start the state machine with and we can return early
			throw new Error(`No start state defined for state machine '${this.id}', while the state machine has states defined.'`); // If there are states defined, but no start state, throw an error as we can't start the state machine
		}

		const startStateDef = this.get_sstate(startStateId)?.definition; // Get the start state definition from the state machine definition

		// Trigger the enter event for the start state. Note that there is no definition for the none-state, so we don't trigger the enter event for that state.
		startStateDef?.enter?.call(this.target, this.get_sstate(startStateId));

		// Start the state machine for the current active state
		this.states[startStateId].start();
	}

	/**
	 * Runs the current state of the FSM.
	 * If the FSM is paused, this function does nothing.
	 * Calls the process_input function of the current state, if it exists, with the state_event_type.None event type.
	 * Calls the run function of the current state, if it exists, with the state_event_type.Run event type.
	 */
	run(): void {
		if (!this.definition || this.paused) return;

		this.enterCriticalSection();
		try {
			// Run substates first
			this.runSubstateMachines();

			// Process input for the current state
			this.processInput();

			// Run the current state's logic
			this.runCurrentState();

			// Execute run checks
			this.doRunChecks();
		} finally {
			this.leaveCriticalSection();
		}
	}

	/**
	 * Processes the input for the current state and transitions to the next state if provided.
	 */
	processInput(): void {
		if (this.paused) return;

		// Note that the input procesing is run first in the lowest substate, then in the parent state, and then in the parent of the parent state, and so on.
		// That is because the `runSubstateMachines` function is called before the `processInput` function, which means that the input processing is run in the substates first.
		this.processInputForCurrentState();

		const next_state = this.definition.process_input?.call(this.target, this);
		this.transitionToNextStateIfProvided(next_state);
	}

	/**
	 * Processes the player input 'events' for the current state.
	 * If the current state has an 'on_input' property, it checks if the input matches any of the input patterns and executes the corresponding handler.
	 * @returns {void}
	 */
	private processInputForCurrentState(): void {
		const inputHandlers = this.definition.on_input;
		if (!inputHandlers) return;

		const playerIndex = this.target.player_index ?? 1;

		for (const inputPattern in inputHandlers) {
			const handler = inputHandlers[inputPattern];
			if (Input.instance.getPlayerInput(playerIndex).checkActionTriggered(inputPattern)) {
				Input.instance.getPlayerInput(playerIndex).consumeAction(inputPattern);
				this.handleStateTransition(handler);
			}
		}
	}

	/**
	 * Runs the current state of the state machine.
	 * If the state has a `run` function defined in its definition, it calls that function.
	 * If the `run` function returns a next state, it transitions to that state.
	 * If the `run` function does not return a next state and `auto_tick` is enabled in the state definition, it increments the `ticks` counter.
	 */
	private runCurrentState(): void {
		const next_state = this.definition.run?.call(this.target, this);
		if (next_state) {
			this.transitionToNextStateIfProvided(next_state);
		} else if (this.definition.auto_tick) {
			++this.ticks;
		}
	}

	/**
	 * Runs the substate machines.
	 */
	runSubstateMachines(): void {
		if (!this.states) return;

		this.current.run();
		for (const id in this.states) {
			if (id === this.currentid) continue;
			if (this.states[id].parallel) this.states[id].run();
		}
	}

	/**
	 * Perform the run checks for the current state.
	 * @returns {void}
	 */
	doRunChecks(): void {
		if (this.paused) return;

		// Run checks in the current state.
		// Note that the run checks are run first in the lowest substate, then in the parent state, and then in the parent of the parent state, and so on.
		// That is because the `runSubstateMachines` function is called before the `doRunChecks` function, which means that the run checks are run in the substates first.
		this.runChecksForCurrentState();
	}

	/**
	 * Executes the run checks defined in the state machine definition.
	 * If a run check condition is met, it might transition to the next state based on the provided logic.
	 */
	runChecksForCurrentState(): void {
		const run_checks = this.definition.run_checks;
		if (!run_checks) return;

		for (const run_check of run_checks) {
			if (run_check.if.call(this.target, this)) {
				const handled = this.handleStateTransition(run_check.do);
				if (handled) {
					break;
				}
				if (run_check.to) {
					this.transitionToNextStateIfProvided(run_check.to);
				} else if (run_check.switch) {
					this.transitionToNextStateIfProvided(run_check.switch, true);
				}
				break;
			}
		}
	}

	/**
	 * Handles the given path and returns the current part, remaining parts, and current context.
	 * @param path - The path to handle, can be a string or an array of strings.
	 * @returns An array containing the current part, remaining parts, and current context.
	 * @throws {Error} If no state with the given ID is found.
	 */
	private handle_path(path: string | string[]): [string, string[], State] {
		let parts: string[];
		if (typeof path === 'string') {
			parts = path.split('.');
		} else {
			parts = path;
		}

		let currentPart = parts[0];
		let restParts = parts.slice(1);

		let currentContext: State;
		switch (currentPart) {
			case '#this':
				currentContext = this;
				[currentPart, ...restParts] = restParts;
				break;
			case '#parent':
				currentContext = this.parent;
				[currentPart, ...restParts] = restParts;
				break;
			case '#root':
				currentContext = this.root;
				[currentPart, ...restParts] = restParts;
				break;
			default:
				currentContext = this.states?.[currentPart];
				if (!currentContext) {
					throw new Error(`No state with ID '${currentPart}'`);
				}
				break;
		}

		return [currentPart, restParts, currentContext];
	}

	/**
	 * Transition to a new state identified by the given ID. If the ID contains multiple parts separated by '.', it traverses through the states accordingly and switches the state of each part.
	 * If no parts are provided, the ID will be split by '.' to determine the parts.
	 * @param path - The ID of the state to transition to.
	 * @throws Error if the state with the given ID does not exist.
	 */
	public to_path(path: string | string[], ...args: any[]): void {
		const [currentPart, restParts, currentContext] = this.handle_path(path);

		if (this.def_id !== currentPart || restParts.length === 0) {
			if (!currentContext.parallel) { // If the state is not running in parallel, set it as the current state
				this.transitionToState(currentPart, 'to', ...args);
			}
		}

		if (restParts.length > 0) {
			currentContext.to_path(restParts, ...args);
		}
	}

	/**
	 * Switches the state of the state machine to the specified ID.
	 * If the ID contains multiple parts separated by '.', it traverses through the states accordingly and only switches the state of the last part.
	 * Performs exit actions for the current state and enter actions for the new current state.
	 * Throws an error if the state with the specified ID doesn't exist or if the target state is parallel.
	 *
	 * @param path - The ID of the state to switch to.
	 * @returns void
	 */
	public switch_path(path: string | string[], ...args: any[]): void {
		const [currentPart, restParts, currentContext] = this.handle_path(path);

		if (restParts.length > 0) {
			currentContext.switch_path(restParts, ...args);
		} else if (this.def_id !== currentPart) {
			this.transitionToState(currentPart, 'switch', ...args);
		}
	}

	/**
	 * Transition to a new state.
	 *
	 * This method is responsible for transitioning the state machine to a new state.
	 * If the ID contains multiple parts separated by '.', it traverses through the states accordingly and switches the state of each part.
	 * It handles three types of state transitions:
	 * 1. Transitions within the current state machine, identified by a state_id starting with '#this.'.
	 * 2. Transitions from the root of the state machine hierarchy, identified by a state_id starting with '#root.'.
	 * 3. Transitions within the parent state machine, for all other state_ids.
	 *
	 * @param state_id - The identifier of the state to transition to. This can be a local state (prefixed with '#this.'),
	 * a state from the root (prefixed with '#root.'), or a state within the parent state machine.
	 * @param args - Optional arguments to pass to the new state. These arguments are passed on to the 'to' or 'switch' methods.
	 */
	to(state_id: Identifier, ...args: any[]): void {
		if (state_id.startsWith('#this.')) { // If the state is local, switch to the state in the current state machine
			// Remove the '#this.' prefix and continue to the next state from the substate
			const restParts = state_id.slice('#this.'.length);
			// If there are more parts, switch to the state in the current state machine
			this.to_path(restParts, ...args);
		}
		else if (state_id.startsWith('#root.')) { // If the state is in the root, switch to the state in the root state machine
			// Remove the '#root.' prefix and continue to the next state from the root
			const restParts = state_id.slice('#root.'.length);
			// If there are more parts, switch to the state in the root state machine
			this.root.to_path(restParts, ...args);
		}
		else { // If the state is not local, check if it is a state in the parent state machine or a state in the root state machine hierarchy
			if (this.parent_id) { // If there is a parent, switch to the state in the parent state machine
				this.parent.to_path(state_id, ...args); // Switch to the state in the parent state machine
			}
			else { // If there is no parent, this is the root state machine, so we can just switch to the state in the current state machine
				this.to_path(state_id, ...args); // Switch to the state in the current state machine
			}
		}
	}

	/**
	 * Transition to a new state.
	 *
	 * This method is responsible for transitioning the state machine to a new state.
	 * If the ID contains multiple parts separated by '.', it traverses through the states accordingly and only switches the state of the last part.
	 * It handles three types of state transitions:
	 * 1. Transitions within the current state machine, identified by a state_id starting with '#this.'.
	 * 2. Transitions from the root of the state machine hierarchy, identified by a state_id starting with '#root.'.
	 * 3. Transitions within the parent state machine, for all other state_ids.
	 *
	 * @param state_id - The identifier of the state to transition to. This can be a local state (prefixed with '#this.'),
	 * a state from the root (prefixed with '#root.'), or a state within the parent state machine.
	 * @param args - Optional arguments to pass to the new state. These arguments are passed on to the 'to' or 'switch' methods.
	 */
	switch(state_id: Identifier, ...args: any[]): void {
		if (state_id.startsWith('#this.')) {
			// Remove the '#this.' prefix and continue to the next state from the substate
			const restParts = state_id.slice('#this.'.length);
			// If there are more parts, switch to the state in the current state machine
			this.switch_path(restParts, ...args);
		}
		else if (state_id.startsWith('#parent.')) {
			// Remove the '#parent.' prefix and continue to the next state from the parent
			const restParts = state_id.slice('#parent.'.length);
			// If there are more parts, switch to the state in the parent state machine
			this.parent.switch_path(restParts, ...args);
		}
		else if (state_id.startsWith('#root.')) {
			// Remove the '#root.' prefix and continue to the next state from the root
			const restParts = state_id.slice('#root.'.length);
			// If there are more parts, switch to the state in the root state machine
			this.root.switch_path(restParts, ...args);
		}
		else {
			this.parent.switch_path(state_id, ...args); // Switch to the state in the parent state machine
		}
	}

	/**
	 * Checks if the current state matches the given path.
	 *
	 * @param path - The path to the desired state, represented as a dot-separated string.
	 * @returns true if the current state matches the path, false otherwise.
	 * @throws Error if no machine with the specified ID is found.
	 */
	public is(path: string | string[]): boolean {
		let parts: string[];
		if (typeof path === 'string') {
			parts = path.split('.');
		} else {
			parts = path;
		}
		const [stateid, ...substateids] = parts;

		// If there are no more parts, check the id of the current state
		if (substateids.length === 0) {
			return this.currentid === stateid;
		}

		const state = this.states[stateid];
		if (!state) {
			throw new Error(`No state with ID '${stateid}'`);
		}

		// If there are more parts, check the state of the substate with the given path
		return state.is(substateids);
	}

	/**
	 * Checks the state guards of the current state and the target state.
	 * If the current state has a canExit guard and it returns false, the transition is prevented.
	 * If the target state has a canEnter guard and it returns false, the transition is prevented.
	 * If all guards pass, the transition is allowed.
	 * @param target_state_id - The identifier of the target state.
	 * @returns true if the transition is allowed, false otherwise.
	 */
	private checkStateGuardConditions(target_state_id: Identifier): boolean {
		const currentStateDefinition = this.current_state_definition;
		const targetStateDefinition = this.definition.states[target_state_id];

		// Check if the current state has a canExit guard and if it returns false, prevent the transition
		if (currentStateDefinition.guards?.canExit && !currentStateDefinition.guards.canExit.call(this.target, this)) {
			return false;
		}

		// Get the target state itself (and not the definition) to check the canEnter guard
		const target_state = this.states[target_state_id];
		// Check if the target state has a canEnter guard and if it returns false, prevent the transition
		if (targetStateDefinition.guards?.canEnter && !targetStateDefinition.guards.canEnter.call(this.target, target_state)) {
			return false;
		}

		return true; // All guards passed, allow the transition
	}

	/**
	 * Transition to the specified state.
	 * If the return value of the enter function is a string, it is assumed to be the ID of the next state to transition to.
	 *
	 * @param state_id - The identifier of the state to transition to.
	 * @param args - Optional arguments to pass to the state's enter and exit actions.
	 * @throws Error - If the state with the specified ID doesn't exist or if the target state is parallel.
	 */
	private transitionToState(state_id: Identifier, transition_type: TransitionType, ...args: any[]): void {
		if (this.critical_section_counter > 0) {
			this.transition_queue.push({ state_id: state_id, args: args, transition_type: transition_type ?? 'to' });
			return;
		}

		if (transition_type === 'switch') {
			// The switch transition type is used to switch to a new state, expect if the state is already the current state
			if (this.currentid === state_id) return;
		}

		// If any state guard conditions fail, prevent the transition
		if (!this.checkStateGuardConditions(state_id)) return;

		// Perform exit actions for the current state
		let stateDef = this.current_state_definition;
		stateDef?.exit?.call(this.target, this.current, ...args);
		stateDef && this.pushHistory(this.currentid);

		// Update the current state
		this.currentid = state_id;
		if (!this.current) throw new Error(`State '${state_id}' doesn't exist for this state machine '${this.def_id}'!`);

		// Perform enter actions for the new current state
		stateDef = this.current_state_definition;
		if (!stateDef) return; // There is no definition for the none-state, so we don't trigger the enter event for that state.
		if (stateDef.parallel) throw new Error(`Cannot transition to parallel state '${state_id}'!`);

		/**
		 * If the auto_reset propert is set to 'state', reset the state machine of the current state.
		 * If the auto_reset propert is set to 'tree', reset the state machine of the current state and all its substate machines.
		 * If the auto_reset propert is set to 'subtree', reset the substate machine of the current state, but not the current state itself.
		 * If the auto_reset property is set to 'none', do not reset any state machines.
		 */
		if (stateDef.auto_reset) {
			switch (stateDef.auto_reset) {
				case 'state': this.current.reset(false); break; // Reset the state machine of the current state (but not its substate machines)
				case 'tree': this.current.reset(true); break; // Reset the state machine of the current state and all its substate machines
				case 'subtree': this.current.resetSubmachine(true); break; // Reset the substate machine of the current state
				case 'none': break; // Do nothing (i.e., don't reset any state machines)
			}
		}
		const next_state = stateDef?.enter?.call(this.target, this.current, ...args);
		this.current.transitionToNextStateIfProvided(next_state);
	}

	/**
	 * Executes the specified event on the state machine.
	 *
	 * @param eventName - The name of the event to execute.
	 * @param emitter - The identifier or identifiable object that triggered the event.
	 * @param args - Additional arguments to pass to the event handler.
	 */
	public do(eventName: string, emitter: Identifier | IIdentifiable, ...args: any[]): void {
		this.root.dispatch(eventName, emitter, ...args);
	}

	/**
	 * Dispatches an event to the state machine.
	 * If the state machine is paused, the event will not be processed.
	 * If the current state has child states, the event will be dispatched to the child states.
	 * If the current state does not have child states, the event will be dispatched to the parent states.
	 * @param eventName - The name of the event to dispatch.
	 * @param emitter_id - The identifier of the event emitter.
	 * @param args - Additional arguments to pass to the event handlers.
	 */
	public dispatch(eventName: string, emitter_id: Identifier, ...args: any[]): void {
		// If the state machine is paused, do not process the event
		if (this.paused) {
			return;
		}

		// If this state has children, dispatch the event to the child states
		if (this.states && Object.keys(this.states).length > 0) {
			// Dispatch the event to the current active state
			this.current?.dispatch(eventName, emitter_id, ...args);

			// Also dispatch the event to all parallel states
			Object.values(this.states).forEach(state => state.parallel && state.dispatch(eventName, emitter_id, ...args));
		} else {
			// This is the deepest part of the state machine, dispatch the event here
			// Bubble up the event to the parent states
			let current = this;
			do {
				if (current.handleEvent(eventName, emitter_id, ...args)) {
					return; // If the event was handled, stop bubbling up the event
				}
				current = current.parent;
			} while (current);
		}
	}

	/**
	 * Retrieves the next state based on the provided `next_state` parameter.
	 *
	 * @param next_state - The next state to transition to. Can be a `StateTransition` object, a string representing the next state, or `undefined` if no transition is needed.
	 * @returns The next state transition object or `undefined` if no transition is needed.
	 * @throws Error if the `next_state` parameter is not a valid type.
	 */
	private getNextState(next_state: StateTransition | string | void): StateTransition | void {
		if (!next_state) {
			return;
		}

		if (typeof next_state === 'string') {
			return { state_id: next_state, args: [] };
		}

		if (typeof next_state === 'object') {
			const args = Array.isArray(next_state.args) ? next_state.args : next_state.args ? [next_state.args] : [];
			return { ...next_state, args };
		}

		throw new Error(`Invalid type for next state: ${next_state}, expected string or object`);
	}

	/**
	 * Transitions to the next state if provided.
	 *
	 * @param next_state - The next state to transition to.
	 */
	private transitionToNextStateIfProvided(next_state: StateTransition | string | void, do_switch: boolean = false): void {
		const next_state_transition = this.getNextState(next_state);

		// If the next state is not the current state, transition to the next state
		if (next_state_transition) {
			if (do_switch) {
				this.switch(next_state_transition.state_id, ...next_state_transition.args);
			}
			else {
				this.to(next_state_transition.state_id, ...next_state_transition.args);
			}
		}
	}

	/**
	 * Handles an event in the state.
	 * @param eventName - The name of the event.
	 * @param emitter_id - The identifier of the event emitter.
	 * @param args - Additional arguments for the event.
	 * @returns A boolean indicating whether the event was handled.
	 */
	private handleEvent(eventName: string, emitter_id: Identifier, ...args: any[]): boolean {
		if (this.paused) {
			return false;
		}

		this.enterCriticalSection();
		try {
			const state_id_or_handler = this.definition?.on?.[eventName];
			if (state_id_or_handler) {
				if (typeof state_id_or_handler !== 'string') {
					const emitterId = state_id_or_handler.scope;
					if (emitterId && emitterId !== 'all' && emitterId !== emitter_id) {
						return false;
					}
				}
				if (this.handleStateTransition(state_id_or_handler, ...args)) {
					return true;
				}
			}
			return false;
		} finally {
			this.leaveCriticalSection();
		}
	}

	private handleStateTransition(state_id_or_handler: any, ...args: any[]): boolean {
		if (typeof state_id_or_handler === 'string') {
			this.to(state_id_or_handler, ...args);
		} else {
			const ifHandler = state_id_or_handler.if;
			const doHandler = state_id_or_handler.do;
			const to_state = state_id_or_handler.to;
			const switch_state = state_id_or_handler.switch;

			if (ifHandler && !ifHandler.call(this.target, this as State<T>, ...args)) {
				return false;
			}

			const next_state = doHandler?.call(this.target, this as State<T>, ...args);
			const next_state_transition = this.getNextState(next_state);
			if (next_state_transition && (next_state_transition.force_transition_to_same_state && next_state_transition.transition_type != 'to')) {
				throw new Error(`The 'force_transition_to_same_state' property is only allowed for 'to' transitions, not for 'switch' transitions!`);
			}

			if (next_state_transition && (next_state_transition.state_id !== this.currentid || next_state_transition.force_transition_to_same_state)) {
				if (next_state_transition.transition_type === 'to' || !next_state_transition.transition_type) {
					this.to(next_state_transition.state_id, ...next_state_transition.args, ...args);
				} else if (next_state_transition.transition_type === 'switch') {
					this.switch(next_state_transition.state_id, ...next_state_transition.args, ...args);
				}
			} else if (to_state) {
				const to_state_transition = this.getNextState(to_state);
				if (to_state_transition) {
					this.to(to_state_transition.state_id, ...to_state_transition.args, ...args);
				}
			} else if (switch_state) {
				const switch_state_transition = this.getNextState(switch_state);
				if (switch_state_transition) {
					this.switch(switch_state_transition.state_id, ...switch_state_transition.args, ...args);
				}
			}
		}
		return true;
	}

	/**
	 * Adds the given state ID to the history stack, which tracks the previous states of the state machine.
	 * If the history stack exceeds the maximum length, the oldest state is removed from the stack.
	 * @param toPush - the state ID to add to the history stack
	 */
	protected pushHistory(toPush: Identifier): void {
		this.history.push(toPush);
		if (this.history.length > BST_MAX_HISTORY)
			this.history.shift(); // Remove the first element in the history-array
	}

	/**
	 * Goes back to the previous state in the history stack.
	 * If there is no previous state, nothing happens.
	 */
	public pop(): void {
		if (this.history.length <= 0) return;
		let poppedStateId = this.history.pop();
		poppedStateId && this.to(poppedStateId);
	}

	/**
	 * Populates the state machine with states defined in the state machine definition.
	 * If no state machine definition is defined, a default machine with a generated 'none'-state is created.
	 * If no current state is set, the state is set to the first state found in the set of states.
	 */
	public populateStates(): void {
		const sdef = this.definition;
		if (!sdef || !sdef.states) { // If no state machine definition is defined, don't populate the states
			this.states = undefined; // Set the states to undefined to denote that there are no states defined (as opposed to an empty object). Note that states should already be undefined, but just to be sure, set it to undefined here as well
			return; // Don't populate the states
		}
		const state_ids = Object.keys(sdef.states);
		if (state_ids.length === 0) { // If there are no states defined in the state machine definition, don't populate the states
			this.states = undefined;
			return;
		}

		this.states = {}; // Initialize the states object to an empty object
		for (let sdef_id in sdef.states) {
			let state = new State(sdef_id, this.target_id, this.id, this.root_id);
			this.add(state);
			state.populateStates(); // Populate the substates of the state
		}
		// If no current state is set, set the state to the first state that it finds in the set of states
		if (!this.currentid) this.currentid = Object.keys(this.states)[0];
	}

	/**
	 * Adds the given states to the state machine.
	 * If a state with the same ID already exists in the state machine, an error is thrown.
	 * @param states - the states to add to the state machine
	 * @throws Error if a state with the same ID already exists in the state machine
	 */
	private add(...states: State[]): void {
		for (let state of states) {
			if (!state.def_id) throw new Error(`State is missing an id, while attempting to add it to this sstate '${this.def_id}'!`);
			if (this.states[state.def_id]) throw new Error(`State ${state.def_id} already exists for sstate '${this.def_id}'!`);
			this.states[state.def_id] = state;
		}
	}

	/**
	 * Returns the tape associated with the state machine definition.
	 * If no tape is defined, returns undefined.
	 * @returns The tape associated with the state machine definition, or undefined if not found.
	 */
	public get tape(): Tape { return this.definition?.tape; }

	/**
	 * Returns the current value of the tape at the position of the tape head.
	 * If there is no tape or the tape head is beyond the end of the tape, returns undefined.
	 */
	public get current_tape_value(): any {
		if (!this.tape || this.tape.length === 0) return undefined;
		const current_index = Math.max(0, Math.min(this.head, this.tape.length - 1));
		return this.tape[current_index];
	}

	/**
	 * Indicates whether the head of the finite state machine is at the end of the tape.
	 * If there is no tape, it also returns true.
	 * @returns A boolean value indicating whether the head is at the end of the tape.
	 */
	public get at_tapeend(): boolean { return !this.tape || this.head >= this.tape.length - 1; } // Note that beyond end also returns true if there is no tape!

	/**
	 * Determines whether the tape head is currently beyond the end of the tape.
	 * Returns true if the tape head is beyond the end of the tape or if there is no tape, false otherwise.
	 * Note that this function assumes that the tape head is within the bounds of the tape.
	 */
	protected get beyond_tapeend(): boolean { return !this.tape || this.head >= this.tape.length; } // Note that beyond end also returns true if there is no tape!

	/**
	 * Returns whether the tape head is currently before the start of the tape,
	 * which is given by index `-1`.
	 * If there is no tape, it also returns true.
	 * @returns A boolean value indicating whether the tape head is before the start of the tape.
	 */
	public get tape_rewound(): boolean { return this.head === TAPE_START_INDEX; }

	/**
	 * Generates a unique identifier for the current instance.
	 * The identifier is created by concatenating the `parent_id`, `target_id`, and `def_id`.
	 * @returns The generated identifier.
	 */
	private make_id(): Identifier {
		let id = `${this.parent_id ?? this.target_id}.${this.def_id}`; // The id is the parent_id + the target_id + the def_id (e.g. 'parent_id.target_id.def_id') to create a unique id
		return id;
	}

	/**
	 * Disposes the current state machine and deregisters it from the registry.
	 * Also deregisters all substates.
	 */
	public dispose(): void {
		$.registry.deregister(this);
		// Also deregister all substates
		for (let state in this.states) {
			this.states[state].dispose();
		}
	}

	/**
	 * The position of the tape head.
	 */
	protected _tapehead!: number;

	/**
	 * Gets the current position of the tapehead.
	 * @returns The current position of the tapehead.

	 */

	public get head(): number {
		return this._tapehead;
	}

	/**
	 * Sets the current position of the tapehead to the given value.
	 * If the tapehead is going out of bounds, the tapehead is moved to the beginning or end of the tape, depending on the state machine definition.
	 * If the tapehead is moved, the tapemove event is triggered.
	 * If the tapehead reaches the end of the tape, the tapeend event is triggered.
	 * @param v - the new position of the tapehead
	 */
	public set head(v: number) {
		this.enterCriticalSection();
		try {
			this._ticks = 0; // Always reset tapehead ticks after moving tapehead
			this._tapehead = v; // Move the tape to new position

			// Check if the tapehead is going out of bounds (or there is no tape at all)
			if (!this.tape) {
				this._tapehead = TAPE_START_INDEX;

				// Trigger the event for moving the tape, after having set the tapehead to the correct position
				this.tapemove();

				// Trigger the event for reaching the end of the tape
				this.tapeend();
			}
			// Check if the tape now is at the end
			else if (this.beyond_tapeend) {
				// Check whether we automagically rewind the tape
				if (this.definition.auto_rewind_tape_after_end) {
					// If so, rewind and move to the first element of the tapehead
					// But why? (Yes... Why?) Because we then can loop an animation,
					// including the first and last element of the tape, without having
					// to resort to any workarounds like duplicating the first entry
					// of the tape or similar.
					this._tapehead = 0; // Set the tapehead to the beginning of the tape, but not to TAPE_START_INDEX, as that is before the start of the tape and we are now properly triggering the tapemove event for the first element of the tape

					// Trigger the event for moving the tape, after having set the tapehead to the correct position
					this.tapemove(true);
				}
				else {
					// Set the tapehead to the end of the tape (or 0 if there is no tape)
					this._tapehead = this.tape.length > 0 ? this.tape.length - 1 : TAPE_START_INDEX;

					// We do not trigger the tapemove event here, as the tapehead is not actually moving and we dont want to trigger the tapemove event twice in a row for the same tapehead position
				}

				// Trigger the event for reaching the end of the tape
				this.tapeend();
			}
			else {
				// Trigger the event for moving the tape. This is executed when no tapehead correction was required
				this.tapemove();
			}
		} finally {
			this.leaveCriticalSection();
		}
	}

	// Sets the current position of the tapehead to the given value without triggering any events or side effects.
	// @param v - the new position of the tapehead
	public setHeadNoSideEffect(v: number) {
		this._tapehead = v;
	}

	/**
	 * Sets the current number of ticks of the tapehead to the given value without triggering any events or side effects.
	 * @param v - the new number of ticks of the tapehead
	 */
	public setTicksNoSideEffect(v: number) {
		this._ticks = v;
	}

	/**
	 * The number of ticks.
	 */
	protected _ticks!: number;
	/**
	 * Returns the current number of ticks of the tapehead.
	 * @returns The current number of ticks of the tapehead.
	 */
	public get ticks(): number {
		return this._ticks;
	}
	/**
	 * Sets the current number of ticks of the tapehead to the given value.
	 * If the number of ticks is greater than or equal to the number of ticks required to move the tapehead,
	 * the tapehead is moved to the next position.
	 * @param v - the new number of ticks of the tapehead
	 */
	public set ticks(v: number) {
		this._ticks = v;
		if (v >= this.definition.ticks2move) { ++this.head; }
	}

	/**
	 * Calls the next state's function.
	 * @param tape_rewound Indicates whether the tape has been rewound. Only occurs when the tape is automatically rewound after reaching the end of the tape via @see {@link StateDefinition.auto_rewind_tape_after_end}.
	 */
	protected tapemove(tape_rewound: boolean = false) {
		this.enterCriticalSection();
		try {
			const next_state = this.definition.next?.call(this.target, this, tape_rewound);
			this.transitionToNextStateIfProvided(next_state);
		} finally {
			this.leaveCriticalSection();
		}
	}

	/**
	 * Triggers the `end` event of the state machine definition, passing this state and the `state_event_type.End` event type as arguments.
	 */
	protected tapeend() {
		this.enterCriticalSection();
		try {
			const next_state = this.definition.end?.call(this.target, this, undefined);
			this.transitionToNextStateIfProvided(next_state);
		} finally {
			this.leaveCriticalSection();
		}
	}

	/**
	 * Resets the tape to its initial state by rewinding the tapehead to the beginning
	 * and resetting the tick counter.
	 *
	 * This method performs the following actions:
	 * - Sets the tapehead position to the start index.
	 * - Resets the tick counter to zero.
	 *
	 * @public
	 */
	public rewind_tape() {
		this.setHeadNoSideEffect(TAPE_START_INDEX); // Reset the tapehead to the beginning of the tape
		this.setTicksNoSideEffect(0); // Reset the ticks
	}

	/**
	 * Resets the state machine by setting the tapehead and ticks to 0 and the ticks2move to the value defined in the state machine definition.
	 */
	public reset(reset_tree: boolean = true): void {
		this.rewind_tape(); // Rewind the tape
		if (!this.definition) return; // No definition exists for the empty 'none'-state
		this.data = { ...this.definition.data }; // Reset the state data by shallow copying the definition's data
		if (reset_tree) this.resetSubmachine(); // Reset the substate machine if it exists
	}

	// Resets the state machine to its initial state.
	// If a start state is defined in the state machine definition, the current state is set to that state.
	// Otherwise, the current state is set to the 'none' state.
	// The history of previous states is cleared and the state machine is unpaused.
	public resetSubmachine(reset_tree: boolean = true): void {
		// N.B. doesn't trigger the onenter-event!
		const start = this.definition?.start_state_id; // Definition doesn't need to exist
		this.currentid = start; // Set the current state to the start state (if it exists)
		this.history = new Array();
		this.paused = false;
		if (!this.definition) return; // If the definition doesn't exist, the state machine is empty and there is nothing to reset
		this.data = { ...this.definition.data }; // Reset the state machine data by shallow copying the definition's data
		if (reset_tree) {
			// Call the reset function for each state
			for (let state in this.states) {
				this.states[state].reset(reset_tree);
			}
		}
	}
}

/**
 * Determines whether the tape should automatically rewind to the beginning
 * after reaching the end.
 */
const AUTO_REWIND_TAPE_AFTER_END = false;

/**
 * Represents the definition of a state in a behavior finite state machine (BFSM).
 *
 * @remarks
 * This class encapsulates the properties and behaviors of a state within a state machine,
 * including its unique identifier, associated data, tape management, and event handling.
 */
export class StateDefinition {
	/**
	 * The unique identifier for the bfsm.
	 */
	public id: Identifier;

	/**
	 * Optional data associated with the bfsm.
	 */
	public data?: { [key: string]: any };

	/**
	 * Indicates whether the state machine is running in parallel with the 'current' state machine as defined in {@link StateMachineController.current_machine}.
	 */
	public parallel?: boolean;

	/**
	 * The tape used by the BFSM.
	 */
	public tape!: Tape;

	/**
	 * Number of runs before tapehead moves to next statedata.
	 */
	public ticks2move: number; // Number of runs before tapehead moves to next statedata

	/**
	 * Specifies whether the tapehead should automatically rewind to index `0` when it reaches the end of the tape.
	 * Defaults to `true`.
	 * - If set to `true`, the tapehead will be set to index `0` when it would go out of bounds.
	 * - If set to `false`, the tapehead will remain at the end of the tape.
	 */
	public auto_tick: boolean; // Automagically increase the ticks during run

	/**
	 * Specifies the behavior for automatic state resetting.
	 *
	 * @remarks
	 * When set to 'state', the state will be automatically reset upon entry.
	 * If set to 'tree', the state and all its substates will be reset.
	 * Choosing 'subtree' will reset only the substates, while 'none' disables automatic resetting.
	 * The default value is 'state'.
	 *
	 * @type {'state' | 'tree' | 'subtree' | 'none'}
	 */
	public auto_reset: 'state' | 'tree' | 'subtree' | 'none'; // Automagically reset the state when entered (and optionally also its substates) (defaults to 'state')

	/**
	 * Indicates whether the tapehead should automatically rewind to index 0 when it would go out of bounds.
	 * If set to true, the tapehead will be set to index 0 when it reaches the end of the tape.
	 * If set to false, the tapehead will remain at the end of the tape.
	 */
	public auto_rewind_tape_after_end: boolean; // Automagically set the tapehead to index 0 when tapehead would go out of bound. Otherwise, will remain at end

	/**
	 * Number of times the tape should be repeated.
	 * See {@link repeat_tape} for more information.
	 */
	public repetitions: number; // Number of times the tape should be repeated

	@exclude_save
	/**
	 * The parent state machine definition.
	 */
	public parent!: StateDefinition; // The parent state machine definition

	@exclude_save
	/**
	 * The root state machine definition.
	 */
	public root!: StateDefinition; // The root state machine definition

	public event_list: { name: string, scope: EventScope }[];

	/**
	 * Constructs a new instance of the `bfsm` class.
	 * @param id - The ID of the `bfsm` instance.
	 * @param partialdef - An optional partial definition to assign to the `bfsm` instance.
	 */
	public constructor(id: Identifier = '_', partialdef?: Partial<StateDefinition>, root: StateDefinition = null) {
		this.id = id; //`${parent_id ? (parent_id + '.') : ''}${id ?? DEFAULT_BST_ID}`;
		partialdef && Object.assign(this, partialdef); // Assign the partial definition to the instance
		this.ticks2move ??= 0; // Unless already defined, ticks2move is 0
		this.repetitions = (this.tape ? (this.repetitions ?? 1) : 0);
		this.auto_tick = this.auto_tick ?? (this.ticks2move !== 0 ? true : false); // If ticks2move is 0, auto_tick is false. Otherwise, auto_tick is true (unless it was already defined)
		this.auto_rewind_tape_after_end = this.auto_rewind_tape_after_end ?? (this.tape ? AUTO_REWIND_TAPE_AFTER_END : false); // If there is a tape, auto_rewind_tape_after_end is AUTO_REWIND_TAPE_AFTER_END. Otherwise, it is false (unless it was already defined)
		this.auto_reset = this.auto_reset ?? 'state'; // Unless already defined, auto_reset is true
		this.data ??= {}; // Unless already defined, data is an empty object
		this.root = root ?? this; // The root state machine is either the provided root or this state machine
		this.parallel ??= false; // Unless already defined, parallel is false

		if (this.tape) {
			this.repeat_tape(this.tape, this.repetitions);
		}

		if (partialdef.states) {
			this.construct_substate_machine(partialdef.states, this.root);
		}
	}

	/**
	 * Repeats the tape by appending it to itself multiple times.
	 *
	 * @param tape - The tape to be repeated.
	 * @param repetitions - The number of times the tape should be repeated.
	 */
	private repeat_tape(tape: typeof this.tape, repetitions: typeof this.repetitions): void {
		// Repeat the tape if necessary (and if it exists) by appending the tape to itself
		if (tape && repetitions > 1) { // If there is a tape and the tape should be repeated at least once
			let originalTape = [...tape]; // Copy the tape
			for (let i = 1; i < repetitions; i++) { // Repeat the tape
				tape.push(...originalTape); // Append the tape to itself
			}
		}
	}

	/**
	 * Constructs the substate machine based on the provided substates.
	 *
	 * @param substates - The blueprint of the substates.
	 */
	private construct_substate_machine(substates: StateMachineBlueprint, root: StateDefinition): void {
		this.states ??= {};
		const substate_ids = Object.keys(substates);
		for (let state_id of substate_ids) {
			const sub_sdef = this.#create_state(substates[state_id], state_id, root);
			validateStateMachine(sub_sdef as StateDefinition);
			this.replace_partialsdef_with_sdef(sub_sdef, root);
		}
		if (substate_ids.length > 0 && !this.start_state_id) { // Only look for a start state if we have at least one state in our definition
			this.start_state_id = substate_ids[0]; // If no default state was defined, we default to the first state found in the list of states
			// If the start state is not defined, we don't need to change the key of the start state
		}
		else {
			// If the start state is defined, we need to change the key of the start state to exclude the start state prefix
			const start_state = this.states[this.start_state_id]; // Get the start state
			for (const state_id of substate_ids) {
				if (StateDefinition.START_STATE_PREFIXES.includes(state_id.charAt(0))) { // If the state id starts with a start state prefix
					delete this.states[state_id]; // Delete the start state from the list of states (with the old key)
					this.states[start_state.id] = start_state; // Add the start state to the list of states (with the new key)
					break; // Stop iterating over the states
				}
			}
		}
	}

	public run?: IStateEventHandler;
	public end?: IStateEventHandler;
	public next?: IStateNextHandler;
	public enter?: IStateEventHandler;
	public exit?: IStateExitHandler;
	public process_input?: IStateEventHandler;

	/**
	 * Represents the mapping of event types to state IDs for transitions to other states based on events (e.g. 'click' => 'idle').
	 * At the individual state level, the `on` property defines the transitions that can occur from that specific state.
	 * NOTE: If the `event_name` starts with a `$` (e.g. `$click`), the event will be triggered on the *local scope* (= self). Otherwise, it will be triggered on the *global scope*.
	 * @example
	 * ```typescript
	   * {
		 *	'$click': 'idle',
	   *	'game_end': 'prepare_for_end_of_the_world_I_mean_game',
	 *		'$drag': { if: (state: sstate) => state.data.dragging, do: (state: sstate) => state.data.dragging = false, to: 'idle', scope: 'self' },
	   * }
	 * ```
	 */
	public on?: {
		[key: string]: Identifier | StateEventDefinition;
	};

	public on_input?: {
		[key: string]: Identifier | StateEventDefinition;
	};

	public run_checks?: TickCheckDefinition[];

	/**
	 * The guards for the state.
	 */
	public guards?: IStateGuard;

	/**
	 * The states defined for this state machine.
	 */
	public states?: id2partial_sdef;

	/**
	 * The identifier of the state that the state machine should start in.
	 */
	public start_state_id?: Identifier;

	/**
	 * The prefix used to identify the start state.
	 */
	public static readonly START_STATE_PREFIXES = '_#';

	/**
	 * Creates a new state definition.
	 * @param partial The partial definition of the state.
	 * @param state_id The identifier of the state.
	 * @returns The new state definition.
	 * @throws An error if the state definition is missing.
	 */
	#create_state(partial: Partial<StateDefinition>, state_id: Identifier, root: StateDefinition): StateDefinition {
		if (!partial) throw new Error(`'sdef' with id '${state_id}' is missing definition while attempting to add it to this 'sdef'!`);
		return new StateDefinition(state_id, partial, root);
	}

	/**
	 * Determines if a given state is the start state.
	 * @param state The state to check.
	 * @returns True if the state is the start state, false otherwise.
	 */
	#is_start_state(state: StateDefinition): boolean {
		return StateDefinition.START_STATE_PREFIXES.includes(state.id.charAt(0)); // Return true iff the first character of the state id is a start state prefix
	}

	/**
	 * Sets the start state of the state machine to the given state.
	 * @param state The state to set as the start state.
	 */
	#set_start_state(state: StateDefinition): void {
		this.start_state_id = state.id;
	}

	/**
	 * Appends a state to the list of states defined for this state machine.
	 * @param state The state to append.
	 * @throws An error if the state is missing an id or if a state with the same id already exists for this state machine.
	 */
	public replace_partialsdef_with_sdef(state: StateDefinition, root: StateDefinition): void {
		if (!state.id) throw new Error(`'sdef' is missing an id, while attempting to add it to this 'sdef'!`);
		// if (this.states[state.id]) throw new Error(`'sdef' with id='${state.id}' already exists for this 'sdef'!`);
		if (this.#is_start_state(state)) { // If the state is a start state, set it as the start state
			state.id = state.id.substring(1); // Remove the start state prefix from the id
			this.#set_start_state(state); // Set the start state for the state machine
		}
		this.states[state.id] = state;
		state.parent = this;
		state.root = root;
	}
}
