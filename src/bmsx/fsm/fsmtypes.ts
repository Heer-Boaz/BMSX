import type { GameplayCommand } from '../ecs/gameplay_command_buffer';
import type { EventLane, EventPayload, EventScope, EventSubscriber } from "../core/eventemitter";
import type { Identifier, Registerable } from '../rompack/rompack';
import type { StateMachineController } from "./fsmcontroller";
import type { State } from './state';
import type { StateDefinition } from './statedefinition';

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
export type id2sstate = Record<Identifier, State> | undefined;

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
export interface StateEventHandler<T extends Stateful = any, P extends EventPayload = EventPayload> { (state: State<T>, payload?: P): StateTransition | Identifier | void; }
export interface StateExitHandler<T extends Stateful = any, P extends EventPayload = EventPayload> { (state: State<T>, payload?: P): void; }
export interface StateNextHandler<T extends Stateful = any, P extends EventPayload = EventPayload> { (state: State<T>, payload?: P & { tape_rewound: boolean }): StateTransition | Identifier | void; }
export interface StateEventCondition<T extends Stateful & EventSubscriber = any, P extends EventPayload = EventPayload> {
	(state: State<T>, payload?: P): boolean;
}

export type listed_sdef_event = { name: string, scope: EventScope, lane?: EventLane | 'any' };

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
	payload?: EventPayload;

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
export type StateActionEmitSpec = string | {
	event?: string;
	payload?: EventPayload;
	emitter?: Identifier;
	scope?: EventScope | string;
	lane?: EventLane;
};

export type StateActionSetTicksSpec = {
	set_ticks_to_last_frame: true;
};

interface StateActionSetValueOptions {
	target: string;
	value: any;
}

export interface StateActionSetPropertySpec {
	set_property: StateActionSetValueOptions;
}

export interface StateActionSetSpec {
	set: StateActionSetValueOptions;
}

interface ApplyAdjustPropertyOptions {
	target: string;
	add?: any;
	sub?: any;
	mul?: any;
	div?: any;
	set?: any;
}

export interface StateActionAdjustPropertySpec {
	adjust_property: ApplyAdjustPropertyOptions;
}

export interface StateActionAdjustSpec {
	adjust: ApplyAdjustPropertyOptions;
}

export interface StateActionSubmitCommandSpec {
	command: GameplayCommand;
}

export interface StateActionTagsSpec {
	tags: {
		add?: any;
		remove?: any;
		toggle?: any;
	};
}

export type StateActionTagOps = keyof StateActionTagsSpec['tags'];

export interface StateActionDispatchSpec {
	dispatch: {
		event: string;
		emitter?: Identifier;
		payload?: EventPayload;
	};
}

export interface StateActionInvokeSpec {
	invoke: {
		fn: any;
		payload?: EventPayload;
		args?: unknown | unknown[];
	};
}

export interface StateActionAddTagSpec { add_tag: any; }

export interface StateActionRemoveTagSpec { remove_tag: any; }

export interface StateActionActivateAbilitySpec {
	activate_ability: string | { id: string; payload?: EventPayload; source?: string };
}

export interface StateActionConsumeActionSpec {
	consume_action: string | string[];
}

export interface StateActionCondition {
	value_equals?: {
		left: any;
		equals: any;
	};
	value_not_equals?: {
		left: any;
		equals: any;
	};
	state_matches?: string | { path: string; machine?: string };
	state_not_matches?: string | { path: string; machine?: string };
	not?: StateActionCondition | StateActionCondition[];
	and?: StateActionCondition[];
	or?: StateActionCondition[];
}

export interface StateActionConditionalSpec {
	when: StateActionCondition;
	then: StateActionSpec | StateActionSpec[];
	else?: StateActionSpec | StateActionSpec[];
}

export type StateActionSequence = StateActionSpec[];

export interface StateActionDispatchEventSpec {
	dispatch_event: {
		event: string;
		emitter?: string;
		payload?: EventPayload;
	};
}

export interface StateActionTransitionSpec {
	to?: StateTransition | Identifier;
	switch?: StateTransition | Identifier;
	force_leaf?: StateTransition | Identifier;
	revert?: boolean | StateTransition | Identifier;
	payload?: EventPayload;
}

export interface StateActionTransitionCompositeSpec extends StateActionTransitionSpec {
	do?: StateActionSpec | StateActionSpec[];
}

export type StateActionSpec =
	| StateActionSetTicksSpec
	| { emit: StateActionEmitSpec }
	| StateActionSetPropertySpec
	| StateActionAdjustPropertySpec
	| StateActionSetSpec
	| StateActionAdjustSpec
	| StateActionTagsSpec
	| StateActionConditionalSpec
	| StateActionSequence
	| StateActionDispatchEventSpec
	| StateActionDispatchSpec
	| StateActionAddTagSpec
	| StateActionRemoveTagSpec
	| StateActionActivateAbilitySpec
	| StateActionInvokeSpec
	| StateActionConsumeActionSpec
	| StateActionSubmitCommandSpec
	| StateActionTransitionSpec
	| StateActionTransitionCompositeSpec
	| Identifier; // State identifier to transition to

export type StateEventDefinition<T extends Stateful & EventSubscriber = any> = {
	/**
	 * The state ID to transition to. If not provided, the state will not transition. This is useful for defining a "transition" that only executes an action.
	 */
	to?: StateTransition | Identifier,

	/**
	 * The state ID to transition to.(as switch-type)  If not provided, the state will not transition. This is useful for defining a "transition" that only executes an action.
	 */
	switch?: StateTransition | Identifier,

	/**
	 * The state ID to transition to (as revert-type). If not provided, the state will not transition. This is useful for defining a "transition" that only executes an action.
	 */
	revert?: StateTransition | Identifier,

	/**
	 * The state ID to transition to (as force_leaf-type). If not provided, the state will not transition. This is useful for defining a "transition" that only executes an action.
	 */
	force_leaf?: StateTransition | Identifier,

	/**
	 * The condition that must be met for the logic under "do" to be executed and/or transition to occur.
	 */
	if?: StateEventCondition<T> | StateActionCondition | string,

	/**
	 * The logic that is executed when the "if"-condition is *not* met. (Not implemented)
	 */
	// else?: StateEventCondition<T> | StateActionCondition | string,

	/**
	 * The action that is executed when the transition occurs.
	 */
	do?: StateEventHandler<T> | string | StateActionSpec,

	/**
	 * (Optional) The ID of the emitter scope. If provided, the listener will be added to the emitter scope listeners, otherwise it will be added to the global scope listeners.
	 */
	scope?: EventScope,

	/**
	 * Optional event lane. Defaults inferred at build time.
	 */
	lane?: EventLane | 'any',
};

/**
 * Represents a state guard that defines conditions for entering or exiting a state.
 * @template T - The type of the stateful object that implements `IStateful` and `IEventSubscriber`.
 */
export interface StateGuard<T extends Stateful & EventSubscriber = any> {
	/**
	 * Checks if the state can be entered.
	 * @this {T} - The stateful object.
	 * @returns {boolean} - Returns `true` if the state can be entered, otherwise `false`.
	 */
	can_enter?: ((this: T, state: State) => boolean) | StateActionCondition | string;

	/**
	 * Checks if the state can be exited.
	 * @this {T} - The stateful object.
	 * @returns {boolean} - Returns `true` if the state can be exited, otherwise `false`.
	 */
	can_exit?: ((this: T, state: State) => boolean) | StateActionCondition | string;
}

/**
 * Represents the definition of a tick check for a stateful object.
 * It defines conditions that are checked on each tick to determine if the state should transition to another state or another action should be executed.
 *
 * @template T - The type of the stateful object.
 */
export type TickCheckDefinition<T extends Stateful & EventSubscriber = any> = Omit<StateEventDefinition<T>, 'scope'>;

/**
 * Represents the type of a state transition (either 'to', 'switch', 'revert', or 'force_leaf').
 * - 'to': The default transition type, which transitions the whole state machine tree to the new state.
 * - 'switch': A transition type that switches only the lowest level state to the new state.
 * - 'revert': A transition type that reverts the state machine to the previous state.
 * - 'force_leaf': A transition type that doesn't re-enter any of the parents, but does force the leaf state to be re-entered, but only if any of the parent states are not already active.
 */
export type TransitionType = 'to' | 'switch' | 'revert' | 'force_leaf';

/**
 * Represents a tape used in the BFSM.
 */
export type Tape = any[];

/**
 * Represents an object that is stateful and can be registered, and subscribes to events.
 * It also has a player index, that is used to identify the player that the stateful object belongs to, which is used to determine which player's input to process.
 */
export interface Stateful extends Registerable { // removed EventSubscriber from extends to avoid index-signature conflicts
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

export type EventBagName = keyof Pick<StateDefinition, 'on' | 'input_event_handlers'>; export type FsmHandlerDecl = {
	name: string; // method/field name on the instance
	keys: string[]; // resolved keys this member answers to
};
