import { ButtonRepeat } from './button_repeat';
import { makeButtonState } from './manager';
import {
	INPUT_HANDLER_SOURCES,
	type ButtonId,
	type ButtonState,
	type InputHandlerSource,
} from './models';
import type { GamepadInput } from './gamepad';
import type { KeyboardInput } from './keyboard';
import type { PointerInput } from './pointer';

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
	public frameDurationMs = 1000 / 60;

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

	private readonly rawActionRepeatRecords: { [source in InputHandlerSource]: Map<ButtonId, ButtonRepeat> } = {
		keyboard: new Map(),
		gamepad: new Map(),
		pointer: new Map(),
	};
	private readonly controlRepeatRecords: { [source in ControlInputSource]: Map<ButtonId, ButtonRepeat> } = {
		keyboard: new Map(),
		gamepad: new Map(),
	};
	private readonly unboundButtonState = makeButtonState();
	public pollTimestampMs = 0;
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
	public getRawButtonState(button: ButtonId, source: InputHandlerSource): ButtonState {
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
	public buttonRepeatEdge(button: ButtonId, source: InputHandlerSource): boolean {
		const rawState = this.getRawButtonState(button, source);
		if (rawState.consumed) {
			return false;
		}
		const repeat = this.repeatState(this.rawActionRepeatRecords[source], button);
		return repeat.update(
			rawState.pressed,
			rawState.justpressed,
			rawState.pressedAtMs,
			this.pollTimestampMs,
			this.frameDurationMs,
			this.frameCounter,
		);
	}

	/** Returns repeat/edge info for a normalized console control. */
	public controlButtonRepeatEdge(button: ButtonId, source: ControlInputSource): boolean {
		const handler = this.inputHandlers[source];
		const state = handler ? handler.getButtonState(button) : this.unboundButtonState;
		if (state.consumed) {
			return false;
		}
		const repeat = this.repeatState(this.controlRepeatRecords[source], button);
		return repeat.update(
			state.pressed,
			state.justpressed,
			state.pressedAtMs,
			this.pollTimestampMs,
			this.frameDurationMs,
			this.frameCounter,
		);
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
		this.pollTimestampMs = currentTime;
		for (let i = 0; i < INPUT_HANDLER_SOURCES.length; i += 1) {
			const source = INPUT_HANDLER_SOURCES[i];
			this.inputHandlers[source]?.pollInput();
		}
	}

	private repeatState(
		records: Map<ButtonId, ButtonRepeat>,
		button: ButtonId,
	): ButtonRepeat {
		let record = records.get(button);
		if (!record) {
			record = new ButtonRepeat();
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
		for (let i = 0; i < INPUT_HANDLER_SOURCES.length; i += 1) {
			const source = INPUT_HANDLER_SOURCES[i];
			this.inputHandlers[source]?.reset();
			this.rawActionRepeatRecords[source].clear();
		}
		this.resetControlButtonRepeats();
		this.pollTimestampMs = 0;
		this.frameCounter = 0;
	}
}
