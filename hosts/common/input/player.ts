import { InputStateManager, makeActionState, makeButtonState } from './manager';
import { INPUT_SOURCES, type ButtonId, type ButtonState, type InputEvent, type InputHandler, type InputSource } from './models';
import type { VibrationParams } from '../platform';

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
 * from the device handlers; this class owns the host's buffered button state,
 * raw-button repeat cadence, and vibration output used by the IDE and overlays.
 */
export class PlayerInput {
	private frameDurationMs = 1000 / 60;

	/** Input handlers keyed by source (keyboard / gamepad / pointer), or null if unbound. */
	public inputHandlers: { [source in InputSource]: InputHandler } = {
		keyboard: null,
		gamepad: null,
		pointer: null,
	};

	/** Manages per-source buffered input events and simulation-frame state aggregation. */
	private readonly _stateManagers: { [source in InputSource]: InputStateManager } = {
		keyboard: new InputStateManager(),
		gamepad: new InputStateManager(),
		pointer: new InputStateManager(),
	};
	private readonly trackedButtons: { [source in InputSource]: Set<ButtonId> } = {
		keyboard: new Set(),
		gamepad: new Set(),
		pointer: new Set(),
	};

	private readonly rawActionRepeatRecords: Map<string, RawActionRepeatRecord> = new Map();
	private lastPollTimestampMs = 0;
	private frameCounter = 0;

	private getStateManager(source: InputSource): InputStateManager {
		return this._stateManagers[source];
	}

	public applyInputControllerVibrationEffect(durationMs: number, intensity: number): void {
		const params: VibrationParams = { effect: 'dual-rumble', duration: durationMs, intensity };
		for (const source of INPUT_SOURCES) {
			if (!this.inputHandlers[source]?.supportsVibrationEffect) continue;
			this.inputHandlers[source]!.applyVibrationEffect(params);
		}
	}

	public consumeRawButton(button: ButtonId, source: InputSource): void {
		this.consumeGameplayButton(button, source);
		this.inputHandlers[source]?.consumeButton(button);
	}

	private consumeGameplayButton(button: ButtonId, source: InputSource): void {
		const state = this.getButtonState(button, source);
		this.getStateManager(source).consumeBufferedEvent(button, state?.pressId);
	}

	public getModifiersState(): { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean } {
		const keyboard = this.inputHandlers['keyboard'];
		if (!keyboard) return { shift: false, ctrl: false, alt: false, meta: false };
		return {
			shift: keyboard.getButtonState('ShiftLeft')?.pressed || keyboard.getButtonState('ShiftRight')?.pressed,
			ctrl: keyboard.getButtonState('ControlLeft')?.pressed || keyboard.getButtonState('ControlRight')?.pressed,
			alt: keyboard.getButtonState('AltLeft')?.pressed || keyboard.getButtonState('AltRight')?.pressed,
			meta: keyboard.getButtonState('MetaLeft')?.pressed || keyboard.getButtonState('MetaRight')?.pressed,
		};
	}

	/** Simulation-frame button state from the per-source buffer (consume-aware). */
	public getButtonState(button: ButtonId, source: InputSource, framewindow: number = null): ButtonState {
		return this._stateManagers[source].getButtonState(button, framewindow);
	}

	/** Live button state straight from the device handler. */
	public getRawButtonState(button: ButtonId, source: InputSource): ButtonState {
		return this.inputHandlers[source]?.getButtonState(button) ?? makeButtonState();
	}

	public get pollFrame(): number {
		return this.frameCounter;
	}

	/** Returns repeat/edge info for a raw button using the built-in repeat cadence. */
	public getButtonRepeatState(button: ButtonId, source: InputSource): ButtonState {
		const state = this.getRawButtonState(button, source);
		const repeatKey = `${source}:${button}`;
		const actionState = makeActionState(repeatKey, state);
		const repeat = this.evaluateRawActionRepeat(repeatKey, actionState, this.frameCounter);
		actionState.repeatcount = repeat.count;
		actionState.repeatpressed = repeat.triggered;
		return actionState;
	}

	assignGamepadToPlayer(gamepadInput: InputHandler): void {
		if (this.inputHandlers['gamepad'] && this.inputHandlers['gamepad'] !== gamepadInput) {
			console.warn(`Replacing existing gamepad for player ${this.playerIndex} with gamepad ${gamepadInput.gamepadIndex}.`);
			this.inputHandlers['gamepad']?.reset();
		}
		this.inputHandlers['gamepad'] = gamepadInput;
		console.info(`Gamepad ${gamepadInput.gamepadIndex} assigned to player ${this.playerIndex}.`);
	}

	public clearGamepad(handler: InputHandler): void {
		if (this.inputHandlers['gamepad'] !== handler) return;
		this.inputHandlers['gamepad'] = null;
		handler.reset();
	}

	/** Polls the input for the player for each input source (keyboard, gamepad, ...). */
	pollInput(currentTime: number): void {
		this.frameCounter += 1;
		this.lastPollTimestampMs = currentTime;
		for (const source of INPUT_SOURCES) {
			this.inputHandlers[source]?.pollInput();
		}
	}

	public recordButtonEvent(source: InputSource, button: ButtonId, event: InputEvent): void {
		this.trackedButtons[source].add(button);
		this.getStateManager(source).addInputEvent(event);
	}

	public recordAxis1Input(source: InputSource, button: ButtonId, value: number, timestamp: number): void {
		this.trackedButtons[source].add(button);
		this.getStateManager(source).recordAxis1Sample(button, value, timestamp);
	}

	public recordAxis2Input(source: InputSource, button: ButtonId, x: number, y: number, timestamp: number): void {
		this.trackedButtons[source].add(button);
		this.getStateManager(source).recordAxis2Sample(button, x, y, timestamp);
	}

	public beginFrame(currentTime: number): void {
		for (const source of INPUT_SOURCES) {
			const stateManager = this.getStateManager(source);
			stateManager.beginFrame(currentTime);
			const handler = this.inputHandlers[source];
			for (const button of this.trackedButtons[source]) {
				stateManager.latchButtonState(button, handler?.getButtonState(button) ?? makeButtonState(), currentTime);
			}
		}
	}

	private evaluateRawActionRepeat(action: string, state: ButtonState, frameId: number): { triggered: boolean; count: number } {
		const repeat = this.ensureRawRepeatState(action);
		if (repeat.lastFrameEvaluated === frameId) {
			return { triggered: repeat.lastResult, count: repeat.repeatCount };
		}

		let result = false;
		const now = this.lastPollTimestampMs;
		const startMs = state.pressedAtMs ?? state.timestamp ?? now;
		const initialDelayMs = INITIAL_REPEAT_DELAY_FRAMES * this.frameDurationMs;
		const repeatIntervalMs = REPEAT_INTERVAL_FRAMES * this.frameDurationMs;

		if (state.justpressed) {
			repeat.active = true;
			repeat.repeatCount = 0;
			repeat.pressStartMs = startMs;
			repeat.lastRepeatAtMs = startMs;
		} else if (!state.pressed) {
			repeat.active = false;
			repeat.repeatCount = 0;
			repeat.pressStartMs = -1;
			repeat.lastRepeatAtMs = -1;
		} else {
			if (!repeat.active) {
				repeat.active = true;
				repeat.repeatCount = 0;
				repeat.pressStartMs = startMs;
				repeat.lastRepeatAtMs = startMs;
			}
			if (repeat.pressStartMs < 0) {
				repeat.pressStartMs = startMs;
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
		return { triggered: result, count: repeat.repeatCount };
	}

	private ensureRawRepeatState(action: string): RawActionRepeatRecord {
		let record = this.rawActionRepeatRecords.get(action);
		if (record === undefined) {
			record = { active: false, repeatCount: 0, pressStartMs: -1, lastFrameEvaluated: -1, lastResult: false, lastRepeatAtMs: -1 };
			this.rawActionRepeatRecords.set(action, record);
		}
		return record;
	}

	/** Updates aggregated button states and cleans up stale events. */
	update(currentTime: number): void {
		for (const source of INPUT_SOURCES) {
			this.getStateManager(source).update(currentTime);
		}
	}

	public constructor(public playerIndex: number, frameDurationMs: number) {
		this.frameDurationMs = frameDurationMs;
		this.reset();
	}

	public setFrameDurationMs(frameDurationMs: number): void {
		this.frameDurationMs = frameDurationMs;
	}

	/** Clears cached transition state so edge detectors don't fire spuriously. */
	public clearEdgeState(): void {
		for (const source of INPUT_SOURCES) {
			this.getStateManager(source).resetEdgeState();
		}
	}

	/**
	 * Resets the state of all input keys and gamepad buttons.
	 * @param except An optional array of keys or buttons to exclude from the reset.
	 */
	public reset(except?: string[]): void {
		this.clearEdgeState();
		for (const source of INPUT_SOURCES) {
			this.inputHandlers[source]?.reset(except);
		}
		this.rawActionRepeatRecords.clear();
		this.lastPollTimestampMs = 0;
		this.frameCounter = 0;
	}
}
