import { EventScope } from '../core/eventemitter';
import { type Identifier } from '../rompack/rompack';
import { excludepropfromsavegame } from 'bmsx/serializer/serializationhooks';
import { type StateEventDefinition, type StateEventHandler, type StateExitHandler, type StateGuard, type StateNextHandler, type Tape, type TickCheckDefinition, type id2partial_sdef, STATE_PARENT_PREFIX, STATE_ROOT_PREFIX, STATE_THIS_PREFIX } from './fsmtypes';

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
	public data?: { [key: string]: any; };

	/**
	 * Indicates whether the state machine is running in parallel with the 'current' state machine as defined in {@link StateMachineController.current_machine}.
	 */
	public is_concurrent?: boolean;

	/**
	 * The tape used by the BFSM.
	 */
	public tape_data: Tape;

	/**
	 * Number of runs before tapehead moves to next statedata.
	 */
	public ticks2advance_tape: number; // Number of runs before tapehead moves to next statedata

	/**
	 * Specifies whether the tapehead should automatically rewind to index `0` when it reaches the end of the tape.
	 * If ticks2advance_tape is 0, the default is false. Otherwise, auto_tick is true (unless it was already defined)
	 * - If set to `true`, the tapehead will be set to index `0` when it would wo out of bounds.
	 * - If set to `false`, the tapehead will remain at the end of the tape.
	 */
	public enable_tape_autotick: boolean; // Automagically increase the ticks during run

	/**
	 * Specifies the behavior for automatic state resetting.
	 *
	 * @remarks
	 * When set to 'state', the state will be automatically reset upon entry.
	 * If set to 'tree', the state and all its states will be reset.
	 * Choosing 'subtree' will reset only the states, while 'none' disables automatic resetting.
	 * The default value is 'state'.
	 *
	 * @type {'state' | 'tree' | 'subtree' | 'none'}
	 */
	public automatic_reset_mode: 'state' | 'tree' | 'subtree' | 'none'; // Automagically reset the state when entered (and optionally also its states) (defaults to 'state')

	/**
	 * Indicates whether the tapehead should automatically rewind to index 0 when it would wo out of bounds.
	 * If set to true, the tapehead will be set to index 0 when it reaches the end of the tape.
	 * If set to false, the tapehead will remain at the end of the tape.
	 */
	public auto_rewind_tape_after_end: boolean; // Automagically set the tapehead to index 0 when tapehead would wo out of bound. Otherwise, will remain at end

	/**
	 * Number of times the tape should be repeated.
	 * See {@link repeat_tape} for more information.
	 */
	public repetitions: number; // Number of times the tape should be repeated

	// Number of times the tape should be repeated
	@excludepropfromsavegame
	/**
	 * The parent state machine definition.
	 */
	public parent!: StateDefinition; // The parent state machine definition

	// The parent state machine definition
	@excludepropfromsavegame
	/**
	 * The root state machine definition.
	 */
	public root!: StateDefinition; // The root state machine definition

	public event_list: { name: string; scope: EventScope; }[];

	/**
	 * Constructs a new instance of the `bfsm` class.
	 * @param id - The ID of the `bfsm` instance.
	 * @param partialdef - An optional partial definition to assign to the `bfsm` instance.
	 */
	public constructor(id: Identifier, partialdef?: Partial<StateDefinition>, root: StateDefinition = null) {
		this.id = id;
		partialdef && Object.assign(this, partialdef); // Assign the partial definition to the instance
		this.ticks2advance_tape ??= 0; // Unless already defined, ticks2move is 0
		this.repetitions = (this.tape_data ? (this.repetitions ?? 1) : 0);
		this.enable_tape_autotick = this.enable_tape_autotick ?? (this.ticks2advance_tape !== 0 ? true : false); // If ticks2advance_tape is 0, auto_tick is false. Otherwise, auto_tick is true (unless it was already defined)
		this.auto_rewind_tape_after_end = this.auto_rewind_tape_after_end ?? (this.tape_data ? AUTO_REWIND_TAPE_AFTER_END : false); // If there is a tape, auto_rewind_tape_after_end is AUTO_REWIND_TAPE_AFTER_END. Otherwise, it is false (unless it was already defined)
		this.automatic_reset_mode = this.automatic_reset_mode ?? 'state'; // Unless already defined, auto_reset is true
		this.data ??= {}; // Unless already defined, data is an empty object
		this.root = root ?? this; // The root state machine is either the provided root or this state machine
		this.is_concurrent ??= false; // Unless already defined, parallel is false

		if (this.tape_data) {
			this.repeat_tape(this.tape_data, this.repetitions);
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
	private repeat_tape(tape: typeof this.tape_data, repetitions: typeof this.repetitions): void {
		// Repeat the tape if necessary (and if it exists) by appending the tape to itself
		if (tape && repetitions > 1) { // If there is a tape and the tape should be repeated at least once
			let originalTape = [...tape]; // Copy the tape
			for (let i = 1; i < repetitions; i++) { // Repeat the tape
				tape.push(...originalTape); // Append the tape to itself
			}
		}
	}

	/**
	 * Constructs the substate machine based on the provided states.
	 *
	 * @param states - The blueprint of the states.
	 */
	private construct_substate_machine(states: id2partial_sdef, root: StateDefinition): void {
		this.states ??= {};
		const substate_ids = Object.keys(states);
		for (let state_id of substate_ids) {
			const sub_sdef = this.#create_state(states[state_id], state_id, root);
			validateStateMachine(sub_sdef as StateDefinition);
			this.replace_partialsdef_with_sdef(sub_sdef, root);
		}
		if (substate_ids.length > 0 && !this.initial) { // Only look for a start state if we have at least one state in our definition
			this.initial = substate_ids[0]; // If no default state was defined, we default to the first state found in the list of states

			// If the start state is not defined, we don't need to change the key of the start state
		}
		else {
			// If the start state is defined, we need to change the key of the start state to exclude the start state prefix
			const start_state = this.states[this.initial]; // Get the start state
			for (const state_id of substate_ids) {
				if (StateDefinition.START_STATE_PREFIXES.includes(state_id.charAt(0))) { // If the state id starts with a start state prefix
					delete this.states[state_id]; // Delete the start state from the list of states (with the old key)
					this.states[start_state.id] = start_state; // Add the start state to the list of states (with the new key)
					break; // Stop iterating over the states
				}
			}
		}
	}

	public tick?: StateEventHandler;
	public tape_end?: StateEventHandler;
	public tape_next?: StateNextHandler;
	public entering_state?: StateEventHandler;
	public exiting_state?: StateExitHandler;
	public process_input?: StateEventHandler;

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

	public input_event_handlers?: {
		[key: string]: Identifier | StateEventDefinition;
	};

	public run_checks?: TickCheckDefinition[];

	/**
	 * The guards for the state.
	 */
	public transition_guards?: StateGuard;

	/**
	 * The states defined for this state machine.
	 */
	public states?: id2partial_sdef;

	/**
	 * The identifier of the state that the state machine should start in.
	 */
	public initial?: Identifier;

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
		this.initial = state.id;
	}

	/**
	 * Appends a state to the list of states defined for this state machine.
	 * @param sub_sdef The state to append.
	 * @throws An error if the state is missing an id or if a state with the same id already exists for this state machine.
	 */
	public replace_partialsdef_with_sdef(sub_sdef: StateDefinition, root: StateDefinition): void {
		if (!sub_sdef.id) throw new Error(`'sub_sdef' is missing an id, while attempting to add it to this 'sdef'!`);
		// if (this.states[state.id]) throw new Error(`'sdef' with id='${state.id}' already exists for this 'sdef'!`);
		let initial_state = this.initial;
		if (this.#is_start_state(sub_sdef)) { // If the state is a start state, set it as the start state
			sub_sdef.id = sub_sdef.id.substring(1); // Remove the start state prefix from the id
			if (initial_state && initial_state !== sub_sdef.id) { // If there is already a start state defined, and it is a start state
				throw `State machine '${this.id}' already has a start state defined ('${initial_state}'). Thus, you chose to define multiple start states ('${initial_state}' and '${sub_sdef.id}'). Please define only one start state!`;
			}
			this.#set_start_state(sub_sdef); // Set the start state for the state machine
		}
		this.states[sub_sdef.id] = sub_sdef;
		sub_sdef.parent = this;
		sub_sdef.root = root;
	}
}

/**
 * Validates the state machine definition.
 *
 * @param machinedef - The state machine definition to validate.
 * @throws Error if the state machine definition is invalid.
 */

export function validateStateMachine(machinedef: StateDefinition, path: string = machinedef.id): void {
	if (!machinedef.states) return;

	try {
		const stateIds = Object.keys(machinedef.states);

		if (!machinedef.initial)
			throw new Error(`No start state defined for state machine '${path}'`);

		if (!stateIds.includes(machinedef.initial))
			throw new Error(`Invalid start state '${machinedef.initial}', as that state doesn't exist in the machine '${path}'.`);

		for (const id of stateIds) {
			const stateDef = machinedef.states[id] as StateDefinition;
			const statePath = `${path}.${stateDef.id}`;

			const checkTransitions = (transitions: { [key: string]: Identifier | StateEventDefinition; }, description: string) => {
				if (!transitions) return;
				for (const t of Object.values(transitions)) {
					if (typeof t === 'string') {
						resolveStateDefPath(stateDef, t, statePath, description);
					} else {
						if (typeof t.to === 'string') resolveStateDefPath(stateDef, t.to, statePath, description);
						if (typeof t.switch === 'string') resolveStateDefPath(stateDef, t.switch, statePath, description);
						if (typeof t.do === 'string') {
							console.warn(`Handler '${t.do}' referenced in '${statePath}' is missing`);
						}
					}
				}
			};

			checkTransitions(stateDef.on, 'on transition');
			checkTransitions(stateDef.input_event_handlers, 'input event handler');
			for (const check of stateDef.run_checks ?? []) {
				if (typeof check === 'string') {
					resolveStateDefPath(stateDef, check, statePath, 'run check (string)');
				} else {
					if (typeof check.to === 'string') resolveStateDefPath(stateDef, check.to, statePath, 'run check (to)');
					if (typeof check.switch === 'string') resolveStateDefPath(stateDef, check.switch, statePath, 'run check (switch)');
					if (typeof check.do === 'string') {
						console.warn(`Handler '${check.do}' referenced in '${statePath}' is missing`);
					}
				}
			}

			const handlers = [stateDef.tick, stateDef.entering_state, stateDef.exiting_state, stateDef.tape_next, stateDef.tape_end, stateDef.process_input];
			const handlerNames = ['run', 'enter', 'exit', 'next', 'end', 'process_input'];
			handlers.forEach((h, idx) => {
				if (typeof h === 'string') {
					console.warn(`Handler '${h}' referenced in '${statePath}' for '${handlerNames[idx]}' is missing`);
				}
			});

			validateStateMachine(stateDef, statePath);
		}
	} catch (e) {
		console.error(`${e.stack || e.message || e}`);
	}
}

function resolveStateDefPath(from: StateDefinition, target: string, origin: string, description: string): void {
	// Accept both new filesystem-style paths and legacy '#this./#parent./#root.' prefixes
	const normalizeLegacy = (s: string): string => {
		if (s.startsWith(STATE_THIS_PREFIX + '.')) return `./${s.slice(STATE_THIS_PREFIX.length + 1).replaceAll('.', '/')}`;
		if (s.startsWith(STATE_PARENT_PREFIX + '.')) return `../${s.slice(STATE_PARENT_PREFIX.length + 1).replaceAll('.', '/')}`;
		if (s.startsWith(STATE_ROOT_PREFIX + '.')) return `/${s.slice(STATE_ROOT_PREFIX.length + 1).replaceAll('.', '/')}`;
		return s;
	};

	const raw = normalizeLegacy(target);

	// Simple single-pass parser for filesystem-like paths with quoting and escapes
	const parse = (input: string): { abs: boolean; up: number; segs: string[] } => {
		const len = input.length;
		let i = 0;
		let abs = false;
		let up = 0;
		const segs: string[] = [];

		if (len === 0) return { abs: false, up: 0, segs };
		if (input[i] === '/') { abs = true; i++; }

		if (!abs) {
			if (input.startsWith('./', i)) {
				i += 2;
			} else {
				while (input.startsWith('../', i)) { up++; i += 3; }
			}
		}

		const pushSeg = (s: string) => {
			if (s.length === 0 || s === '.') return;
			if (s === '..') {
				if (segs.length > 0) segs.pop(); else up++;
				return;
			}
			segs.push(s);
		};

		while (i < len) {
			const c = input[i];
			if (c === '/') { i++; continue; }
			if (c === '[' && i + 1 < len && input[i + 1] === '"') {
				i += 2; // skip ["
				let seg = '';
				while (i < len) {
					const ch = input[i++];
					if (ch === '\\') {
						if (i < len) {
							const esc = input[i++];
							if (esc === '"') seg += '"'; else if (esc === '/') seg += '/'; else seg += esc;
						}
						continue;
					}
					if (ch === '"' && i < len && input[i] === ']') { i++; break; }
					seg += ch;
				}
				pushSeg(seg);
				continue;
			}
			let start = i;
			while (i < len && input[i] !== '/') i++;
			pushSeg(input.slice(start, i));
		}

		return { abs, up, segs };
	};

	const spec = parse(raw);

	// Determine starting context
	let ctx: StateDefinition | undefined = spec.abs ? from.root : from;
	// Apply upward traversal
	for (let u = 0; u < spec.up; u++) {
		if (!ctx.parent) throw new Error(`Invalid state path '${target}' referenced from '${origin}': above root`);
		ctx = ctx.parent;
	}

	// Traverse segments
	for (const seg of spec.segs) {
		if (!ctx.states?.[seg]) {
			throw new Error(`[Validate state machines] Machine '${origin}' - Invalid state path '${target}': state '${seg}' not found in transition from state '${ctx.id}' (${description})`);
		}
		ctx = ctx.states[seg] as StateDefinition;
	}
}
