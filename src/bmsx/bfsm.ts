import { GameObject } from "./gameobject";
import { exclude_save, insavegame } from "./gameserializer";
import { BaseModel } from "./model";

/**
 * Represents the machine definitions.
 */
export var MachineDefinitions: Record<string, mdef>;
/**
 * A record that maps string keys to functions that build machine states.
 */
var MachineDefinitionBuilders: Record<string, () => machine_states>;

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
export function build_fsm(fsm_name?: string) {
	return function statedef_builder(target: any, name: any, descriptor: PropertyDescriptor): any {
		MachineDefinitionBuilders ??= {};
		MachineDefinitionBuilders[fsm_name ?? target.name] = descriptor.value;
	};
}

/**
 * Decorator function that builds a finite state machine definition.
 * @param target - The class that the member is on.
 * @param name - The name of the member in the class.
 * @param descriptor - The member descriptor; This is essentially the object that would have been passed to Object.defineProperty.
 * @returns The decorated function.
 */
export function statedef_builder(target: any, name: any, descriptor: PropertyDescriptor): any {
	MachineDefinitionBuilders ??= {};
	MachineDefinitionBuilders[target.name] = descriptor.value;
}

/**
 * Builds the state machine definitions and sets them in the `MachineDefinitions` object.
 * Loops through all the `MachineDefinitionBuilders` and calls them to get the state machine definition.
 * If a definition is returned, it creates a new `mdef` object with the machine name and definition.
 * If the `mdef` object is created successfully, it sets the machine definition in the `MachineDefinitions` object.
 */
export function setup_fsmdef_library(): void {
	MachineDefinitions = {};
	for (let machine_name in MachineDefinitionBuilders) {
		let machine_definition = MachineDefinitionBuilders[machine_name]();
		if (machine_definition) {
			createMachine(machine_name, machine_definition);
		}
	}
}

function createMachine(machine_name: string, machine_definition: machine_states): void {
	// If the machine_definition has states, create a new machine definition for each state
	if (machine_definition.states) {
		for (let stateId in machine_definition.states) {
			let state = machine_definition.states[stateId];

			// If the state has substates, create a new machine definition for each substate
			if (state.states) {
				// Generate a new submachine_id
				let submachine_id = generateSubmachineId(machine_name, stateId);
				state.submachine_id = submachine_id;

				// Create a new machine with the substate's states
				let submachine_definition: machine_states = { states: state.states };
				createMachine(submachine_id, submachine_definition);
			}
		}
	}
	let machineBuilt = new mdef(machine_name, machine_definition);
	MachineDefinitions[machine_name] = machineBuilt; // A class might choose not to create a new machine
}

// Function to generate a new submachine_id
function generateSubmachineId(machine_name: string, stateId: string): string {
	return `${machine_name}_${stateId}`;
}

/**
 * Represents a type definition for mapping IDs to `sdef` objects.
 */
export type id2sdef = Record<string, sdef>;
/**
 * Represents a mapping of IDs to mdefs.
 */
export type id2mdef = Record<string, mdef>;
/**
 * Represents a mapping of IDs to state contexts.
 */
export type id2mstate = Record<string, statecontext>;
/**
 * Represents a mapping of IDs to sstates.
 */
export type id2sstate = Record<string, sstate>;
/**
 * Represents a state event handler function.
 * @param state - The state object.
 * @param type - The type of state event.
 * @returns The result of the state event handler.
 */
export interface state_event_handler { (state: sstate, ...args: any[]); }
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
	statemachines: Record<string, statecontext>;

	public get machines(): Record<string, statecontext> {
		return new Proxy(this.statemachines, {
			get: (target, prop: string) => {
				if (target[prop]) {
					return target[prop];
				}
				throw new Error(`No machine with ID "${prop}"`);
			}
		});
	}

	current_machine_id: string;

	get current_machine(): statecontext { return this.statemachines[this.current_machine_id]; }

	get current_state(): sstate { return this.current_machine.current; }

	get states(): id2sstate { return this.current_machine.states; }

	get definition(): mdef { return this.current_machine.definition; }

	constructor() {
		this.statemachines = {};
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
	 * @returns void
	 */
	to(newstate: string, ...args: any[]): void {
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

	switch(path: string, ...args: any[]): void {
		const dotIndex = path.indexOf('.');
		const machineid = dotIndex !== -1 ? path.slice(0, dotIndex) : path;
		let stateids = dotIndex !== -1 ? path.slice(dotIndex + 1) : undefined;

		// If no stateid is specified, assume that the stateid is the same as the machineid
		if (!stateids) {
			stateids = machineid;
		}

		const machine = this.statemachines[machineid];
		if (!machine) throw new Error(`No machine with ID "${machineid}"`);

		// Only switch the state in the specified machine, without changing the current machine
		machine.switch(stateids, ...args);
	}

	add_statemachine(id: string, targetid: string): void {
		this.statemachines[id] = statecontext.create(id, targetid);
		// If this is the first id that was added, set it as the current machine
		if (!this.current_machine_id) this.current_machine_id = id;
	}

	/**
	 * Gets the state machine with the given ID.
	 * @param id - The ID of the state machine.
	 * @returns The state machine with the given ID.
	 */
	get_statemachine(id: string): statecontext {
		return this.statemachines[id];
	}

	/**
	 * Retrieves the current state of a given path in the state machine.
	 *
	 * @param path - The path to the desired state, represented as a dot-separated string.
	 * @returns The current state object if found, otherwise undefined.
	 * @throws Error if no machine with the specified ID is found.
	 */
	is(path: string): boolean {
		const dotIndex = path.indexOf('.');
		const machineid = dotIndex !== -1 ? path.slice(0, dotIndex) : path;
		const stateids = dotIndex !== -1 ? path.slice(dotIndex + 1) : undefined;

		if (dotIndex === -1) {
			return this.current_machine.is(path);
		}

		const machine = this.machines[machineid];
		if (!machine) {
			throw new Error(`No machine with ID "${machineid}"`);
		}

		// If there are more parts, check the state of the submachine with the given path
		return machine.is(stateids);
	}

	/**
	 * Runs the state machine with the given ID.
	 * @param id - The ID of the state machine.
	 */
	run_statemachine(id: string): void {
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
	reset_statemachine(id: string): void {
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
	pop_statemachine(id: string): void {
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
	switch_state(id: string, stateid: string): void {
		this.statemachines[id].to(stateid);
	}

	pause_statemachine(id: string): void {
		this.statemachines[id].paused = true;
	}

	pause_all_statemachines(): void {
		for (let id in this.statemachines) {
			this.statemachines[id].paused = true;
		}
	}

	pause_all_except(id: string): void {
		for (let _id in this.statemachines) {
			if (_id === id) continue;
			this.statemachines[_id].paused = true;
		}
	}

	resume_statemachine(id: string): void {
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
interface IStateController {
	run(): void;
	switch(path: string, ...args: any[]): void;
	to(path: string, ...args: any[]): void;
	is(path: string): boolean;
	pop(): void;
	state: statecontext;
	states: id2sstate;
	current: sstate;
	currentid: string;
	get start_state_id(): string;
}

@insavegame
/**
 * Represents the context of a state in a finite state machine.
 * Contains information about the current state, the state machine it belongs to, and any substate machines.
 */
export class statecontext implements IStateController {
	/**
	 * The unique identifier for the bfsm.
	 */
	id: string;
	/**
	 * Represents the states of the Bfsm.
	 */
	states: id2sstate;

	get state() { return this; }
	/**
	 * Indicates whether the state machine is running in parallel with the "current" state machine as defined in {@link bfsm_controller.current_machine}.
	 */
	get parallel(): boolean { return this.definition.parallel; }
	/**
	 * Identifier of the current state.
	 */
	currentid!: string; // Identifier of current state
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
	 * @see {@link BaseModel.get}
	 */
	targetid: string;

	/**
	 * Represents the state data for the state machine that is shared across its states.
	 */
	public data: { [key: string]: any } = {};

	/**
	 * Returns the game object or model that this state machine is associated with.
	 */
	public get target(): GameObject | BaseModel { return global.model.get(this.targetid); }

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
	public get_sstate(id: string) { return this.states[id]; }
	/**
	 * Gets the definition of the current state machine.
	 * @returns The definition of the current state machine.
	 */
	public get definition(): mdef { return MachineDefinitions[this.id]; }
	/**
	 * Gets the id of the start state of the FSM.
	 * @returns The id of the start state of the FSM.
	 */
	public get start_state_id(): string { return MachineDefinitions[this.id]?.start_state ?? NONE_STATE_ID; }

	/**
	 * Gets the definition of the current state of the FSM.
	 * Note that the definition can be empty, as not all objects have a defined machine.
	 */
	public get current_state_definition(): sdef {
		return this.current?.definition;
	}

	/**
	 * Factory for creating new FSMs.
	 * @param _id - id of the FSM definition to use for this machine.
	 * @param _targetid - id of the object that is stated by this FSM. @see {@link BaseModel.get}.
	 */
	public static create(_id: string, _targetid: string): statecontext {
		let result = new statecontext(_id, _targetid);
		result.populateStates();

		return result;
	}

	/**
	 * Represents the context of a state in a finite state machine.
	 * Contains information about the current state, the state machine it belongs to, and any substate machines.
	 * @param _id - id of the state machine definition to use for this machine.
	 * @param _targetid - id of the object that is stated by this FSM. @see {@link BaseModel.get}.
	 */
	constructor(_id: string, _targetid: string) {
		this.id = _id ?? DEFAULT_BST_ID;
		this.targetid = _targetid;
		this.states ??= {};
		this.paused ??= false;

		// Note: when parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
		_id && _targetid && this.reset(false);
	}

	public start(): void {
		const startStateId = this.start_state_id;
		if (!startStateId) {
			throw new Error(`No start state defined for state machine '${this.id}'`);
		}

		const startStateDef = this.get_sstate(startStateId)?.definition;

		// Trigger the enter event for the start state. Note that there is no definition for the none-state, so we don't trigger the enter event for that state.
		startStateDef?.enter?.call(this.target, this.get_sstate(startStateId));

		// Start the state machine for the current active state
		this.states[startStateId].state?.start();
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
			// Perform exit actions for the current state
			let stateDef = this.current_state_definition;
			stateDef?.exit?.call(this.target, this.current, ...args);
			stateDef && this.pushHistory(this.currentid);

			// Update the current state
			this.currentid = currentPart;
			if (!this.current) throw new Error(`State "${currentPart}" doesn't exist for this state machine '${this.id}'!`);

			// Perform enter actions for the new current state
			stateDef = this.current_state_definition;
			stateDef?.enter?.call(this.target, this.current, ...args);
		}

		// If there are more parts, transition to the next state
		if (restParts.length > 0) {
			currentContext.to(restParts.join('.'), ...args);
		}
	}

	/**
	 * Checks if the current state matches the given path.
	 *
	 * @param path - The path to the desired state, represented as a dot-separated string.
	 * @returns true if the current state matches the path, false otherwise.
	 * @throws Error if no machine with the specified ID is found.
	 */
	public is(path: string): boolean {
		const dotIndex = path.indexOf('.');
		const currentPart = dotIndex !== -1 ? path.slice(0, dotIndex) : path;
		const restParts = dotIndex !== -1 ? path.slice(dotIndex + 1) : undefined;
		const moreThanOneRestParts = restParts ? (restParts.indexOf('.') !== -1) : false;

		let currentContext: IStateController = this.states[currentPart];
		if (!currentContext) {
			throw new Error(`No state with ID "${currentPart}"`);
		}

		// If there are more parts, check the state of the submachine
		if (moreThanOneRestParts) {
			return currentContext.is(restParts);
		}

		// If there are no more parts, check if the current state matches the current part
		return this.currentid === currentPart;
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
		const dotIndex = path.indexOf('.');
		const currentPart = dotIndex !== -1 ? path.slice(0, dotIndex) : path;
		const restParts = dotIndex !== -1 ? path.slice(dotIndex + 1) : undefined;
		const moreThanOneRestParts = restParts && restParts.indexOf('.') !== -1;

		if (currentPart === '*') {
			// Iterate over all states and substates
			for (let stateid in this.states) {
				const currentContext = this.states[stateid] as IStateController;
				if (!currentContext) continue;
				// If a match is found, remove the '*' from the id and continue with the rest of the path
				if (restParts && (restParts === stateid || restParts.startsWith(stateid + '.'))) {
					if (moreThanOneRestParts) {
						// If there are more parts, continue to the next state
						currentContext.switch(restParts, ...args);
						return;
					} else {
						// If this is the final part of the id, switch the state
						this.to(stateid, ...args);
						return;
					}
				} else if (currentContext.state) {
					currentContext.switch(path, ...args);
				}
			}
		} else {
			let currentContext: IStateController = this.states[currentPart];
			if (!currentContext) {
				throw new Error(`No state with ID "${currentPart}"`);
			}

			// If there are more parts, continue to the next state
			if (restParts) {
				currentContext.switch(restParts, ...args);
			} else {
				// if (this.currentid === currentPart) return; // Don't switch to the same state

				// Perform exit actions for the current state
				let stateDef = this.current_state_definition;
				stateDef?.exit?.call(this.target, this.current, ...args);
				stateDef && this.pushHistory(this.currentid);

				// Update the current state
				this.currentid = currentPart;
				if (!this.current) throw new Error(`State "${currentPart}" doesn't exist for this state machine '${this.id}'!`);

				// Perform enter actions for the new current state
				stateDef = this.current_state_definition;
				stateDef?.enter?.call(this.target, this.current, ...args);
			}
		}
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

	// Resets the state machine to its initial state.
	// If a start state is defined in the state machine definition, the current state is set to that state.
	// Otherwise, the current state is set to the 'none' state.
	// The history of previous states is cleared and the state machine is unpaused.
	public reset(reset_tree: boolean = true): void {
		// N.B. doesn't trigger the onenter-event!
		const start = this.definition?.start_state; // Definition doesn't need to exist
		this.currentid = start ?? NONE_STATE_ID; // Set the current state to the start state (if it exists)
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
		let mdef = this.definition;
		if (!mdef) {
			// A class is not required to have a defined machine.
			// Thus, we create a default machine that automatically has a generated
			// 'none'-state associated with it.
			this.add(new sstate(NONE_STATE_ID, this.id, this.targetid));
		}
		else {
			for (let sdef_id in mdef.states) {
				let state = new sstate(sdef_id, this.id, this.targetid);
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
			if (!state.statedef_id) throw new Error(`State is missing an id, while attempting to add it to this statecontext '${this.id}'!`);
			if (this.states[state.statedef_id]) throw new Error(`State ${state.statedef_id} already exists for statecontext '${this.id}'!`);
			this.states[state.statedef_id] = state;
			state.machinedef_id = this.id;
		}
	}
}

@insavegame
/**
 * Represents a state in a state machine.
 * @template T - The type of the game object or model associated with the state.
 */
export class sstate<T extends GameObject | BaseModel = any> implements IStateController {
	pop(): void {
		this.getOrThrowStateMachine().pop();
	}

	to(id: string, ...args: any[]): void {
		this.getOrThrowStateMachine().to(id, ...args);
	}

	switch(id: string, ...args: any[]): void {
		this.getOrThrowStateMachine().switch(id, ...args);
	}

	run(): void {
		this.state?.run();
	}

	is(id: string): boolean {
		return this.getOrThrowStateMachine().is(id);
	}

	get current(): sstate {
		return this.getOrThrowStateMachine().current;
	}

	get currentid(): string {
		return this.state?.currentid ?? this.statedef_id;
	}

	get start_state_id(): string {
		return this.getOrThrowStateMachine().start_state_id;
	}

	state: statecontext;
	/**
	 * Retrieves the state machine associated with the current state.
	 * @returns The state machine object.
	 * @throws Error if the state doesn't have a state machine.
	 */
	private getOrThrowStateMachine(): statecontext {
		if (!this.state) throw new Error(`State "${this.statedef_id}" doesn't have a state machine.`);
		return this.state;
	}

	get states(): id2sstate { return this.state?.states; }
	/**
	 * The unique identifier for the state definition.
	 */
	public statedef_id: string;
	/**
	 * The identifier of the machine definition.
	 */
	public machinedef_id: string;
	/**
	 * `If != undefined`, this state is a substate of the the state with `parentid`
	 */
	// parentid: string;
	/**
	 * This concurrent state machine reflects the (partial) state of the game object with the given id
	 * @see BaseModel.get
	 */
	public targetid: string;

	/**
	 * Returns the state definition associated with this state.
	 * If the state machine definition or the state definition is not found, returns undefined.
	 * @returns The state definition associated with this state, or undefined if not found.
	 */
	public get definition(): sdef { return MachineDefinitions[this.machinedef_id]?.states[this.statedef_id]; } // Note that definition can be empty, as not all objects have a defined machine
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
	 * Returns the game object or model associated with the target ID of this state.
	 * @returns The game object or model associated with the target ID of this state.
	 * @template T - The type of the game object or model to return.
	 */
	public get target() { return this.targetAs<T>(); }

	/**
	 * Returns the game object or model associated with the target ID of this state.
	 * @returns The game object or model associated with the target ID of this state.
	 * @template T - The type of the game object or model to return.
	 */
	public targetAs<T extends GameObject | BaseModel>(): T { return <T>global.model.get(this.targetid); }

	/**
	 * Represents the state data for the state.
	 */
	public data: { [key: string]: any } = {};

	/**
	 * Creates a new state object with the given ID, machine ID, and target ID.
	 * If parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, the object is not initialized.
	 * @param _id - The ID of the state object.
	 * @param _machineid - The ID of the state machine object.
	 * @param _targetid - The ID of the target object.
	 */
	public constructor(_id: string, _machineid: string, _targetid: string) {
		this.statedef_id = _id;
		this.machinedef_id = _machineid;
		this.targetid = _targetid;
		const substateDefinition = this.definition?.submachine_id;
		this.state = substateDefinition ? statecontext.create(substateDefinition, this.targetid) : undefined;

		// Note: when parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
		if (_id && _machineid && this.definition) { // No definition exists for the empty 'none'-state
			this.reset(false);
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
		if (reset_tree) this.state?.reset(); // Reset the substate machine if it exists
	}
}

/**
 * Represents a state definition for a state machine.
 */
export class sdef {
	submachine_id?: string; // Represents the machine name of the substate machine
	states?: id2partial_sdef; // Represents the states of the substate machine

	public data?: { [key: string]: any };
	/**
	 * The unique identifier for the bfsm.
	 */
	public id: string;
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
	public parent!: mdef;

	/**
	 * Constructs a new instance of the `bfsm` class.
	 * @param _id - The ID of the `bfsm` instance.
	 * @param _partialdef - An optional partial definition to assign to the `bfsm` instance.
	 */
	public constructor(_id: string = '_', _partialdef?: Partial<sdef>) {
		this.id = _id;
		this.ticks2move ??= 1;
		this.repetitions ??= 1;
		this.auto_tick ??= true;
		this.auto_rewind_tape_after_end ??= true;
		this.data ??= {};
		_partialdef && Object.assign(this, _partialdef); // Assign the partial definition to the instance

		// Repeat the tape if necessary (and if it exists) by appending the tape to itself
		if (this.tape && this.repetitions > 1) {
			let originalTape = [...this.tape]; // Copy the tape
			for (let i = 1; i < this.repetitions; i++) { // Repeat the tape
				this.tape.push(...originalTape); // Append the tape to itself
			}
		}
	}

	public run?: state_event_handler;
	public end?: state_event_handler;
	public next?: state_event_handler;
	public enter?: state_event_handler;
	public exit?: state_event_handler;
	public process_input?: state_event_handler;
}

/**
 * A type representing a mapping of state IDs to partial state definitions.
 */
export type id2partial_sdef = Record<string, Partial<sdef>>;

/**
 * Represents the states of a state machine.
 */
export interface machine_states {
	parallel?: boolean;

	states: id2partial_sdef;
}

/**
 * Represents a state machine definition.
 */
export class mdef {
	/**
	 * The unique identifier for this state machine definition.
	 */
	public id: string;

	/**
	 * The states defined for this state machine.
	 */
	public states: id2sdef;

	/**
	 * Indicates whether the state machine is running in parallel with the "current" state machine as defined in {@link bfsm_controller.current_machine}.
	 */
	public parallel: boolean;

	/**
	 * The identifier of the state that the state machine should start in.
	 */
	public start_state: string;

	/**
	 * Represents the state data for the state machine that is shared across its states.
	 */
	public data?: { [key: string]: any } = {};

	/**
	 * The prefix used to identify the start state.
	 */
	public static readonly START_STATE_PREFIXES = '_#';

	/**
	 * Creates a new state machine definition.
	 * @param id The unique identifier for this state machine definition.
	 * @param state_list The list of states defined for this state machine.
	 */
	constructor(id?: string, state_list?: machine_states) {
		this.id = id ?? DEFAULT_BST_ID;
		this.parallel = state_list?.parallel ?? false;
		this.states ??= {};
		let keys = Object.keys(state_list.states);
		for (let state_id of keys) {
			this.append(mdef.#create_state(state_list.states[state_id], state_id));
		}
		if (keys.length > 0) { // Only look for a start state if we have at least one state in our definition
			this.start_state ??= keys[0]; // If no default state was defined, we default to the first state found in the list of states
		}
		// _partialdef && Object.assign(this, _partialdef);
	}

	/**
	 * Creates a new state definition.
	 * @param partial The partial definition of the state.
	 * @param _state_id The identifier of the state.
	 * @returns The new state definition.
	 * @throws An error if the state definition is missing.
	 */
	static #create_state(partial: Partial<sdef>, _state_id: string): sdef {
		if (!partial) throw new Error(`'sdef' with id '${_state_id}' is missing definition while attempting to add it to this 'mdef'!`);
		return new sdef(_state_id, partial);
	}

	/**
	 * Determines if a given state is the start state.
	 * @param _state The state to check.
	 * @returns True if the state is the start state, false otherwise.
	 */
	static #is_start_state(_state: sdef): boolean {
		return mdef.START_STATE_PREFIXES.includes(_state.id.charAt(0));
	}

	/**
	 * Sets the start state of the state machine to the given state.
	 * @param _state The state to set as the start state.
	 */
	#set_start_state(_state: sdef): void {
		this.start_state = _state.id;
	}

	/**
	 * Adds one or more states to the list of states defined for this state machine.
	 * @param states The states to add.
	 * @throws An error if any of the states are missing an id or if a state with the same id already exists for this state machine.
	 */
	public add(...states: sdef[]): void {
		states.forEach(s => this.append(s));
	}

	/**
	 * Appends a state to the list of states defined for this state machine.
	 * @param _state The state to append.
	 * @throws An error if the state is missing an id or if a state with the same id already exists for this state machine.
	 */
	public append(_state: sdef): void {
		if (!_state.id) throw new Error(`'sdef' is missing an id, while attempting to add it to this 'mdef'!`);
		if (this.states[_state.id]) throw new Error(`'sdef' with id='${_state.id}' already exists for this 'mdef'!`);
		if (mdef.#is_start_state(_state)) {
			// Remove the start state prefix from the id
			_state.id = _state.id.substring(1);
			this.#set_start_state(_state);
		}
		this.states[_state.id] = _state;
		_state.parent = this;
	}
}
