import { KeyModifier, type PlayerInput } from '../../../hosts/common/input/player';

export function isKeyJustPressed(code: string, playerInput: PlayerInput): boolean {
	const keyboard = playerInput.inputHandlers.keyboard;
	const state = keyboard.getKeyState(code);
	return state.justpressed && !state.consumed;
}

export function shouldRepeatKeyFromPlayer(code: string, playerInput: PlayerInput): boolean {
	return playerInput.buttonRepeatEdge(code, 'keyboard');
}

export function consumeIdeKey(code: string, playerInput: PlayerInput): void {
	playerInput.inputHandlers.keyboard?.consumeKey(code);
}

export function isCtrlDown(playerInput: PlayerInput): boolean {
	return (playerInput.getModifiers() & KeyModifier.ctrl) !== 0;
}

export function isShiftDown(playerInput: PlayerInput): boolean {
	return (playerInput.getModifiers() & KeyModifier.shift) !== 0;
}

export function isAltDown(playerInput: PlayerInput): boolean {
	return (playerInput.getModifiers() & KeyModifier.alt) !== 0;
}

export function isMetaDown(playerInput: PlayerInput): boolean {
	return (playerInput.getModifiers() & KeyModifier.meta) !== 0;
}
