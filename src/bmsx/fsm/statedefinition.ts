import { EventLane, EventScope } from '../core/eventemitter';
import { type Identifier } from '../rompack/rompack';
import { excludepropfromsavegame } from '../serializer/serializationhooks';
import { type StateActionSpec, type StateEventDefinition, type StateEventHandler, type StateExitHandler, type StateGuard, type StateNextHandler, type Tape, type TickCheckDefinition, type id2partial_sdef } from './fsmtypes';
import { State } from './state';

function looksLikeStatePath(value: string): boolean {
	if (!value) return false;
	return value.startsWith('./') || value.startsWith('../') || value.startsWith('/') || value.startsWith('root:/') || value.startsWith('parent:/') || value.includes('/');
}

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

	public def_id: Identifier; // Full id including parent path (e.g. 'rootid:/parentid/thisid')

	/**
	 * Optional data associated with the bfsm.
	 */
	public data?: { [key: string]: any; };

	/**
	 * Indicates whether this state (or nested state machine) runs in parallel with
	 * the focused branch. Applies at every hierarchy level: a concurrent child
	 * ticks every frame without supplanting {@link State.currentid}, while
	 * non-concurrent children inherit focus and their own trees behave the same
	 * way recursively.
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
	 * Determines how the tape progresses when it reaches either end.
	 *
	 * - `once`: tapehead stops at the final entry.
	 * - `loop`: tapehead rewinds to the start after the last entry.
	 * - `pingpong`: tapehead inverts direction at the ends.
	 */
	public tape_playback_mode: 'once' | 'loop' | 'pingpong';

	/**
	 * Name of the easing curve used to distribute time across tape entries.
	 * When set, the easing curve adjusts the effective ticks-per-entry while
	 * preserving the total duration defined by {@link ticks2advance_tape}.
	 */
	public tape_playback_easing?: string;

	/**
	 * Specifies whether the tapehead should automatically advance based on ticks.
	 * If ticks2advance_tape is 0, the default is false. Otherwise, auto_tick is true (unless it was already defined)
	 */
	public enable_tape_autotick: boolean; // Automagically increase the ticks during run

	/**
	 * Controls how input handlers are evaluated for this state. Defaults to 'all'.
	 */
	public input_eval?: 'first' | 'all';

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

	@excludepropfromsavegame
	/**
	 * The root state machine definition.
	 */
	public root!: StateDefinition; // The root state machine definition

 	public event_list: { name: string; scope: EventScope; lane: EventLane | 'any' }[];

	private get is_root(): boolean { return this.root === this; }

	/**
	 * Generates a unique identifier for the current instance.
	 * The identifier is created by concatenating the parent machine's id (or the `target_id` for root machines) and the `def_id`.
	 * @returns The generated identifier.
	 */
	private make_id(): Identifier {
	if (this.is_root) return this.id;
		const parent = this.parent;
		if (!parent) {
			throw new Error(`StateDefinition '${this.id}' is missing a parent while computing def_id.`);
		}
		const parentId = parent.def_id ?? parent.id;
		const separator = parent.is_root ? ':/' : '/';
		return `${parentId}${separator}${this.id}`;
	}

	/**
	 * Constructs a new instance of the `bfsm` class.
	 * @param id - The ID of the `bfsm` instance.
	 * @param partialdef - An optional partial definition to assign to the `bfsm` instance.
	 */
	public constructor(id: Identifier, partialdef?: Partial<StateDefinition>, root: StateDefinition = null, parent: StateDefinition = null) {
		this.id = id;
		partialdef && Object.assign(this, partialdef); // Assign the partial definition to the instance
		this.ticks2advance_tape ??= 0; // Unless already defined, ticks2move is 0
		this.tape_playback_mode ??= 'once';
		this.repetitions = (this.tape_data ? (this.repetitions ?? 1) : 0);
		this.enable_tape_autotick = this.enable_tape_autotick ?? (this.ticks2advance_tape !== 0 ? true : false); // If ticks2advance_tape is 0, auto_tick is false. Otherwise, auto_tick is true (unless it was already defined)
		this.automatic_reset_mode = this.automatic_reset_mode ?? 'state'; // Unless already defined, auto_reset is true
		this.data ??= {}; // Unless already defined, data is an empty object
		this.root = root ?? this; // The root state machine is either the provided root or this state machine
		this.parent = parent; // The parent state machine is either the provided parent or null (for root machines)
		this.is_concurrent ??= false; // Unless already defined, parallel is false
		this.def_id = this.make_id(); // Alias for def_id

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
			const sub_sdef = this.#create_state(states[state_id], state_id, root, this);
			this.replace_partialsdef_with_sdef(sub_sdef, root);
			validateStateMachine(sub_sdef);
		}
		// At runtime the first registered child becomes active when no explicit
		// `initial` is provided; see the comment above {@link initial}. We mirror that
		// construction order here so the narrative in authoring tools matches engine
		// behaviour.
		if (substate_ids.length > 0 && !this.initial) { // Only look for a start state if we have at least one state in our definition
			this.initial = substate_ids[0]; // If no default state was defined, we default to the first state found in the list of states
		}
	}

	public tick?: StateEventHandler | string | StateActionSpec;
	public tape_end?: StateEventHandler | string | StateActionSpec;
	public tape_next?: StateNextHandler | string | StateActionSpec;
	public entering_state?: StateEventHandler | string | StateActionSpec;
	public exiting_state?: StateExitHandler | string | StateActionSpec;
	public process_input?: StateEventHandler | string | StateActionSpec;

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
	 *
	 * If omitted the runtime adopts the first child inserted during construction,
	 * keeping behaviour consistent with the controller-level default. States that
	 * carry a prefix from {@link START_STATE_PREFIXES} mark themselves as the
	 * explicit initial state without renaming, so authoring tools can preserve the
	 * original label.
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
	#create_state(partial: Partial<StateDefinition>, state_id: Identifier, root: StateDefinition, parent: StateDefinition): StateDefinition {
		if (!partial) throw new Error(`'sdef' with id '${state_id}' is missing definition while attempting to add it to this 'sdef'!`);
		return new StateDefinition(state_id, partial, root, parent);
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
	 * Appends a state to the list of states defined for this state machine.
	 * @param sub_sdef The state to append.
	 * @throws An error if the state is missing an id or if a state with the same id already exists for this state machine.
	 */
	public replace_partialsdef_with_sdef(sub_sdef: StateDefinition, root: StateDefinition): void {
		if (!sub_sdef.id) throw new Error(`'sub_sdef' is missing an id, while attempting to add it to this 'sdef'!`);
		// if (this.states[state.id]) throw new Error(`'sdef' with id='${state.id}' already exists for this 'sdef'!`);
		const initial_state = this.initial;
		if (this.#is_start_state(sub_sdef)) {
			if (initial_state && initial_state !== sub_sdef.id) {
				throw `State machine '${this.id}' already has a start state defined ('${initial_state}'). Thus, you chose to define multiple start states ('${initial_state}' and '${sub_sdef.id}'). Please define only one start state!`;
			}
			this.initial = sub_sdef.id;
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
		// Strict preflight checks for tape/ticks configuration on the current definition
		const checkTapeConfig = (def: StateDefinition, atPath: string) => {
			// Only validate when a tape is configured (otherwise ticks/autotick are irrelevant here)
			if (!def.tape_data) return;

			// ticks2advance_tape must be a finite number >= 0
			if (typeof def.ticks2advance_tape !== 'number' || !isFinite(def.ticks2advance_tape) || Number.isNaN(def.ticks2advance_tape) || def.ticks2advance_tape < 0) {
				throw new Error(`Invalid ticks2advance_tape for state '${atPath}': expected a number >= 0.`);
			}

			// When enable_tape_autotick is true, ticks2advance_tape must be > 0
			if (def.enable_tape_autotick && def.ticks2advance_tape <= 0) {
				throw new Error(`Invalid tape config in state '${atPath}': enable_tape_autotick requires ticks2advance_tape > 0 (got ${def.ticks2advance_tape}).`);
			}

			// repetitions must be >= 0 if defined
			if (def.repetitions != null && def.repetitions < 0) {
				throw new Error(`Invalid repetitions for state '${atPath}': expected a number >= 0.`);
			}
		};

		// Validate current definition first
		checkTapeConfig(machinedef, path);

		const stateIds = Object.keys(machinedef.states);

		if (!machinedef.initial)
			throw new Error(`No start state defined for state machine '${path}'`);

		if (!stateIds.includes(machinedef.initial))
			throw new Error(`Invalid start state '${machinedef.initial}', as that state doesn't exist in the machine '${path}'.`);

		for (const id of stateIds) {
			const stateDef = machinedef.states[id] as StateDefinition;
			const statePath = `${path}.${stateDef.id}`;

			// Strict preflight for each sub definition
			checkTapeConfig(stateDef, statePath);

			const checkTransitions = (transitions: { [key: string]: Identifier | StateEventDefinition; }, description: string) => {
				if (!transitions) return;
				for (const t of Object.values(transitions)) {
					if (typeof t === 'string') {
						resolveStateDefPath(stateDef, t, statePath, description);
					} else {
						if (typeof t.to === 'string') resolveStateDefPath(stateDef, t.to, statePath, description);
						if (typeof t.switch === 'string') resolveStateDefPath(stateDef, t.switch, statePath, description);
						if (typeof t.do === 'string' && !t.do.includes('.handlers.') && !looksLikeStatePath(t.do)) {
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
					if (typeof check.do === 'string' && !check.do.includes('.handlers.') && !looksLikeStatePath(check.do)) {
						console.warn(`Handler '${check.do}' referenced in '${statePath}' is missing`);
					}
				}
			}

			const handlers = [stateDef.tick, stateDef.entering_state, stateDef.exiting_state, stateDef.tape_next, stateDef.tape_end, stateDef.process_input];
			const handlerNames = ['run', 'enter', 'exit', 'next', 'end', 'process_input'];
			handlers.forEach((h, idx) => {
				if (typeof h === 'string' && !h.includes('.handlers.') && !looksLikeStatePath(h)) {
					console.warn(`Handler '${h}' referenced in '${statePath}' for '${handlerNames[idx]}' is missing`);
				}
			});

			validateStateMachine(stateDef, statePath);
		}
	} catch (e) {
		console.error(`[Validate state machines] ${e}`);
		console.error(`${e.stack || e.message || e}`);
		throw new Error(`State machine validation failed!`);
	}
}

function resolveStateDefPath(from: StateDefinition, target: string, origin: string, description: string): void {
	// // Simple single-pass parser for filesystem-like paths with quoting and escapes
	// const parse = (input: string): { abs: boolean; up: number; segs: string[] } => {
	// 	const len = input.length;
	// 	let i = 0;
	// 	let abs = false;
	// 	let up = 0;
	// 	const segs: string[] = [];

	// 	if (len === 0) return { abs: false, up: 0, segs };
	// 	if (input[i] === '/') { abs = true; i++; }

	// 	if (!abs) {
	// 		if (input.startsWith('./', i)) {
	// 			i += 2;
	// 		} else {
	// 			while (input.startsWith('../', i)) { up++; i += 3; }
	// 		}
	// 	}

	// 	const pushSeg = (s: string) => {
	// 		if (s.length === 0 || s === '.') return;
	// 		if (s === '..') {
	// 			if (segs.length > 0) segs.pop(); else up++;
	// 			return;
	// 		}
	// 		segs.push(s);
	// 	};

	// 	while (i < len) {
	// 		const c = input[i];
	// 		if (c === '/') { i++; continue; }
	// 		if (c === '[' && i + 1 < len && input[i + 1] === '"') {
	// 			i += 2; // skip ["
	// 			let seg = '';
	// 			while (i < len) {
	// 				const ch = input[i++];
	// 				if (ch === '\\') {
	// 					if (i < len) {
	// 						const esc = input[i++];
	// 						if (esc === '"') seg += '"'; else if (esc === '/') seg += '/'; else seg += esc;
	// 					}
	// 					continue;
	// 				}
	// 				if (ch === '"' && i < len && input[i] === ']') { i++; break; }
	// 				seg += ch;
	// 			}
	// 			pushSeg(seg);
	// 			continue;
	// 		}
	// 		let start = i;
	// 		while (i < len && input[i] !== '/') i++;
	// 		pushSeg(input.slice(start, i));
	// 	}

	// 	return { abs, up, segs };
	// };

	const spec = State.parseFsPath(target);

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
