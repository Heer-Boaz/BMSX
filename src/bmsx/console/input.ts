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
	private readonly playerIndex: number;

	constructor(playerIndex: number) {
		this.playerIndex = playerIndex;
	}

	public btn(button: BmsxConsoleButton): boolean {
		const state = this.getState(button);
		return state.pressed;
	}

	public btnp(button: BmsxConsoleButton): boolean {
		const state = this.getState(button);
		return state.justpressed;
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
