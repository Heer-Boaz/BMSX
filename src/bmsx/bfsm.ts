import { GameObject } from "./gameobject";
import { exclude_save, insavegame } from "./gameserializer";
import { BaseModel } from "./model";

export var MachineDefinitions: Record<string, mdef>;
var MachineDefinitionBuilders: Record<string, () => machine_states>;

// target: the class that the member is on.
// name: the name of the member in the class.
// descriptor: the member descriptor; This is essentially the object that would have been passed to Object.defineProperty.
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
		let machineBuilt: mdef;
		if (machine_definition) {
			machineBuilt = new mdef(machine_name, machine_definition);
			if (machine_definition) MachineDefinitions[machine_name] = machineBuilt; // A class might choose not to create a new machine
		}
	}
}

export const enum state_event_type {
	None = 0,
	Run = 1,
	Enter = 2,
	Exit = 3,
	Next = 4,
	End = 5,
}

export type id2sdef = Record<string, sdef>;
export type id2mdef = Record<string, mdef>;
export type id2mstate = Record<string, statecontext>;
export type id2sstate = Record<string, sstate>;
export interface state_event_handler { (state: sstate, type: state_event_type): any; }
export type Tape = any[];

const BST_MAX_HISTORY = 10;
export const DEFAULT_BST_ID = 'master';
export const NONE_STATE_ID = 'none';

/**
 * Type used for getting all the states of a nested object containing both the machines as well as the inner states per machine. Allows for type checking state-names without having to create a type per machine.
 * @see https://www.raygesualdo.com/posts/flattening-object-keys-with-typescript-types
 */
// export type FlattenedPropKeys<T extends Record<string, unknown>, Key = keyof T> = Key extends string ? T[Key] extends Record<string, unknown> ? FlattenedPropKeys<T[Key]> : Key : never;
// export type Bla<T extends id2partial_sdef, Key = keyof T> = Key extends string ? Key : never;
export type Bla<T extends id2partial_sdef> = keyof T;

@insavegame
/**
 * Represents the context of a state in a finite state machine.
 * Contains information about the current state, the state machine it belongs to, and any substate machines.
 */
export class statecontext {
	id: string;
	states: id2sstate;
	currentid!: string; // Identifier of current state
	history!: Array<string>; // History of previous states
	paused: boolean; // Iff paused, skip 'onrun'
	/**
	 * This state machine reflects the (partial) state of the game object with the given id
	 * @see {@link BaseModel.get}
	 */
	targetid: string;
	substate: Record<string, statecontext>;

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
	public get start_state_id(): string { return MachineDefinitions[this.id].start_state; }

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
	 * @param _sub_fsm_ids - array of ids of any additional machines to be added to this machines. @see {@link statecontext.substate}.
	 */
	public static create(_id: string, _targetid: string, _sub_fsm_ids?: string[]): statecontext {
		let result = new statecontext(_id, _targetid);
		result.populateStates();

		if (_sub_fsm_ids && _sub_fsm_ids.length > 0) {
			_sub_fsm_ids.forEach(sub_id => {
				result.substate.sub_id = new statecontext(_id, _targetid);
				result.substate.sub_id.populateStates();
			});
		}

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
		this.substate ??= {};

		// Note: when parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
		_id && _targetid && this.reset();
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

		currentStatedef.process_input?.call(this.target, this.current, state_event_type.None);
		// Then, run the state
		currentStatedef.behaviorTree?.tick();
		currentStatedef.run?.call(this.target, this.current, state_event_type.Run);
	}

	/**
	 * Transitions the state machine to the given state ID.
	 * Calls the exit function of the current state, if it exists, and stores the previous state on the history stack.
	 * Then switches the current state to the new state ID and calls the enter function of the new state, if it exists.
	 * @param newstate - the ID of the state to transition to
	 * @throws Error if the new state ID does not exist in the state machine definition
	 */
	public to(newstate: string): void {
		let stateDef = this.current_state_definition;
		// stateDef can be undefined if we are in the 'none' state
		stateDef?.exit?.call(this.target, this.current, state_event_type.Exit);
		stateDef && this.pushHistory(this.currentid); // Store the previous state on the history stack, if it is other than 'none'

		this.currentid = newstate; // Switch the current state to the new state
		if (!this.current) throw new Error(`State "${newstate}" doesn't exist for this state machine '${this.id}'!`);

		stateDef = this.current_state_definition;
		// stateDef can be undefined if we are in the 'none' state
		stateDef?.enter?.call(this.target, this.current, state_event_type.Enter);
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
	public reset(): void {
		let start = this.definition?.start_state; // Definition doesn't need to exist
		/* N.B. doesn't trigger the onenter-event!
		 * Not feasible, as the object doesn't exist in the model (or the model itself doesn't exist yet).
		 * Therefore, problems will occur when attempting to do stuff during the onenter-event if the object does not yet exist in the model.
		 * Better to use onspawn instead and treat the start-state as just the start-state.
		 */
		this.currentid = start ?? NONE_STATE_ID;
		this.history = new Array();
		this.paused = false;
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
			this.add(new sstate('none', this.id, this.targetid));
		}
		else {
			for (let sdef_id in mdef.states) {
				this.add(new sstate(sdef_id, this.id, this.targetid));
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
export class sstate<T extends GameObject | BaseModel = any> {
	public statedef_id: string;
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
	public nudges2move!: number; // Number of runs before tapehead moves to next statedata

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
	public get current(): any { return (this.tape && this.head < this.tape.length) ? this.tape[this.head] : undefined; };
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

		// Note: when parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
		if (_id && _machineid && this.definition) { // No definition exists for the empty 'none'-state
			this.reset();
		}
	}

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
		this._nudges = 0; // Always reset tapehead nudges after moving tapehead
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
	 * Sets the current number of nudges of the tapehead to the given value without triggering any events or side effects.
	 * @param v - the new number of nudges of the tapehead
	 */
	public setHeadNudgesNoSideEffect(v: number) {
		this._nudges = v;
	}

	protected _nudges!: number;
	/**
	 * Returns the current number of nudges of the tapehead.
	 * @returns The current number of nudges of the tapehead.
	 */
	public get nudges(): number {
		return this._nudges;
	}
	/**
	 * Sets the current number of nudges of the tapehead to the given value.
	 * If the number of nudges is greater than or equal to the number of nudges required to move the tapehead,
	 * the tapehead is moved to the next position.
	 * @param v - the new number of nudges of the tapehead
	 */
	public set nudges(v: number) {
		this._nudges = v;
		if (v >= this.nudges2move) { ++this.head; }
	}

	// Triggers the `next` event of the state machine definition, passing this state and the `state_event_type.Next` event type as arguments.
	protected tapemove() {
		this.definition.next?.call(this.target, this as sstate<T>, state_event_type.Next);
	}

	/**
	 * Triggers the `end` event of the state machine definition, passing this state and the `state_event_type.End` event type as arguments.
	 */
	protected tapeend() {
		this.definition.end?.call(this.target, this as sstate<T>, state_event_type.End);
	}

	/**
	 * Resets the state machine by setting the tapehead and nudges to 0 and the nudges2move to the value defined in the state machine definition.
	 */
	public reset(): void {
		this._tapehead = 0;
		this._nudges = 0;
		this.nudges2move = this.definition.nudges2move;
	}
}

/**
 * Represents a state definition for a state machine.
 */
export class sdef {
	public id: string;
	public tape!: Tape;
	public nudges2move: number; // Number of runs before tapehead moves to next statedata
	public auto_rewind_tape_after_end: boolean = true; // Automagically set the tapehead to index 0 when tapehead would go out of bound. Otherwise, will remain at end

	public behaviorTree?: BTNode;

	@exclude_save
	public parent!: mdef;

	public constructor(_id: string = '_', _partialdef?: Partial<sdef>) {
		this.id = _id;
		this.nudges2move ??= 1;
		_partialdef && Object.assign(this, _partialdef);
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
	 * The identifier of the state that the state machine should start in.
	 */
	public start_state: string;

	/**
	 * The prefix used to identify the start state.
	 */
	public static readonly START_STATE_PREFIX = '#';

	/**
	 * Creates a new state machine definition.
	 * @param id The unique identifier for this state machine definition.
	 * @param state_list The list of states defined for this state machine.
	 */
	constructor(id?: string, state_list?: machine_states) {
		this.id = id ?? DEFAULT_BST_ID;
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
		return _state.id.startsWith(mdef.START_STATE_PREFIX);
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
		this.states[_state.id] = _state;
		_state.parent = this;
		mdef.#is_start_state(_state) && this.#set_start_state(_state);
	}
}

type BTStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';

type BTNodeFeedback = {
	status: BTStatus,
	updates?: (blackboard: Blackboard) => void;  // Detailed information about the action taken or decision made
};

class Blackboard {
	private data: Map<string, any> = new Map();

	get<T>(key: string): T {
		return this.data.get(key) as T;
	}

	set<T>(key: string, value: T) {
		this.data.set(key, value);
	}
}

// Base class for BT nodes
abstract class BTNode {
	public targetid: string;
	public priority: number;
	public blackboard: Blackboard;
	constructor(_targetid: string, _blackboard: Blackboard, _priority = 0) {
		this.targetid = _targetid;
		this.blackboard = _blackboard;
		this.priority = _priority;
	}

	abstract tick(): BTNodeFeedback;
}

class SequenceNode extends BTNode {
	constructor(_targetid: string, _blackboard: Blackboard, public children: BTNode[], _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	tick(): BTNodeFeedback {
		for (const child of this.children) {
			const result = child.tick();
			if (result.status === 'FAILED') {
				return { status: 'FAILED' };
			}
		}
		return { status: 'SUCCESS' };
	}
}

class SelectorNode extends BTNode {
	constructor(_targetid: string, _blackboard: Blackboard, public children: BTNode[], _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	tick(): BTNodeFeedback {
		for (const child of this.children) {
			const result = child.tick();
			if (result.status !== 'FAILED') {
				return result;
			}
		}
		return { status: 'FAILED' };
	}
}

class ParallelNode extends BTNode {
	constructor(_targetid: string, _blackboard: Blackboard, public children: BTNode[], public successPolicy: 'ONE' | 'ALL', _proirity = 0) {
		super(_targetid, _blackboard, _proirity);
	}

	tick(): BTNodeFeedback {
		let successCount = 0;
		let running = false;

		for (const child of this.children) {
			const result = child.tick();
			if (result.status === 'SUCCESS') {
				successCount++;
				if (this.successPolicy === 'ONE') {
					return { status: 'SUCCESS' };
				}
			} else if (result.status === 'RUNNING') {
				running = true;
			}
		}

		if (this.successPolicy === 'ALL' && successCount === this.children.length) {
			return { status: 'SUCCESS' };
		}

		return running ? { status: 'RUNNING' } : { status: 'FAILED' };
	}
}

class DecoratorNode extends BTNode {
	constructor(_targetid: string, _blackboard: Blackboard, public child: BTNode, public decorator: (status: BTStatus) => BTStatus, _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	tick(): BTNodeFeedback {
		const result = this.child.tick();
		return { status: this.decorator(result.status) };
	}
}

class ConditionNode extends BTNode {
	constructor(_targetid: string, _blackboard: Blackboard, public condition: () => boolean, _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	tick(): BTNodeFeedback {
		return this.condition() ? { status: 'SUCCESS' } : { status: 'FAILED' };
	}
}

class RandomSelectorNode extends BTNode {
	constructor(_targetid: string, _blackboard: Blackboard, public children: BTNode[], _priorirty = 0) {
		super(_targetid, _blackboard, _priorirty);
	}

	tick(): BTNodeFeedback {
		const randomIndex = Math.floor(Math.random() * this.children.length);
		return this.children[randomIndex].tick();
	}
}

class LimitNode extends BTNode {
	private count: number = 0;

	constructor(_targetid: string, _blackboard: Blackboard, public limit: number, public child: BTNode, _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	tick(): BTNodeFeedback {
		if (this.count < this.limit) {
			const result = this.child.tick();
			if (result.status !== 'RUNNING') {
				this.count++;
			}
			return result;
		}
		return { status: 'FAILED' };
	}
}

class PrioritySelectorNode extends BTNode {
	constructor(_targetid: string, _blackboard: Blackboard, public children: BTNode[], _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	tick(): BTNodeFeedback {
		for (const child of this.children) {
			const result = child.tick();
			if (result.status === 'SUCCESS') {
				return { status: 'SUCCESS' };
			}
		}
		return { status: 'FAILED' };
	}
}

class WaitNode extends BTNode {
	private startTime: number | null = null;

	constructor(_targetid: string, _blackboard: Blackboard, public waitTime: number, _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	tick(): BTNodeFeedback {
		const currentTime = Date.now();
		if (this.startTime === null) {
			this.startTime = currentTime;
			return { status: 'RUNNING' };
		}

		if (currentTime - this.startTime < this.waitTime) {
			return { status: 'RUNNING' };
		}

		this.startTime = null;
		return { status: 'SUCCESS' };
	}
}

class ActionNode extends BTNode {
	constructor(_targetid: string, _blackboard: Blackboard, public action: (blackboard: Blackboard) => void, _proirity = 0) {
		super(_targetid, _blackboard, _proirity);
	}

	tick(): BTNodeFeedback {
		this.action(this.blackboard);
		return { status: 'SUCCESS' };
	}
}
// Example usage
// const changeHealthAction = (blackboard: Blackboard) => {
//     let currentHealth = blackboard.get<number>('health');
//     blackboard.set('health', currentHealth - 10); // Example: reduce health
// };

// // Usage in an ActionNode
// const healthActionNode = new ActionNode('enemy1', blackboard, changeHealthAction);



class CompositeActionNode extends BTNode {
	constructor(_targetid: string, _blackboard: Blackboard, public actions: ActionNode[], _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	tick(): BTNodeFeedback {
		for (const action of this.actions) {
			action.tick();
		}
		return { status: 'SUCCESS' };
	}
}
