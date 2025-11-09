import { $ } from '../../core/game';
import type { KeyboardInput } from '../../input/keyboardinput';
import type { ButtonState } from '../../input/inputtypes';
import type { KeyPressRecord } from './types';

const keyPressRecords = new Map<string, KeyPressRecord>();

export function resetKeyPressRecords(): void {
	keyPressRecords.clear();
}

export function clearKeyPressRecord(code: string): void {
	keyPressRecords.delete(code);
}

export function getKeyboardButtonState(playerIndex: number, code: string): ButtonState | null {
	const playerInput = $.input.getPlayerInput(playerIndex);
	if (!playerInput) {
		return null;
	}
	return playerInput.getButtonState(code, 'keyboard');
}

export function shouldAcceptKeyPress(code: string, state: ButtonState): boolean {
	if (state.pressed !== true) {
		keyPressRecords.delete(code);
		return false;
	}
	const pressId = state.pressId ?? null;
	const existing = keyPressRecords.get(code);
	if (pressId !== null) {
		if (existing && existing.lastPressId === pressId) {
			return false;
		}
		keyPressRecords.set(code, { lastPressId: pressId });
		return true;
	}
	if (state.justpressed !== true) {
		return false;
	}
	if (existing && existing.lastPressId === null) {
		return false;
	}
	keyPressRecords.set(code, { lastPressId: null });
	return true;
}

export function isKeyJustPressed(playerIndex: number, code: string): boolean {
	const state = getKeyboardButtonState(playerIndex, code);
	return state ? shouldAcceptKeyPress(code, state) : false;
}

export function isModifierPressed(playerIndex: number, code: string): boolean {
	const state = getKeyboardButtonState(playerIndex, code);
	return state ? state.pressed === true : false;
}

export function isKeyPressed(playerIndex: number, code: string): boolean {
	const state = getKeyboardButtonState(playerIndex, code);
	return state ? state.pressed === true : false;
}

export function isKeyTyped(playerIndex: number, code: string): boolean {
	const state = getKeyboardButtonState(playerIndex, code);
	return state ? shouldAcceptKeyPress(code, state) : false;
}

export function consumeKey(keyboard: KeyboardInput, code: string): void {
	keyboard.consumeButton(code);
}
