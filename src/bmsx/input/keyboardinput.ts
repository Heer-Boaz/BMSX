import { getPressedState, Input, makeButtonState, options, resetObject } from './input';
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

	constructor() {
		this.keyStates = {};
		this.gamepadButtonStates = {};
		this.reset();

		window.addEventListener('keydown', e => { this.keydown(e.code); }, options);
		window.addEventListener('keyup', e => { this.keyup(e.code); }, options);
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
	public consumeButton(key: string): void {
		this.gamepadButtonStates[key].consumed = true;
		// Use the constant to map keyboard keys to gamepad buttons
		const keyMappedToCorrespondingGamepadButtonId = Input.KEYBOARDKEY2GAMEPADBUTTON[key as keyof typeof Input.KEYBOARDKEY2GAMEPADBUTTON];
		if (keyMappedToCorrespondingGamepadButtonId) {
			this.gamepadButtonStates[keyMappedToCorrespondingGamepadButtonId].consumed = true;
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
		const now = performance.now();
		// Update existing keys in place, create states on demand
		Object.keys(this.keyStates).forEach(buttonId => {
			const prev = this.gamepadButtonStates[buttonId] ?? makeButtonState();
			const isDown = this.keyStates[buttonId].pressed;
			const wasDown = !!prev.pressed;
			if (isDown) {
				const just = !wasDown;
				if (just) {
					const pid = this.nextPressId++;
					this.gamepadButtonStates[buttonId] = makeButtonState({
						pressed: true,
						justpressed: true,
						waspressed: true,
						presstime: 0,
						timestamp: now,
						pressedAtMs: now,
						pressId: pid,
						value: 1,
					});
				} else {
					const st = this.gamepadButtonStates[buttonId] ?? makeButtonState();
					st.pressed = true;
					st.justpressed = false;
					st.waspressed = true;
					st.justreleased = false;
					st.presstime = (st.presstime ?? 0) + 1;
					st.value = 1;
					// preserve pressId, pressedAtMs, timestamp from first frame
					this.gamepadButtonStates[buttonId] = st;
				}
			} else {
				const st = this.gamepadButtonStates[buttonId] ?? makeButtonState();
				const jr = wasDown;
				this.gamepadButtonStates[buttonId] = makeButtonState({
					pressed: false,
					justpressed: false,
					justreleased: jr,
					waspressed: st.waspressed || wasDown,
					wasreleased: st.wasreleased || jr,
					consumed: st.consumed || false,
					timestamp: now,
					releasedAtMs: jr ? now : st.releasedAtMs ?? null,
					pressId: jr ? st.pressId ?? null : st.pressId ?? null,
					value: 0,
				});
			}

			// Mirror to the corresponding gamepad button mapping for keyboard (so consumers can treat keyboard as a gamepad-like source)
			const mapped = Input.KEYBOARDKEY2GAMEPADBUTTON[buttonId as keyof typeof Input.KEYBOARDKEY2GAMEPADBUTTON];
			if (mapped) {
				const src = this.gamepadButtonStates[buttonId];
				const dst = this.gamepadButtonStates[mapped] ?? makeButtonState();
				// copy fields shallowly
				dst.pressed = src.pressed;
				dst.justpressed = src.justpressed;
				dst.justreleased = src.justreleased;
				dst.waspressed = src.waspressed;
				dst.wasreleased = src.wasreleased;
				dst.consumed = src.consumed;
				dst.presstime = src.presstime;
				dst.timestamp = src.timestamp;
				dst.pressedAtMs = src.pressedAtMs;
				dst.releasedAtMs = src.releasedAtMs;
				dst.pressId = src.pressId;
				dst.value = src.value;
				dst.value2d = src.value2d ?? null;
				this.gamepadButtonStates[mapped] = dst;
			}
		});
	}

	/**
	 * Sets the key state to true when a key is pressed.
	 * @param key_code - The button ID or string representing the key.
	 */
	keydown(key_code: KeyboardButtonId | string): void {
		if (!this.keyStates[key_code]) {
			this.keyStates[key_code] = makeButtonState({ pressed: true, justpressed: true, presstime: 0, timestamp: performance.now() });
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
		window.removeEventListener('keydown', e => { this.keydown(e.code); }, options);
		window.removeEventListener('keyup', e => { this.keyup(e.code); }, options);
		this.reset();
		this.keyStates = {};
		this.gamepadButtonStates = {};
	}
}
