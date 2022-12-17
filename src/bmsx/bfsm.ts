import { GameObject, BaseModel } from "./bmsx";
import { insavegame } from "./gamereviver";

export var MachineDefinitions: Record<string, mdef>;
var MachineDefinitionBuilders: Record<string, () => Partial<mdef>>;

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
	for (let classname in MachineDefinitionBuilders) {
		let machineDefForClass = MachineDefinitionBuilders[classname]();
		let machineBuilt: mdef = undefined;
		if (machineDefForClass) {
			machineBuilt = new mdef(classname, machineDefForClass);
			if (machineDefForClass) MachineDefinitions[classname] = machineBuilt; // A class might choose not to create a new machine
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
export type id2mstate = Record<string, mstate>;
export type id2sstate = Record<string, sstate>;
export type state_event_handler = (state: sstate, me: any, type: state_event_type) => void;
export type Tape = any[];

const BST_MAX_HISTORY = 10;
export const DEFAULT_BST_ID = 'master';
export const NONE_STATE_ID = 'none';

/**
 * Type used for getting all the states of a nested object containing both the machines as well as the inner states per machine. Allows for type checking state-names without having to create a type per machine.
 * @see https://www.raygesualdo.com/posts/flattening-object-keys-with-typescript-types
 */
export type FlattenedPropKeys<T extends Record<string, unknown>, Key = keyof T> = Key extends string ? T[Key] extends Record<string, unknown> ? FlattenedPropKeys<T[Key]> : Key : never;

@insavegame
export class mstate {
	id: string;
	states: id2sstate;
	currentid: string; // Identifier of current state
	history: Array<string>; // History of previous states
	paused: boolean; // Iff paused, skip 'onrun'
	/**
	 * This state machine reflects the (partial) state of the game object with the given id
	 * @see BaseModel.get
	 */
	targetid: string;
	substate: Record<string, mstate>;

	public get target(): GameObject | BaseModel { return global.model.get(this.targetid); }
	public get current(): sstate { return this.states[this.currentid]; };

	public get definition(): mdef {
		return MachineDefinitions[this.id];
	}

	public get current_state_definition(): sdef {
		return this.current?.definition; // Note that definition can be empty, as not all objects have a defined machine
	}

	/**
	 * Factory for creating new FSMs.
	 * @param _id - id of the FSM definition to use for this machine.
	 * @param _targetid - id of the object that is stated by this FSM. @see {@link BaseModel.get}.
	 * @param _sub_fsm_ids - array of ids of any additional machines to be added to this machines. @see {@link mstate.substate}.
	 */
	public static create(_id: string, _targetid: string, _sub_fsm_ids?: string[]): mstate {
		let result = new mstate(_id, _targetid);
		result.populateStates();

		if (_sub_fsm_ids && _sub_fsm_ids.length > 0) {
			_sub_fsm_ids.forEach(sub_id => {
				result.substate.sub_id = new mstate(_id, _targetid);
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
		this.substate = {};

		// Note: when parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
		_id && _targetid && this.reset();
	}

	public run(): void {
		if (this.paused) return;
		// [this.currentStatedef] can be undefined if we are in the 'none' state
		this.current_state_definition?.process_input?.(this.current, this.target, state_event_type.None);
		this.current_state_definition?.onrun?.(this.current, this.target, state_event_type.Run);
	}

	public to(newstate: string): void {
		let stateDef = this.current_state_definition;
		// stateDef can be undefined if we are in the 'none' state
		stateDef?.onexit?.(this.current, this.target, state_event_type.Exit);
		stateDef && this.pushHistory(this.currentid); // Store the previous state on the history stack, if it is other than 'none'

		this.currentid = newstate; // Switch the current state to the new state
		if (!this.current) throw new Error(`State "${newstate}" doesn't exist for this state machine!`);

		stateDef = this.current_state_definition;
		// stateDef can be undefined if we are in the 'none' state
		stateDef?.onenter?.(this.current, this.target, state_event_type.Enter);
	}

	protected pushHistory(toPush: string): void {
		this.history.push(toPush);
		if (this.history.length > BST_MAX_HISTORY)
			this.history.shift(); // Remove the first element in the history-array
	}

	public reset(): void {
		this.currentid = NONE_STATE_ID;
		this.history = new Array();
		this.paused = false;
	}

	public pop(): void {
		if (this.history.length <= 0) return;
		let poppedStateId = this.history.pop();
		this.to(poppedStateId);
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
			if (!state.id) throw new Error(`State is missing an id, while attempting to add it to this mstate!`);
			if (this.states[state.id]) throw new Error(`State ${state.id} already exists for state machine!`);
			this.states[state.id] = state;
			state.machineid = this.id;
		}
	}
}

@insavegame
export class sstate {
	id: string;
	machineid: string;
	/**
	 * `If != undefined`, this state is a substate of the the state with `parentid`
	 */
	parentid: string;
	/**
	 * This concurrent state machine reflects the (partial) state of the game object with the given id
	 * @see BaseModel.get
	 */
	targetid: string;
	nudges2move: number; // Number of runs before tapehead moves to next statedata
	// /**
	//  * `If != undefined`, this state has substates
	//  */
	// submachine: mstate;

	public get definition(): sdef { return MachineDefinitions[this.machineid]?.states[this.id]; } // Note that definition can be empty, as not all objects have a defined machine
	public get tape(): Tape { return this.definition.tape; }
	public get current(): any { return (this.tape && this.head < this.tape.length) ? this.tape[this.head] : undefined; };
	public get at_tapeend(): boolean { return !this.tape || this.head >= this.tape.length - 1; } // Note that beyond end also returns true if there is no tape!
	protected get beyond_tapeend(): boolean { return !this.tape || this.head >= this.tape.length; } // Note that beyond end also returns true if there is no tape!
	public get at_tape_start(): boolean { return this.head === 0; }
	// public get internalstate() { return { statedata: this.tape, tapehead: this.head, nudges: this.nudges, nudges2move: this.nudges2move }; }
	public get target(): GameObject | BaseModel { return global.model.get(this.targetid); }
	// https://github.com/microsoft/TypeScript/issues/35986
	public targetAs<T extends GameObject | BaseModel>(): T { return <T>global.model.get(this.targetid); }

	public constructor(_id: string, _machineid: string, _targetid: string) {
		this.id = _id;
		this.machineid = _machineid;
		this.targetid = _targetid;

		// Note: when parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
		if (_id && _machineid && this.definition) { // No definition exists for the empty 'none'-state
			this.reset();

			// If this state has its own state machine, create submachine and populate substates
			// let sub_machine_def = this.definition.submachine;
			// if (sub_machine_def) {
			// 	this.submachine = new mstate(sub_machine_def.id, this.targetid);
			// 	this.submachine.populateStates();
			// }
		}
	}

	protected _tapehead: number;
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

	protected _nudges: number;
	public get nudges(): number {
		return this._nudges;
	}
	public set nudges(v: number) {
		this._nudges = v;
		if (v >= this.nudges2move) { ++this.head; }
	}

	protected tapemove() {
		this.definition.onnext?.(this, this.target, state_event_type.Next);
	}

	protected tapeend() {
		this.definition.onend?.(this, this.target, state_event_type.End);
	}

	public reset(): void {
		this._tapehead = 0;
		this._nudges = 0;
		this.nudges2move = this.definition.nudges2move;
	}
}

export class sdef {
	public id: string;
	public tape: Tape;
	public nudges2move: number; // Number of runs before tapehead moves to next statedata
	public auto_rewind_tape_after_end: boolean = true; // Automagically set the tapehead to index 0 when tapehead would go out of bound. Otherwise, will remain at end
	public parent: mdef;
	// public parent_state: sdef;
	/**
	 * `If != undefined`, this state has substates
	 */
	// public submachine: mdef;

	public constructor(_id: string = '_', _partialdef?: Partial<sdef>) {
		this.id = _id;
		this.nudges2move ??= 1;
		_partialdef && Object.assign(this, _partialdef);
	}

	public onrun: state_event_handler;
	public onfinal: state_event_handler;
	public onend: state_event_handler;
	public onnext: state_event_handler;
	public onenter: state_event_handler;
	public onexit: state_event_handler;
	public process_input: state_event_handler;

	// Helper function to set all handlers
	public setAllHandlers(handler: state_event_handler): void {
		this.onrun = handler;
		this.onfinal = handler;
		this.onend = handler;
		this.onnext = handler;
		this.onenter = handler;
		this.onexit = handler;
		this.process_input = handler;
	}
}

export class mdef {
	public id: string;
	public states: id2sdef;
	public getStateDef(s_id: string): sdef { return this.states[s_id]; }

	constructor(id?: string, _partialdef?: Partial<mdef>) {
		this.id = id ?? DEFAULT_BST_ID;
		this.states ??= {};
		_partialdef && Object.assign(this, _partialdef);
	}

	// public create(id: string): sdef {
	// 	if (this.states[id]) throw new Error(`State ${id} already exists for state machine!`);
	// 	let result = new sdef(id);
	// 	this.states[id] = result;
	// 	result.parent = this;
	// 	return result;
	// }

	// public add(...states: sdef[]): void {
	// 	for (let state of states) {
	// 		if (!state.id) throw new Error(`State is missing an id, while attempting to add it to this bst!`);
	// 		if (this.states[state.id]) throw new Error(`State ${state.id} already exists for state machine!`);
	// 		this.states[state.id] = state;
	// 		state.parent = this;
	// 	}
	// }

	// public append(_state: sdef, _id: string): void {
	// 	this.states[_id] = _state;
	// 	_state.parent = this;
	// }

	// public remove(_id: string): void {
	// 	let s = this.states[_id];
	// 	s.parent = undefined;
	// 	delete this.states[_id];
	// }
}
