import type { ActionState } from '../../../input/models';
import { decodeSignedFix16, encodeSignedFix16, FIX16_SCALE } from '../../common/numeric';

export const INP_STATUS_PRESSED = 1 << 0;
export const INP_STATUS_JUST_PRESSED = 1 << 1;
export const INP_STATUS_JUST_RELEASED = 1 << 2;
export const INP_STATUS_WAS_PRESSED = 1 << 3;
export const INP_STATUS_WAS_RELEASED = 1 << 4;
export const INP_STATUS_CONSUMED = 1 << 5;
export const INP_STATUS_ALL_JUST_PRESSED = 1 << 6;
export const INP_STATUS_ALL_JUST_RELEASED = 1 << 7;
export const INP_STATUS_ALL_WAS_PRESSED = 1 << 8;
export const INP_STATUS_GUARDED_JUST_PRESSED = 1 << 9;
export const INP_STATUS_REPEAT_PRESSED = 1 << 10;
export const INP_STATUS_HAS_VALUE = 1 << 11;

export const INPUT_CONTROLLER_PLAYER_COUNT = 4;
export const INPUT_CONTROLLER_EVENT_FIFO_CAPACITY = 32;
export const INP_EVENT_STATUS_EMPTY = 1 << 0;
export const INP_EVENT_STATUS_FULL = 1 << 1;
export const INP_EVENT_STATUS_OVERFLOW = 1 << 2;
export const INP_EVENT_CTRL_POP = 1;
export const INP_EVENT_CTRL_CLEAR = 2;
export const INP_EVENT_ACTION_STATUS_MASK = INP_STATUS_JUST_PRESSED
	| INP_STATUS_JUST_RELEASED
	| INP_STATUS_ALL_JUST_PRESSED
	| INP_STATUS_ALL_JUST_RELEASED
	| INP_STATUS_GUARDED_JUST_PRESSED
	| INP_STATUS_REPEAT_PRESSED;

export const INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE = FIX16_SCALE;
export const INP_OUTPUT_STATUS_SUPPORTED = 1 << 0;
export const INP_OUTPUT_CTRL_APPLY = 1;

export function decodeInputOutputIntensityQ16(value: number): number {
	return (value >>> 0) / INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE;
}

export function packInputActionStatus(state: ActionState): number {
	let word = 0;
	if (state.pressed) word |= INP_STATUS_PRESSED;
	if (state.justpressed) word |= INP_STATUS_JUST_PRESSED;
	if (state.justreleased) word |= INP_STATUS_JUST_RELEASED;
	if (state.waspressed) word |= INP_STATUS_WAS_PRESSED;
	if (state.wasreleased) word |= INP_STATUS_WAS_RELEASED;
	if (state.consumed) word |= INP_STATUS_CONSUMED;
	if (state.alljustpressed) word |= INP_STATUS_ALL_JUST_PRESSED;
	if (state.alljustreleased) word |= INP_STATUS_ALL_JUST_RELEASED;
	if (state.allwaspressed) word |= INP_STATUS_ALL_WAS_PRESSED;
	if (state.guardedjustpressed) word |= INP_STATUS_GUARDED_JUST_PRESSED;
	if (state.repeatpressed) word |= INP_STATUS_REPEAT_PRESSED;
	word |= INP_STATUS_HAS_VALUE;
	return word >>> 0;
}

export function encodeInputActionValueQ16(state: ActionState): number {
	return state.value == null ? 0 : encodeSignedFix16(state.value);
}

export function createInputActionSnapshot(
	action: string,
	statusWord: number,
	valueQ16: number,
	pressTime: number,
	repeatCount: number,
): ActionState {
	return {
		action,
		pressed: (statusWord & INP_STATUS_PRESSED) !== 0,
		justpressed: (statusWord & INP_STATUS_JUST_PRESSED) !== 0,
		justreleased: (statusWord & INP_STATUS_JUST_RELEASED) !== 0,
		waspressed: (statusWord & INP_STATUS_WAS_PRESSED) !== 0,
		wasreleased: (statusWord & INP_STATUS_WAS_RELEASED) !== 0,
		consumed: (statusWord & INP_STATUS_CONSUMED) !== 0,
		alljustpressed: (statusWord & INP_STATUS_ALL_JUST_PRESSED) !== 0,
		alljustreleased: (statusWord & INP_STATUS_ALL_JUST_RELEASED) !== 0,
		allwaspressed: (statusWord & INP_STATUS_ALL_WAS_PRESSED) !== 0,
		guardedjustpressed: (statusWord & INP_STATUS_GUARDED_JUST_PRESSED) !== 0,
		repeatpressed: (statusWord & INP_STATUS_REPEAT_PRESSED) !== 0,
		repeatcount: repeatCount,
		presstime: pressTime,
		timestamp: 0,
		pressedAtMs: null,
		releasedAtMs: null,
		pressId: null,
		value: (statusWord & INP_STATUS_HAS_VALUE) !== 0 ? decodeSignedFix16(valueQ16) : null,
		value2d: null,
	};
}
