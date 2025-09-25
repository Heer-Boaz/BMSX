import { Registry } from '../core/registry';
import { $ } from '../core/game';
import { Input } from '../input/input';
import { Identifiable, Identifier } from '../rompack/rompack';
import { insavegame, onload, type RevivableObjectArgs } from '../serializer/serializationhooks';
import { getEasing } from '../utils/easing';
import { BST_MAX_HISTORY, DEFAULT_BST_ID } from './fsmcontroller';
import { StateDefinitions } from './fsmlibrary';
import { type id2sstate, type Stateful, type StateTransition, type StateTransitionWithType, type Tape, type TransitionType, type StateEventDefinition, type TickCheckDefinition } from './fsmtypes';
import { StateDefinition } from './statedefinition';
import { EventPayload } from '../core/eventemitter';

const TAPE_START_INDEX = -1; // The index of the tape that is *before* the start of the tape, so that the first index of the tape is considered when the `next`-event is triggered

@insavegame
/**
 * Represents a state in a state machine.
 * @template T - The type of the world object or model associated with the state.
 */
export class State<T extends Stateful = Stateful> implements Identifiable {
	/** Path parsing and diagnostics configuration. */
	public static pathConfig = {
		enableLegacyAliases: false,
		cacheSize: 256,
	};

	/** Optional diagnostics toggles for development. */
	public static diagnostics = {
		logLegacyAliasUse: false,
		traceTransitions: false,
	};

	/** Simple path parse cache. */
	private static _pathCache = new Map<string, { abs: boolean, up: number, segs: readonly string[] }>();

	/** Parse filesystem-like path: '/', './', '../', quoting via ["..."] with escapes. */
	public static parseFsPath(input: string): { abs: boolean, up: number, segs: readonly string[] } {
		const hit = State._pathCache.get(input);
		if (hit) {
			State._pathCache.set(input, hit);
			return hit;
		}

		const len = input.length;
		let i = 0;
		let abs = false;
		let up = 0;
		const segs: string[] = [];

		if (len === 0) return { abs: false, up: 0, segs: [] };

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
				if (segs.length > 0) segs.pop();
				else up++;
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
				let closed = false;
				while (i < len) {
					const ch = input[i++];
					if (ch === '\\') {
						if (i < len) {
							const esc = input[i++];
							if (esc === '"') seg += '"';
							else if (esc === '/') seg += '/';
							else seg += esc;
						}
						continue;
					}
					if (ch === '"') { if (i < len && input[i] === ']') { i++; closed = true; break; } else { throw new Error(`Unterminated quoted segment in path '${input}'.`); } }
					seg += ch;
				}
				if (!closed) throw new Error(`Unterminated quoted segment in path '${input}'.`);
				pushSeg(seg);
				continue;
			}

			let start = i;
			while (i < len && input[i] !== '/') i++;
			pushSeg(input.slice(start, i));
		}

		if (State._pathCache.size >= State.pathConfig.cacheSize) {
			const firstKey = State._pathCache.keys().next().value as string | undefined;
			if (firstKey) State._pathCache.delete(firstKey);
		}
		const rec = { abs, up, segs: segs as readonly string[] };
		State._pathCache.set(input, rec);
		return rec;
	}

	/**
	 * The unique identifier of this specific instance of the state machine.
	* @see {@link make_id}
	 */
	id: Identifier;

	/**
	 * Direct reference to parent state
	 */
	private parent_ref?: State;

	/**
	 * Direct reference to root state
	 */
	private root_ref?: State;

	/** Parent state of this state (machine). */
	public get parent(): State | undefined { return this.parent_ref; }
	/** Root state of this state (machine). */
	public get root(): State { return this.root_ref ?? this; }
	public get is_root(): boolean { return this.root === this; }

	/**
	 * id of the state machine definition, which is the id of the state machine as defined in the StateDefinitions for root machines, or the id of the state for substate machines
	 * Note that the localdef_id is not necessarily unique, as multiple state machines can have substates with the same id.
	 * Also note that the localdef_id is not necessarily unique, as multiple instances of the same state machine definition can exist in the world.
	 * For the unique instance id, use the `id` property.
	 * For the unique definition id, used the `definition.def_id` property.
	 * @see {@link StateDefinitions}
	 */
	localdef_id!: Identifier;

	def_id!: Identifier; // The unique definition id of this state in the StateDefinitions-library

	/**
	 * Represents the substates of the FSM.
	 */
	states: id2sstate;

	/**
	 * Indicates whether the state machine is running in parallel with the 'current' state machine as defined in {@link StateMachineController.current_machine}.
	 */
	get is_concurrent(): boolean { return !!this.definition.is_concurrent; }

	/**
	 * Identifier of the active child state.
	 *
	 * The first child registered via {@link populateStates} becomes current when a
	 * definition does not specify `initial`, mirroring how the controller keeps the
	 * first machine focused. When a state transitions into a non-concurrent child,
	 * the child in turn drives its own subtree; concurrent children are ticked in
	 * addition to this `currentid` and therefore do not steal focus.
	 */
	currentid!: Identifier; // Identifier of current state

	/** Ring buffer for previous states (history). */
	private _hist!: Identifier[];
	private _histHead!: number;
	private _histSize!: number;

	/**
	 * Indicates whether the execution is paused.
	 */
	paused: boolean; // Iff paused, skip 'onrun'

	/**
	 * This state machine reflects the (partial) state of the world object with the given id
	 * @see {@link World.getWorldObject}
	 */
	target_id: Identifier;

	/**
	 * Represents the state data for the state machine that is shared across its states.
	 */
	public data: { [key: string]: any; } = {};

	/**
	 * Returns the world object or model that this state machine is associated with.
	 */
	public get target(): T { return $.registry.get<T>(this.target_id); }

	/**
	 * Returns the current state of the FSM
	 */
	public get current(): State | undefined { return this.states?.[this.currentid]; }

	/**
	 * Gets the definition of the current state machine.
	 * @returns The definition of the current state machine.
	 */
	public get definition(): StateDefinition { return StateDefinitions[this.def_id]; }

	/**
	 * Gets the id of the start state of the FSM.
	 * @returns The id of the start state of the FSM.
	 */
	public get start_state_id(): Identifier { return this.definition?.initial; }

	/**
	 * Represents the counter for the critical section.
	 */
	private critical_section_counter: number;

	/**
	 * Indicates whether we are currently draining the transition queue.
	 */
	private is_processing_queue: boolean;

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
			if (!this.is_processing_queue) this.process_transition_queue();
		}
		else if (this.critical_section_counter < 0) {
			throw new Error(`Critical section counter was lower than 0, which is obviously a bug. State: "${this.id}, StateDefId: "${this.localdef_id}.`);
		}
	}

	/**
	 * Executes a function within a critical section and ensures the section is exited.
	 */
	private withCriticalSection<T>(fn: () => T): T {
		this.enterCriticalSection();
		try { return fn(); }
		finally { this.leaveCriticalSection(); }
	}

	/**
	 * Processes the transition queue by transitioning to the next state in the queue.
	 * This method dequeues each state transition from the transition queue and transitions to the corresponding state.
	 */
	private process_transition_queue(): void {
		if (this.is_processing_queue) return;
		this.is_processing_queue = true;
		try {
			for (let i = 0; i < this.transition_queue.length; i++) {
				const t = this.transition_queue[i];
				this.transitionToState(t.state_id, t.transition_type, t.payload);
			}
			this.transition_queue.length = 0;
		} finally {
			this.is_processing_queue = false;
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
	 * @param localdef_id - id of the FSM definition to use for this machine.
	 * @param target_id - id of the object that is stated by this FSM. @see {@link World.getWorldObject}.
	 */
	public static create(localdef_id: Identifier, target_id: Identifier, parent?: State, root?: State): State {
		let result = new State({ localdef_id, target_id, parent, root });
		result.populateStates(); // Populate the states of the state machine with the states from the state machine definition (if any) and their states
		result.reset(true); // Reset the state machine to the start state to initialize the state machine and its substate machines

		return result;
	}

	/**
	 * Represents the context of a state in a finite state machine.
	 * Contains information about the current state, the state machine it belongs to, and any substate machines.
	 * @param def_id - id of the state machine definition to use for this machine.
	 * @param target_id - id of the object that is stated by this FSM. @see {@link World.getWorldObject}.
	 */
	constructor(opts: RevivableObjectArgs & { localdef_id: Identifier, target_id: Identifier, parent?: State, root?: State }) {
		this.localdef_id = opts.localdef_id ?? DEFAULT_BST_ID;
		this.target_id = opts.target_id;
		this.parent_ref = opts.parent;
		// If no explicit root provided, inherit from parent or become own root
		this.root_ref = opts.root ?? opts.parent?.root ?? this;
		this.def_id = this.parent ? this.parent.definition.states[this.localdef_id].def_id : StateDefinitions[this.localdef_id]?.def_id; // Resolve definition id from parent or root
		// Note that the definition can be empty, as not all objects have a defined machine.

		this.paused ??= false;
		// Note: do not initailize the states here, as this will be done in the populateStates function. Also, do not initialize the currentid here, as this will be done in the reset function
		// Note: do not initialize the history here, as this will be done in the reset function
		// Note: do not set the states to an empty object, as this state might not have any states defined. Instead, leave it as undefined, so that it can be checked if the state has states defined
		// When parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
		if (opts.localdef_id && opts.target_id) {
			this.id = this.make_id();
			this.transition_queue = [];
			this.critical_section_counter = 0;
			this.is_processing_queue = false;
			// Initialize history ring buffer
			this._hist = new Array(BST_MAX_HISTORY);
			this._histHead = 0;
			this._histSize = 0;
			// Registry.instance.register(this);
		}
	}

	@onload
	/**
	 * Performs the setup logic when the component is loaded.
	 */
	public onLoadSetup(): void {
		// Restore parent/root links after revive
		// if (!this.parent_ref) this.root_ref = this.root_ref ?? this;
		// if (this.states) {
		// 	for (const child of Object.values(this.states)) {
		// 		child.parent_ref = this;
		// 		child.root_ref = this.root;
		// 	}
		// }
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

		const startStateDef = this.states[startStateId].definition; // Get the start state definition from the state machine definition
		if (!startStateDef) throw new Error(`[State] start(): Start state '${startStateId}' not found in state machine '${this.id}'.`); // If the start state is not found in the states, throw an error

		// Trigger the enter event for the start state. Note that there is no definition for the none-state, so we don't trigger the enter event for that state.
		this.withCriticalSection(() => {
			const enterStart = startStateDef.entering_state;
			if (typeof enterStart === 'function') {
				enterStart.call(this.target, this.states[startStateId]);
			}
		});

		// Start the state machine for the current active state recursively
		this.states[startStateId].start();
	}

	/**
	 * Runs the current state of the FSM.
	 * If the FSM is paused, this function does nothing.
	 * Calls the process_input function of the current state, if it exists, with the state_event_type.None event type.
	 * Calls the run function of the current state, if it exists, with the state_event_type.Run event type.
	 */
	tick(): void {
		if (!this.definition || this.paused) return;

		this._transitionsThisTick = 0;
		this.in_tick = true;
		try {
			this.withCriticalSection(() => {
				if (!Registry.instance.has(this.id)) {
					Registry.instance.register(this);
				}
				// Run states first
				this.runSubstateMachines();
				// Process input for the current state
				this.processInput();
				// Run the current state's logic
				this.runCurrentState();
				// Execute run checks
				this.doRunChecks();
			});
		} finally {
			this.in_tick = false;
		}
	}

	/**
	 * Processes the input for the current state and transitions to the next state if provided.
	 */
	processInput(): void {
		if (this.paused) return;

		// Note that the input procesing is run first in the lowest substate, then in the parent state, and then in the parent of the parent state, and so on.
		// That is because the `runSubstateMachines` function is called before the `processInput` function, which means that the input processing is run in the states first.
		this.processInputForCurrentState();

		const processInput = this.definition.process_input;
		const next_state = typeof processInput === 'function' ? processInput.call(this.target, this) : undefined;
		this.transitionToNextStateIfProvided(next_state);
	}

	/**
	 * Processes the player input 'events' for the current state.
	 * If the current state has an 'on_input' property, it checks if the input matches any of the input patterns and executes the corresponding handler.
	 * @returns {void}
	 */
	private processInputForCurrentState(): void {
		const inputHandlers = this.definition.input_event_handlers;
		if (!inputHandlers) return;

		const playerIndex = this.target.player_index ?? 1;
		const p = Input.instance.getPlayerInput(playerIndex);
		const evalMode = this.resolveInputEvaluationMode();

		for (const inputPattern in inputHandlers) {
			const handler = inputHandlers[inputPattern];
			if (!handler) continue;
			if (!p.checkActionTriggered(inputPattern)) continue;
			this.handleStateTransition(handler);
			if (evalMode === 'first') break;
		}
	}

	private resolveInputEvaluationMode(): 'first' | 'all' {
		let node: State<any> | undefined = this;
		while (node) {
			const mode = node.definition.input_eval;
			if (mode === 'first' || mode === 'all') return mode;
			node = node.parent;
		}
		return 'all';
	}

	/**
	 * Runs the current state of the state machine.
	 * If the state has a `run` function defined in its definition, it calls that function.
	 * If the `run` function returns a next state, it transitions to that state.
	 * If the `run` function does not return a next state and `auto_tick` is enabled in the state definition, it increments the `ticks` counter.
	 */
	private runCurrentState(): void {
		const tickHandler = this.definition.tick;
		const next_state = typeof tickHandler === 'function' ? tickHandler.call(this.target, this) : undefined;
		if (next_state) {
			this.transitionToNextStateIfProvided(next_state);
		} else if (this.definition.enable_tape_autotick) {
			++this.ticks;
		}
	}

	/**
	 * Runs the substate machines.
	 */
	runSubstateMachines(): void {
		if (!this.states) return;

		const states = this.states;
		const cur = states[this.currentid];
		cur?.tick();
		// Parallel states run alongside the focused branch without stealing
		// `currentid`, providing the same behaviour as controller-level concurrent
		// machines.
		for (const [id, s] of Object.entries(states)) {
			if (id !== this.currentid && s.is_concurrent) s.tick();
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
		// That is because the `runSubstateMachines` function is called before the `doRunChecks` function, which means that the run checks are run in the states first.
		this.runChecksForCurrentState();
	}

	/**
	 * Executes the run checks defined in the state machine definition.
	 * If a run check condition is met, it might transition to the next state based on the provided logic.
	 */
	runChecksForCurrentState(): void {
		const checks = this.definition.run_checks;
		if (!checks) return;

		for (const rc of checks) {
			const condition = rc.if;
			if (typeof condition === 'function' && !condition.call(this.target, this)) continue;
			if (typeof condition === 'string') continue;
			this.handleStateTransition(rc);
			break; // First passing check wins
		}
	}

	/**
	 * Handles the given path and returns the current part, remaining parts, and current context.
	 * @param path - The path to handle, can be a string or an array of strings.
	 * @returns An array containing the current part, remaining parts, and current context.
	 * @throws {Error} If no state with the given ID is found.
	 */
	// Legacy helper removed; path handling now uses filesystem-style parser.

	/**
	 * Transition to a new state identified by the given ID. If the ID contains multiple parts separated by '/', it traverses through the states accordingly and switches the state of each part.
	 * If no parts are provided, the ID will be split by '/' to determine the parts.
	 * @param path - The ID of the state to transition to.
	 * @throws Error if the state with the given ID does not exist.
	 */
	public transition_to_path(path: string | string[], payload?: EventPayload): void {
		if (Array.isArray(path)) {
			let ctx: State = this;
			for (let idx = 0; idx < path.length; idx++) {
				const seg = path[idx];
				if (!ctx.states?.[seg]) throw new Error(`No state with ID '${seg}'`);
				const child = ctx.states[seg];
				if (!child.is_concurrent) ctx.transitionToState(seg, 'to', payload);
				ctx = child;
			}
			return;
		}

		const spec = State.parseFsPath(path);
		if (!spec.abs && spec.up === 0 && spec.segs.length === 0) {
			throw new Error(`Empty path is invalid.`);
		}
		let ctx: State = spec.abs ? this.root : this;
		for (let u = 0; u < spec.up; u++) {
			if (!ctx.parent) throw new Error(`Path '${path}' attempts to go above root.`);
			ctx = ctx.parent;
		}

		for (let i = 0; i < spec.segs.length; i++) {
			const seg = spec.segs[i];
			const child = ctx.states?.[seg];
			if (!child) {
				const keys = ctx.states ? Object.keys(ctx.states).join(', ') : '(none)';
				throw new Error(`No state '${seg}' under '${ctx.id}'. Children: ${keys}`);
			}
			if (!child.is_concurrent) ctx.transitionToState(seg, 'to', payload);
			ctx = child;
		}
	}

	/**
	 * Switches the state of the state machine to the specified ID.
	 * If the ID contains multiple parts separated by '/', it traverses through the states accordingly and only switches the state of the last part.
	 * Performs exit actions for the current state and enter actions for the new current state.
	 * Throws an error if the state with the specified ID doesn't exist or if the target state is parallel.
	 *
	 * @param path - The ID of the state to switch to.
	 * @returns void
	 */
	public transition_switch_path(path: string | string[], payload?: EventPayload): void {
		if (Array.isArray(path)) {
			let ctx: State = this;
			for (let i = 0; i < path.length - 1; i++) {
				const seg = path[i];
				const child = ctx.states?.[seg];
				if (!child) {
					const keys = ctx.states ? Object.keys(ctx.states).join(', ') : '(none)';
					throw new Error(`No state '${seg}' under '${ctx.id}'. Children: ${keys}`);
				}
				ctx = child;
			}
			if (path.length > 0) ctx.transitionToState(path[path.length - 1], 'switch', payload);
			return;
		}

		const spec = State.parseFsPath(path);
		let ctx: State = spec.abs ? this.root : this;
		for (let u = 0; u < spec.up; u++) {
			if (!ctx.parent) throw new Error(`Path '${path}' attempts to go above root.`);
			ctx = ctx.parent;
		}

		for (let i = 0; i < spec.segs.length - 1; i++) {
			const seg = spec.segs[i];
			const child = ctx.states?.[seg];
			if (!child) {
				const keys = ctx.states ? Object.keys(ctx.states).join(', ') : '(none)';
				throw new Error(`No state '${seg}' under '${ctx.id}'. Children: ${keys}`);
			}
			ctx = child;
		}
		if (spec.segs.length > 0) {
			ctx.transitionToState(spec.segs[spec.segs.length - 1], 'switch', payload);
		}
	}

	/**
	 * A transition type that doesn't re-enter any of the parents, but does force the leaf state to be re-entered, but only if any of the given parents in the path changed.
	 * @param path
	 * @param payload
	 */
	public transition_force_leaf(path: string | string[], payload?: EventPayload): void {
		let ctx: State;
		let segments: readonly string[];

		if (Array.isArray(path)) {
			if (path.length === 0) throw new Error(`Empty path is invalid.`);
			ctx = this;
			segments = path;
		} else {
			const spec = State.parseFsPath(path);
			if (!spec.abs && spec.up === 0 && spec.segs.length === 0) {
				throw new Error(`Empty path is invalid.`);
			}
			ctx = spec.abs ? this.root : this;
			for (let u = 0; u < spec.up; u++) {
				if (!ctx.parent) throw new Error(`Path '${path}' attempts to go above root.`);
				ctx = ctx.parent;
			}
			segments = spec.segs;
			if (segments.length === 0) throw new Error(`Empty path is invalid.`);
		}

		let parentChanged = segments.length === 1 ? ctx.currentid !== segments[0] : false;

		for (let i = 0; i < segments.length - 1; i++) {
			const seg = segments[i];
			const child = ctx.states?.[seg];
			if (!child) {
				const keys = ctx.states ? Object.keys(ctx.states).join(', ') : '(none)';
				throw new Error(`No state '${seg}' under '${ctx.id}'. Children: ${keys}`);
			}
			if (!child.is_concurrent && ctx.currentid !== seg) {
				ctx.transitionToState(seg, 'switch', payload);
				parentChanged = true;
			}
			ctx = child;
		}

		const leaf = segments[segments.length - 1];
		const leafState = ctx.states?.[leaf];
		if (!leafState) {
			const keys = ctx.states ? Object.keys(ctx.states).join(', ') : '(none)';
			throw new Error(`No state '${leaf}' under '${ctx.id}'. Children: ${keys}`);
		}
		if (parentChanged) ctx.transitionToState(leaf, 'to', payload);
	}

	private extractStateIdAndPayload(transition: Identifier | StateTransition | StateTransitionWithType, payload?: EventPayload): { state_id: Identifier, payload?: EventPayload } {
		if (typeof transition === 'string') {
			return { state_id: transition, payload };
		}
		return { state_id: transition.state_id, payload: transition.payload };
	}

	transition_to(state_id: Identifier, payload?: EventPayload): void;
	transition_to(transition: StateTransition): void;
	transition_to(state_or_transition: Identifier | StateTransition, payload?: EventPayload): void {
		const { state_id, payload: extractedPayload } = this.extractStateIdAndPayload(state_or_transition, payload);
		this.transition_to_path(state_id, extractedPayload);
	}

	switch_to_state(state_id: Identifier, payload?: EventPayload): void;
	switch_to_state(transition: StateTransition): void;
	switch_to_state(state_or_transition: Identifier | StateTransition, payload?: EventPayload): void {
		const { state_id, payload: extractedPayload } = this.extractStateIdAndPayload(state_or_transition, payload);
		this.transition_switch_path(state_id, extractedPayload);
	}

	force_leaf_transition(state_id: Identifier, payload?: EventPayload): void;
	force_leaf_transition(transition: StateTransition): void;
	force_leaf_transition(state_or_transition: Identifier | StateTransition, payload?: EventPayload): void {
		const { state_id, payload: extractedPayload } = this.extractStateIdAndPayload(state_or_transition, payload);
		this.transition_force_leaf(state_id, extractedPayload);
	}

	public get path(): string {
		if (this.is_root) return '/';
		const segments: string[] = [];
		let node: State | undefined = this;
		while (node && !node.is_root) {
			segments.push(node.currentid);
			node = node.parent;
		}
		return '/' + segments.reverse().join('/');
	}

	/**
	 * Checks if the current state matches the given path.
	 * Supports filesystem style (":/", "/", "./", "../") and array of segments.
	 */
	public matches_state_path(path: string | string[]): boolean {
		if (Array.isArray(path)) {
			// Relative match
			if (path.length === 0) return false;
			const [head, ...tail] = path;
			if (tail.length === 0) return this.currentid === head;
			const next = this.states?.[head];
			return !!next && next.matches_state_path(tail);
		}

		const spec = State.parseFsPath(path);
		let ctx: State = spec.abs ? this.root : this;
		for (let u = 0; u < spec.up; u++) {
			if (!ctx.parent) return false;
			ctx = ctx.parent;
		}
		if (spec.segs.length === 0) return false;
		let current: State = ctx;
		for (let i = 0; i < spec.segs.length - 1; i++) {
			const seg = spec.segs[i];
			const child = current.states?.[seg];
			if (!child) return false;
			current = child;
		}
		const last = spec.segs[spec.segs.length - 1];
		return current.currentid === last;
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
		const curDef = this.current_state_definition;
		const tgtDef = this.definition?.states?.[target_state_id];

		const exitGuard = curDef?.transition_guards?.can_exit;
		if (typeof exitGuard === 'function' && !exitGuard.call(this.target, this)) {
			return false;
		}

		const tgt = this.states?.[target_state_id];
		const enterGuard = tgtDef?.transition_guards?.can_enter;
		if (typeof enterGuard === 'function' && !enterGuard.call(this.target, tgt)) {
			return false;
		}

		return true;
	}

	/**
	 * Transition to the specified state.
	 * If the return value of the enter function is a string, it is assumed to be the ID of the next state to transition to.
	 *
	 * @param state_id - The identifier of the state to transition to.
	 * @param args - Optional arguments to pass to the state's enter and exit actions.
	 * @throws Error - If the state with the specified ID doesn't exist or if the target state is parallel.
	 */
	private _transitionsThisTick = 0;
	private in_tick = false;
	private static readonly MAX_TRANSITIONS_PER_TICK = 1000;

	private trace(msg: string): void {
		const diag: any = State.diagnostics;
		if (diag && diag.traceTransitions) {
			// eslint-disable-next-line no-console
			console.debug(`[FSM] ${this.id}: ${msg}`);
		}
	}

	private transitionToState(state_id: Identifier, transition_type: TransitionType, payload?: EventPayload): void {
		if (this.in_tick) {
			if (++this._transitionsThisTick > State.MAX_TRANSITIONS_PER_TICK) {
				throw new Error(`Transition limit exceeded in one tick for '${this.id}'.`);
			}
		}

		this.trace(`to='${state_id}' type='${transition_type}' from='${this.currentid}'`);
		if (this.critical_section_counter > 0) {
			this.transition_queue.push({ state_id, payload, transition_type: transition_type ?? 'to' });
			return;
		}

		if (transition_type === 'switch' && this.currentid === state_id) return;

		// If any state guard conditions fail, prevent the transition
		if (!this.checkStateGuardConditions(state_id)) return;

		this.withCriticalSection(() => {
			const prevId = this.currentid;
			const prevDef = this.current_state_definition;

			// Exit previous state
			const exitHandler = prevDef?.exiting_state;
			if (typeof exitHandler === 'function') {
				exitHandler.call(this.target, this.current, payload);
			}
			if (prevDef) this.pushHistory(prevId);

			// Switch current id
			this.currentid = state_id;
			const cur = this.current;
			const curDef = this.current_state_definition;
			if (!cur || !curDef) return; // No definition for the none-state
			if (curDef.is_concurrent) throw new Error(`Cannot transition to parallel state '${state_id}'!`);

			// Automatic reset behavior
			switch (curDef.automatic_reset_mode) {
				case 'state': cur.reset(false); break;
				case 'tree': cur.reset(true); break;
				case 'subtree': cur.resetSubmachine(true); break;
			}

			// Enter new state and possibly chain to next state
			const enterHandler = curDef.entering_state;
			const next = typeof enterHandler === 'function' ? enterHandler.call(this.target, cur, payload) : undefined;
			cur.transitionToNextStateIfProvided(next);
		});
	}

	/**
	 * Executes the specified event on the state machine.
	 *
	 * @param eventName - The name of the event to execute.
	 * @param emitter - The identifier or identifiable object that triggered the event.
	 * @param args - Additional arguments to pass to the event handler.
	 */
	public dispatch_event_to_root(eventName: string, emitter: Identifier, payload?: EventPayload): void {
		this.root.dispatch_event(eventName, emitter, payload);
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
	public dispatch_event(eventName: string, emitter_id: Identifier, payload?: EventPayload): void {
		if (this.paused) return;

		const hasChildren = !!this.states && Object.keys(this.states).length > 0;
		if (hasChildren) {
			const cur = this.current;
			const parallels = this.states ? Object.values(this.states).filter(s => s.is_concurrent) : [];
			cur?.dispatch_event(eventName, emitter_id, payload);
			for (const s of parallels) s.dispatch_event(eventName, emitter_id, payload);
			return;
		}

		let current: State | undefined = this;
		while (current) {
			if (current.handleEvent(eventName, emitter_id, payload)) return;
			current = current.parent;
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
			return { state_id: next_state };
		}

		if (typeof next_state === 'object') {
			return { ...next_state };
		}

		throw new Error(`Invalid type for next state: ${next_state}, expected string or object`);
	}

	/**
	 * Transitions to the next state if provided.
	 *
	 * @param next_state - The next state to transition to.
	 */
	private transitionToNextStateIfProvided(next_state: StateTransition | string | void, transition_type?: TransitionType): void {
		const next_state_transition = this.getNextState(next_state);

		// If the next state is not the current state, transition to the next state
		if (next_state_transition) {
			switch (transition_type) {
				case 'switch':
					this.switch_to_state(next_state_transition.state_id, next_state_transition.payload);
					break;
				case 'force_leaf':
					this.force_leaf_transition(next_state_transition.state_id, next_state_transition.payload);
					break;
				case 'revert':
					this.pop_and_transition();
					break;
				case 'to':
				default:
					this.transition_to(next_state_transition.state_id, next_state_transition.payload);
					break;
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
	private handleEvent(eventName: string, emitter_id: Identifier, payload?: EventPayload): boolean {
		if (this.paused) return false;
		return this.withCriticalSection(() => {
			const spec = this.definition?.on?.[eventName];
			if (!spec) return false;
			if (typeof spec !== 'string') {
				const scope = spec.scope;
				if (scope && scope !== 'all' && scope !== emitter_id) return false;
			}
			return this.handleStateTransition(spec, payload);
		});
	}

	private handleStateTransition(action: Identifier | StateEventDefinition | TickCheckDefinition | undefined, payload?: EventPayload): boolean {
		if (!action) return false;

		// Simple string → always a transition, thus handled.
		if (typeof action === 'string') {
			if (isNoOpString(action)) return true;
			this.transition_to(action, payload);
			return true;
		}

		const cond = action.if;
		if (typeof cond === 'function' && !cond.call(this.target, this as State<T>, payload)) return false;

		let didRunDo = false;

		// Run 'do' and interpret optional next state
		const doHandler = action.do;
		if (typeof doHandler === 'string' && isNoOpString(doHandler)) {
			didRunDo = true;
		}
		else if (typeof doHandler === 'function') {
			didRunDo = true;
			const next = this.getNextState(doHandler.call(this.target, this as State<T>, payload));
			if (next) {
				if (next.force_transition_to_same_state && next.transition_type && next.transition_type !== 'to') {
					throw new Error(`The 'force_transition_to_same_state' property is only allowed for 'to' transitions, not for 'switch' transitions!`);
				}
				switch (next.transition_type) {
					case 'switch':
						this.switch_to_state(next.state_id, next.payload);
						break;
					case 'force_leaf':
						this.force_leaf_transition(next.state_id, next.payload);
						break;
					case 'revert':
						this.pop_and_transition();
						break;
					case 'to':
					default:
						this.transition_to(next.state_id, next.payload);
						break;
				}
				return true;
			}
		}

		// Fallback explicit transitions even if do() ran but did not transition
		if (action.to) {
			const t = this.getNextState(action.to);
			if (t) {
				this.transition_to(t.state_id, t.payload);
				return true;
			}
		}
		if (action.switch) {
			const s = this.getNextState(action.switch);
			if (s) {
				this.switch_to_state(s.state_id, s.payload);
				return true;
			}
		}
		if (action.force_leaf) {
			const f = this.getNextState(action.force_leaf);
			if (f) {
				this.force_leaf_transition(f.state_id, f.payload);
				return true;
			}
		}
		if (action.revert) {
			this.pop_and_transition();
			return true;
		}

		// If do() ran (even without transition), consider the event handled
		return didRunDo;
	}

	/**
	 * Adds the given state ID to the history stack, which tracks the previous states of the state machine.
	 * If the history stack exceeds the maximum length, the oldest state is removed from the stack.
	 * @param toPush - the state ID to add to the history stack
	 */
	protected pushHistory(toPush: Identifier): void {
		const cap = BST_MAX_HISTORY;
		const tailIndex = (this._histHead + this._histSize) % cap;
		this._hist[tailIndex] = toPush;
		if (this._histSize < cap) {
			this._histSize++;
		} else {
			// Buffer full: advance head to overwrite oldest
			this._histHead = (this._histHead + 1) % cap;
		}
	}

	/**
	 * Goes back to the previous state in the history stack.
	 * If there is no previous state, nothing happens.
	 */
	public pop_and_transition(): void {
		if (this._histSize <= 0) return;
		const cap = BST_MAX_HISTORY;
		const tailIndex = (this._histHead + this._histSize - 1 + cap) % cap;
		const poppedStateId = this._hist[tailIndex];
		this._histSize--;
		if (poppedStateId) this.transition_to(poppedStateId);
	}

	/** Returns a snapshot of the history ring buffer from oldest to newest. */
	public getHistorySnapshot(): Identifier[] {
		const out: Identifier[] = [];
		for (let i = 0; i < this._histSize; i++) {
			out.push(this._hist[(this._histHead + i) % BST_MAX_HISTORY]);
		}
		return out;
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
			let state = new State({ localdef_id: sdef_id, target_id: this.target_id, parent: this, root: this.root });
			this.add(state);
			state.populateStates(); // Populate the states of the state
		}
		// If no current state is set, set the state to the first state that it finds in the set of states
		if (!this.currentid) this.currentid = this.states ? Object.keys(this.states)[0] : undefined;
	}

	/**
	 * Adds the given states to the state machine.
	 * If a state with the same ID already exists in the state machine, an error is thrown.
	 * @param states - the states to add to the state machine
	 * @throws Error if a state with the same ID already exists in the state machine
	 */
	private add(...states: State[]): void {
		for (let state of states) {
			if (!state.localdef_id) throw new Error(`State is missing an id, while attempting to add it to this sstate '${this.localdef_id}'!`);
			if (this.states[state.localdef_id]) throw new Error(`State ${state.localdef_id} already exists for sstate '${this.localdef_id}'!`);
			this.states[state.localdef_id] = state;
		}
	}

	/**
	 * Returns the tape associated with the state machine definition.
	 * If no tape is defined, returns undefined.
	 * @returns The tape associated with the state machine definition, or undefined if not found.
	 */
	public get tape(): Tape { return this.definition?.tape_data; }

	/**
	 * Returns the current value of the tape at the position of the tape head.
	 * If there is no tape or the tape head is beyond the end of the tape, returns undefined.
	 */
	public get current_tape_value(): any {
		const t = this.tape;
		const i = this.tapehead_position;
		if (!t || t.length === 0) return undefined;
		if (i < 0 || i >= t.length) return undefined;
		return t[i];
	}

	/**
	 * Indicates whether the head of the finite state machine is at the end of the tape.
	 * If there is no tape, it also returns true.
	 * @returns A boolean value indicating whether the head is at the end of the tape.
	 */
	public get is_at_tape_end(): boolean { return !this.tape || this.tapehead_position >= this.tape.length - 1; } // Note that beyond end also returns true if there is no tape!

	/**
	 * Determines whether the tape head is currently beyond the end of the tape.
	 * Returns true if the tape head is beyond the end of the tape or if there is no tape, false otherwise.
	 * Note that this function assumes that the tape head is within the bounds of the tape.
	 */
	protected get is_tape_exhausted(): boolean { return !this.tape || this.tapehead_position >= this.tape.length; } // Note that beyond end also returns true if there is no tape!

	/**
	 * Returns whether the tape head is currently before the start of the tape,
	 * which is given by index `-1`.
	 * If there is no tape, it also returns true.
	 * @returns A boolean value indicating whether the tape head is before the start of the tape.
	 */
	public get is_tape_rewound_to_start(): boolean { return this.tapehead_position === TAPE_START_INDEX; }

	/**
	 * Generates a unique identifier for the current instance.
	 * The identifier is created by concatenating the parent machine's id (or the `target_id` for root machines) and the `def_id`.
	 * @returns The generated identifier.
	 */
	private make_id(): Identifier {
		let parentPart: Identifier;
		let thisPart: Identifier;
		if (this.is_root) {
			parentPart = this.target_id + '.';
			thisPart = this.localdef_id;
		}
		else {
			if (this.parent_ref.is_root) parentPart = this.parent_ref.id + ':/';
			else parentPart = this.parent_ref.id + '/';
			thisPart = this.localdef_id;
		}
		const id = parentPart + thisPart;
		return id;
	}

	/**
	 * Disposes the current state machine and deregisters it from the registry.
	 * Also deregisters all states.
	 */
	public dispose(): void {
		// Also deregister all states
		if (!this.states) return;
		for (let state in this.states) {
			this.states[state].dispose();
		}
	}

	public bind(): void {
		// No-op
		// Registry.instance.register(this);
	}

	public unbind(): void {
		// No-op
		// Registry.instance.deregister(this);
	}

	/**
	 * The position of the tape head.
	 */
	protected _tapehead!: number;
	private _tapeTickThreshold: number = Number.POSITIVE_INFINITY;
	private _tapePlaybackDirection: 1 | -1 = 1;

	/**
	 * Gets the current position of the tapehead.
	 * @returns The current position of the tapehead.

	 */
	public get tapehead_position(): number {
		return this._tapehead;
	}

	/**
	 * Sets the current position of the tapehead to the given value.
	 * If the tapehead is going out of bounds, the tapehead is moved to the beginning or end of the tape, depending on the state machine definition.
	 * If the tapehead is moved, the tapemove event is triggered.
	 * If the tapehead reaches the end of the tape, the tapeend event is triggered.
	 * @param v - the new position of the tapehead
	 */
	public set tapehead_position(v: number) {
		this.enterCriticalSection();
		try {
			this._ticks = 0; // Always reset tapehead ticks after moving tapehead
			const tape = this.tape;
			const mode = this.definition?.tape_playback_mode ?? 'once';

			if (!tape || tape.length === 0) {
				this._tapehead = TAPE_START_INDEX;
				this._tapePlaybackDirection = 1;
				this.tapemove();
				this.tapeend();
				this.updateTapeTickThreshold();
				return;
			}

			if (mode !== 'pingpong') this._tapePlaybackDirection = 1;

			const lastIndex = tape.length - 1;

			if (v < 0) {
				if (mode === 'pingpong') {
					this._tapehead = 0;
					this._tapePlaybackDirection = 1;
					this.tapeend();
				} else {
					this._tapehead = 0;
					this.tapemove();
					this.tapeend();
				}
				this.updateTapeTickThreshold();
				return;
			}

			if (v > lastIndex) {
				if (mode === 'loop') {
					this._tapehead = 0;
					this._tapePlaybackDirection = 1;
					this.tapemove(true);
				} else if (mode === 'pingpong') {
					this._tapehead = lastIndex;
					if (lastIndex > 0) this._tapePlaybackDirection = -1;
					this.tapeend();
					this.updateTapeTickThreshold();
					return;
				} else {
					this._tapehead = lastIndex;
					this.tapeend();
					this.updateTapeTickThreshold();
					return;
				}
				this.tapeend();
				this.updateTapeTickThreshold();
				return;
			}

			this._tapehead = v; // Move the tape to new position
			this.tapemove();
			this.updateTapeTickThreshold();
		} finally {
			this.leaveCriticalSection();
		}
	}

	// Sets the current position of the tapehead to the given value without triggering any events or side effects.
	// @param v - the new position of the tapehead
	public setHeadNoSideEffect(v: number) {
		this._tapehead = v;
		this.updateTapeTickThreshold();
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
		const def = this.definition;
		if (!def) return;
		const base = def.ticks2advance_tape;
		if (base <= 0) {
			this.advanceTapehead();
			return;
		}
		if (v >= this._tapeTickThreshold) {
			this.advanceTapehead();
		}
	}

	private advanceTapehead(): void {
		const tape = this.tape;
		const mode = this.definition?.tape_playback_mode ?? 'once';
		if (!tape || tape.length === 0) {
			this.tapehead_position = this._tapehead + 1;
			return;
		}

		const direction = mode === 'pingpong' ? this._tapePlaybackDirection : 1;
		const nextIndex = this._tapehead + direction;
		this.tapehead_position = nextIndex;
	}

	private computeTapeProgress(index: number): number {
		const tape = this.tape;
		if (!tape || tape.length === 0) return 0;
		const len = tape.length;
		const clamped = Math.max(-1, Math.min(len, index));
		if (clamped <= -1) return 0;
		if (clamped >= len) return 1;
		return (clamped + 1) / len;
	}

	private updateTapeTickThreshold(): void {
		const def = this.definition;
		if (!def) {
			this._tapeTickThreshold = Number.POSITIVE_INFINITY;
			return;
		}
		const base = def.ticks2advance_tape;
		if (base <= 0) {
			this._tapeTickThreshold = base;
			return;
		}
		const tape = this.tape;
		if (!tape || tape.length === 0) {
			this._tapeTickThreshold = base;
			return;
		}
		const easingName = def.tape_playback_easing;
		if (!easingName) {
			this._tapeTickThreshold = base;
			return;
		}
		const easing = getEasing(easingName);
		const before = this.computeTapeProgress(this._tapehead);
		const after = this.computeTapeProgress(this._tapehead + this._tapePlaybackDirection);
		if (after === before) {
			this._tapeTickThreshold = Number.POSITIVE_INFINITY;
			return;
		}
		const delta = Math.abs(easing(after) - easing(before));
		const totalSegments = tape.length;
		const scaled = base * (delta > 0 ? delta * totalSegments : 1);
		this._tapeTickThreshold = Math.max(scaled, Number.EPSILON);
	}

	/**
	 * Calls the next state's function.
	 * @param tape_rewound Indicates whether the tape has been rewound as part of loop playback.
	 */
	protected tapemove(tape_rewound: boolean = false) {
		this.enterCriticalSection();
		try {
			const tapeNext = this.definition.tape_next;
			const next_state = typeof tapeNext === 'function' ? tapeNext.call(this.target, this, { tape_rewound }) : undefined;
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
			const tapeEnd = this.definition.tape_end;
			const next_state = typeof tapeEnd === 'function' ? tapeEnd.call(this.target, this) : undefined;
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
		this._tapePlaybackDirection = 1;
		this.updateTapeTickThreshold();
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
		const start = this.definition?.initial; // Definition doesn't need to exist
		this.currentid = start; // Set the current state to the start state (if it exists)
		// Reset history ring buffer
		this._histHead = 0;
		this._histSize = 0;
		this.paused = false;
		if (!this.definition) return; // If the definition doesn't exist, the state machine is empty and there is nothing to reset
		this.data = { ...this.definition.data }; // Reset the state machine data by shallow copying the definition's data
		if (reset_tree && this.states) {
			// Call the reset function for each state
			for (let state of Object.values(this.states)) {
				state.reset(reset_tree);
			}
		}
	}
}
function isNoOpString(value: string): boolean {
	if (!value) return false;
	const lower = value.trim().toLowerCase();
	return lower === 'no-op' || lower === 'noop' || lower === 'no_op';
}
