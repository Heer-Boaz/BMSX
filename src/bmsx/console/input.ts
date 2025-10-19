import { $ } from '../core/game';
import type { ActionState } from '../input/inputtypes';
import type { BmsxConsoleButton } from './types';
import { BmsxConsoleButtonCount } from './types';

const BUTTON_ACTIONS: string[] = [
	'console_left',
	'console_right',
	'console_up',
	'console_down',
	'console_o',
	'console_x',
];

type RepeatStateEntry = {
	active: boolean;
	repeatCount: number;
	lastFrameEvaluated: number;
	lastResult: boolean;
};

export class BmsxConsoleInput {
	private static readonly INITIAL_REPEAT_DELAY_FRAMES = 15;
	private static readonly REPEAT_INTERVAL_FRAMES = 4;

	private readonly playerIndex: number;
	private currentFrame: number = 0;
	private readonly repeatState: RepeatStateEntry[] = [];

	constructor(playerIndex: number) {
		this.playerIndex = playerIndex;
	}

	public beginFrame(frame: number): void {
		this.currentFrame = frame;
	}

	public btn(button: BmsxConsoleButton): boolean {
		const state = this.getState(button);
		return state.pressed;
	}

	public btnp(button: BmsxConsoleButton): boolean {
		const state = this.getState(button);
		const repeat = this.ensureRepeatState(button);
		if (repeat.lastFrameEvaluated === this.currentFrame) {
			return repeat.lastResult;
		}
		let result = false;
		if (state.justpressed) {
			repeat.active = true;
			repeat.repeatCount = 0;
			result = true;
		} else if (!state.pressed) {
			this.resetRepeatState(button, repeat);
		} else {
			if (!repeat.active) {
				repeat.active = true;
				repeat.repeatCount = 0;
			}
			const presstime = state.presstime;
			if (presstime == null) {
				throw new Error(`[BmsxConsoleInput] Action state for button ${button} missing presstime while pressed.`);
			}
			const repeatsElapsed = this.computeRepeatCount(presstime);
			if (repeatsElapsed > repeat.repeatCount) {
				repeat.repeatCount = repeatsElapsed;
				result = true;
			}
		}
		repeat.lastFrameEvaluated = this.currentFrame;
		repeat.lastResult = result;
		return result;
	}

	private ensureRepeatState(button: BmsxConsoleButton): RepeatStateEntry {
		const idx = button as number;
		let entry = this.repeatState[idx];
		if (!entry) {
			entry = { active: false, repeatCount: 0, lastFrameEvaluated: -1, lastResult: false };
			this.repeatState[idx] = entry;
		}
		return entry;
	}

	private resetRepeatState(button: BmsxConsoleButton, entry?: RepeatStateEntry): void {
		const repeat = entry ?? this.ensureRepeatState(button);
		repeat.active = false;
		repeat.repeatCount = 0;
		repeat.lastResult = false;
		repeat.lastFrameEvaluated = this.currentFrame;
	}

	private computeRepeatCount(presstimeMs: number): number {
		const fps = $.targetFPS;
		if (!Number.isFinite(fps) || fps <= 0) {
			throw new Error(`[BmsxConsoleInput] Invalid target FPS ${fps}.`);
		}
		const frameDurationMs = 1000 / fps;
		const repeatDelayMs = BmsxConsoleInput.INITIAL_REPEAT_DELAY_FRAMES * frameDurationMs;
		if (presstimeMs < repeatDelayMs) {
			return 0;
		}
		const repeatIntervalMs = BmsxConsoleInput.REPEAT_INTERVAL_FRAMES * frameDurationMs;
		if (repeatIntervalMs <= 0) {
			throw new Error('[BmsxConsoleInput] Repeat interval must be greater than zero.');
		}
		const elapsedSinceDelay = presstimeMs - repeatDelayMs;
		return Math.floor(elapsedSinceDelay / repeatIntervalMs) + 1;
	}

	private getState(button: BmsxConsoleButton): ActionState {
		if (button < 0 || button >= BmsxConsoleButtonCount) {
			throw new Error(`[BmsxConsoleInput] Button index ${button} outside supported range 0-${BmsxConsoleButtonCount - 1}.`);
		}
		const actionName = BUTTON_ACTIONS[button];
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		const state = playerInput.getActionState(actionName);
		if (!state.pressed) {
			this.resetRepeatState(button);
		}
		return state;
	}
}
