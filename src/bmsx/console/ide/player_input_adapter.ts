import { $ } from '../../core/game';
import type { ButtonState } from '../../input/inputtypes';
import { ide_state } from './ide_state';

export function getIdeKeyState(code: string): ButtonState | null {
	return $.input.getPlayerInput(ide_state.playerIndex).getButtonState(code, 'keyboard');
}

export function consumeIdeKey(code: string): void {
	$.input.getPlayerInput(ide_state.playerIndex).consumeButton(code, 'keyboard', { sticky: false });
}
