import { $ } from '../core/game';
import { Input } from '../input/input';
import { Identifiable, Identifier } from '../rompack/rompack';
import { insavegame, onload } from '../serializer/gameserializer';
import { BST_MAX_HISTORY, DEFAULT_BST_ID } from './fsmcontroller';
import { StateDefinitions } from './fsmlibrary';
import { STATE_PARENT_PREFIX, STATE_ROOT_PREFIX, STATE_THIS_PREFIX, type id2sstate, type Stateful, type StateTransition, type StateTransitionWithType, type Tape, type TransitionType } from './fsmtypes';
import { StateDefinition } from './statedefinition';

const TAPE_START_INDEX = -1; // The index of the tape that is *before* the start of the tape, so that the first index of the tape is considered when the `next`-event is triggered

@insavegame
/**
 * Represents a state in a state machine.
 * @template T - The type of the game object or model associated with the state.
 */
export class State<T extends Stateful = Stateful> implements Identifiable {
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

    /**
     * The parent state of the state (machine).
     */
    public get parent(): State { return $.registry.get(this.parent_id); }

    /**
     * The identifier of this specific instance of the state machine's root machine.
     * @see {@link make_id}
     */
    root_id: Identifier;

    /**
     * The root state of the state (machine).
     */
    public get root(): State { return $.registry.get(this.root_id); }

    /**
     * The unique identifier for the bfsm.
     */
    def_id: Identifier;

    /**
     * Represents the states of the Bfsm.
     */
    substates: id2sstate;

    /**
     * Indicates whether the state machine is running in parallel with the 'current' state machine as defined in {@link StateMachineController.current_machine}.
     */
    get is_concurrent(): boolean { return this.definition?.is_concurrent; }

    /**
     * Identifier of the current state.
     */
    currentid!: Identifier; // Identifier of current state

    /**
     * History of previous states.
     */
    past_states!: Array<Identifier>; // History of previous state (as ids)

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
    public data: { [key: string]: any; } = {};

    /**
     * Returns the game object or model that this state machine is associated with.
     */
    public get target(): T { return $.registry.get<T>(this.target_id); }

    /**
     * Returns the current state of the FSM
     */
    public get current(): State { return this.substates?.[this.currentid]; }

    /**
     * Gets the state with the given id from the state machine.
     * Used for referencing states from within the state instance, instead
     * of referencing states from the state machine definition.
     * @param id - id of the state, according to its definition
     */
    public get_sstate(id: Identifier) { return this.substates?.[id]; }

    /**
     * Gets the definition of the current state machine.
     * @returns The definition of the current state machine.
     */
    public get definition(): StateDefinition { return (this.parent ? this.parent.definition.substates[this.def_id] : StateDefinitions[this.def_id]) as StateDefinition; }

    /**
     * Gets the id of the start state of the FSM.
     * @returns The id of the start state of the FSM.
     */
    public get start_state_id(): Identifier { return this.definition?.start_state_id; }

    /**
     * Represents the counter for the critical section.
     */
    private critical_section_counter: number;

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
            this.process_transition_queue();
        }
        else if (this.critical_section_counter < 0) {
            throw new Error(`Critical section counter was lower than 0, which is obviously a bug. State: "${this.id}, StateDefId: "${this.def_id}.`);
        }
    }

    /**
     * Processes the transition queue by transitioning to the next state in the queue.
     * This method dequeues each state transition from the transition queue and transitions to the corresponding state.
     */
    private process_transition_queue(): void {
        while (this.transition_queue.length > 0) {
            const state_transition = this.transition_queue.shift();
            this.transitionToState(state_transition.state_id, state_transition.transition_type, ...state_transition.args);
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
     * @param id - id of the FSM definition to use for this machine.
     * @param target_id - id of the object that is stated by this FSM. @see {@link BaseModel.getGameObject}.
     */
    public static create(id: Identifier, target_id: Identifier, parent_id: Identifier, root_id: Identifier): State {
        let result = new State(id, target_id, parent_id, root_id);
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
    constructor(def_id: Identifier, target_id: Identifier, parent_id: Identifier, root_id: Identifier) {
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
            this.transition_queue = [];
            this.critical_section_counter = 0;
            $.registry.register(this);
        }
        this.root_id = root_id ?? this.id;
    }

    @onload
    /**
     * Performs the setup logic when the component is loaded.
     */
    public onLoadSetup(): void {
    }

    /**
     * Starts the state machine by transitioning to the start state and triggering the enter event for that state.
     * If there are no states defined, the state machine will not start and the method will return early.
     * If there are states defined but no start state, an error will be thrown as the state machine cannot start without a start state.
     */
    public start(): void {
        const startStateId = this.start_state_id;
        if (!startStateId) {
            if (!this.substates) return; // If there are no states defined, there is no start state to start the state machine with and we can return early
            throw new Error(`No start state defined for state machine '${this.id}', while the state machine has states defined.'`); // If there are states defined, but no start state, throw an error as we can't start the state machine
        }

        const startStateDef = this.get_sstate(startStateId)?.definition; // Get the start state definition from the state machine definition


        // Trigger the enter event for the start state. Note that there is no definition for the none-state, so we don't trigger the enter event for that state.
        this.enterCriticalSection();
        startStateDef?.entering_state?.call(this.target, this.get_sstate(startStateId));
        this.leaveCriticalSection();

        // Start the state machine for the current active state
        this.substates[startStateId].start();
    }

    /**
     * Runs the current state of the FSM.
     * If the FSM is paused, this function does nothing.
     * Calls the process_input function of the current state, if it exists, with the state_event_type.None event type.
     * Calls the run function of the current state, if it exists, with the state_event_type.Run event type.
     */
    tick(): void {
        if (!this.definition || this.paused) return;

        this.enterCriticalSection();
        try {
            // Run substates first
            this.runSubstateMachines();

            // Process input for the current state
            this.processInput();

            // Run the current state's logic
            this.runCurrentState();

            // Execute run checks
            this.doRunChecks();
        } finally {
            this.leaveCriticalSection();
        }
    }

    /**
     * Processes the input for the current state and transitions to the next state if provided.
     */
    processInput(): void {
        if (this.paused) return;

        // Note that the input procesing is run first in the lowest substate, then in the parent state, and then in the parent of the parent state, and so on.
        // That is because the `runSubstateMachines` function is called before the `processInput` function, which means that the input processing is run in the substates first.
        this.processInputForCurrentState();

        const next_state = this.definition.process_input?.call(this.target, this);
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

        for (const inputPattern in inputHandlers) {
            const handler = inputHandlers[inputPattern];
            if (Input.instance.getPlayerInput(playerIndex).checkActionTriggered(inputPattern)) {
                Input.instance.getPlayerInput(playerIndex).consumeAction(inputPattern);
                this.handleStateTransition(handler);
            }
        }
    }

    /**
     * Runs the current state of the state machine.
     * If the state has a `run` function defined in its definition, it calls that function.
     * If the `run` function returns a next state, it transitions to that state.
     * If the `run` function does not return a next state and `auto_tick` is enabled in the state definition, it increments the `ticks` counter.
     */
    private runCurrentState(): void {
        const next_state = this.definition.tick?.call(this.target, this);
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
        if (!this.substates) return;

        this.current.tick();
        for (const id in this.substates) {
            if (id === this.currentid) continue;
            if (this.substates[id].is_concurrent) this.substates[id].tick();
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
        // That is because the `runSubstateMachines` function is called before the `doRunChecks` function, which means that the run checks are run in the substates first.
        this.runChecksForCurrentState();
    }

    /**
     * Executes the run checks defined in the state machine definition.
     * If a run check condition is met, it might transition to the next state based on the provided logic.
     */
    runChecksForCurrentState(): void {
        const run_checks = this.definition.run_checks;
        if (!run_checks) return;

        for (const run_check of run_checks) {
            if (run_check.if.call(this.target, this)) {
                const handled = this.handleStateTransition(run_check.do);
                if (handled) {
                    break;
                }
                if (run_check.to) {
                    this.transitionToNextStateIfProvided(run_check.to);
                } else if (run_check.switch) {
                    this.transitionToNextStateIfProvided(run_check.switch, true);
                }
                break;
            }
        }
    }

    /**
     * Handles the given path and returns the current part, remaining parts, and current context.
     * @param path - The path to handle, can be a string or an array of strings.
     * @returns An array containing the current part, remaining parts, and current context.
     * @throws {Error} If no state with the given ID is found.
     */
    private handle_path(path: string | string[]): [string, string[], State] {
        let parts: string[];
        if (typeof path === 'string') {
            parts = path.split('.');
        } else {
            parts = path;
        }

        let currentPart = parts[0];
        let restParts = parts.slice(1);

        let currentContext: State;
        switch (currentPart) {
            case STATE_THIS_PREFIX:
                currentContext = this;
                [currentPart, ...restParts] = restParts;
                break;
            case STATE_PARENT_PREFIX:
                currentContext = this.parent;
                [currentPart, ...restParts] = restParts;
                break;
            case STATE_ROOT_PREFIX:
                currentContext = this.root;
                [currentPart, ...restParts] = restParts;
                break;
            default:
                currentContext = this.substates?.[currentPart];
                if (!currentContext) throw new Error(`No state with ID '${currentPart}'`);
                break;
        }

        return [currentPart, restParts, currentContext];
    }

    /**
     * Transition to a new state identified by the given ID. If the ID contains multiple parts separated by '.', it traverses through the states accordingly and switches the state of each part.
     * If no parts are provided, the ID will be split by '.' to determine the parts.
     * @param path - The ID of the state to transition to.
     * @throws Error if the state with the given ID does not exist.
     */
    public transition_to_path(path: string | string[], ...args: any[]): void {
        const [currentPart, restParts, currentContext] = this.handle_path(path);

        if (this.def_id !== currentPart || restParts.length === 0) {
            if (!currentContext.is_concurrent) { // If the state is not running in parallel, set it as the current state
                this.transitionToState(currentPart, 'to', ...args);
            }
        }

        if (restParts.length > 0) {
            currentContext.transition_to_path(restParts, ...args);
        }
    }

    /**
     * Switches the state of the state machine to the specified ID.
     * If the ID contains multiple parts separated by '.', it traverses through the states accordingly and only switches the state of the last part.
     * Performs exit actions for the current state and enter actions for the new current state.
     * Throws an error if the state with the specified ID doesn't exist or if the target state is parallel.
     *
     * @param path - The ID of the state to switch to.
     * @returns void
     */
    public transition_switch_path(path: string | string[], ...args: any[]): void {
        const [currentPart, restParts, currentContext] = this.handle_path(path);

        if (restParts.length > 0) {
            currentContext.transition_switch_path(restParts, ...args);
        } else if (this.def_id !== currentPart) {
            this.transitionToState(currentPart, 'switch', ...args);
        }
    }

    /**
     * Transition to a new state.
     *
     * This method is responsible for transitioning the state machine to a new state.
     * If the ID contains multiple parts separated by '.', it traverses through the states accordingly and switches the state of each part.
     * It handles three types of state transitions:
     * 1. Transitions within the current state machine, identified by a state_id starting with `${STATE_THIS_PREFIX}.`.
     * 2. Transitions from the root of the state machine hierarchy, identified by a state_id starting with `${STATE_ROOT_PREFIX}.`.
     * 3. Transitions within the parent state machine, for all other state_ids.
     *
     * @param state_id - The identifier of the state to transition to. This can be a local state (prefixed with `${STATE_THIS_PREFIX}.`),
     * a state from the root (prefixed with `${STATE_ROOT_PREFIX}.`), or a state within the parent state machine.
     * @param args - Optional arguments to pass to the new state. These arguments are passed on to the 'to' or 'switch' methods.
     */
    transition_to(state_id: Identifier, ...args: any[]): void {
        if (state_id.startsWith(`${STATE_THIS_PREFIX}.`)) { // If the state is local, switch to the state in the current state machine
            // Remove the `${STATE_THIS_PREFIX}.` prefix and continue to the next state from the substate
            const restParts = state_id.slice(`${STATE_THIS_PREFIX}.`.length);
            // If there are more parts, switch to the state in the current state machine
            this.transition_to_path(restParts, ...args);
        }
        else if (state_id.startsWith(`${STATE_ROOT_PREFIX}.`)) { // If the state is in the root, switch to the state in the root state machine
            // Remove the `${STATE_ROOT_PREFIX}.` prefix and continue to the next state from the root
            const restParts = state_id.slice(`${STATE_ROOT_PREFIX}.`.length);
            // If there are more parts, switch to the state in the root state machine
            this.root.transition_to_path(restParts, ...args);
        }
        else { // If the state is not local, check if it is a state in the parent state machine or a state in the root state machine hierarchy
            if (this.parent_id) { // If there is a parent, switch to the state in the parent state machine
                this.parent.transition_to_path(state_id, ...args); // Switch to the state in the parent state machine
            }
            else { // If there is no parent, this is the root state machine, so we can just switch to the state in the current state machine
                this.transition_to_path(state_id, ...args); // Switch to the state in the current state machine
            }
        }
    }

    /**
     * Transition to a new state.
     *
     * This method is responsible for transitioning the state machine to a new state.
     * If the ID contains multiple parts separated by '.', it traverses through the states accordingly and only switches the state of the last part.
     * It handles three types of state transitions:
     * 1. Transitions within the current state machine, identified by a state_id starting with `${STATE_THIS_PREFIX}.`.
     * 2. Transitions from the root of the state machine hierarchy, identified by a state_id starting with `${STATE_ROOT_PREFIX}.`.
     * 3. Transitions within the parent state machine, for all other state_ids.
     *
     * @param state_id - The identifier of the state to transition to. This can be a local state (prefixed with `${STATE_THIS_PREFIX}.`),
     * a state from the root (prefixed with `${STATE_ROOT_PREFIX}.`), or a state within the parent state machine.
     * @param args - Optional arguments to pass to the new state. These arguments are passed on to the 'to' or 'switch' methods.
     */
    switch_to_state(state_id: Identifier, ...args: any[]): void {
        if (state_id.startsWith(`${STATE_THIS_PREFIX}.`)) {
            // Remove the `${STATE_THIS_PREFIX}.` prefix and continue to the next state from the substate
            const restParts = state_id.slice(`${STATE_THIS_PREFIX}.`.length);
            // If there are more parts, switch to the state in the current state machine
            this.transition_switch_path(restParts, ...args);
        }
        else if (state_id.startsWith(`${STATE_PARENT_PREFIX}.`)) {
            // Remove the `${STATE_PARENT_PREFIX}.` prefix and continue to the next state from the parent
            const restParts = state_id.slice(`${STATE_PARENT_PREFIX}.`.length);
            // If there are more parts, switch to the state in the parent state machine
            this.parent.transition_switch_path(restParts, ...args);
        }
        else if (state_id.startsWith(`${STATE_ROOT_PREFIX}.`)) {
            // Remove the `${STATE_ROOT_PREFIX}.` prefix and continue to the next state from the root
            const restParts = state_id.slice(`${STATE_ROOT_PREFIX}.`.length);
            // If there are more parts, switch to the state in the root state machine
            this.root.transition_switch_path(restParts, ...args);
        }
        else {
            this.parent.transition_switch_path(state_id, ...args); // Switch to the state in the parent state machine
        }
    }

    /**
     * Checks if the current state matches the given path.
     *
     * @param path - The path to the desired state, represented as a dot-separated string.
     * @returns true if the current state matches the path, false otherwise.
     * @throws Error if no machine with the specified ID is found.
     */
    public matches_state_path(path: string | string[]): boolean {
        let parts: string[];
        if (typeof path === 'string') {
            parts = path.split('.');
        } else {
            parts = path;
        }
        const [stateid, ...substateids] = parts;

        // If there are no more parts, check the id of the current state
        if (substateids.length === 0) {
            return this.currentid === stateid;
        }

        const state = this.substates[stateid];
        if (!state) {
            throw new Error(`No state with ID '${stateid}'`);
        }

        // If there are more parts, check the state of the substate with the given path
        return state.matches_state_path(substateids);
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
        const currentStateDefinition = this.current_state_definition;
        const targetStateDefinition = this.definition.substates[target_state_id];

        // Check if the current state has a canExit guard and if it returns false, prevent the transition
        if (currentStateDefinition.transition_guards?.can_exit && !currentStateDefinition.transition_guards.can_exit.call(this.target, this)) {
            return false;
        }

        // Get the target state itself (and not the definition) to check the canEnter guard
        const target_state = this.substates[target_state_id];
        // Check if the target state has a canEnter guard and if it returns false, prevent the transition
        if (targetStateDefinition.transition_guards?.can_enter && !targetStateDefinition.transition_guards.can_enter.call(this.target, target_state)) {
            return false;
        }

        return true; // All guards passed, allow the transition
    }

    /**
     * Transition to the specified state.
     * If the return value of the enter function is a string, it is assumed to be the ID of the next state to transition to.
     *
     * @param state_id - The identifier of the state to transition to.
     * @param args - Optional arguments to pass to the state's enter and exit actions.
     * @throws Error - If the state with the specified ID doesn't exist or if the target state is parallel.
     */
    private transitionToState(state_id: Identifier, transition_type: TransitionType, ...args: any[]): void {
        if (this.critical_section_counter > 0) {
            this.transition_queue.push({ state_id: state_id, args: args, transition_type: transition_type ?? 'to' });
            return;
        }

        if (transition_type === 'switch') {
            // The switch transition type is used to switch to a new state, expect if the state is already the current state
            if (this.currentid === state_id) return;
        }

        // If any state guard conditions fail, prevent the transition
        if (!this.checkStateGuardConditions(state_id)) return;

        // Perform exit actions for the current state
        let stateDef = this.current_state_definition;
        this.enterCriticalSection();
        stateDef?.exiting_state?.call(this.target, this.current, ...args);
        this.leaveCriticalSection();
        stateDef && this.pushHistory(this.currentid);

        // Update the current state
        this.currentid = state_id;
        if (!this.current) throw new Error(`State '${state_id}' doesn't exist for this state machine '${this.def_id}'!`);

        // Perform enter actions for the new current state
        stateDef = this.current_state_definition;
        if (!stateDef) return; // There is no definition for the none-state, so we don't trigger the enter event for that state.
        if (stateDef.is_concurrent) throw new Error(`Cannot transition to parallel state '${state_id}'!`);

        /**
         * If the auto_reset propert is set to 'state', reset the state machine of the current state.
         * If the auto_reset propert is set to 'tree', reset the state machine of the current state and all its substate machines.
         * If the auto_reset propert is set to 'subtree', reset the substate machine of the current state, but not the current state itself.
         * If the auto_reset property is set to 'none', do not reset any state machines.
         */
        if (stateDef.automatic_reset_mode) {
            switch (stateDef.automatic_reset_mode) {
                case 'state': this.current.reset(false); break; // Reset the state machine of the current state (but not its substate machines)
                case 'tree': this.current.reset(true); break; // Reset the state machine of the current state and all its substate machines
                case 'subtree': this.current.resetSubmachine(true); break; // Reset the substate machine of the current state
                case 'none': break; // Do nothing (i.e., don't reset any state machines)
            }
        }
        this.enterCriticalSection();
        const next_state = stateDef?.entering_state?.call(this.target, this.current, ...args);
        this.leaveCriticalSection();
        this.current.transitionToNextStateIfProvided(next_state);
    }

    /**
     * Executes the specified event on the state machine.
     *
     * @param eventName - The name of the event to execute.
     * @param emitter - The identifier or identifiable object that triggered the event.
     * @param args - Additional arguments to pass to the event handler.
     */
    public dispatch_event_to_root(eventName: string, emitter: Identifier, ...args: any[]): void {
        this.root.dispatch_event(eventName, emitter, ...args);
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
    public dispatch_event(eventName: string, emitter_id: Identifier, ...args: any[]): void {
        // If the state machine is paused, do not process the event
        if (this.paused) {
            return;
        }

        // If this state has children, dispatch the event to the child states
        if (this.substates && Object.keys(this.substates).length > 0) {
            // Dispatch the event to the current active state
            this.current?.dispatch_event(eventName, emitter_id, ...args);

            // Also dispatch the event to all parallel states
            Object.values(this.substates).forEach(state => state.is_concurrent && state.dispatch_event(eventName, emitter_id, ...args));
        } else {
            // This is the deepest part of the state machine, dispatch the event here
            // Bubble up the event to the parent states
            let current = this as State;
            do {
                if (current.handleEvent(eventName, emitter_id, ...args)) {
                    return; // If the event was handled, stop bubbling up the event
                }
                current = current.parent;
            } while (current);
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
            return { state_id: next_state, args: [] };
        }

        if (typeof next_state === 'object') {
            const args = Array.isArray(next_state.args) ? next_state.args : next_state.args ? [next_state.args] : [];
            return { ...next_state, args };
        }

        throw new Error(`Invalid type for next state: ${next_state}, expected string or object`);
    }

    /**
     * Transitions to the next state if provided.
     *
     * @param next_state - The next state to transition to.
     */
    private transitionToNextStateIfProvided(next_state: StateTransition | string | void, do_switch: boolean = false): void {
        const next_state_transition = this.getNextState(next_state);

        // If the next state is not the current state, transition to the next state
        if (next_state_transition) {
            if (do_switch) {
                this.switch_to_state(next_state_transition.state_id, ...next_state_transition.args);
            }
            else {
                this.transition_to(next_state_transition.state_id, ...next_state_transition.args);
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
    private handleEvent(eventName: string, emitter_id: Identifier, ...args: any[]): boolean {
        if (this.paused) {
            return false;
        }

        this.enterCriticalSection();
        try {
            const state_id_or_handler = this.definition?.event_handlers?.[eventName];
            if (state_id_or_handler) {
                if (typeof state_id_or_handler !== 'string') {
                    const emitterId = state_id_or_handler.scope;
                    if (emitterId && emitterId !== 'all' && emitterId !== emitter_id) {
                        return false;
                    }
                }
                if (this.handleStateTransition(state_id_or_handler, ...args)) {
                    return true;
                }
            }
            return false;
        } finally {
            this.leaveCriticalSection();
        }
    }

    private handleStateTransition(state_id_or_handler: any, ...args: any[]): boolean {
        if (typeof state_id_or_handler === 'string') {
            this.transition_to(state_id_or_handler, ...args);
        } else {
            const ifHandler = state_id_or_handler.if;
            const doHandler = state_id_or_handler.do;
            const to_state = state_id_or_handler.to;
            const switch_state = state_id_or_handler.switch;

            if (ifHandler && !ifHandler.call(this.target, this as State<T>, ...args)) {
                return false;
            }

            const next_state = doHandler?.call(this.target, this as State<T>, ...args);
            const next_state_transition = this.getNextState(next_state);
            if (next_state_transition && (next_state_transition.force_transition_to_same_state && next_state_transition.transition_type != 'to')) {
                throw new Error(`The 'force_transition_to_same_state' property is only allowed for 'to' transitions, not for 'switch' transitions!`);
            }

            if (next_state_transition && (next_state_transition.state_id !== this.currentid || next_state_transition.force_transition_to_same_state)) {
                if (next_state_transition.transition_type === 'to' || !next_state_transition.transition_type) {
                    this.transition_to(next_state_transition.state_id, ...next_state_transition.args, ...args);
                } else if (next_state_transition.transition_type === 'switch') {
                    this.switch_to_state(next_state_transition.state_id, ...next_state_transition.args, ...args);
                }
            } else if (to_state) {
                const to_state_transition = this.getNextState(to_state);
                if (to_state_transition) {
                    this.transition_to(to_state_transition.state_id, ...to_state_transition.args, ...args);
                }
            } else if (switch_state) {
                const switch_state_transition = this.getNextState(switch_state);
                if (switch_state_transition) {
                    this.switch_to_state(switch_state_transition.state_id, ...switch_state_transition.args, ...args);
                }
            }
        }
        return true;
    }

    /**
     * Adds the given state ID to the history stack, which tracks the previous states of the state machine.
     * If the history stack exceeds the maximum length, the oldest state is removed from the stack.
     * @param toPush - the state ID to add to the history stack
     */
    protected pushHistory(toPush: Identifier): void {
        this.past_states.push(toPush);
        if (this.past_states.length > BST_MAX_HISTORY)
            this.past_states.shift(); // Remove the first element in the history-array
    }

    /**
     * Goes back to the previous state in the history stack.
     * If there is no previous state, nothing happens.
     */
    public pop_and_transition(): void {
        if (this.past_states.length <= 0) return;
        let poppedStateId = this.past_states.pop();
        poppedStateId && this.transition_to(poppedStateId);
    }

    /**
     * Populates the state machine with states defined in the state machine definition.
     * If no state machine definition is defined, a default machine with a generated 'none'-state is created.
     * If no current state is set, the state is set to the first state found in the set of states.
     */
    public populateStates(): void {
        const sdef = this.definition;
        if (!sdef || !sdef.substates) { // If no state machine definition is defined, don't populate the states
            this.substates = undefined; // Set the states to undefined to denote that there are no states defined (as opposed to an empty object). Note that states should already be undefined, but just to be sure, set it to undefined here as well
            return; // Don't populate the states
        }
        const state_ids = Object.keys(sdef.substates);
        if (state_ids.length === 0) { // If there are no states defined in the state machine definition, don't populate the states
            this.substates = undefined;
            return;
        }

        this.substates = {}; // Initialize the states object to an empty object
        for (let sdef_id in sdef.substates) {
            let state = new State(sdef_id, this.target_id, this.id, this.root_id);
            this.add(state);
            state.populateStates(); // Populate the substates of the state
        }
        // If no current state is set, set the state to the first state that it finds in the set of states
        if (!this.currentid) this.currentid = Object.keys(this.substates)[0];
    }

    /**
     * Adds the given states to the state machine.
     * If a state with the same ID already exists in the state machine, an error is thrown.
     * @param states - the states to add to the state machine
     * @throws Error if a state with the same ID already exists in the state machine
     */
    private add(...states: State[]): void {
        for (let state of states) {
            if (!state.def_id) throw new Error(`State is missing an id, while attempting to add it to this sstate '${this.def_id}'!`);
            if (this.substates[state.def_id]) throw new Error(`State ${state.def_id} already exists for sstate '${this.def_id}'!`);
            this.substates[state.def_id] = state;
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
        if (!this.tape || this.tape.length === 0) return undefined;
        const current_index = Math.max(0, Math.min(this.tapehead_position, this.tape.length - 1));
        return this.tape[current_index];
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
     * The identifier is created by concatenating the `parent_id`, `target_id`, and `def_id`.
     * @returns The generated identifier.
     */
    private make_id(): Identifier {
        let id = `${this.parent_id ?? this.target_id}.${this.def_id}`; // The id is the parent_id + the target_id + the def_id (e.g. 'parent_id.target_id.def_id') to create a unique id
        return id;
    }

    /**
     * Disposes the current state machine and deregisters it from the registry.
     * Also deregisters all substates.
     */
    public dispose(): void {
        $.registry.deregister(this);
        // Also deregister all substates
        for (let state in this.substates) {
            this.substates[state].dispose();
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
            this._tapehead = v; // Move the tape to new position


            // Check if the tapehead is going out of bounds (or there is no tape at all)
            if (!this.tape) {
                this._tapehead = TAPE_START_INDEX;

                // Trigger the event for moving the tape, after having set the tapehead to the correct position
                this.tapemove();

                // Trigger the event for reaching the end of the tape
                this.tapeend();
            }

            // Check if the tape now is at the end
            else if (this.is_tape_exhausted) {
                // Check whether we automagically rewind the tape
                if (this.definition.auto_rewind_tape_after_end) {
                    // If so, rewind and move to the first element of the tapehead
                    // But why? (Yes... Why?) Because we then can loop an animation,
                    // including the first and last element of the tape, without having
                    // to resort to any workarounds like duplicating the first entry
                    // of the tape or similar.
                    this._tapehead = 0; // Set the tapehead to the beginning of the tape, but not to TAPE_START_INDEX, as that is before the start of the tape and we are now properly triggering the tapemove event for the first element of the tape


                    // Trigger the event for moving the tape, after having set the tapehead to the correct position
                    this.tapemove(true);
                }
                else {
                    // Set the tapehead to the end of the tape (or 0 if there is no tape)
                    this._tapehead = this.tape.length > 0 ? this.tape.length - 1 : TAPE_START_INDEX;

                    // We do not trigger the tapemove event here, as the tapehead is not actually moving and we dont want to trigger the tapemove event twice in a row for the same tapehead position
                }

                // Trigger the event for reaching the end of the tape
                this.tapeend();
            }
            else {
                // Trigger the event for moving the tape. This is executed when no tapehead correction was required
                this.tapemove();
            }
        } finally {
            this.leaveCriticalSection();
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
        if (v >= this.definition.ticks2advance_tape) { ++this.tapehead_position; }
    }

    /**
     * Calls the next state's function.
     * @param tape_rewound Indicates whether the tape has been rewound. Only occurs when the tape is automatically rewound after reaching the end of the tape via @see {@link StateDefinition.auto_rewind_tape_after_end}.
     */
    protected tapemove(tape_rewound: boolean = false) {
        this.enterCriticalSection();
        try {
            const next_state = this.definition.tape_next?.call(this.target, this, tape_rewound);
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
            const next_state = this.definition.tape_end?.call(this.target, this, undefined);
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
        const start = this.definition?.start_state_id; // Definition doesn't need to exist
        this.currentid = start; // Set the current state to the start state (if it exists)
        this.past_states = new Array();
        this.paused = false;
        if (!this.definition) return; // If the definition doesn't exist, the state machine is empty and there is nothing to reset
        this.data = { ...this.definition.data }; // Reset the state machine data by shallow copying the definition's data
        if (reset_tree) {
            // Call the reset function for each state
            for (let state in this.substates) {
                this.substates[state].reset(reset_tree);
            }
        }
    }
}
