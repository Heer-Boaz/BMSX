/**
 * Host-side input vocabulary: button/action state shapes, source mappings, and
 * the InputHandler contract. The machine ICU only sees raw snapshot words.
 */

import type { VibrationParams } from "../platform";
import { INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_IDS, type InputControllerPadSnapshot, type InputControllerSnapshot } from "../machine/devices/input/contracts";

// Host-owned input vocabulary. The machine ICU only sees raw snapshot words;
// key names, button names, and rich button state live at the host layer.
export const INPUT_SOURCES = ['keyboard', 'gamepad', 'pointer'] as const;
export type InputSource = typeof INPUT_SOURCES[number];

export type ButtonId = string;
export type BGamepadButton = (typeof INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_IDS)[number];

export type ButtonState = {
	pressed: boolean;
	justpressed: boolean;
	justreleased: boolean;
	waspressed: boolean;
	wasreleased: boolean;
	repeatpressed: boolean;
	repeatcount: number;
	consumed: boolean;
	presstime: number;
	timestamp: number;
	pressedAtMs?: number;
	releasedAtMs?: number;
	pressId?: number;
	value?: number;
	value2d?: [number, number] | null;
};

export type KeyboardBinding = string | { id: string; scale?: number; invert?: boolean };
export type KeyboardInputMapping = {
	[action: string]: KeyboardBinding[];
};

export type GamepadBinding = string | { id: string; scale?: number; invert?: boolean };
export type GamepadInputMapping = {
	[action: string]: GamepadBinding[];
};

export type PointerBinding = string | { id: string; scale?: number; invert?: boolean };
export type PointerInputMapping = {
	[action: string]: PointerBinding[];
};

export type InputMap = {
	keyboard: KeyboardInputMapping;
	gamepad: GamepadInputMapping;
	pointer: PointerInputMapping;
};

export function inputBindingId(binding: string | { id: string }): string {
	return typeof binding === 'string' ? binding : binding.id;
}

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
 * Represents the ID of a button.
 * It can be one of the predefined values 'BTN1', 'BTN2', 'BTN3', 'BTN4',
 * or a custom Key value.
 */
export type KeyboardButtonId = 'BTN1' | 'BTN2' | 'BTN3' | 'BTN4';
/**
 * Represents the state of an button-press-index in the Index2State type. Used for tracking the state of a button.
 */
export type KeyOrButtonId2ButtonState = { [index: ButtonId]: ButtonState; };
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

	writeInputControllerKeyWords(keyWords: Uint32Array): void;

	writeInputControllerPointerSnapshot(snapshot: InputControllerSnapshot): void;

	writeInputControllerPadSnapshot(snapshot: InputControllerPadSnapshot): void;

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
}
