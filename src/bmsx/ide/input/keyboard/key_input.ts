import { consoleCore } from '../../../core/console';
import { Input } from '../../../input/manager';

export function isKeyJustPressed(code: string): boolean {
	const keyboard = consoleCore.input.getPlayerInput(1).inputHandlers.keyboard;
	const state = keyboard.getButtonState(code);
	return state.justpressed;
}

export function shouldRepeatKeyFromPlayer(code: string): boolean {
	const player = consoleCore.input.getPlayerInput(1);
	const state = player.getButtonRepeatState(code, 'keyboard');
	return state.justpressed || state.repeatpressed;
}

export function consumeIdeKey(code: string): void {
	const player = Input.instance.getPlayerInput(1);
	player.consumeRawButton(code, 'keyboard');
}

export function isCtrlDown(): boolean {
	const mods = consoleCore.input.getPlayerInput(1).getModifiersState();
	return mods.ctrl;
}

export function isShiftDown(): boolean {
	const mods = consoleCore.input.getPlayerInput(1).getModifiersState();
	return mods.shift;
}

export function isAltDown(): boolean {
	const mods = consoleCore.input.getPlayerInput(1).getModifiersState();
	return mods.alt;
}

export function isMetaDown(): boolean {
	const mods = consoleCore.input.getPlayerInput(1).getModifiersState();
	return mods.meta;
}
