import { type Identifier } from '../rompack/rompack';
import { excludepropfromsavegame } from '../serializer/serializationhooks';
import { type StateActionSpec, type StateEventDefinition, type StateEventHandler, type StateExitHandler, type StateGuard, type TickCheckDefinition, type id2partial_sdef, type StateTimelineMap, type listed_sdef_event } from './fsmtypes';
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
 * including its unique identifier, associated data, and event handling.
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
	 * Controls how input handlers are evaluated for this state. Defaults to 'all'.
	 */
	public input_eval?: 'first' | 'all';

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

	public event_list: listed_sdef_event[];

	public timelines?: StateTimelineMap;


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
		const timelines = partialdef?.timelines;
		partialdef && Object.assign(this, partialdef); // Assign the partial definition to the instance
		this.timelines = timelines ? { ...timelines } : undefined;
		this.data ??= {}; // Unless already defined, data is an empty object
		this.root = root ?? this; // The root state machine is either the provided root or this state machine
		this.parent = parent; // The parent state machine is either the provided parent or null (for root machines)
		this.is_concurrent ??= false; // Unless already defined, parallel is false
		this.def_id = this.make_id(); // Alias for def_id
		if (partialdef.states) {
			this.construct_substate_machine(partialdef.states, this.root);
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
	public entering_state?: StateExitHandler | string | StateActionSpec;
	public exiting_state?: StateExitHandler | string | StateActionSpec;
	public process_input?: StateEventHandler | string | StateActionSpec;

	/**
	 * Represents the mapping of event types to state IDs for transitions to other states based on events (e.g. 'click' => 'idle').
	 * At the individual state level, the `on` property defines the transitions that can occur from that specific state.
	 * Event names are evaluated relative to the object emitting them, so no special `$` prefixes or manual scope declarations are required. Legacy blueprints that still prefix names with `$` are normalized automatically but it is discouraged.
	 * @example
	 * ```typescript
	   * {
		 *	'click': 'idle',
	   *	'game_end': 'prepare_for_end_of_the_world_I_mean_game',
	 *		'drag': {
	 *			do(this: TargetClass, state: sstate) {
	 *				if (!state.data.dragging) return;
	 *				state.data.dragging = false;
	 *				return 'idle';
	 *			},
	 *		},
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
	try {
		if (!machinedef.states) return;

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
						if (typeof t.go === 'string') {
							if (looksLikeStatePath(t.go)) {
								resolveStateDefPath(stateDef, t.go, statePath, description);
							} else if (!t.go.includes('.handlers.')) {
								console.warn(`Handler '${t.go}' referenced in '${statePath}' is missing`);
							}
						}
					}
				}
			};

			checkTransitions(stateDef.on, 'on transition');
			checkTransitions(stateDef.input_event_handlers, 'input event handler');
			for (const check of stateDef.run_checks ?? []) {
				if (typeof check === 'string') {
					resolveStateDefPath(stateDef, check, statePath, 'run check (string)');
				} else if (typeof check.go === 'string') {
					if (looksLikeStatePath(check.go)) {
						resolveStateDefPath(stateDef, check.go, statePath, 'run check (do)');
					} else if (!check.go.includes('.handlers.')) {
						console.warn(`Handler '${check.go}' referenced in '${statePath}' is missing`);
					}
				}
			}

			const handlers = [stateDef.tick, stateDef.entering_state, stateDef.exiting_state, stateDef.process_input];
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
	const spec = State.parseFsPath(target);

	// Determine starting context
	let ctx: StateDefinition = spec.abs ? from.root : from;
	// Apply upward traversal
	for (let u = 0; u < spec.up; u++) {
		if (!ctx.parent) throw new Error(`Invalid state path '${target}' referenced from '${origin}': above root`);
		ctx = ctx.parent;
	}

	// Traverse segments
	for (const seg of spec.segs) {
		const states = ctx.states;
		if (!states) {
			throw new Error(`[Validate state machines] Machine '${origin}' - Invalid state path '${target}': state '${seg}' not found in transition from state '${ctx.id}' (${description})`);
		}
		const child = (states[seg] ?? states[`_${seg}`] ?? states[`#${seg}`]) as StateDefinition;
		if (!child) {
			throw new Error(`[Validate state machines] Machine '${origin}' - Invalid state path '${target}': state '${seg}' not found in transition from state '${ctx.id}' (${description})`);
		}
		ctx = child;
	}
}
