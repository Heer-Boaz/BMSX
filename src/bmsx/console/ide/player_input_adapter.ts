import { $ } from '../../core/game';
import type { PlayerInput } from '../../input/playerinput';
import type { ButtonState } from '../../input/inputtypes';
import { ide_state } from './ide_state';

function requirePlayerInput(targetIndex: number = ide_state.playerIndex): PlayerInput {
	const playerInput = $.input.getPlayerInput(targetIndex);
	if (!playerInput) {
		throw new Error(`[IDE Input] Player input handler unavailable for index ${targetIndex}.`);
	}
	return playerInput;
}

export function getIdeKeyState(code: string, playerIndex: number = ide_state.playerIndex): ButtonState | null {
	const playerInput = $.input.getPlayerInput(playerIndex);
	if (!playerInput) {
		return null;
	}
	return playerInput.getButtonState(code, 'keyboard');
}

export function consumeIdeKey(code: string, playerIndex: number = ide_state.playerIndex): void {
	const playerInput = $.input.getPlayerInput(playerIndex);
	if (!playerInput) {
		return;
	}
	playerInput.consumeButton(code, 'keyboard');
}

export function getIdeModifierState(playerIndex: number = ide_state.playerIndex): { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean } {
	return requirePlayerInput(playerIndex).getModifiersState();
}

export function getIdePlayerInput(playerIndex: number = ide_state.playerIndex): PlayerInput {
	return requirePlayerInput(playerIndex);
}
