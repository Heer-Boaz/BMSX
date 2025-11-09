import type { KeyboardInput } from '../../input/keyboardinput';
import type { ButtonState } from '../../input/inputtypes';
import type { KeyPressRecord } from './types';
import { consumeIdeKey, getIdeKeyState } from './player_input_adapter';

const keyPressRecords = new Map<string, KeyPressRecord>();

export function resetKeyPressRecords(): void {
	keyPressRecords.clear();
}

export function clearKeyPressRecord(code: string): void {
	keyPressRecords.delete(code);
}

export function getKeyboardButtonState(playerIndex: number, code: string): ButtonState | null {
	return getIdeKeyState(code, playerIndex);
}

export function shouldAcceptKeyPress(code: string, state: ButtonState): boolean {
	if (state.consumed === true) {
		keyPressRecords.delete(code);
		return false;
	}
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

export function consumeKey(_keyboard: KeyboardInput | null, code: string, playerIndex?: number): void {
	const index = typeof playerIndex === 'number' ? playerIndex : undefined;
	consumeIdeKey(code, index);
}
