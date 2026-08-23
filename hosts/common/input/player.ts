import { makeButtonState } from './manager';
import {
	INPUT_SOURCES,
	type ButtonId,
	type ButtonState,
	type InputSource,
} from './models';
import type { GamepadInput } from './gamepad';
import type { KeyboardInput } from './keyboard';
import type { PointerInput } from './pointer';

export { INPUT_SOURCES };
export type { InputSource };

const INITIAL_REPEAT_DELAY_FRAMES = 15;
const REPEAT_INTERVAL_FRAMES = 4;

type RawActionRepeatRecord = {
	active: boolean;
	repeatCount: number;
	pressStartMs: number;
	lastFrameEvaluated: number;
	lastResult: boolean;
	lastRepeatAtMs: number;
};

type ControlInputSource = 'keyboard' | 'gamepad';

/** Bitwise flags representing keyboard modifier keys. */
export enum KeyModifier {
	none = 0,
	shift = 1 << 0,
	ctrl = 1 << 1,
	alt = 1 << 2,
	meta = 1 << 3,
}

/**
 * Host-side per-player input view. The machine ICU reads a raw snapshot directly
 * from the device handlers; this class owns the raw-button repeat cadence and
 * vibration output used by the IDE and overlays.
 */
export class PlayerInput {
	private frameDurationMs = 1000 / 60;

	/** Input handlers keyed by source (keyboard / gamepad / pointer), or null if unbound. */
	public inputHandlers: {
		keyboard: KeyboardInput | null;
		gamepad: GamepadInput | null;
		pointer: PointerInput | null;
	} = {
		keyboard: null,
		gamepad: null,
		pointer: null,
	};

	private readonly rawActionRepeatRecords: { [source in InputSource]: Map<ButtonId, RawActionRepeatRecord> } = {
		keyboard: new Map(),
		gamepad: new Map(),
		pointer: new Map(),
	};
	private readonly controlRepeatRecords: { [source in ControlInputSource]: Map<ButtonId, RawActionRepeatRecord> } = {
		keyboard: new Map(),
		gamepad: new Map(),
	};
	private readonly unboundButtonState = makeButtonState();
	private lastPollTimestampMs = 0;
	private frameCounter = 0;

	public applyInputControllerVibrationEffect(durationMs: number, intensity: number): void {
		const gamepad = this.inputHandlers.gamepad;
		if (gamepad?.supportsVibrationEffect) {
			gamepad.applyVibrationEffect(durationMs, intensity);
		}
	}

	public getModifiers(): KeyModifier {
		const keyboard = this.inputHandlers['keyboard'];
		if (!keyboard) {
			return KeyModifier.none;
		}
		let modifiers = KeyModifier.none;
		if (keyboard.getKeyState('ShiftLeft').pressed || keyboard.getKeyState('ShiftRight').pressed) {
			modifiers |= KeyModifier.shift;
		}
		if (keyboard.getKeyState('ControlLeft').pressed) {
			modifiers |= KeyModifier.ctrl;
		}
		if (keyboard.getKeyState('AltLeft').pressed) {
			modifiers |= KeyModifier.alt;
		}
		if (keyboard.getKeyState('MetaLeft').pressed || keyboard.getKeyState('MetaRight').pressed) {
			modifiers |= KeyModifier.meta;
		}
		return modifiers;
	}

	/** Live button state straight from the device handler. */
	public getRawButtonState(button: ButtonId, source: InputSource): ButtonState {
		if (source === 'keyboard') {
			const keyboard = this.inputHandlers.keyboard;
			return keyboard ? keyboard.getKeyState(button) : this.unboundButtonState;
		}
		const handler = this.inputHandlers[source];
		if (!handler) return this.unboundButtonState;
		return handler.getButtonState(button);
	}

	public get pollFrame(): number {
		return this.frameCounter;
	}

	/** Returns repeat/edge info for a raw button using the built-in repeat cadence. */
	public buttonRepeatEdge(button: ButtonId, source: InputSource): boolean {
		const rawState = this.getRawButtonState(button, source);
		if (rawState.consumed) {
			return false;
		}
		const repeat = this.repeatState(this.rawActionRepeatRecords[source], button);
		this.evaluateRepeat(
			repeat,
			rawState.pressed,
			rawState.justpressed,
			rawState.pressedAtMs,
			this.frameCounter,
		);
		return rawState.justpressed || repeat.lastResult;
	}

	/** Returns repeat/edge info for a normalized console control. */
	public controlButtonRepeatEdge(button: ButtonId, source: ControlInputSource): boolean {
		const handler = this.inputHandlers[source];
		const state = handler ? handler.getButtonState(button) : this.unboundButtonState;
		if (state.consumed) {
			return false;
		}
		const repeat = this.repeatState(this.controlRepeatRecords[source], button);
		this.evaluateRepeat(
			repeat,
			state.pressed,
			state.justpressed,
			state.pressedAtMs,
			this.frameCounter,
		);
		return state.justpressed || repeat.lastResult;
	}

	public controlSignalRepeatEdge(
		signal: ButtonId,
		source: ControlInputSource,
		pressed: boolean,
	): boolean {
		const repeat = this.repeatState(this.controlRepeatRecords[source], signal);
		const acquired = pressed && !repeat.active;
		this.evaluateRepeat(
			repeat,
			pressed,
			acquired,
			this.lastPollTimestampMs,
			this.frameCounter,
		);
		return acquired || repeat.lastResult;
	}

	public resetControlButtonRepeats(): void {
		this.controlRepeatRecords.keyboard.clear();
		this.controlRepeatRecords.gamepad.clear();
	}

	public setGamepad(gamepadInput: GamepadInput | null): void {
		this.inputHandlers['gamepad'] = gamepadInput;
		this.rawActionRepeatRecords.gamepad.clear();
		this.controlRepeatRecords.gamepad.clear();
	}

	/** Polls the input for the player for each input source (keyboard, gamepad, ...). */
	pollInput(currentTime: number): void {
		this.frameCounter += 1;
		this.lastPollTimestampMs = currentTime;
		for (let i = 0; i < INPUT_SOURCES.length; i += 1) {
			const source = INPUT_SOURCES[i];
			this.inputHandlers[source]?.pollInput();
		}
	}

	private evaluateRepeat(
		repeat: RawActionRepeatRecord,
		pressed: boolean,
		justPressed: boolean,
		pressedAtMs: number,
		frameId: number,
	): void {
		if (repeat.lastFrameEvaluated === frameId) {
			return;
		}

		let result = false;
		const now = this.lastPollTimestampMs;
		const initialDelayMs = INITIAL_REPEAT_DELAY_FRAMES * this.frameDurationMs;
		const repeatIntervalMs = REPEAT_INTERVAL_FRAMES * this.frameDurationMs;

		if (justPressed) {
			repeat.active = true;
			repeat.repeatCount = 0;
			repeat.pressStartMs = pressedAtMs;
			repeat.lastRepeatAtMs = pressedAtMs;
		} else if (!pressed) {
			repeat.active = false;
			repeat.repeatCount = 0;
			repeat.pressStartMs = -1;
			repeat.lastRepeatAtMs = -1;
		} else {
			if (!repeat.active) {
				repeat.active = true;
				repeat.repeatCount = 0;
				repeat.pressStartMs = pressedAtMs;
				repeat.lastRepeatAtMs = pressedAtMs;
			}
			if (repeat.pressStartMs < 0) {
				repeat.pressStartMs = pressedAtMs;
			}
			const nextAt = repeat.repeatCount === 0
				? repeat.pressStartMs + initialDelayMs
				: repeat.lastRepeatAtMs + repeatIntervalMs;
			if (now >= nextAt) {
				repeat.repeatCount += 1;
				repeat.lastRepeatAtMs = nextAt;
				result = true;
			}
		}

		repeat.lastFrameEvaluated = frameId;
		repeat.lastResult = result;
	}

	private repeatState(
		records: Map<ButtonId, RawActionRepeatRecord>,
		button: ButtonId,
	): RawActionRepeatRecord {
		let record = records.get(button);
		if (!record) {
			record = {
				active: false,
				repeatCount: 0,
				pressStartMs: -1,
				lastFrameEvaluated: -1,
				lastResult: false,
				lastRepeatAtMs: -1,
			};
			records.set(button, record);
		}
		return record;
	}

	public constructor(public playerIndex: number, frameDurationMs: number) {
		this.frameDurationMs = frameDurationMs;
		this.reset();
	}

	public setFrameDurationMs(frameDurationMs: number): void {
		this.frameDurationMs = frameDurationMs;
	}

	public reset(): void {
		for (let i = 0; i < INPUT_SOURCES.length; i += 1) {
			this.inputHandlers[INPUT_SOURCES[i]]?.reset();
		}
		for (let i = 0; i < INPUT_SOURCES.length; i += 1) {
			this.rawActionRepeatRecords[INPUT_SOURCES[i]].clear();
		}
		this.resetControlButtonRepeats();
		this.lastPollTimestampMs = 0;
		this.frameCounter = 0;
	}
}
