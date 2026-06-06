import { machineManager } from '../../../core/machine_manager';
import { Input } from '../../../input/manager';

export function isKeyJustPressed(code: string): boolean {
	const keyboard = machineManager.input.getPlayerInput(1).inputHandlers.keyboard;
	const state = keyboard.getButtonState(code);
	return state.justpressed;
}

export function shouldRepeatKeyFromPlayer(code: string): boolean {
	const player = machineManager.input.getPlayerInput(1);
	const state = player.getButtonRepeatState(code, 'keyboard');
	return state.justpressed || state.repeatpressed;
}

export function consumeIdeKey(code: string): void {
	const player = Input.instance.getPlayerInput(1);
	player.consumeRawButton(code, 'keyboard');
}

export function isCtrlDown(): boolean {
	const mods = machineManager.input.getPlayerInput(1).getModifiersState();
	return mods.ctrl;
}

export function isShiftDown(): boolean {
	const mods = machineManager.input.getPlayerInput(1).getModifiersState();
	return mods.shift;
}

export function isAltDown(): boolean {
	const mods = machineManager.input.getPlayerInput(1).getModifiersState();
	return mods.alt;
}

export function isMetaDown(): boolean {
	const mods = machineManager.input.getPlayerInput(1).getModifiersState();
	return mods.meta;
}
