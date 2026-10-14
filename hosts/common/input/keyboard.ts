import { getPressedState, Input, makeButtonState } from './manager';
import { inputBindingId, type ButtonState, type KeyboardButtonId, type KeyboardInputHandler, type KeyOrButtonId2ButtonState } from './models';
import type { HostClock } from '../clock';
import { INPUT_CONTROLLER_KEY_WORD_COUNT } from '../../../machine/ts/machine/devices/input/contracts';
import { HID_MODIFIER_FIRST_USAGE, hidKeyUsageForCode } from './hid_keys';


/** Retains the combined keyboard state of every keyboard source assigned to player one. */
export class KeyboardInput implements KeyboardInputHandler {
	/**
	 * Event-latched source banks and their union. Hardware control chords use
	 * the physical view; editors use the union. Source attribution is retained
	 * until routing, including taps wholly between host polls.
	 */
	private keyStates: KeyOrButtonId2ButtonState = {};
	private physicalKeyStates: KeyOrButtonId2ButtonState = {};
	private virtualKeyStates: KeyOrButtonId2ButtonState = {};
	private polledPhysicalKeyStates: KeyOrButtonId2ButtonState = {};
	private polledVirtualKeyStates: KeyOrButtonId2ButtonState = {};
	private polledKeyStates: KeyOrButtonId2ButtonState = {};
	private mappedButtonStates: KeyOrButtonId2ButtonState = {};
	private readonly keyCodes: string[] = [];
	private readonly physicalKeyCodes: string[] = [];
	private readonly virtualKeyCodes: string[] = [];
	private readonly pressedKeysBySource = new Map<string, Set<string>>();
	private keySourceCounts: Record<string, number> = {};
	private readonly physicalKeyUsageWords = new Uint32Array(INPUT_CONTROLLER_KEY_WORD_COUNT);
	private readonly virtualKeyUsageWords = new Uint32Array(INPUT_CONTROLLER_KEY_WORD_COUNT);
	private readonly routedPhysicalKeyUsageWords = new Uint32Array(INPUT_CONTROLLER_KEY_WORD_COUNT);
	private readonly routedVirtualKeyUsageWords = new Uint32Array(INPUT_CONTROLLER_KEY_WORD_COUNT);

	private nextPressId = 1;
	private ordinaryHeldCount = 0;
	private ordinaryPressGeneration = 0;

	public get physicalOrdinaryHeldCount(): number { return this.ordinaryHeldCount; }
	public get physicalOrdinaryPressGeneration(): number { return this.ordinaryPressGeneration; }
	public get routedPhysicalModifierMask(): number { return this.routedPhysicalKeyUsageWords[HID_MODIFIER_FIRST_USAGE >>> 5] & 0xff; }

	constructor(
		private readonly clock: HostClock,
	) {
		this.reset();
	}

	public reset(): void {
		this.keyStates = {};
		this.physicalKeyStates = {};
		this.virtualKeyStates = {};
		this.polledPhysicalKeyStates = {};
		this.polledVirtualKeyStates = {};
		this.polledKeyStates = {};
		this.mappedButtonStates = {};
		// The fixed one-key console bindings are views of the same physical state,
		// not copies rebuilt on every poll.
		for (const code in Input.KEYBOARDKEY2GAMEPADBUTTON) {
			this.mappedButtonStates[Input.KEYBOARDKEY2GAMEPADBUTTON[code]] = getPressedState(this.polledPhysicalKeyStates, code);
		}
		this.pressedKeysBySource.clear();
		this.keySourceCounts = {};
		this.keyCodes.length = 0;
		this.physicalKeyCodes.length = 0;
		this.virtualKeyCodes.length = 0;
		this.ordinaryHeldCount = 0;
		this.physicalKeyUsageWords.fill(0);
		this.virtualKeyUsageWords.fill(0);
		this.routedPhysicalKeyUsageWords.fill(0);
		this.routedVirtualKeyUsageWords.fill(0);
	}

	private setKeyUsageWord(words: Uint32Array, usage: number, pressed: boolean): void {
		if (usage < 0) return;
		const word = usage >>> 5;
		const mask = 1 << (usage & 31);
		words[word] = pressed ? ((words[word] | mask) >>> 0) : ((words[word] & ~mask) >>> 0);
	}

	/**
	 * Consumes a mapped console control and its physical keyboard bindings for
	 * every later owner in the current host frame.
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
				this.consumePhysicalKey(code);
			}
		}
	}

	/** Removes only hardware contributions, preserving virtual typing of the same key. */
	public consumePhysicalKey(code: string): void {
		const physical = this.polledPhysicalKeyStates[code];
		if (physical) physical.consumed = true;
		const aggregate = this.polledKeyStates[code];
		if (aggregate) {
			const virtual = this.polledVirtualKeyStates[code];
			if (virtual && !virtual.consumed && (virtual.pressed || virtual.justpressed || virtual.justreleased)) {
				Object.assign(aggregate, virtual);
			} else {
				aggregate.consumed = true;
			}
		}
		this.setKeyUsageWord(this.routedPhysicalKeyUsageWords, hidKeyUsageForCode(code), false);
	}

	/** Physical host UI reads never include keys produced by the virtual keyboard. */
	public physicalKeyPressed(code: string): boolean {
		return this.polledPhysicalKeyStates[code]?.pressed === true;
	}

	/** Consumes a merged editor key, including both physical and virtual contributions. */
	public consumeKey(code: string): void {
		const state = this.polledKeyStates[code];
		if (state) {
			state.consumed = true;
		}
		const physical = this.polledPhysicalKeyStates[code];
		if (physical) physical.consumed = true;
		const virtual = this.polledVirtualKeyStates[code];
		if (virtual) virtual.consumed = true;
		const usage = hidKeyUsageForCode(code);
		this.setKeyUsageWord(this.routedPhysicalKeyUsageWords, usage, false);
		this.setKeyUsageWord(this.routedVirtualKeyUsageWords, usage, false);
	}

	/** Returns the physical-only console-control view used by host control chords. */
	// disable-next-line single_line_method_pattern -- KeyboardInputHandler keeps hardware controls separate from merged typing state.
	public getButtonState(button: string): ButtonState {
		return getPressedState(this.mappedButtonStates, button);
	}

	/** Returns the polled aggregate key view used by keyboard-oriented host UI. */
	// disable-next-line single_line_method_pattern -- KeyboardInputHandler keeps merged typing state distinct from physical console controls.
	public getKeyState(code: string): ButtonState {
		return getPressedState(this.polledKeyStates, code);
	}

	public writeInputControllerKeyWords(keyWords: Uint32Array): void {
		for (let i = 0; i < INPUT_CONTROLLER_KEY_WORD_COUNT; i += 1) {
			keyWords[i] = (keyWords[i] | this.routedPhysicalKeyUsageWords[i] | this.routedVirtualKeyUsageWords[i]) >>> 0;
		}
	}

	public pollInput(): void {
		const now = this.clock.now();
		this.routedPhysicalKeyUsageWords.set(this.physicalKeyUsageWords);
		this.routedVirtualKeyUsageWords.set(this.virtualKeyUsageWords);
		this.publishKeyStates(this.physicalKeyStates, this.physicalKeyCodes, this.polledPhysicalKeyStates, now);
		this.publishKeyStates(this.virtualKeyStates, this.virtualKeyCodes, this.polledVirtualKeyStates, now);
		this.publishKeyStates(this.keyStates, this.keyCodes, this.polledKeyStates, now);
	}

	/** Publishes retained event edges without allocating new snapshots each frame. */
	private publishKeyStates(currentStates: KeyOrButtonId2ButtonState, codes: readonly string[], polledStates: KeyOrButtonId2ButtonState, now: number): void {
		for (let index = 0; index < codes.length; index += 1) {
			const buttonId = codes[index];
			const state = getPressedState(polledStates, buttonId);
			const current = currentStates[buttonId];
			const isDown = current.pressed;
			const wasDown = state.pressed;
			const wasPressed = state.waspressed;
			const wasReleased = state.wasreleased;
			const previousTimestamp = state.timestamp;
			const previousReleasedAtMs = state.releasedAtMs;
			const justpressed = current.justpressed;
			const justreleased = current.justreleased;

			const pressId = current.pressId;
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

			current.justpressed = false;
			current.justreleased = false;
		}
	}

	/**
	 * Sets the key state to true when a key is pressed.
	 * @param key_code - The button ID or string representing the key.
	 */
	public keydown(sourceId: string, keyCode: KeyboardButtonId | string): void {
		let pressedKeys = this.pressedKeysBySource.get(sourceId);
		if (!pressedKeys) {
			pressedKeys = new Set<string>();
			this.pressedKeysBySource.set(sourceId, pressedKeys);
		}
		if (pressedKeys.has(keyCode)) {
			return;
		}
		pressedKeys.add(keyCode);
		const sourceCount = this.keySourceCounts[keyCode] || 0;
		this.keySourceCounts[keyCode] = sourceCount + 1;
		if (sourceCount !== 0) {
			return;
		}
		const now = this.clock.now();
		this.setEventKeyState(this.physicalKeyStates, this.physicalKeyCodes, keyCode, true, now);
		if (!this.virtualKeyStates[keyCode]?.pressed) this.setEventKeyState(this.keyStates, this.keyCodes, keyCode, true, now);
		const usage = hidKeyUsageForCode(keyCode);
		if (usage >= 0 && usage < HID_MODIFIER_FIRST_USAGE) {
			this.ordinaryHeldCount += 1;
			this.ordinaryPressGeneration += 1;
		}
		this.setKeyUsageWord(this.physicalKeyUsageWords, usage, true);
	}

	/**
	 * Handles the keyup event for a given key.
	 * @param key_code - The key identifier or name.
	 */
	public keyup(sourceId: string, keyCode: KeyboardButtonId | string): void {
		const pressedKeys = this.pressedKeysBySource.get(sourceId);
		if (!pressedKeys || !pressedKeys.delete(keyCode)) {
			return;
		}
		this.releaseKey(keyCode);
	}

	/** Releases every key retained by a disconnected keyboard source. */
	public disconnectSource(sourceId: string): void {
		const pressedKeys = this.pressedKeysBySource.get(sourceId);
		if (!pressedKeys) {
			return;
		}
		for (const keyCode of pressedKeys) {
			this.releaseKey(keyCode);
		}
		this.pressedKeysBySource.delete(sourceId);
	}

	private releaseKey(keyCode: KeyboardButtonId | string): void {
		const sourceCount = this.keySourceCounts[keyCode] - 1;
		if (sourceCount !== 0) {
			this.keySourceCounts[keyCode] = sourceCount;
			return;
		}
		delete this.keySourceCounts[keyCode];
		const now = this.clock.now();
		this.setEventKeyState(this.physicalKeyStates, this.physicalKeyCodes, keyCode, false, now);
		if (!this.virtualKeyStates[keyCode]?.pressed) this.setEventKeyState(this.keyStates, this.keyCodes, keyCode, false, now);
		const usage = hidKeyUsageForCode(keyCode);
		if (usage >= 0 && usage < HID_MODIFIER_FIRST_USAGE) this.ordinaryHeldCount -= 1;
		this.setKeyUsageWord(this.physicalKeyUsageWords, usage, false);
	}

	/** The on-screen keyboard already aggregates its contact and modifier sources. */
	public setVirtualKey(code: string, down: boolean): void {
		const now = this.clock.now();
		this.setEventKeyState(this.virtualKeyStates, this.virtualKeyCodes, code, down, now);
		if (!this.physicalKeyStates[code]?.pressed) this.setEventKeyState(this.keyStates, this.keyCodes, code, down, now);
		this.setKeyUsageWord(this.virtualKeyUsageWords, hidKeyUsageForCode(code), down);
	}

	private setEventKeyState(states: KeyOrButtonId2ButtonState, codes: string[], code: string, down: boolean, now: number): void {
		let state = states[code];
		if (!state) {
			state = states[code] = makeButtonState();
			codes.push(code);
		}
		state.pressed = down;
		state.timestamp = now;
		if (down) {
			state.pressedAtMs = now;
			state.releasedAtMs = 0;
			state.pressId = this.nextPressId++;
			state.justpressed = true;
		} else {
			state.pressedAtMs = 0;
			state.releasedAtMs = now;
			state.justreleased = true;
		}
	}

}
