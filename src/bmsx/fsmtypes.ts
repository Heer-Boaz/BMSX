import type { Identifier, StateDefinition, IEventSubscriber, EventScope, IRegisterable, StateMachineController, State } from "./bmsx";

/**
 * Represents a type definition for mapping IDs to `sdef` objects.
 */
export type id2sdef = Record<Identifier, StateDefinition>;

/**
 * Represents a mapping of IDs to state contexts.
 */
export type id2mstate = Record<Identifier, State>;

/**
 * Represents a mapping of IDs to sstates.
 */
export type id2sstate = Record<Identifier, State>;

/**
 * The states defined for this state machine (key = state id, value = partial state definition), their substate machines and their additional properties are defined in {@link StateDefinition}.
 * @example
 * {
 *		parellel: true,
 *		data: { ... },
 *		on: { ... }, // Note: defines the state transitions at the *current* level (thus, not for submachines)
 *		// (Note: the state id is the key of the state in the states object)
 *		_idle: { // The state definition for the idle state which is the start state of this machine, given the prefix '_' (or '#')
 *			auto_tick: false, // `true` by default
 *			on: { ... }, // Note: defines the state transitions at the *current* level (thus, not for submachines)
 *			enter(this: TargetClass, state: sstate): { state.reset(); ... },
 *			run(this: TargetClass, state: sstate): { ++state.ticks; },
 *			next(this: TargetClass, state: sstate): { let bla = state.current_tape_value; ... },
 *		},
 *		running: { ... },
 * }
 */
export type StateMachineBlueprint = Partial<StateDefinition>;

/**
 * A type representing a mapping of state IDs to partial state definitions.
 */
export type id2partial_sdef = Record<Identifier, StateMachineBlueprint>;

// export type StateIdentifierStart = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';
// export type StatePathPart = `${StateIdentifierStart}${Identifier}`;
// export type StatePathSpecial = '#this' | '#parent' | '#root';
// export type StatePath = `${StatePathSpecial}.${StatePathPart}` | `${StatePathPart}`;

/**
 * Represents a state event handler.
 * @template T - The type of the stateful object.
 * @param state - The state object.
 * @param args - Additional arguments for the event handler.
 * @returns A string denoting the next state to transition to (or undefined if no transition should occur).
 */
export interface IStateEventHandler<T extends IStateful = any> { (state: State<T>, ...args: any[]): StateTransition | Identifier | void; }
export interface IStateExitHandler<T extends IStateful = any> { (state: State<T>, ...args: any[]): void; }
export interface IStateNextHandler<T extends IStateful = any> extends IStateEventHandler { (state: State<T>, tape_rewound: boolean, ...args: any[]): StateTransition | Identifier | void; }
export interface IStateEventCondition<T extends IStateful & IEventSubscriber = any> {
    (state: State<T>, ...args: any[]): boolean;
}

export type listed_sdef_event = { name: string, scope: EventScope };

/**
 * Represents a state transition.
 */
export type StateTransition = {
    /**
     * The next state to transition to.
     */
    state_id: Identifier;

    /**
     * The arguments for the state transition.
     */
    args?: any;

    /**
     * The transition type: 'to' or 'switch', where 'to' is the default.
     */
    transition_type?: TransitionType;

    /**
     * If set to `true`, the state will transition to the same state, even if the state is already the current state.
     */
    force_transition_to_same_state?: boolean;
};

/**
 * Represents a state transition with a type (either 'to' or 'switch').
 */
export type StateTransitionWithType = StateTransition & { transition_type: TransitionType };

/**
 * Represents the definition of a state event in a state machine.
 * @template T - The type of the stateful object that the event is associated with.
 */
export type StateEventDefinition<T extends IStateful & IEventSubscriber = any> = {
    /**
     * The state ID to transition to. If not provided, the state will not transition. This is useful for defining a "transition" that only executes an action.
     */
    to?: StateTransition | Identifier,

    /**
     * The state ID to transition to.(as switch-type)  If not provided, the state will not transition. This is useful for defining a "transition" that only executes an action.
     */
    switch?: StateTransition | Identifier,

    /**
     * The condition that must be met for the transition to occur.
     */
    if?: IStateEventCondition<T>,

    /**
     * The action that is executed when the transition occurs.
     */
    do?: IStateEventHandler<T>,

    /**
     * (Optional) The ID of the emitter scope. If provided, the listener will be added to the emitter scope listeners, otherwise it will be added to the global scope listeners.
     */
    scope?: EventScope,
};

/**
 * Represents a state guard that defines conditions for entering or exiting a state.
 * @template T - The type of the stateful object that implements `IStateful` and `IEventSubscriber`.
 */
export interface IStateGuard<T extends IStateful & IEventSubscriber = any> {
    /**
     * Checks if the state can be entered.
     * @this {T} - The stateful object.
     * @returns {boolean} - Returns `true` if the state can be entered, otherwise `false`.
     */
    canEnter?: (this: T, state: State) => boolean;

    /**
     * Checks if the state can be exited.
     * @this {T} - The stateful object.
     * @returns {boolean} - Returns `true` if the state can be exited, otherwise `false`.
     */
    canExit?: (this: T, state: State) => boolean;
}

/**
 * Represents the definition of a tick check for a stateful object.
 * It defines conditions that are checked on each tick to determine if the state should transition to another state or another action should be executed.
 *
 * @template T - The type of the stateful object.
 */
export type TickCheckDefinition<T extends IStateful = any> = Omit<StateEventDefinition<T>, 'scope'>;

/**
 * Represents the type of a state transition (either 'to' or 'switch').
 * - 'to': The default transition type, which transitions the whole state machine tree to the new state.
 * - 'switch': A transition type that switches only the lowest level state to the new state.
 */
export type TransitionType = 'to' | 'switch';

/**
 * Represents a tape used in the BFSM.
 */
export type Tape = any[];

/**
 * Represents an object that is stateful and can be registered, and subscribes to events.
 * It also has a player index, that is used to identify the player that the stateful object belongs to, which is used to determine which player's input to process.
 */
export interface IStateful extends IRegisterable, IEventSubscriber {
    /**
     * The StatemachineController of the object.
     */
    sc: StateMachineController;

    /**
     * The player index of the stateful object.
     * If the player index is not set, it defaults to 1 (the first/main player).
     */
    player_index?: number;
}

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
