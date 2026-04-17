/**
 * Represents a query to retrieve the state of one or more actions.
 * Used to query the state of actions in the input system, such as whether a button is pressed or consumed or whether there is a long-press.
 * @see ActionState for the structure of the query result.
 * @see PlayerInput.checkActionTriggered for the preferred way to evaluate action patterns.
 */

import type { Input } from "./input";

export type ActionStateQuery = {
	/**
	 * An optional array of filters to apply when querying for action states.
	 */
	filter?: string[];

	/**
	 * Specifies whether the action is currently pressed.
	 */
	pressed?: boolean;

	/**
	 * Specifies whether the action was just released
	 */
	justReleased?: boolean;

	/**
	 * Specifies whether the action was not pressed before (i.e., it was just pressed).
	 */
	justPressed?: boolean;

	/**
	 * Specifies whether the action has been consumed.
	 */
	consumed?: boolean;

	/**
	 * The time at which the action was pressed, in milliseconds.
	 */
	pressTime?: number;

	/**
	 * An optional array of action names, ordered by priority, to use when querying for action states.
	 */
	actionsByPriority?: string[];
};
/**
 * Represents the ID of a button.
 * It can be one of the predefined values 'BTN1', 'BTN2', 'BTN3', 'BTN4',
 * or a custom Key value.
 */
export type KeyboardButtonId = 'BTN1' | 'BTN2' | 'BTN3' | 'BTN4';
export type ButtonId = string;
/**
 * Represents the state of an button-press-index in the Index2State type. Used for tracking the state of a button.
 */
export type KeyOrButtonId2ButtonState = { [index: ButtonId]: ButtonState; };
/**
 * Represents a mapping of keyboard inputs to actions.
 */
export type KeyboardBinding = string | { id: string; scale?: number; invert?: boolean };
export type KeyboardInputMapping = {
	[action: string]: KeyboardBinding[];
};

/**
 * Represents a mapping of gamepad inputs to gamepad buttons.
 */
export type GamepadBinding = BGamepadButton | { id: BGamepadButton; scale?: number; invert?: boolean };
export type GamepadInputMapping = {
	[action: string]: GamepadBinding[];
};
export type PointerBinding = string | { id: string; scale?: number; invert?: boolean };
export type PointerInputMapping = {
	[action: string]: PointerBinding[];
};

/**
 * Represents the input mapping for a game.
 */
export interface InputMap {
	keyboard: KeyboardInputMapping;
	gamepad: GamepadInputMapping;
	pointer?: PointerInputMapping;
}

/**
 * Represents a gamepad button.
 * @typedef {keyof typeof Input.BUTTON2INDEX } BGamepadButton
 */
export type BGamepadButton = (typeof Input.BUTTON_IDS)[number];

/**
 * Represents the state of a button.
 */
export type ButtonState = {
	// Binary/edge fields
	pressed: boolean;
	justpressed: boolean;
	justreleased: boolean;
	waspressed: boolean;
	wasreleased: boolean;
	repeatpressed: boolean;
	repeatcount: number;
	// Consumption fields
	consumed: boolean;
	// Timing fields
	presstime: number; // ms since pressed
	timestamp: number; // last transition timestamp (ms)
	pressedAtMs?: number; // absolute press timestamp (ms)
	releasedAtMs?: number; // absolute release timestamp (ms)
	// Identity of this press cycle, increases monotonically per-device
	pressId?: number;
	// Analog values
	value?: number; // 1D analog value in [-1,1] or [0,1]
	value2d?: readonly [number, number]; // 2D analog value
};

/**
 * Represents the input event that is stored when a key or button is pressed or released.
 */
export type InputEvent = {
	eventType: 'press' | 'release';
	identifier: ButtonId; // Key code or button name
	timestamp: number;
	consumed: boolean;
	pressId?: number; // identity of the press this event belongs to
};

/**
 * Represents the state of an action, including the action name and button state.
 */
export type ActionState = {
	action: string;
	alljustpressed: boolean;
	allwaspressed: boolean;
	alljustreleased: boolean;
	guardedjustpressed: boolean;
	repeatpressed: boolean;
	repeatcount: number;
} & ButtonState;

/**
 * Represents the parameters for a vibration effect on the gamepad.
 */
export interface VibrationParams {
	effect: GamepadHapticEffectType;
	duration: number;
	intensity: number;
};

/**
 * Represents an input handler that provides methods for polling input, getting button states,
 * consuming buttons, resetting input, and getting the gamepad index.
 */
export interface InputHandler {
	/**
	 * Polls the input to update the button states.
	 */
	pollInput(): void;

	/**
	 * Gets the state of the specified button.
	 * @param btn - The button name or null to get the state of all buttons.
	 * @returns The state of the button.
	 */
	getButtonState(btn: ButtonId): ButtonState;

	/**
	 * Consumes the specified button, marking it as processed.
	 * @param button - The button name to consume.
	 */
	consumeButton(button: ButtonId): void;

	/**
	 * Resets the input, optionally excluding specified buttons.
	 * @param except - An optional array of button names to exclude from the reset.
	 */
	reset(except?: string[]): void;

	/**
	 * Gets the index of the gamepad.
	 */
	get gamepadIndex(): number;

	/**
	 * Provides haptic feedback on the input device.
	 * @param effect - The type of haptic feedback to provide.
	 */
	applyVibrationEffect: (params: VibrationParams) => void;

	/**
	 * Checks if the gamepad has haptic feedback capabilities.
	 */
	get supportsVibrationEffect(): boolean;

	/**
	 * Disposes of the input handler, cleaning up resources and event listeners.
	 */
	dispose(): void;
}
