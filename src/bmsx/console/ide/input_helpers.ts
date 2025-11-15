import type { ButtonState } from '../../input/inputtypes';
import type { KeyPressRecord } from './types';
import { getIdeKeyState } from './player_input_adapter';

const keyPressRecords = new Map<string, KeyPressRecord>();

export function resetKeyPressRecords(): void {
	keyPressRecords.clear();
}

export function clearKeyPressRecord(code: string): void {
	keyPressRecords.delete(code);
}

function recordKeyState(code: string, state: ButtonState, latched: boolean): void {
	const pressId = state.pressId ?? null;
	keyPressRecords.set(code, { lastPressId: pressId, downLatched: latched });
}

export function shouldAcceptKeyPress(code: string, state: ButtonState): boolean {
	if (state.pressed !== true) {
		keyPressRecords.delete(code);
		return false;
	}
	if (state.consumed === true) {
		recordKeyState(code, state, true);
		return false;
	}
	const existing = keyPressRecords.get(code);
	if (existing?.downLatched) {
		return false;
	}
	if (state.justpressed === true) {
		recordKeyState(code, state, true);
		return true;
	}
	if (!existing) {
		recordKeyState(code, state, true);
		return true;
	}
	return false;
}

export function isKeyJustPressed(code: string): boolean {
	const state = getIdeKeyState(code);
	return state ? shouldAcceptKeyPress(code, state) : false;
}

export function isModifierPressed(code: string): boolean {
	const state = getIdeKeyState(code);
	return state ? state.pressed === true : false;
}

export function isKeyPressed(code: string): boolean {
	const state = getIdeKeyState(code);
	return state ? state.pressed === true : false;
}

export function isKeyTyped(code: string): boolean {
	const state = getIdeKeyState(code);
	return state ? shouldAcceptKeyPress(code, state) : false;
}
