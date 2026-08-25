/**
 * Host-side input vocabulary: button/action state shapes, source mappings, and
 * source-specific input contracts. The machine ICU only sees raw snapshot words.
 */

import type { InputControllerPadSnapshot, InputControllerSnapshot } from '../../../machine/ts/machine/devices/input/contracts';
import { GAMEPAD_BUTTON_IDS } from './gamepad_buttons';

// Host-owned input vocabulary. The machine ICU only sees raw snapshot words;
// key names, button names, and rich button state live at the host layer.
export const INPUT_HANDLER_SOURCES = ['keyboard', 'gamepad', 'pointer'] as const;
export type InputHandlerSource = typeof INPUT_HANDLER_SOURCES[number];

export type ButtonId = string;
export type BGamepadButton = (typeof GAMEPAD_BUTTON_IDS)[number];

export type ButtonState = {
	pressed: boolean;
	justpressed: boolean;
	justreleased: boolean;
	waspressed: boolean;
	wasreleased: boolean;
	repeatpressed: boolean;
	repeatcount: number;
	consumed: boolean;
	presstime: number | null;
	timestamp: number;
	pressedAtMs: number;
	releasedAtMs: number;
	pressId: number;
	value: number;
	value2d: [number, number] | null;
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

	/** Clears retained physical and host-facing input state. */
	reset(): void;
}

export interface KeyboardInputHandler extends InputHandler {
	getKeyState(code: ButtonId): ButtonState;
	consumeKey(code: ButtonId): void;
	writeInputControllerKeyWords(keyWords: Uint32Array): void;
}

export interface PointerInputHandler extends InputHandler {
	writeInputControllerPointerSnapshot(snapshot: InputControllerSnapshot): void;
}

export interface GamepadInputHandler extends InputHandler {
	get gamepadIndex(): number;
	writeInputControllerPadSnapshot(snapshot: InputControllerPadSnapshot): void;
	applyVibrationEffect(durationMs: number, intensity: number): void;
	get supportsVibrationEffect(): boolean;
}
