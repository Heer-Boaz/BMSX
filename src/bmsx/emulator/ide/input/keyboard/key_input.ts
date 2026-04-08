import { $ } from '../../../../core/engine_core';

export function isKeyJustPressed(code: string): boolean {
	const player = $.input.getPlayerInput(1);
	return player.getButtonState(code, 'keyboard').justpressed === true;
}

export function shouldRepeatKeyFromPlayer(code: string): boolean {
	const player = $.input.getPlayerInput(1);
	return player.getButtonRepeatState(code, 'keyboard').repeatpressed;
}

export function consumeIdeKey(code: string): void {
	$.consume_button(1, code, 'keyboard');
	$.input.getPlayerInput(1).stateManager.consumeBufferedEvent(code);
}

export function isCtrlDown(): boolean {
	const mods = $.input.getPlayerInput(1).getModifiersState();
	return mods.ctrl;
}

export function isShiftDown(): boolean {
	const mods = $.input.getPlayerInput(1).getModifiersState();
	return mods.shift;
}

export function isAltDown(): boolean {
	const mods = $.input.getPlayerInput(1).getModifiersState();
	return mods.alt;
}

export function isMetaDown(): boolean {
	const mods = $.input.getPlayerInput(1).getModifiersState();
	return mods.meta;
}
