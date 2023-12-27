import { exclude_save, insavegame, onload } from './gameserializer';
import { IIdentifiable, IRegisterable, Identifier } from './bmsx';
import { BaseModel } from './basemodel';
import { EventScope, IEventSubscriber } from './eventemitter';

/**
 * Represents the machine definitions.
 */
export var StateDefinitions: Record<string, sdef>;

/**
 * A record that maps string keys to functions that build machine states.
 */
var StateDefinitionBuilders: Record<string, () => StateMachineBlueprint>;

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
		updateAllAssignedFSMs(constructor);
	};
}

/**
 * Updates all assigned FSMs for the given constructor.
 *
 * @param constructor - The constructor function.
 */
function updateAllAssignedFSMs(constructor: any) {
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
export function setup_fssdef_library(): void {
	StateDefinitions = {};
	for (let machine_name in StateDefinitionBuilders) {
		let machine_definition = StateDefinitionBuilders[machine_name]();
		if (machine_definition) {
			const machineBuilt = createMachine(machine_name, machine_definition);
			validateStateMachine(machineBuilt); // Check if the machine definition is valid before adding it to the library of machine definitions
			StateDefinitions[machine_name] = machineBuilt; // Add the machine definition to the library of machine definitions
			addEventListToDefinition(machineBuilt); // Add the events to the event list of the machine definition
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
function createMachine(machine_name: Identifier, machine_definition: StateMachineBlueprint): sdef {
	// If the machine has states defined, create a new machine definition for each state
	return new sdef(machine_name, machine_definition);
}

function addEventListToDefinition(machine: StateMachineBlueprint): void {
	// If the machine has events defined, add them to the event list of the machine definition
	const eventMap = getStateMachineEvents(machine); // Get the events from the machine definition
	if (eventMap && eventMap.size > 0) {
		machine.event_list = []; // Create a new event list for the machine definition
		eventMap.forEach(event_entry => { // Add the events to the event list of the
			machine.event_list.push({ name: event_entry.name, scope: event_entry.scope }); // Add the event to the event list of the machine definition
			console.info(`Added event '${event_entry.name}' with scope '${event_entry.scope}' to machine '${machine.id}'.`); // Log that the event was added to the machine definition
		});
	}
	else console.info(`No events defined for machine '${machine.id}'.`); // Log that no events were defined for the machine definition
}

function getStateMachineEvents(machine: StateMachineBlueprint, eventNamesAndScopes?: Set<listed_sdef_event>) {
	function add(name: string, scope: string): void {
		if (events.has({ name: name, scope: 'all' })) return; // If the event is already in the set, and the scope is global, don't add it again
		if (events.has({ name: name, scope: scope })) return; // If the event is already in the set, and the scope is the same, don't add it again
		events.add({ name: name, scope: scope });
	}

	const events = eventNamesAndScopes ?? new Set<listed_sdef_event>();
	for (const stateId in machine.states) {
		const state = machine.states[stateId];
		const state_def = state;
		if (!state_def) continue;
		if (state_def.on) {
			for (const name in state_def.on) {
				const definition = state_def.on[name];
				if (typeof definition === 'string') {
					add(name, 'all');
				}
				else {
					add(name, definition.scope ?? 'self');
				}
			}
		}
		// If the state has a submachine, recursively subscribe to its events
		if (state_def.states) {
			getStateMachineEvents(state, events);
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
function validateStateMachine(machinedef: sdef): void {
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

/**
 * Represents a type definition for mapping IDs to `sdef` objects.
 */
export type id2sdef = Record<Identifier, sdef>;

/**
 * Represents a mapping of IDs to state contexts.
 */
export type id2mstate = Record<Identifier, sstate>;

/**
 * Represents a mapping of IDs to sstates.
 */
export type id2sstate = Record<Identifier, sstate>;


/**
 * The states defined for this state machine (key = state id, value = partial state definition), their substate machines and their additional properties are defined in {@link sdef}.
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
export type StateMachineBlueprint = Partial<sdef>;

/**
 * A type representing a mapping of state IDs to partial state definitions.
 */
export type id2partial_sdef = Record<string, StateMachineBlueprint>;

export interface state_event_condition<T extends IStateful & IEventSubscriber = any> extends state_event_handler<T> {
	(state: sstate<T>, ...args: any[]): boolean;
}

type listed_sdef_event = { name: string, scope: EventScope };

export type StateEventDefinition<T extends IStateful & IEventSubscriber = any> = {
	/**
	 * The state ID to transition to. If not provided, the state will not transition. This is useful for defining a "transition" that only executes an action.
	 */
	to?: Identifier,

	/**
	 * The condition that must be met for the transition to occur.
	 */
	if?: state_event_condition<T>,

	/**
	 * The action that is executed when the transition occurs.
	 */
	do?: state_event_handler<T>,

	/**
	 * (Optional) The ID of the emitter scope. If provided, the listener will be added to the emitter scope listeners, otherwise it will be added to the global scope listeners.
	 */
	scope?: EventScope,
};

/**
 * Represents a state event handler function.
 * @param state - The state object.
 * @param type - The type of state event.
 * @returns The result of the state event handler.
 */
export interface state_event_handler<T extends IStateful = any> { (state: sstate<T>, ...args: any[]); }

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

export interface IStateful extends IRegisterable, IEventSubscriber {
	/**
	 * The StatemachineController of the object.
	 */
	sc: bfsm_controller;
}

/**
 * Type used for getting all the states of a nested object containing both the machines as well as the inner states per machine. Allows for type checking state-names without having to create a type per machine.
 * @see https://www.raygesualdo.com/posts/flattening-object-keys-with-typescript-types
 */
// export type FlattenedPropKeys<T extends Record<string, unknown>, Key = keyof T> = Key extends string ? T[Key] extends Record<string, unknown> ? FlattenedPropKeys<T[Key]> : Key : never;
// export type Bla<T extends id2partial_sdef, Key = keyof T> = Key extends string ? Key : never;
export type Bla<T extends id2partial_sdef> = keyof T;

@insavegame
export class bfsm_controller {
	/**
	 * The substate object that holds the state context for each substate.
	 */
	statemachines: Record<Identifier, sstate>;

	public get machines(): Record<string, sstate> {
		return new Proxy(this.statemachines, {
			get: (target, prop: string) => {
				if (target[prop]) {
					return target[prop];
				}
				throw new Error(`No machine with ID '${prop}'`);
			}
		});
	}

	current_machine_id: Identifier;

	get current_machine(): sstate { return this.statemachines[this.current_machine_id]; }

	get current_state(): sstate { return this.current_machine.current; }

	get states(): id2sstate { return this.current_machine.states; }

	get definition(): sdef { return this.current_machine.definition; }

	constructor() {
		this.statemachines = {};
	}

	public dispose(): void {
		// Deregister all machines
		for (let id in this.statemachines) {
			this.statemachines[id].dispose();
		}
	}

	start(): void {
		this.initLoadSetup();
	}

	@onload
	initLoadSetup(): void {
		for (const id in this.statemachines) {
			const machine = this.statemachines[id];

			// Subscribe to all events that are defined in the machine definition for the machine and its submachines
			const events = machine.definition?.event_list;
			if (events && events.length > 0) {
				events.forEach(event => {
					let scope = event.scope ?? 'self';
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
					game.event_emitter.on(event.name, this.auto_dispatch, machine.target, scope);
				});
			}
			machine.start();
		}
	}

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
		machine.to(stateids, ...args);
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
		const [machineid, ...stateids] = path.split('.');

		const machine = this.statemachines[machineid];
		if (!machine) throw new Error(`No machine with ID '${machineid}'`);

		// If no stateid is specified, assume that the stateid is the same as the machineid
		const stateid = stateids.length > 0 ? stateids.join('.') : machineid;

		// Only switch the state in the specified machine, without changing the current machine
		machine.switch(stateid, ...args);
	}

	public dispatch(event_name: string, emitter: Identifier | IIdentifiable, ...args: any[]): void {
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

	private auto_dispatch(this: IStateful, event_name: string, emitter: Identifier | IIdentifiable, ...args: any[]): void {
		const emitter_id = typeof emitter === 'string' ? emitter : emitter.id;

		// Dispatch the event to the current machine
		this.sc.current_machine.dispatch(event_name, emitter_id, ...args); // Note: this.sc is the state machine controller of the object that is subscribed to the event

		// Dispatch the event to all machines that are running in parallel with the current machine (i.e., all parallel machines except the current machine)
		for (const id in this.sc.statemachines) { // Note: this.sc is the state machine controller of the object that is subscribed to the event
			if (this.sc.current_machine_id === id) continue; // Skip the current machine, as the event has already been dispatched to that machine
			if (this.sc.statemachines[id].paused) continue; // Skip paused machines
			if (!this.sc.statemachines[id].parallel) continue; // Skip machines that are not running in parallel
			this.sc.statemachines[id].dispatch(event_name, emitter_id, ...args);
		}
	}

	/**
	 * Adds a state machine to the Bfsm instance.
	 *
	 * @param id - The ID of the state machine.
	 * @param target_id - The ID of the target machine.
	 * @param parent_id - The ID of the target object.
	 */
	add_statemachine(id: Identifier, target_id: Identifier): void {
		this.statemachines[id] = sstate.create(id, target_id, target_id);
		// If this is the first id that was added, set it as the current machine
		if (!this.current_machine_id) this.current_machine_id = id;
	}

	/**
	 * Gets the state machine with the given ID.
	 * @param id - The ID of the state machine.
	 * @returns The state machine with the given ID.
	 */
	get_statemachine(id: Identifier): sstate {
		return this.statemachines[id];
	}

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
		return machine.is(stateids.join('.'));
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
		for (let id in this.statemachines) {
			this.statemachines[id].run();
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
		for (let id in this.statemachines) {
			this.statemachines[id].reset();
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
		for (let id in this.statemachines) {
			this.statemachines[id].pop();
		}
	}

	/**
	 * Sets the state of the state machine with the given ID to the state with the given ID.
	 * @param id - The ID of the state machine.
	 * @param stateid - The ID of the state.
	 */
	switch_state(id: Identifier, stateid: Identifier): void {
		this.statemachines[id].to(stateid);
	}

	pause_statemachine(id: Identifier): void {
		this.statemachines[id].paused = true;
	}

	pause_all_statemachines(): void {
		for (let id in this.statemachines) {
			this.statemachines[id].paused = true;
		}
	}

	pause_all_except(id: Identifier): void {
		for (let _id in this.statemachines) {
			if (_id === id) continue;
			this.statemachines[_id].paused = true;
		}
	}

	resume_statemachine(id: Identifier): void {
		this.statemachines[id].paused = false;
	}

	resume_all_statemachines(): void {
		for (let id in this.statemachines) {
			this.statemachines[id].paused = false;
		}
	}
}

/**
 * Represents the context of a state in a finite state machine.
 * Contains information about the current state, the state machine it belongs to, and any substate machines.
 */
interface IStateController extends IRegisterable {
	run(): void;
	switch(path: string, ...args: any[]): void;
	to(path: string, ...args: any[]): void;
	is(path: string): boolean;
	pop(): void;
	states: id2sstate;
	current: sstate;
	currentid: Identifier;
	get start_state_id(): Identifier;
}

@insavegame
/**
 * Represents a state in a state machine.
 * @template T - The type of the game object or model associated with the state.
 */
export class sstate<T extends IStateful & IEventSubscriber & IRegisterable = any> implements IStateController, IIdentifiable {
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

	public get parent() { return game.registry.get(this.parent_id); }

	/**
	 * The unique identifier for the bfsm.
	 */
	def_id: Identifier;

	/**
	 * Represents the states of the Bfsm.
	 */
	states: id2sstate;

	/**
	 * Indicates whether the state machine is running in parallel with the 'current' state machine as defined in {@link bfsm_controller.current_machine}.
	 */
	get parallel(): boolean { return this.definition?.parallel; }

	/**
	 * Identifier of the current state.
	 */
	currentid!: Identifier; // Identifier of current state

	/**
	 * History of previous states.
	 */
	history!: Array<string>; // History of previous states

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
	public get target(): T { return game.registry.get<T>(this.target_id); }

	/**
	 * Returns the current state of the FSM
	 */
	public get current(): sstate { return this.states?.[this.currentid]; }

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
	public get definition(): sdef { return this.parent ? this.parent.definition.states[this.def_id] : StateDefinitions[this.def_id]; }

	/**
	 * Gets the id of the start state of the FSM.
	 * @returns The id of the start state of the FSM.
	 */
	public get start_state_id(): Identifier { return this.definition?.start_state_id; }

	/**
	 * Gets the definition of the current state of the FSM.
	 * Note that the definition can be empty, as not all objects have a defined machine.
	 */
	public get current_state_definition(): sdef {
		return this.current?.definition;
	}

	/**
	 * Factory for creating new FSMs.
	 * @param id - id of the FSM definition to use for this machine.
	 * @param target_id - id of the object that is stated by this FSM. @see {@link BaseModel.getGameObject}.
	 */
	public static create(id: Identifier, target_id: Identifier, parent_id: Identifier): sstate {
		let result = new sstate(id, target_id, parent_id);
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
	constructor(def_id: Identifier, target_id: Identifier, parent_id: Identifier) {
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
			this.onLoadSetup();
		}
	}

	@onload
	public onLoadSetup(): void {
		game.registry.register(this);
		// this.target.on('destroy', this.dispose, this.target.id);

	}

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
		const definition = this.definition;
		if (!definition) return; // If there is no definition, there is nothing to run
		if (this.paused) return;

		// First process any input
		definition.process_input?.call(this.target, this);
		// Then, run the substate
		definition.run?.call(this.target, this);
		if (definition.auto_tick) ++this.ticks; // Auto-nudge the state if auto_nudge is set to true

		// Then run the submachine for the state if it exists
		if (!this.states) return; // If there are no states defined, there is no submachine to run and we can return early

		this.current.run(); // Run the current state of the substate machine

		// Run all substate machines that have 'parallel' set to true
		for (const id in this.states) {
			// Skip the current machine, as it has already been run
			if (id === this.currentid) continue;
			if (this.states[id].parallel) this.states[id].run();
		}
	}

	/**
	 * Transition to a new state identified by the given ID.
	 * If no parts are provided, the ID will be split by '.' to determine the parts.
	 * @param id - The ID of the state to transition to.
	 * @param parts - Optional array of parts that make up the ID.
	 * @throws Error if the state with the given ID does not exist.
	 */
	public to(id: string, ...args: any[]): void {
		const parts: string[] = id.split('.');
		let currentPart = parts[0];
		let restParts = parts.slice(1);

		let currentContext: IStateController = this.states[currentPart];
		if (!currentContext) {
			throw new Error(`No state with ID '${currentPart}'`);
		}

		if (this.currentid !== currentPart || restParts.length === 0) { // Don't switch to the same state, except if this is the final part of the id
			this.transitionToState(currentPart, ...args);
		}

		// If there are more parts, transition to the next state
		if (restParts.length > 0) {
			currentContext.to(restParts.join('.'), ...args);
		}
	}

	public transition(state_id: Identifier, ...args: any[]): void {
		if (this.def_id === state_id) return; // Don't switch to the same state
		this.parent.switch(state_id, ...args);
	}

	/**
	 * Checks if the current state matches the given path.
	 *
	 * @param path - The path to the desired state, represented as a dot-separated string.
	 * @returns true if the current state matches the path, false otherwise.
	 * @throws Error if no machine with the specified ID is found.
	 */
	public is(id: string): boolean {
		const [stateid, ...substateids] = id.split('.');

		// If there are no more parts, check the id of the current state
		if (substateids.length === 0) {
			return this.currentid === stateid;
		}

		const state = this.states[stateid];
		if (!state) {
			throw new Error(`No state with ID '${stateid}'`);
		}

		// If there are more parts, check the state of the substate with the given path
		return state.is(substateids.join('.'));
	}

	/**
	 * Switches the state of the state machine to the specified ID.
	 * If the ID contains multiple parts separated by '.', it traverses through the states accordingly and only switches the state of the last part.
	 * If the state ID is '*', it switches all states and substates.
	 * Performs exit actions for the current state and enter actions for the new current state.
	 * Throws an error if the state with the specified ID doesn't exist.
	 *
	 * @param path - The ID of the state to switch to.
	 * @returns void
	 * @throws Error - If the state with the specified ID doesn't exist.
	 */
	public switch(path: string, ...args: any[]): void {
		const [currentPart, ...restParts] = path.split('.');

		if (currentPart === '*') {
			// Iterate over all states and substates
			for (let stateid in this.states) {
				const currentContext = this.states[stateid] as IStateController;
				if (!currentContext) continue;

				// Remove the '*' from the id and continue with the rest of the path
				if (restParts.length > 1) {
					currentContext.switch(restParts.join('.'), ...args);
				}
				// If the wildcard is just before the final part, switch to the state
				else if (restParts.length === 1) {
					currentContext.switch(restParts[0], ...args);
				}
			}
		} else {
			let currentContext: IStateController = this.states[currentPart];
			if (!currentContext) {
				throw new Error(`No state with ID '${currentPart}'`);
			}

			// If there are more parts, continue to the next state
			if (restParts.length > 0) {
				currentContext.switch(restParts.join('.'), ...args);
			} else {
				this.transitionToState(currentPart, ...args);
			}
		}
	}

	private transitionToState(stateId: string, ...args: any[]): void {
		// Perform exit actions for the current state
		let stateDef = this.current_state_definition;
		stateDef?.exit?.call(this.target, this.current, ...args);
		stateDef && this.pushHistory(this.currentid);

		// Update the current state
		this.currentid = stateId;
		if (!this.current) throw new Error(`State '${stateId}' doesn't exist for this state machine '${this.def_id}'!`);

		// Perform enter actions for the new current state
		stateDef = this.current_state_definition;
		stateDef?.enter?.call(this.target, this.current, ...args);
	}

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
			// console.info(`Event ${eventName} dispatched by ${emitter_id} at state ${this.id}`);

			// Bubble up the event to the parent states
			let current = this;
			do {
				if (current.handleEvent(eventName, emitter_id, ...args)) {
					// console.warn(`Event '${eventName}' gobbled up by '${current.id}'!`);
					return; // If the event was handled, stop bubbling up the event
				}
				current = current.parent;
				// console.info(`Event '${eventName}' bubbled up to state '${current?.id ?? 'the great void! This is the end of the line!'}'`);
			} while (current);
		}
	}

	private handleEvent(eventName: string, emitter_id: Identifier, ...args: any[]): boolean {
		// If the state machine is paused, do not process the event
		if (this.paused) {
			return false; // Return false to indicate that the event was not handled
		}

		// Check if the 'on' property of the state's definition contains a transition for the event
		const state_id_or_handler = this.definition?.on?.[eventName];
		if (state_id_or_handler) {
			if (typeof state_id_or_handler === 'string') {
				// If the handler is a string, treat it as a state ID and transition to that state
				this.transition(state_id_or_handler, ...args); // Transition to the state with the given ID and pass the arguments to the state transition function
				// Note: the state transition function will handle the enter and exit events for the states, but not if the state is the same as the current state
			} else {
				// If the handler is a StateTransition object (i.e., an object with an 'if' and 'do' handler), call the 'if' handler and if it returns true, call the 'do' handler and transition to the target state
				const ifHandler = state_id_or_handler.if; // Get the if-handler from the state transition object
				const doHandler = state_id_or_handler.do; // Get the do-handler from the state transition object
				const emitterId = state_id_or_handler.scope; // (Optional) The ID of the emitter scope. If provided, the listener will be added to the emitter scope listeners, otherwise it will be added to the global scope listeners.
				const targetStateId = state_id_or_handler.to; // Get the target state ID from the state transition object

				// If the emitter ID is provided and it is not the same as the emitter ID of the event, do nothing
				if (emitterId && emitterId !== emitter_id) {
					return false; // Return false to indicate that the event was not handled
				}

				// If the emitter ID is not provided or it is the same as the emitter ID of the event, call the if-handler
				if (ifHandler && !ifHandler.call(this.target, this as sstate<T>, ...args)) {
					// If the if-handler exists and returns false, do nothing
					return false; // Return false to indicate that the event was not handled
				}

				// If the if-handler does not exist or returns true, call the do-handler
				doHandler?.call(this.target, this as sstate<T>, ...args);
				// Transition to the target state if it is defined and not the same as the current state ID (otherwise, do nothing)
				targetStateId && this.transition(targetStateId, ...args);
			}
			return true; // Return true to indicate that the event was handled
		}

		return false; // Return false if the event was not handled (it will bubble up to the parent state)
	}

	/**
	 * Adds the given state ID to the history stack, which tracks the previous states of the state machine.
	 * If the history stack exceeds the maximum length, the oldest state is removed from the stack.
	 * @param toPush - the state ID to add to the history stack
	 */
	protected pushHistory(toPush: string): void {
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
			let state = new sstate(sdef_id, this.target_id, this.id);
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
	private add(...states: sstate[]): void {
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
	public get current_tape_value(): any { return (this.tape && this.head < this.tape.length) ? this.tape[this.head] : undefined; };
	public get at_tapeend(): boolean { return !this.tape || this.head >= this.tape.length - 1; } // Note that beyond end also returns true if there is no tape!
	/**
	 * Determines whether the tape head is currently beyond the end of the tape.
	 * Returns true if the tape head is beyond the end of the tape or if there is no tape, false otherwise.
	 * Note that this function assumes that the tape head is within the bounds of the tape.
	 */
	protected get beyond_tapeend(): boolean { return !this.tape || this.head >= this.tape.length; } // Note that beyond end also returns true if there is no tape!
	// Determines whether the tape head is currently at the start of the tape.
	// Returns true if the tape head is at the start of the tape, false otherwise.
	// Note that this function assumes that the tape head is within the bounds of the tape.
	public get at_tape_start(): boolean { return this.head === 0; }

	/**
	 * Retrieves the target object as the specified type.
	 *
	 * @returns The target object casted to the specified type.
	 * @template T - The type to cast the target object to.
	 */
	public targetAs<T>(): T { return <T>game.registry.get(this.target_id); }

	private make_id(): Identifier {
		let id = `${this.parent_id ?? this.target_id}.${this.def_id}`; // The id is the parent_id + the target_id + the def_id (e.g. 'parent_id.target_id.def_id') to create a unique id
		// let parts = id.split('.'); // Split the id into parts to remove duplicate parts and create a unique id
		// let uniqueParts = parts.filter((value, index, self) => self.indexOf(value) === index); // Remove duplicate parts (e.g. 'parent_id.parent_id.def_id' becomes 'parent_id.def_id')
		// return uniqueParts.join('.'); // Join the parts together with a '.' in between each part to create the id for the state
		return id;
	}

	public dispose(): void {
		game.registry.deregister(this);
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
		this._ticks = 0; // Always reset tapehead ticks after moving tapehead
		this._tapehead = v; // Move the tape to new position

		// Check if the tapehead is going out of bounds (or there is no tape at all)
		if (!this.tape) {
			this._tapehead = 0;

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
				this._tapehead = 0;
			}
			else {
				// Set the tapehead to the end of the tape (or 0 if there is no tape)
				this._tapehead = this.tape.length - 1;
			}
			// Trigger the event for moving the tape, after having set the tapehead to the correct position
			this.tapemove();

			// Trigger the event for reaching the end of the tape
			this.tapeend();
		}
		else {
			// Trigger the event for moving the tape. This is executed when no tapehead correction was required
			this.tapemove();
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

	// Triggers the `next` event of the state machine definition, passing this state and the `state_event_type.Next` event type as arguments.
	protected tapemove() {
		this.definition.next?.call(this.target, this as sstate<T>, undefined);
	}

	/**
	 * Triggers the `end` event of the state machine definition, passing this state and the `state_event_type.End` event type as arguments.
	 */
	protected tapeend() {
		this.definition.end?.call(this.target, this as sstate<T>, undefined);
	}

	/**
	 * Resets the state machine by setting the tapehead and ticks to 0 and the ticks2move to the value defined in the state machine definition.
	 */
	public reset(reset_tree: boolean = true): void {
		this._tapehead = 0; // Reset the tapehead to the beginning of the tape
		this._ticks = 0; // Reset the ticks
		if (!this.definition) return; // No definition exists for the empty 'none'-state
		this.data = { ...this.definition.data }; // Reset the state data by shallow copying the definition's data
		if (reset_tree) this.resetSubmachine(); // Reset the substate machine if it exists
	}

	// Resets the state machine to its initial state.
	// If a start state is defined in the state machine definition, the current state is set to that state.
	// Otherwise, the current state is set to the 'none' state.
	// The history of previous states is cleared and the state machine is unpaused.
	public resetSubmachine(reset_tree: boolean = true): void {
		this.reset(false);
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
				this.states[state].resetSubmachine(reset_tree);
			}
		}
	}
}

/**
 * Represents a state definition for a state machine.
 */
export class sdef {
	public data?: { [key: string]: any };

	/**
	 * The unique identifier for the bfsm.
	 */
	public id: Identifier;

	/**
	 * The tape used by the BFSM.
	 */
	public tape!: Tape;

	/**
	 * Number of runs before tapehead moves to next statedata.
	 */
	public ticks2move: number; // Number of runs before tapehead moves to next statedata

	/**
	 * Specifies whether the tapehead should automatically rewind to index 0 when it reaches the end of the tape.
	 * If set to true, the tapehead will be set to index 0 when it would go out of bounds.
	 * If set to false, the tapehead will remain at the end of the tape.
	 */
	public auto_tick: boolean; // Automagically increase the ticks during run
	public auto_rewind_tape_after_end: boolean; // Automagically set the tapehead to index 0 when tapehead would go out of bound. Otherwise, will remain at end
	public repetitions: number; // Number of times the tape should be repeated

	@exclude_save
	public parent!: sdef;

	public event_list: { name: string, scope: EventScope }[];

	/**
	 * Constructs a new instance of the `bfsm` class.
	 * @param id - The ID of the `bfsm` instance.
	 * @param partialdef - An optional partial definition to assign to the `bfsm` instance.
	 */
	public constructor(id: Identifier = '_', partialdef?: Partial<sdef>) {
		this.id = id; //`${parent_id ? (parent_id + '.') : ''}${id ?? DEFAULT_BST_ID}`;
		partialdef && Object.assign(this, partialdef); // Assign the partial definition to the instance
		this.ticks2move ??= 0; // Unless already defined, ticks2move is 0
		this.repetitions = (this.tape ? (this.repetitions ?? 1) : 0);
		this.auto_tick = this.auto_tick ?? (this.ticks2move !== 0 ? true : false); // If ticks2move is 0, auto_tick is false. Otherwise, auto_tick is true (unless it was already defined)
		this.auto_rewind_tape_after_end = this.auto_rewind_tape_after_end ?? (this.tape ? true : false); // If there is a tape, auto_rewind_tape_after_end is true. Otherwise, it is false (unless it was already defined)
		this.data ??= {}; // Unless already defined, data is an empty object

		if (this.tape) {
			this.repeat_tape(this.tape, this.repetitions);
		}

		if (partialdef.states) {
			this.construct_substate_machine(partialdef.states);
		}
	}

	private repeat_tape(tape: typeof this.tape, repetitions: typeof this.repetitions): void {
		// Repeat the tape if necessary (and if it exists) by appending the tape to itself
		if (tape && repetitions > 1) { // If there is a tape and the tape should be repeated at least once
			let originalTape = [...tape]; // Copy the tape
			for (let i = 1; i < repetitions; i++) { // Repeat the tape
				tape.push(...originalTape); // Append the tape to itself
			}
		}
	}

	private construct_substate_machine(substates: StateMachineBlueprint): void {
		this.states ??= {};
		const substate_ids = Object.keys(substates);
		for (let state_id of substate_ids) {
			const sub_sdef = this.#create_state(substates[state_id], state_id);
			validateStateMachine(sub_sdef as sdef);
			this.replace_partialsdef_with_sdef(sub_sdef);
		}
		if (substate_ids.length > 0 && !this.start_state_id) { // Only look for a start state if we have at least one state in our definition
			this.start_state_id = substate_ids[0]; // If no default state was defined, we default to the first state found in the list of states
			// If the start state is not defined, we don't need to change the key of the start state
		}
		else {
			// If the start state is defined, we need to change the key of the start state to exclude the start state prefix
			const start_state = this.states[this.start_state_id]; // Get the start state
			for (const state_id of substate_ids) {
				if (sdef.START_STATE_PREFIXES.includes(state_id.charAt(0))) { // If the state id starts with a start state prefix
					delete this.states[state_id]; // Delete the start state from the list of states (with the old key)
					this.states[start_state.id] = start_state; // Add the start state to the list of states (with the new key)
					break; // Stop iterating over the states
				}
			}
		}
	}

	public run?: state_event_handler;
	public end?: state_event_handler;
	public next?: state_event_handler;
	public enter?: state_event_handler;
	public exit?: state_event_handler;
	public process_input?: state_event_handler;

	/**
	 * Represents the mapping of event types to state IDs for transitions to other states based on events (e.g. 'click' => 'idle').
	 * At the individual state level, the `on` property defines the transitions that can occur from that specific state.
	 */
	public on?: { [key: string]: Identifier | StateEventDefinition };

	/**
	 * The states defined for this state machine.
	 */
	public states?: id2partial_sdef;

	/**
	 * Indicates whether the state machine is running in parallel with the 'current' state machine as defined in {@link bfsm_controller.current_machine}.
	 */
	public parallel?: boolean;

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
	#create_state(partial: Partial<sdef>, state_id: Identifier): sdef {
		if (!partial) throw new Error(`'sdef' with id '${state_id}' is missing definition while attempting to add it to this 'sdef'!`);
		return new sdef(state_id, partial);
	}

	/**
	 * Determines if a given state is the start state.
	 * @param state The state to check.
	 * @returns True if the state is the start state, false otherwise.
	 */
	#is_start_state(state: sdef): boolean {
		return sdef.START_STATE_PREFIXES.includes(state.id.charAt(0)); // Return true iff the first character of the state id is a start state prefix
	}

	/**
	 * Sets the start state of the state machine to the given state.
	 * @param state The state to set as the start state.
	 */
	#set_start_state(state: sdef): void {
		this.start_state_id = state.id;
	}

	/**
	 * Appends a state to the list of states defined for this state machine.
	 * @param state The state to append.
	 * @throws An error if the state is missing an id or if a state with the same id already exists for this state machine.
	 */
	public replace_partialsdef_with_sdef(state: sdef): void {
		if (!state.id) throw new Error(`'sdef' is missing an id, while attempting to add it to this 'sdef'!`);
		// if (this.states[state.id]) throw new Error(`'sdef' with id='${state.id}' already exists for this 'sdef'!`);
		if (this.#is_start_state(state)) { // If the state is a start state, set it as the start state
			state.id = state.id.substring(1); // Remove the start state prefix from the id
			this.#set_start_state(state); // Set the start state for the state machine
		}
		this.states[state.id] = state;
		state.parent = this;
	}

}
