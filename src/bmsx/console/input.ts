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

export class BmsxConsoleInput {
	private static readonly INITIAL_REPEAT_DELAY_FRAMES = 15;
	private static readonly REPEAT_INTERVAL_FRAMES = 4;

	private readonly playerIndex: number;
	private currentFrame: number = 0;
	private readonly repeatState: Array<{
		repeatCooldown: number;
		lastFrameEvaluated: number;
		lastResult: boolean;
	}> = [];

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
			repeat.repeatCooldown = BmsxConsoleInput.INITIAL_REPEAT_DELAY_FRAMES;
			result = true;
		} else if (!state.pressed) {
			repeat.repeatCooldown = 0;
		} else {
			if (repeat.repeatCooldown > 0) {
				repeat.repeatCooldown -= 1;
			}
			if (repeat.repeatCooldown <= 0) {
				result = true;
				repeat.repeatCooldown = BmsxConsoleInput.REPEAT_INTERVAL_FRAMES;
			}
		}
		repeat.lastFrameEvaluated = this.currentFrame;
		repeat.lastResult = result;
		return result;
	}

	private ensureRepeatState(button: BmsxConsoleButton) {
		const idx = button as number;
		let entry = this.repeatState[idx];
		if (!entry) {
			entry = { repeatCooldown: 0, lastFrameEvaluated: -1, lastResult: false };
			this.repeatState[idx] = entry;
		}
		return entry;
	}

	private getState(button: BmsxConsoleButton): ActionState {
		if (button < 0 || button >= BmsxConsoleButtonCount) {
			throw new Error(`[BmsxConsoleInput] Button index ${button} outside supported range 0-${BmsxConsoleButtonCount - 1}.`);
		}
		const actionName = BUTTON_ACTIONS[button];
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		const state = playerInput.getActionState(actionName);
		if (!state.pressed) {
			const repeat = this.ensureRepeatState(button);
			repeat.repeatCooldown = 0;
			repeat.lastResult = false;
			repeat.lastFrameEvaluated = this.currentFrame;
		}
		return state;
	}
}
