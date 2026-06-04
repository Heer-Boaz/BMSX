import { decodeSignedFix16, encodeSignedFix16, FIX16_SCALE } from '../../common/numeric';

export const INPUT_SOURCES = ['keyboard', 'gamepad', 'pointer'] as const;
export type InputSource = typeof INPUT_SOURCES[number];

export type ButtonId = string;

export const INPUT_CONTROLLER_GAMEPAD_BUTTON_IDS = [
	'a',
	'b',
	'x',
	'y',
	'lb',
	'rb',
	'lt',
	'rt',
	'select',
	'start',
	'ls',
	'rs',
	'up',
	'down',
	'left',
	'right',
	'home',
	'touch',
] as const;
export type BGamepadButton = (typeof INPUT_CONTROLLER_GAMEPAD_BUTTON_IDS)[number];

export type KeyboardBinding = string | { id: string; scale?: number; invert?: boolean };
export type KeyboardInputMapping = {
	[action: string]: KeyboardBinding[];
};

export type GamepadBinding = BGamepadButton | { id: BGamepadButton; scale?: number; invert?: boolean };
export type GamepadInputMapping = {
	[action: string]: GamepadBinding[];
};

export type PointerBinding = string | { id: string; scale?: number; invert?: boolean };
export type PointerInputMapping = {
	[action: string]: PointerBinding[];
};

export type InputControllerDefaultMapping = {
	keyboard: KeyboardInputMapping;
	gamepad: GamepadInputMapping;
	pointer: PointerInputMapping;
};

export interface InputMap {
	keyboard: KeyboardInputMapping;
	gamepad: GamepadInputMapping;
	pointer: PointerInputMapping;
}

export interface InputControllerPlayerInputSource {
	sampleInputControllerButton(source: InputSource, button: ButtonId): ButtonState;
	consumeInputControllerButton(source: InputSource, button: ButtonId): void;
}

export interface InputControllerInputSource {
	inputControllerPlayer(playerIndex: number): InputControllerPlayerInputSource;
}

export function inputBindingId(binding: ButtonId | { id: ButtonId }): ButtonId {
	return typeof binding === 'string' ? binding : binding.id;
}

export type ButtonState = {
	pressed: boolean;
	justpressed: boolean;
	justreleased: boolean;
	waspressed: boolean;
	wasreleased: boolean;
	repeatpressed: boolean;
	repeatcount: number;
	consumed: boolean;
	presstime: number;
	timestamp: number;
	pressedAtMs?: number;
	releasedAtMs?: number;
	pressId?: number;
	value?: number;
	value2d?: [number, number] | null;
};

export type ActionState = {
	action: string;
	alljustpressed: boolean;
	allwaspressed: boolean;
	alljustreleased: boolean;
	guardedjustpressed: boolean;
	repeatpressed: boolean;
	repeatcount: number;
} & ButtonState;

export const INPUT_CONTROLLER_DEFAULT_POINTER_MAPPING: PointerInputMapping = Object.freeze({
	pointer_primary: ['pointer_primary'],
	pointer_secondary: ['pointer_secondary'],
	pointer_aux: ['pointer_aux'],
	pointer_back: ['pointer_back'],
	pointer_forward: ['pointer_forward'],
	pointer_delta: ['pointer_delta'],
	pointer_position: ['pointer_position'],
	pointer_wheel: ['pointer_wheel'],
});

export const INPUT_CONTROLLER_DEFAULT_KEYBOARD_MAPPING: KeyboardInputMapping = Object.freeze({
	a: ['KeyX'],
	b: ['KeyC'],
	x: ['KeyZ'],
	y: ['KeyS'],
	lb: ['ShiftLeft'],
	rb: ['ShiftRight'],
	lt: ['CtrlLeft'],
	rt: ['CtrlRight'],
	select: ['Backspace'],
	start: ['Enter'],
	ls: ['KeyQ'],
	rs: ['KeyE'],
	up: ['ArrowUp'],
	down: ['ArrowDown'],
	left: ['ArrowLeft'],
	right: ['ArrowRight'],
	home: ['Escape'],
	touch: ['Space'],
});

export const INPUT_CONTROLLER_DEFAULT_GAMEPAD_MAPPING: GamepadInputMapping = Object.freeze({
	a: ['a'],
	b: ['b'],
	x: ['x'],
	y: ['y'],
	lb: ['lb'],
	rb: ['rb'],
	lt: ['lt'],
	rt: ['rt'],
	select: ['select'],
	start: ['start'],
	ls: ['ls'],
	rs: ['rs'],
	up: ['up'],
	down: ['down'],
	left: ['left'],
	right: ['right'],
	home: ['home'],
	touch: ['touch'],
});

export const INPUT_CONTROLLER_DEFAULT_MAPPING: InputControllerDefaultMapping = Object.freeze({
	keyboard: INPUT_CONTROLLER_DEFAULT_KEYBOARD_MAPPING,
	gamepad: INPUT_CONTROLLER_DEFAULT_GAMEPAD_MAPPING,
	pointer: INPUT_CONTROLLER_DEFAULT_POINTER_MAPPING,
});

export function createInputControllerActionState(action: string): ActionState {
	return {
		action,
		pressed: false,
		justpressed: false,
		justreleased: false,
		waspressed: false,
		wasreleased: false,
		consumed: false,
		presstime: null,
		timestamp: null,
		pressedAtMs: null,
		releasedAtMs: null,
		pressId: null,
		value: null,
		value2d: null,
		alljustpressed: false,
		allwaspressed: false,
		alljustreleased: false,
		guardedjustpressed: false,
		repeatpressed: false,
		repeatcount: 0,
	};
}

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
export const INPUT_CONTROLLER_PLAYER_SELECT_MASK = INPUT_CONTROLLER_PLAYER_COUNT - 1;
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

export function decodeInputControllerPlayerSelect(playerWord: number): number {
	return ((((playerWord >>> 0) - 1) >>> 0) & INPUT_CONTROLLER_PLAYER_SELECT_MASK) + 1;
}

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

export function encodeInputActionValueXQ16(state: ActionState): number {
	return state.value2d == null ? 0 : encodeSignedFix16(state.value2d[0]);
}

export function encodeInputActionValueYQ16(state: ActionState): number {
	return state.value2d == null ? 0 : encodeSignedFix16(state.value2d[1]);
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
