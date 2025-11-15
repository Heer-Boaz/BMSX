import { $ } from '../../core/game';
import type { PlayerInput } from '../../input/playerinput';
import type { ButtonState } from '../../input/inputtypes';
import { ide_state } from './ide_state';

export function getIdeKeyState(code: string, playerIndex: number = ide_state.playerIndex): ButtonState | null {
	return $.input.getPlayerInput(playerIndex).getButtonState(code, 'keyboard');
}

export function consumeIdeKey(code: string, playerIndex: number = ide_state.playerIndex): void {
	$.input.getPlayerInput(playerIndex).consumeButton(code, 'keyboard');
}

export function getIdeModifierState(playerIndex: number = ide_state.playerIndex): { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean } {
	return $.input.getPlayerInput(playerIndex).getModifiersState();
}

export function getIdePlayerInput(playerIndex: number = ide_state.playerIndex): PlayerInput {
	return $.input.getPlayerInput(playerIndex);
}
