import { consoleCore } from '../core/console';
import { getPressedState, Input, makeButtonState, resetObject } from './manager';
import type { ButtonState, InputHandler, KeyboardButtonId, KeyOrButtonId2ButtonState } from './models';
import type { VibrationParams } from '../platform';


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
	private readonly pendingPresses = new Set<string>();
	private readonly pendingReleases = new Set<string>();

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
			this.pendingPresses.clear();
			this.pendingReleases.clear();
		}
		else {
			resetObject(this.keyStates, except);
			resetObject(this.gamepadButtonStates, except);
			for (const key of [...this.pendingPresses]) {
				if (!except.includes(key)) {
					this.pendingPresses.delete(key);
				}
			}
			for (const key of [...this.pendingReleases]) {
				if (!except.includes(key)) {
					this.pendingReleases.delete(key);
				}
			}
		}
	}

	/**
	 * Marks the specified key as consumed, preventing further processing of its state.
	 *
	 * @param key - The identifier of the key to be consumed.
	 * @returns void
	 */
	public consumeButton(key: string): void {
		const state = this.gamepadButtonStates[key] ?? (this.gamepadButtonStates[key] = makeButtonState());
		state.consumed = true;
		// Use the constant to map keyboard keys to gamepad buttons
		const keyMappedToCorrespondingGamepadButtonId = Input.KEYBOARDKEY2GAMEPADBUTTON[key as keyof typeof Input.KEYBOARDKEY2GAMEPADBUTTON];
		if (keyMappedToCorrespondingGamepadButtonId) {
			const mappedState = this.gamepadButtonStates[keyMappedToCorrespondingGamepadButtonId] ?? (this.gamepadButtonStates[keyMappedToCorrespondingGamepadButtonId] = makeButtonState());
			mappedState.consumed = true;
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
		const now = consoleCore.platform.clock.now();
		// Update existing keys in place, create states on demand
		Object.keys(this.keyStates).forEach(buttonId => {
			const prev = this.gamepadButtonStates[buttonId] ?? makeButtonState();
			const current = this.keyStates[buttonId];
			const isDown = current.pressed;
			const wasDown = prev.pressed;
			const justpressed = this.pendingPresses.has(buttonId);
			const justreleased = this.pendingReleases.has(buttonId);

			let pressId = current.pressId ?? prev.pressId;
			if ((isDown || justpressed || justreleased) && !pressId) {
				pressId = this.nextPressId++;
				current.pressId = pressId;
			}
			const pressedAt = isDown
				? (current.pressedAtMs ?? prev.pressedAtMs ?? prev.timestamp ?? now)
				: null;

			let state: ButtonState;
			if (isDown) {
				const stickyConsumed = prev.consumed;
				state = {
					...prev,
					pressed: true,
					justpressed,
					justreleased: false,
					waspressed: true,
					wasreleased: prev.wasreleased,
					presstime: now - pressedAt,
					pressedAtMs: pressedAt,
					releasedAtMs: null,
					timestamp: justpressed ? (current.timestamp ?? now) : (prev.timestamp ?? pressedAt),
					pressId,
					value: 1,
					consumed: stickyConsumed,
				};
			} else {
				state = {
					...prev,
					pressed: false,
					justpressed,
					justreleased,
					waspressed: prev.waspressed || wasDown || justpressed,
					wasreleased: prev.wasreleased || wasDown || justreleased,
					presstime: null,
					pressedAtMs: null,
					releasedAtMs: justreleased ? (current.releasedAtMs ?? current.timestamp ?? now) : prev.releasedAtMs,
					timestamp: (justreleased || justpressed) ? (current.timestamp ?? now) : (prev.timestamp ?? now),
					pressId: (justpressed || justreleased || wasDown) ? pressId : null,
					value: 0,
					consumed: false,
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
				dst.value2d = state.value2d ;
				this.gamepadButtonStates[mapped] = dst;
			}

			this.pendingPresses.delete(buttonId);
			this.pendingReleases.delete(buttonId);
		});
	}

	public ingestButton(_code: string, _state: ButtonState): void { }

	/**
	 * Sets the key state to true when a key is pressed.
	 * @param key_code - The button ID or string representing the key.
	 */
	keydown(key_code: KeyboardButtonId | string): void {
		const now = consoleCore.platform.clock.now();
		const state = this.keyStates[key_code] ?? (this.keyStates[key_code] = makeButtonState());
		if (!state.pressed) {
			state.pressed = true;
			state.timestamp = now;
			state.pressedAtMs = now;
			state.releasedAtMs = null;
			state.pressId = this.nextPressId++;
			this.pendingPresses.add(key_code);
		}
	}

	/**
	 * Handles the keyup event for a given key.
	 * @param key_code - The key identifier or name.
	 */
	keyup(key_code: KeyboardButtonId | string): void {
		const state = this.keyStates[key_code];
		if (!state || (!state.pressed && !this.pendingPresses.has(key_code))) return;
		state.pressed = false;
		state.timestamp = consoleCore.platform.clock.now();
		state.releasedAtMs = state.timestamp;
		this.pendingReleases.add(key_code);
	}

}
