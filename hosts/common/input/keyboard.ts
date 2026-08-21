import { getPressedState, Input, makeButtonState } from './manager';
import { inputBindingId, type ButtonState, type KeyboardButtonId, type KeyboardInputHandler, type KeyOrButtonId2ButtonState } from './models';
import type { HostClock } from '../clock';
import { INPUT_CONTROLLER_KEY_WORD_COUNT } from '../../../machine/ts/machine/devices/input/contracts';
import { hidKeyUsageForCode } from './hid_keys';


/** Retains physical keyboard input and its normalized host-control projection. */
export class KeyboardInput implements KeyboardInputHandler {
	/**
	 * Event-latched physical key state. pollInput publishes this into the
	 * host-facing key and mapped-button views once per host frame.
	 */
	private keyStates: KeyOrButtonId2ButtonState = {};
	private polledKeyStates: KeyOrButtonId2ButtonState = {};
	private mappedButtonStates: KeyOrButtonId2ButtonState = {};
	private readonly keyUsageWords = new Uint32Array(INPUT_CONTROLLER_KEY_WORD_COUNT);
	private readonly routedKeyUsageWords = new Uint32Array(INPUT_CONTROLLER_KEY_WORD_COUNT);

	private nextPressId = 1;

	constructor(
		private readonly clock: HostClock,
		public readonly deviceId: string = 'keyboard:0',
	) {
		this.reset();
	}

	public reset(): void {
		this.keyStates = {};
		this.polledKeyStates = {};
		this.mappedButtonStates = {};
		this.keyUsageWords.fill(0);
		this.routedKeyUsageWords.fill(0);
	}

	private setKeyUsageWord(code: string, pressed: boolean): void {
		const usage = hidKeyUsageForCode(code);
		if (usage < 0) return;
		const word = usage >>> 5;
		const mask = 1 << (usage & 31);
		this.keyUsageWords[word] = pressed ? ((this.keyUsageWords[word] | mask) >>> 0) : ((this.keyUsageWords[word] & ~mask) >>> 0);
	}

	/**
	 * Consumes a mapped console control without hiding its physical key from host
	 * keyboard owners. The matching HID usages are removed from this frame's ICU
	 * view so a host chord cannot leak into the guest.
	 *
	 * @param button - The mapped console control to consume.
	 * @returns void
	 */
	public consumeButton(button: string): void {
		const state = this.mappedButtonStates[button];
		if (state) {
			state.consumed = true;
		}
		const bindings = Input.DEFAULT_INPUT_MAPPING.keyboard[button];
		if (bindings) {
			for (let index = 0; index < bindings.length; index += 1) {
				const code = inputBindingId(bindings[index]);
				this.hideKeyUsage(code);
			}
		}
	}

	/** Consumes one physical key for later host owners and the current ICU view. */
	public consumeKey(code: string): void {
		const state = this.polledKeyStates[code];
		if (state) {
			state.consumed = true;
		}
		this.hideKeyUsage(code);
		const mapped = Input.KEYBOARDKEY2GAMEPADBUTTON[code as keyof typeof Input.KEYBOARDKEY2GAMEPADBUTTON];
		if (mapped) {
			const mappedState = this.mappedButtonStates[mapped];
			if (mappedState) {
				mappedState.consumed = true;
			}
		}
	}

	private hideKeyUsage(code: string): void {
		const usage = hidKeyUsageForCode(code);
		if (usage < 0) return;
		const word = usage >>> 5;
		this.routedKeyUsageWords[word] = (this.routedKeyUsageWords[word] & ~(1 << (usage & 31))) >>> 0;
	}

	/** Returns a normalized console-control view used by host control chords. */
	public getButtonState(button: string): ButtonState {
		return getPressedState(this.mappedButtonStates, button);
	}

	/** Returns the polled physical key view used by keyboard-oriented host UI. */
	public getKeyState(code: string): ButtonState {
		return getPressedState(this.polledKeyStates, code);
	}

	public writeInputControllerKeyWords(keyWords: Uint32Array): void {
		for (let i = 0; i < INPUT_CONTROLLER_KEY_WORD_COUNT; i += 1) {
			keyWords[i] = (keyWords[i] | this.routedKeyUsageWords[i]) >>> 0;
		}
	}

	public pollInput(): void {
		const now = this.clock.now();
		this.routedKeyUsageWords.set(this.keyUsageWords);
		for (const buttonId in this.keyStates) {
			const state = getPressedState(this.polledKeyStates, buttonId);
			const current = this.keyStates[buttonId];
			const isDown = current.pressed;
			const wasDown = state.pressed;
			const wasPressed = state.waspressed;
			const wasReleased = state.wasreleased;
			const previousTimestamp = state.timestamp;
			const previousReleasedAtMs = state.releasedAtMs;
			const previousPressId = state.pressId;
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
				state.consumed = false;
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
				const dst = getPressedState(this.mappedButtonStates, mapped);
				dst.pressed = state.pressed;
				dst.justpressed = state.justpressed;
				dst.justreleased = state.justreleased;
				dst.waspressed = state.waspressed;
				dst.wasreleased = state.wasreleased;
				dst.consumed = false;
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
