import { getPressedState, Input, makeButtonState, resetObject } from './manager';
import { inputBindingId, type ButtonState, type KeyboardButtonId, type KeyboardInputHandler, type KeyOrButtonId2ButtonState } from './models';
import type { HostClock } from '../clock';
import { INPUT_CONTROLLER_KEY_WORD_COUNT } from '../../../machine/ts/machine/devices/input/contracts';
import { hidKeyUsageForCode } from './hid_keys';


/**
 * Represents a keyboard input handler that implements the IInputHandler interface.
 *
 * This class manages the state of keyboard keys, allowing for key press detection,
 * consumption of key events, and resetting of input states. It listens for keydown
 * and keyup events to update the state of keys accordingly.
 *
 * @implements {InputHandler}
 */
export class KeyboardInput implements KeyboardInputHandler {
	/**
	 * The state of each keyboard key.
	 */
	public keyStates: KeyOrButtonId2ButtonState = {};
	private readonly keyUsageWords = new Uint32Array(INPUT_CONTROLLER_KEY_WORD_COUNT);

	public gamepadButtonStates: KeyOrButtonId2ButtonState = {};

	private nextPressId = 1;

	constructor(
		private readonly clock: HostClock,
		public readonly deviceId: string = 'keyboard:0',
	) {
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
			this.keyUsageWords.fill(0);
		}
		else {
			resetObject(this.keyStates, except);
			resetObject(this.gamepadButtonStates, except);
			this.rebuildKeyUsageWords();
		}
	}

	private setKeyUsageWord(code: string, pressed: boolean): void {
		const usage = hidKeyUsageForCode(code);
		if (usage < 0) return;
		const word = usage >>> 5;
		const mask = 1 << (usage & 31);
		this.keyUsageWords[word] = pressed ? ((this.keyUsageWords[word] | mask) >>> 0) : ((this.keyUsageWords[word] & ~mask) >>> 0);
	}

	private rebuildKeyUsageWords(): void {
		this.keyUsageWords.fill(0);
		for (const code in this.keyStates) {
			if (this.keyStates[code].pressed) {
				this.setKeyUsageWord(code, true);
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
		const state = this.gamepadButtonStates[key];
		if (state) {
			state.consumed = true;
		}
		this.setKeyUsageWord(key, false);
		const bindings = Input.DEFAULT_INPUT_MAPPING.keyboard[key];
		if (bindings) {
			for (let index = 0; index < bindings.length; index += 1) {
				const code = inputBindingId(bindings[index]);
				const boundState = this.gamepadButtonStates[code];
				if (boundState) {
					boundState.consumed = true;
				}
				this.setKeyUsageWord(code, false);
			}
		}
		const keyMappedToCorrespondingGamepadButtonId = Input.KEYBOARDKEY2GAMEPADBUTTON[key as keyof typeof Input.KEYBOARDKEY2GAMEPADBUTTON];
		if (keyMappedToCorrespondingGamepadButtonId) {
			const mappedState = this.gamepadButtonStates[keyMappedToCorrespondingGamepadButtonId];
			if (mappedState) {
				mappedState.consumed = true;
			}
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
		return getPressedState(this.gamepadButtonStates, key);
	}

	public writeInputControllerKeyWords(keyWords: Uint32Array): void {
		for (let i = 0; i < INPUT_CONTROLLER_KEY_WORD_COUNT; i += 1) {
			keyWords[i] = (keyWords[i] | this.keyUsageWords[i]) >>> 0;
		}
	}

	/**
	 * Polls the input from the keyboard.
	 * This function should be called once per frame to ensure that keyboard input is up-to-date.
	 * It updates the state of each key based on the current keydown and keyup events.
	 * @returns void
	 */
	pollInput(): void {
		const now = this.clock.now();
		for (const buttonId in this.keyStates) {
			const state = getPressedState(this.gamepadButtonStates, buttonId);
			const current = this.keyStates[buttonId];
			const isDown = current.pressed;
			const wasDown = state.pressed;
			const wasPressed = state.waspressed;
			const wasReleased = state.wasreleased;
			const previousTimestamp = state.timestamp;
			const previousReleasedAtMs = state.releasedAtMs;
			const previousPressId = state.pressId;
			const previousConsumed = state.consumed;
			const justpressed = current.justpressed;
			const justreleased = current.justreleased;

			let pressId = current.pressId || previousPressId;
			if ((isDown || justpressed || justreleased) && !pressId) {
				pressId = this.nextPressId++;
				current.pressId = pressId;
			}
			const pressedAt = current.pressedAtMs;

			if (isDown) {
				state.pressed = true;
				state.justpressed = justpressed;
				state.justreleased = false;
				state.waspressed = true;
				state.wasreleased = wasReleased;
				state.presstime = now - pressedAt;
				state.pressedAtMs = pressedAt;
				state.releasedAtMs = 0;
				state.timestamp = justpressed ? current.timestamp : previousTimestamp;
				state.pressId = pressId;
				state.value = 1;
				state.consumed = previousConsumed;
			} else {
				state.pressed = false;
				state.justpressed = justpressed;
				state.justreleased = justreleased;
				state.waspressed = wasPressed || wasDown || justpressed;
				state.wasreleased = wasReleased || wasDown || justreleased;
				state.presstime = null;
				state.pressedAtMs = 0;
				state.releasedAtMs = justreleased ? current.releasedAtMs : previousReleasedAtMs;
				state.timestamp = (justreleased || justpressed) ? current.timestamp : previousTimestamp;
				state.pressId = (justpressed || justreleased || wasDown) ? pressId : 0;
				state.value = 0;
				state.consumed = false;
			}

			const mapped = Input.KEYBOARDKEY2GAMEPADBUTTON[buttonId as keyof typeof Input.KEYBOARDKEY2GAMEPADBUTTON];
			if (mapped) {
				const dst = getPressedState(this.gamepadButtonStates, mapped);
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
				dst.value2d = state.value2d;
			}

			current.justpressed = false;
			current.justreleased = false;
		}
	}

	/**
	 * Sets the key state to true when a key is pressed.
	 * @param key_code - The button ID or string representing the key.
	 */
	keydown(key_code: KeyboardButtonId | string): void {
		const now = this.clock.now();
		const state = this.keyStates[key_code] ?? (this.keyStates[key_code] = makeButtonState());
		if (!state.pressed) {
			state.pressed = true;
			state.timestamp = now;
			state.pressedAtMs = now;
			state.releasedAtMs = 0;
			state.pressId = this.nextPressId++;
			state.justpressed = true;
			this.setKeyUsageWord(key_code, true);
		}
	}

	/**
	 * Handles the keyup event for a given key.
	 * @param key_code - The key identifier or name.
	 */
	keyup(key_code: KeyboardButtonId | string): void {
		const state = this.keyStates[key_code];
		if (!state || (!state.pressed && !state.justpressed)) return;
		state.pressed = false;
		state.timestamp = this.clock.now();
		state.pressedAtMs = 0;
		state.releasedAtMs = state.timestamp;
		state.justreleased = true;
		this.setKeyUsageWord(key_code, false);
	}

}
