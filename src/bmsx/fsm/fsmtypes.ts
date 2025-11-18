import type { EventPort } from '../core/eventemitter';
import type { Identifier, Registerable } from '../rompack/rompack';
import type { StateMachineController } from "./fsmcontroller";
import type { State } from './state';
import type { StateDefinition } from './statedefinition';
import type { EventPayload, GameEvent } from '../core/game_event';
import type { Timeline } from '../timeline/timeline';
import type { TimelinePlayOptions } from '../component/timeline_component';

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
 *			next(this: TargetClass, state: sstate): { optional legacy handler },
 *		},
 *		running: { ... },
 * }
 */
export type StateMachineBlueprint = Partial<StateDefinition>;

/**
 * A type representing a mapping of state IDs to partial state definitions.
 */
export type id2partial_sdef = Record<Identifier, StateMachineBlueprint>;

export type StateTimelineConfig<T = any> = {
	/** Optional id override; falls back to the dictionary key. */
	id?: string;
	/** Factory that builds the timeline instance for this state. */
	create: () => Timeline<T>;
	/** Automatically plays the timeline when the state enters. Defaults to true. */
	autoplay?: boolean;
	/** Automatically stops the timeline when the state exits. Defaults to true. */
	stop_on_exit?: boolean;
	/** Optional play options used when autoplay starts the timeline. */
	play_options?: TimelinePlayOptions;
};

export type StateTimelineMap = Record<string, StateTimelineConfig>;

// export type StateIdentifierStart = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';
// export type StatePathPart = `${StateIdentifierStart}${Identifier}`;
// export type StatePathSpecial = '#this' | '#parent' | '#root';
// export type StatePath = `${StatePathSpecial}.${StatePathPart}` | `${StatePathPart}`;

export type transition_target = Identifier;

export interface StateEventHandler<T extends Stateful = any, E extends GameEvent = GameEvent> {
	(state: State<T>, event: E): transition_target | void;
}
export interface StateExitHandler<T extends Stateful = any, P extends EventPayload = EventPayload> { (state: State<T>, payload?: P): void; }
export type listed_sdef_event = { name: string };


/**
 * Represents the definition of a state event in a state machine.
 * @template T - The type of the stateful object that the event is associated with.
 */
export type StateActionEmitSpec = string | {
	event?: string;
	payload?: Record<string, unknown>;
	emitter?: Identifier;
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
		payload?: Record<string, unknown>;
	};
}

export interface StateActionInvokeSpec {
	invoke: {
		fn: any;
		payload?: Record<string, unknown>;
		args?: unknown | unknown[];
	};
}

export interface StateActionAddTagSpec { add_tag: any; }

export interface StateActionRemoveTagSpec { remove_tag: any; }

export interface StateActionActivateAbilitySpec {
	activate_ability: string | { id: string; payload?: Record<string, unknown>; source?: string };
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
		payload?: Record<string, unknown>;
	};
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
	| Identifier; // State identifier to transition to

export interface StateEventDefinition<T extends Stateful = any> {
	/**
	 * The action that is executed when the event is handled. Returning a transition triggers a state change.
	 */
	do?: StateEventHandler<T> | string | StateActionSpec;
}

/**
 * Represents a state guard that defines conditions for entering or exiting a state.
 * @template T - The type of the stateful object that implements `IStateful` and `IEventSubscriber`.
 */
export interface StateGuard<T extends Stateful = any> {
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
export type TickCheckDefinition<T extends Stateful = any> = StateEventDefinition<T>;

/**
 * Represents an object that is stateful and can be registered, and subscribes to events.
 * It also has a player index, that is used to identify the player that the stateful object belongs to, which is used to determine which player's input to process.
 */
export interface Stateful extends Registerable {
	/**
	 * The StatemachineController of the object.
	 */
	sc: StateMachineController;

	/**
	 * Event channel for object-local events.
	 */
	events: EventPort;

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
