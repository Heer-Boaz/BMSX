import { exclude_save, insavegame, onload } from "./gameserializer";
import { IIdentifiable, IRegisterable, Identifier } from "./bmsx";
import { BaseModel } from "./basemodel";
import { Registry } from "./registry";

/**
 * Represents the machine definitions.
 */
export var StateDefinitions: Record<string, sdef>;

/**
 * A record that maps string keys to functions that build machine states.
 */
var StateDefinitionBuilders: Record<string, () => machine_states>;

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
 * Decorator function that builds a finite state machine definition.
 * @param target - The class that the member is on.
 * @param name - The name of the member in the class.
 * @param descriptor - The member descriptor; This is essentially the object that would have been passed to Object.defineProperty.
 * @returns The decorated function.
 */
export function statedef_builder(target: any, _name: any, descriptor: PropertyDescriptor): any {
	StateDefinitionBuilders ??= {};
	StateDefinitionBuilders[target.name] = descriptor.value;
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
			createMachine(machine_name, machine_definition);
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
function createMachine(machine_name: Identifier, machine_definition: machine_states): void {
	// // If the machine_definition has states, create a new machine definition for each state
	// if (machine_definition.states) {
	// 	for (let stateId in machine_definition.states) { // Loop through all states in the machine definition
	// 		const state = machine_definition.states[stateId]; // Get the state definition

	// 		// If the state has substates, create a new machine definition for each substate
	// 		if (state.states) {
	// 			// Create a new submachine_id for the substate and set it in the state definition
	// 			let submachine_id = generateSubmachineId(machine_name, stateId); // The submachine_id is the machine_name + the stateId
	// 			state.submachine_id = submachine_id; // Set the submachine_id in the state definition

	// 			// Create a new machine with the substate's states
	// 			let submachine_definition: machine_states = { states: state.states }; // Create a new machine definition with the substate's states
	// 			createMachine(submachine_id, submachine_definition); // Create a new machine with the substate's states
	// 		}
	// 	}
	// }
	// Create a new machine definition object with the machine name and definition and add it to the library of machine definitions
	let machineBuilt = new sdef(machine_name, machine_definition as Partial<sdef>);
	validateStateMachine(machineBuilt); // Check if the machine definition is valid before adding it to the library of machine definitions
	StateDefinitions[machine_name] = machineBuilt; // A class might choose not to create a new machine
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
				if (!stateNames.includes(targetState)) { // Check if the target state exists
					throw new Error(`Invalid event transition target '${targetState}' in state '${state}'.`);
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

// // Function to generate a new submachine_id
// function generateSubmachineId(machine_name: Identifier, stateId: Identifier): string {
// 	if (sdef.START_STATE_PREFIXES.includes(stateId.charAt(0))) {
// 		stateId = stateId.slice(1);
// 	}
// 	if (sdef.START_STATE_PREFIXES.includes(machine_name.charAt(0))) {
// 		machine_name = machine_name.slice(1);
// 	}

// 	let id = `${machine_name}.${stateId}`; // The submachine_id is the machine_name + the stateId (e.g. 'machine_name.stateId') to create a unique submachine_id
// 	let parts = id.split('.'); // Split the id into parts to remove duplicate parts and create a unique submachine_id
// 	let uniqueParts = parts.filter((value, index, self) => self.indexOf(value) === index); // Remove duplicate parts
// 	return uniqueParts.join('.'); // Join the parts together with a '.' in between each part to create the submachine_id for the substate machine definition
// }

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
/**
 * The ID representing the none state.
 */
export const NONE_STATE_ID = '_none';

export interface IStateful extends IRegisterable {
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
				throw new Error(`No machine with ID "${prop}"`);
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
		for (const id in this.statemachines) {
			this.statemachines[id].start();
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
	 * Switches both statemachine and state, based on the newstate which is a combination of statemachine and state, written as "statemachine.state.substate...".
	 * If no stateid is specified, assume that the stateid is the same as the machineid.
	 * If no machineid is specified, assume that the machineid is the same as the current machine.
	 * If the machine is not running in parallel, set it as the current machine. Otherwise, only switch the state in the specified machine, without changing the current machine.
	 * Throws an error if no machine with the specified ID exists.
	 * @param newstate The new state to switch to, in the format "statemachine.state.substate".
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
		if (!machine) throw new Error(`No machine with ID "${machineid}"`);
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
	 * @param path - The path to the state machine and state ID, separated by a dot (e.g., "machineID.stateID").
	 * @param args - Additional arguments to pass to the state switch function.
	 */
	switch(path: string, ...args: any[]): void {
		const [machineid, ...stateids] = path.split('.');

		const machine = this.statemachines[machineid];
		if (!machine) throw new Error(`No machine with ID "${machineid}"`);

		// If no stateid is specified, assume that the stateid is the same as the machineid
		const stateid = stateids.length > 0 ? stateids.join('.') : machineid;

		// Only switch the state in the specified machine, without changing the current machine
		machine.switch(stateid, ...args);
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
			throw new Error(`No machine with ID "${machineid}"`);
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
export class sstate<T extends IStateful = IStateful> implements IStateController, IIdentifiable {
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

	public get parent() { return Registry.instance.get(this.parent_id); }

	/**
	 * The unique identifier for the bfsm.
	 */
	def_id: Identifier;

	/**
	 * Represents the states of the Bfsm.
	 */
	states: id2sstate;

	/**
	 * Indicates whether the state machine is running in parallel with the "current" state machine as defined in {@link bfsm_controller.current_machine}.
	 */
	get parallel(): boolean { return this.definition.parallel; }

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
	 * Represents the mapping of event types to state IDs for transitions to other states based on events (e.g. 'click' => 'idle').
	 * At the individual state level, the `on` property defines the transitions that can occur from that specific state.
	 */
	public on?: { [key: string]: Identifier };

	/**
	 * Represents the state data for the state machine that is shared across its states.
	 */
	public data: { [key: string]: any } = {};

	/**
	 * Returns the game object or model that this state machine is associated with.
	 */
	public get target(): IStateful { return Registry.instance.get(this.target_id); }

	/**
	 * Returns the current state of the FSM
	 */
	public get current(): sstate { return this.states[this.currentid]; }

	/**
	 * Gets the state with the given id from the state machine.
	 * Used for referencing states from within the state instance, instead
	 * of referencing states from the state machine definition.
	 * @param id - id of the state, according to its definition
	 */
	public get_sstate(id: Identifier) { return this.states[id]; }

	/**
	 * Gets the definition of the current state machine.
	 * @returns The definition of the current state machine.
	 */
	public get definition(): sdef { return this.parent ? this.parent.definition.states[this.def_id] : StateDefinitions[this.def_id]; }

	/**
	 * Gets the id of the start state of the FSM.
	 * @returns The id of the start state of the FSM.
	 */
	public get start_state_id(): Identifier { return this.parent ? this.parent.definition.states[this.def_id]?.start_state_id : NONE_STATE_ID; }

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
		result.populateStates();

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
		this.states ??= {};
		this.paused ??= false;

		// Note: when parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
		if (def_id && target_id) {
			this.id = this.make_id();
			this.register();
			this.reset(false);
			// const substateDefinition = this.definition?.submachine_id;
			// this.sm = substateDefinition ? sstate.create(substateDefinition, this.target_id, this.parent_id) : undefined;
		}
	}


	@onload
	public register(): void {
		Registry.instance.register(this);
	}

	public start(): void {
		const startStateId = this.start_state_id;
		if (!startStateId) {
			throw new Error(`No start state defined for state machine '${this.def_id}'`);
		}

		const startStateDef = this.get_sstate(startStateId)?.definition;

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
	public run(): void {
		if (this.paused) return;
		// [this.currentStatedef] can be undefined if we are in the 'none' state
		// First process any input
		let currentStatedef = this.current_state_definition;
		if (!currentStatedef) return;
		const currentState = this.current;
		currentStatedef.process_input?.call(this.target, currentState);
		// Then, run the state
		currentStatedef.run?.call(this.target, currentState);
		if (currentStatedef.auto_tick) ++currentState.ticks; // Auto-nudge the state if auto_nudge is set to true
		// Then run the submachine for the state if it exists
		currentState.run(); // Note that this will do nothing if there is no submachine
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
			throw new Error(`No state with ID "${currentPart}"`);
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
		this.parent.switch(`${state_id}}`, ...args);
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
			throw new Error(`No state with ID "${stateid}"`);
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
				throw new Error(`No state with ID "${currentPart}"`);
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
		if (!this.current) throw new Error(`State "${stateId}" doesn't exist for this state machine '${this.def_id}'!`);

		// Perform enter actions for the new current state
		stateDef = this.current_state_definition;
		stateDef?.enter?.call(this.target, this.current, ...args);
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
		let sdef = this.definition;
		if (!sdef) {
			// A class is not required to have a defined machine.
			// Thus, we create a default machine that automatically has a generated
			// 'none'-state associated with it.
			this.add(new sstate(NONE_STATE_ID, this.target_id, this.id));
		}
		else {
			for (let sdef_id in sdef.states) {
				let state = new sstate(sdef_id, this.target_id, this.id);
				this.add(state);
			}
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
	public get tape(): Tape { return this.definition.tape; }
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
	public targetAs<T>(): T { return <T>Registry.instance.get(this.target_id); }

	private make_id(): Identifier {
		let id = `${this.parent_id ?? this.target_id}.${this.def_id}`; // The id is the parent_id + the target_id + the def_id (e.g. 'parent_id.target_id.def_id') to create a unique id
		let parts = id.split('.'); // Split the id into parts to remove duplicate parts and create a unique id
		let uniqueParts = parts.filter((value, index, self) => self.indexOf(value) === index); // Remove duplicate parts (e.g. 'parent_id.parent_id.def_id' becomes 'parent_id.def_id')
		return uniqueParts.join('.'); // Join the parts together with a '.' in between each part to create the id for the state
	}

	public dispose(): void {
		Registry.instance.deregister(this);
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
		// N.B. doesn't trigger the onenter-event!
		const start = this.definition?.start_state_id; // Definition doesn't need to exist
		this.currentid = start ?? NONE_STATE_ID; // Set the current state to the start state (if it exists)
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

	/**
	 * Constructs a new instance of the `bfsm` class.
	 * @param id - The ID of the `bfsm` instance.
	 * @param partialdef - An optional partial definition to assign to the `bfsm` instance.
	 */
	public constructor(id: Identifier = '_', partialdef?: Partial<sdef>) {
		this.id = id; //`${parent_id ? (parent_id + '.') : ''}${id ?? DEFAULT_BST_ID}`;
		this.ticks2move ??= 1;
		this.repetitions ??= 1;
		this.auto_tick ??= true;
		this.auto_rewind_tape_after_end ??= true;
		this.data ??= {};
		partialdef && Object.assign(this, partialdef); // Assign the partial definition to the instance

		// Repeat the tape if necessary (and if it exists) by appending the tape to itself
		if (this.tape && this.repetitions > 1) {
			let originalTape = [...this.tape]; // Copy the tape
			for (let i = 1; i < this.repetitions; i++) { // Repeat the tape
				this.tape.push(...originalTape); // Append the tape to itself
			}
		}

		const substates = (partialdef as machine_states).states;
		if (substates) {
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
	public on?: { [key: string]: Identifier };

	/**
	 * The states defined for this state machine.
	 */
	public states?: id2partial_sdef;

	/**
	 * Indicates whether the state machine is running in parallel with the "current" state machine as defined in {@link bfsm_controller.current_machine}.
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

/**
 * A type representing a mapping of state IDs to partial state definitions.
 */
export type id2partial_sdef = Record<string, Partial<sdef>>;

/**
 * Represents the states of a state machine.
 */
export interface machine_states {
	/**
	 * Indicates whether the state machine is running in parallel with the "current" state machine as defined in {@link bfsm_controller.current_machine}.
	 */
	parallel?: boolean,

	/**
	 * Represents the state data for the state machine that is shared across its states.
	 */
	data?: { [key: string]: any },

	/**
	 * Represents the mapping of event types to state IDs for transitions to other states based on events (e.g. 'click' => 'idle').
	 * At the state machine level, the `on` property defines the global transitions that can occur from any state.
	 */
	on?: { [key: string]: Identifier }

	/**
	 * The states defined for this state machine.
	 */
	states: id2partial_sdef,
}
