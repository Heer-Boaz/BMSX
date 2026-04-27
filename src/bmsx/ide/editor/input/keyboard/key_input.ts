import { engineCore } from '../../../../core/engine';
import { Input } from '../../../../input/manager';

export function isKeyJustPressed(code: string): boolean {
	const keyboard = engineCore.input.getPlayerInput(1).inputHandlers.keyboard;
	return keyboard?.getButtonState(code).justpressed === true;
}

export function shouldRepeatKeyFromPlayer(code: string): boolean {
	const player = engineCore.input.getPlayerInput(1);
	const state = player.getButtonRepeatState(code, 'keyboard');
	return state.justpressed === true || state.repeatpressed === true;
}

export function consumeIdeKey(code: string): void {
	Input.instance.getPlayerInput(1).consumeRawButton(code, 'keyboard');
}

export function isCtrlDown(): boolean {
	const mods = engineCore.input.getPlayerInput(1).getModifiersState();
	return mods.ctrl;
}

export function isShiftDown(): boolean {
	const mods = engineCore.input.getPlayerInput(1).getModifiersState();
	return mods.shift;
}

export function isAltDown(): boolean {
	const mods = engineCore.input.getPlayerInput(1).getModifiersState();
	return mods.alt;
}

export function isMetaDown(): boolean {
	const mods = engineCore.input.getPlayerInput(1).getModifiersState();
	return mods.meta;
}
