import { $ } from '../core/game';
import { getPressedState, Input, makeButtonState, resetObject } from './input';
import type { ButtonState, InputHandler, KeyboardButtonId, KeyOrButtonId2ButtonState, VibrationParams } from './inputtypes';


/**
 * Represents a keyboard input handler that implements the IInputHandler interface.
 *
 * This class manages the state of keyboard keys, allowing for key press detection,
 * consumption of key events, and resetting of input states. It listens for keydown
 * and keyup events to update the state of keys accordingly.
 *
 * @implements {InputHandler}
 */
export class KeyboardInput implements InputHandler {
	/**
	 * The state of each keyboard key.
	 */
	public keyStates: KeyOrButtonId2ButtonState = {};

	public gamepadButtonStates: KeyOrButtonId2ButtonState = {};

	public get supportsVibrationEffect(): boolean {
		return false; // Keyboard does not support vibration effects
	}

	public applyVibrationEffect(_params: VibrationParams): void {
		// No vibration effect for keyboard
	}

	/**
	 * The index of the input device, which defaults to 0 (the main player).
	 */
	public readonly gamepadIndex = 0;

	private nextPressId = 1;

	constructor(public readonly deviceId: string = 'keyboard:0') {
		this.keyStates = {};
		this.gamepadButtonStates = {};
		this.reset();
	}

	/**
	 * Resets the state of all input keys and gamepad buttons.
	 * @param except An optional array of keys or buttons to exclude from the reset.
	 */
	public reset(except?: string[]): void {
		if (!except) {
			this.keyStates = {};
			this.gamepadButtonStates = {};
		}
		else {
			resetObject(this.keyStates, except);
			resetObject(this.gamepadButtonStates, except);
		}
	}

	/**
	 * Marks the specified key as consumed, preventing further processing of its state.
	 *
	 * @param key - The identifier of the key to be consumed.
	 * @returns void
	 */
	public consumeButton(key: string, options?: { sticky?: boolean }): void {
		const sticky = options?.sticky ?? true;
		const state = this.gamepadButtonStates[key] ?? (this.gamepadButtonStates[key] = makeButtonState());
		state.consumed = true;
		state.stickyConsumed = sticky ? true : state.stickyConsumed ?? false;
		// Use the constant to map keyboard keys to gamepad buttons
		const keyMappedToCorrespondingGamepadButtonId = Input.KEYBOARDKEY2GAMEPADBUTTON[key as keyof typeof Input.KEYBOARDKEY2GAMEPADBUTTON];
		if (keyMappedToCorrespondingGamepadButtonId) {
			const mappedState = this.gamepadButtonStates[keyMappedToCorrespondingGamepadButtonId] ?? (this.gamepadButtonStates[keyMappedToCorrespondingGamepadButtonId] = makeButtonState());
			mappedState.consumed = true;
			mappedState.stickyConsumed = sticky ? true : mappedState.stickyConsumed ?? false;
		}
	}

	/**
	 * Retrieves the current state of a specified button.
	 *
	 * @param key - The identifier for the button whose state is to be retrieved.
	 * @returns The current state of the button as a ButtonState object.
	 *          If the provided key is null, a default ButtonState is returned.
	 */
	public getButtonState(key: string): ButtonState {
		if (key === null) return makeButtonState();
		return getPressedState(this.gamepadButtonStates, key);
		// const convertedKey = Input.KEYBOARDKEY2GAMEPADBUTTON[key] ? Input.KEYBOARDKEY2GAMEPADBUTTON[key] : key;
		// return getPressedState(this.gamepadButtonStates, convertedKey);
	}

	/**
	 * Polls the input from the keyboard.
	 * This function should be called once per frame to ensure that keyboard input is up-to-date.
	 * It updates the state of each key based on the current keydown and keyup events.
	 * @returns void
	 */
	pollInput(): void {
		const now = $.platform.clock.now();
		// Update existing keys in place, create states on demand
		Object.keys(this.keyStates).forEach(buttonId => {
			const prev = this.gamepadButtonStates[buttonId] ?? makeButtonState();
			const isDown = this.keyStates[buttonId].pressed === true;
			const wasDown = prev.pressed === true;

			let pressId = prev.pressId ?? null;
			if (isDown && !pressId) {
				pressId = this.nextPressId++;
			}
			const pressedAt = wasDown ? (prev.pressedAtMs ?? prev.timestamp ?? now) : now;

			let state: ButtonState;
			if (isDown) {
				const stickyConsumed = prev.stickyConsumed ?? false;
				state = {
					...prev,
					pressed: true,
					justpressed: !wasDown,
					justreleased: false,
					waspressed: true,
					wasreleased: prev.wasreleased,
					presstime: Math.max(0, now - pressedAt),
					pressedAtMs: pressedAt,
					releasedAtMs: null,
					timestamp: wasDown ? (prev.timestamp ?? pressedAt) : now,
					pressId,
					value: 1,
					consumed: stickyConsumed,
					stickyConsumed,
				};
			} else {
				state = {
					...prev,
					pressed: false,
					justpressed: false,
					justreleased: wasDown,
					waspressed: prev.waspressed || wasDown,
					wasreleased: prev.wasreleased || wasDown,
					presstime: null,
					pressedAtMs: null,
					releasedAtMs: wasDown ? now : prev.releasedAtMs ?? null,
					timestamp: wasDown ? now : prev.timestamp ?? now,
					pressId: wasDown ? (prev.pressId ?? pressId) : null,
					value: 0,
					consumed: false,
					stickyConsumed: false,
				};
			}

			this.gamepadButtonStates[buttonId] = state;

			const mapped = Input.KEYBOARDKEY2GAMEPADBUTTON[buttonId as keyof typeof Input.KEYBOARDKEY2GAMEPADBUTTON];
			if (mapped) {
				const dst = this.gamepadButtonStates[mapped] ?? makeButtonState();
				dst.pressed = state.pressed;
				dst.justpressed = state.justpressed;
				dst.justreleased = state.justreleased;
				dst.waspressed = state.waspressed;
				dst.wasreleased = state.wasreleased;
				dst.consumed = state.consumed;
				dst.presstime = state.presstime;
				dst.timestamp = state.timestamp;
				dst.pressedAtMs = state.pressedAtMs;
				dst.releasedAtMs = state.releasedAtMs;
				dst.pressId = state.pressId;
				dst.value = state.value;
				dst.value2d = state.value2d ?? null;
				dst.stickyConsumed = state.stickyConsumed;
				this.gamepadButtonStates[mapped] = dst;
			}
		});
	}

	public ingestButton(_code: string, _state: ButtonState): void { }

	/**
	 * Sets the key state to true when a key is pressed.
	 * @param key_code - The button ID or string representing the key.
	 */
	keydown(key_code: KeyboardButtonId | string): void {
		if (!this.keyStates[key_code]) {
			this.keyStates[key_code] = makeButtonState({ pressed: true, justpressed: true, presstime: 0, timestamp: $.platform.clock.now() });
		} else {
			this.keyStates[key_code].pressed = true;
		}
	}

	/**
	 * Handles the keyup event for a given key.
	 * @param key_code - The key identifier or name.
	 */
	keyup(key_code: KeyboardButtonId | string): void {
		if (!this.keyStates[key_code]) return;
		this.keyStates[key_code] = makeButtonState();
	}

	/**
	 * Handles the blur event of the input element by resetting the input state.
	 * @param _e - The blur event object.
	 */
	blur(_e: FocusEvent): void {
		// this.preventInput = true; // Prevent input when the window loses focus
		this.reset();
	}

	/**
	 * Handles the focus event for the input element by resetting the input state.
	 * Resets the input state.
	 * @param _e - The focus event object.
	 */
	focus(_e: FocusEvent): void {
		this.reset();
		// this.preventInput = false; // Allow input when the window regains focus
	}

	dispose(): void {
		this.reset();
		this.keyStates = {};
		this.gamepadButtonStates = {};
	}
}
