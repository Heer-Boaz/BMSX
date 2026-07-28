import type { PlayerInput } from '../../../machine/ts/input/player';

export function isKeyJustPressed(code: string, playerInput: PlayerInput): boolean {
	const keyboard = playerInput.inputHandlers.keyboard;
	const state = keyboard.getButtonState(code);
	return state.justpressed;
}

export function shouldRepeatKeyFromPlayer(code: string, playerInput: PlayerInput): boolean {
	const state = playerInput.getButtonRepeatState(code, 'keyboard');
	return state.justpressed || state.repeatpressed;
}

export function consumeIdeKey(code: string, playerInput: PlayerInput): void {
	playerInput.consumeRawButton(code, 'keyboard');
}

export function isCtrlDown(playerInput: PlayerInput): boolean {
	const mods = playerInput.getModifiersState();
	return mods.ctrl;
}

export function isShiftDown(playerInput: PlayerInput): boolean {
	const mods = playerInput.getModifiersState();
	return mods.shift;
}

export function isAltDown(playerInput: PlayerInput): boolean {
	const mods = playerInput.getModifiersState();
	return mods.alt;
}

export function isMetaDown(playerInput: PlayerInput): boolean {
	const mods = playerInput.getModifiersState();
	return mods.meta;
}
