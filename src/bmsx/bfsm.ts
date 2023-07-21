import { GameObject } from "./gameobject";
import { exclude_save, insavegame } from "./gameserializer";
import { BaseModel } from "./model";

export var MachineDefinitions: Record<string, mdef>;
var MachineDefinitionBuilders: Record<string, () => machine_states>;

// target: the class that the member is on.
// name: the name of the member in the class.
// descriptor: the member descriptor; This is essentially the object that would have been passed to Object.defineProperty.
export function build_fsm(fsm_name?: string) {
	return function statedef_builder(target: any, name: any, descriptor: PropertyDescriptor): any {
		MachineDefinitionBuilders ??= {};
		MachineDefinitionBuilders[fsm_name ?? target.name] = descriptor.value;
	};
}

export function statedef_builder(target: any, name: any, descriptor: PropertyDescriptor): any {
	MachineDefinitionBuilders ??= {};
	MachineDefinitionBuilders[target.name] = descriptor.value;
}

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
	public get definition(): mdef { return MachineDefinitions[this.id]; }
	public get start_state_id(): string { return MachineDefinitions[this.id].start_state; }

	public get current_state_definition(): sdef {
		return this.current?.definition; // Note that definition can be empty, as not all objects have a defined machine
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

	constructor(_id: string, _targetid: string) {
		this.id = _id ?? DEFAULT_BST_ID;
		this.targetid = _targetid;
		this.states ??= {};
		this.paused ??= false;
		this.substate ??= {};

		// Note: when parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
		_id && _targetid && this.reset();
	}

	public run(): void {
		if (this.paused) return;
		// [this.currentStatedef] can be undefined if we are in the 'none' state
		this.current_state_definition?.process_input?.call(this.target, this.current, state_event_type.None);
		this.current_state_definition?.run?.call(this.target, this.current, state_event_type.Run);
	}

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

	protected pushHistory(toPush: string): void {
		this.history.push(toPush);
		if (this.history.length > BST_MAX_HISTORY)
			this.history.shift(); // Remove the first element in the history-array
	}

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

	public pop(): void {
		if (this.history.length <= 0) return;
		let poppedStateId = this.history.pop();
		poppedStateId && this.to(poppedStateId);
	}

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

	private add(...states: sstate[]): void {
		for (let state of states) {
			if (!state.statedef_id) throw new Error(`State is missing an id, while attempting to add it to this statecontext '${this.id}'!`);
			if (this.states[state.statedef_id]) throw new Error(`State ${state.statedef_id} already exists for statecontext  '${this.id}'!`);
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

	public get definition(): sdef { return MachineDefinitions[this.machinedef_id]?.states[this.statedef_id]; } // Note that definition can be empty, as not all objects have a defined machine
	public get tape(): Tape { return this.definition.tape; }
	public get current(): any { return (this.tape && this.head < this.tape.length) ? this.tape[this.head] : undefined; };
	public get at_tapeend(): boolean { return !this.tape || this.head >= this.tape.length - 1; } // Note that beyond end also returns true if there is no tape!
	protected get beyond_tapeend(): boolean { return !this.tape || this.head >= this.tape.length; } // Note that beyond end also returns true if there is no tape!
	public get at_tape_start(): boolean { return this.head === 0; }
	// public get internalstate() { return { statedata: this.tape, tapehead: this.head, nudges: this.nudges, nudges2move: this.nudges2move }; }
	public get target() { return this.targetAs<T>(); }//return global.model.get(this.targetid); }
	// https://github.com/microsoft/TypeScript/issues/35986
	// public ik = () => this.targetAs<T>();
	public targetAs<T extends GameObject | BaseModel>(): T { return <T>global.model.get(this.targetid); }

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
	public get head(): number {
		return this._tapehead;
	}
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

	public setHeadNoSideEffect(v: number) {
		this._tapehead = v;
	}

	public setHeadNudgesNoSideEffect(v: number) {
		this._nudges = v;
	}

	protected _nudges!: number;
	public get nudges(): number {
		return this._nudges;
	}
	public set nudges(v: number) {
		this._nudges = v;
		if (v >= this.nudges2move) { ++this.head; }
	}

	protected tapemove() {
		this.definition.next?.call(this.target, this as sstate<T>, state_event_type.Next);
	}

	protected tapeend() {
		this.definition.end?.call(this.target, this as sstate<T>, state_event_type.End);
	}

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

	// Helper function to set all handlers
	public setAllHandlers(handler: state_event_handler): void {
		this.run = handler;
		this.end = handler;
		this.next = handler;
		this.enter = handler;
		this.exit = handler;
		this.process_input = handler;
	}
}

export type id2partial_sdef = Record<string, Partial<sdef>>;

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
