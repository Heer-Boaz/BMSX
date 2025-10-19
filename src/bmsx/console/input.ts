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
	hasDispatchedThisCycle: boolean;
	pressStartFrame: number;
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
			repeat.hasDispatchedThisCycle = true;
			repeat.pressStartFrame = this.currentFrame;
			result = true;
		} else if (!state.pressed && state.justreleased && !repeat.hasDispatchedThisCycle) {
			repeat.active = false;
			repeat.repeatCount = 0;
			repeat.hasDispatchedThisCycle = true;
			repeat.pressStartFrame = -1;
			result = true;
		} else if (!state.pressed) {
			repeat.active = false;
			repeat.repeatCount = 0;
			repeat.hasDispatchedThisCycle = false;
			repeat.pressStartFrame = -1;
		} else {
			if (!repeat.active) {
				repeat.active = true;
				repeat.repeatCount = 0;
				repeat.pressStartFrame = this.currentFrame;
			}
			if (repeat.pressStartFrame < 0) {
				throw new Error(`[BmsxConsoleInput] Press start frame not set for button ${button}.`);
			}
			const heldFrames = this.currentFrame - repeat.pressStartFrame;
			if (heldFrames < 0) {
				throw new Error(`[BmsxConsoleInput] Negative held frame count detected for button ${button}.`);
			}
			const repeatsElapsed = this.computeRepeatCount(heldFrames);
			if (repeatsElapsed > repeat.repeatCount) {
				repeat.repeatCount = repeatsElapsed;
				repeat.hasDispatchedThisCycle = true;
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
			entry = {
				active: false,
				repeatCount: 0,
				lastFrameEvaluated: -1,
				lastResult: false,
				hasDispatchedThisCycle: false,
				pressStartFrame: -1,
			};
			this.repeatState[idx] = entry;
		}
		return entry;
	}

	private computeRepeatCount(heldFrames: number): number {
		if (heldFrames < 0) {
			throw new Error('[BmsxConsoleInput] Held frame count cannot be negative.');
		}
		if (heldFrames < BmsxConsoleInput.INITIAL_REPEAT_DELAY_FRAMES) {
			return 0;
		}
		const elapsedSinceDelay = heldFrames - BmsxConsoleInput.INITIAL_REPEAT_DELAY_FRAMES;
		return Math.floor(elapsedSinceDelay / BmsxConsoleInput.REPEAT_INTERVAL_FRAMES) + 1;
	}

	private getState(button: BmsxConsoleButton): ActionState {
		if (button < 0 || button >= BmsxConsoleButtonCount) {
			throw new Error(`[BmsxConsoleInput] Button index ${button} outside supported range 0-${BmsxConsoleButtonCount - 1}.`);
		}
		const actionName = BUTTON_ACTIONS[button];
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		return playerInput.getActionState(actionName);
	}
}
