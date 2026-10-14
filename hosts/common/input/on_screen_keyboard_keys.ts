import { HID_MODIFIER_MASK_ALT, HID_MODIFIER_MASK_CONTROL, HID_MODIFIER_MASK_SHIFT } from './hid_keys';

export type OnScreenKeyDefinition = {
	readonly label: string;
	readonly shiftLabel?: string;
	readonly code: string;
	readonly modifier: number;
};

/** Page indices of NATIVE_KEYBOARD_PAGES; other presentations author their own pages. */
export const enum KeyboardPage { Text, Symbols, Functions }
export const enum OnScreenKeyboardCommand {
	None, Activate, Backspace, Delete, Space, Shift, Left, Right, Home, End, Enter, TogglePage,
}

export const NO_MODIFIER = -1;
export const MODIFIER_SHIFT = 0;
export const MODIFIER_CONTROL = 1;
export const MODIFIER_ALT = 2;
export const MODIFIER_CODES = ['ShiftLeft', 'ControlLeft', 'AltLeft'] as const;
export const MODIFIER_HID_MASKS = [HID_MODIFIER_MASK_SHIFT, HID_MODIFIER_MASK_CONTROL, HID_MODIFIER_MASK_ALT] as const;
export const MAIN_KEY_COUNT = 60;

export const ON_SCREEN_KEY_DEFINITIONS: readonly OnScreenKeyDefinition[] = [
	{ label: 'ESC', code: 'Escape', modifier: NO_MODIFIER },
	{ label: '1', shiftLabel: '!', code: 'Digit1', modifier: NO_MODIFIER },
	{ label: '2', shiftLabel: '@', code: 'Digit2', modifier: NO_MODIFIER },
	{ label: '3', shiftLabel: '#', code: 'Digit3', modifier: NO_MODIFIER },
	{ label: '4', shiftLabel: '$', code: 'Digit4', modifier: NO_MODIFIER },
	{ label: '5', shiftLabel: '%', code: 'Digit5', modifier: NO_MODIFIER },
	{ label: '6', shiftLabel: '^', code: 'Digit6', modifier: NO_MODIFIER },
	{ label: '7', shiftLabel: '&', code: 'Digit7', modifier: NO_MODIFIER },
	{ label: '8', shiftLabel: '*', code: 'Digit8', modifier: NO_MODIFIER },
	{ label: '9', shiftLabel: '(', code: 'Digit9', modifier: NO_MODIFIER },
	{ label: '0', shiftLabel: ')', code: 'Digit0', modifier: NO_MODIFIER },
	{ label: '-', shiftLabel: '_', code: 'Minus', modifier: NO_MODIFIER },
	{ label: '=', shiftLabel: '+', code: 'Equal', modifier: NO_MODIFIER },
	{ label: 'BKSP', code: 'Backspace', modifier: NO_MODIFIER },

	{ label: 'TAB', code: 'Tab', modifier: NO_MODIFIER },
	{ label: 'q', shiftLabel: 'Q', code: 'KeyQ', modifier: NO_MODIFIER },
	{ label: 'w', shiftLabel: 'W', code: 'KeyW', modifier: NO_MODIFIER },
	{ label: 'e', shiftLabel: 'E', code: 'KeyE', modifier: NO_MODIFIER },
	{ label: 'r', shiftLabel: 'R', code: 'KeyR', modifier: NO_MODIFIER },
	{ label: 't', shiftLabel: 'T', code: 'KeyT', modifier: NO_MODIFIER },
	{ label: 'y', shiftLabel: 'Y', code: 'KeyY', modifier: NO_MODIFIER },
	{ label: 'u', shiftLabel: 'U', code: 'KeyU', modifier: NO_MODIFIER },
	{ label: 'i', shiftLabel: 'I', code: 'KeyI', modifier: NO_MODIFIER },
	{ label: 'o', shiftLabel: 'O', code: 'KeyO', modifier: NO_MODIFIER },
	{ label: 'p', shiftLabel: 'P', code: 'KeyP', modifier: NO_MODIFIER },
	{ label: '[', shiftLabel: '{', code: 'BracketLeft', modifier: NO_MODIFIER },
	{ label: ']', shiftLabel: '}', code: 'BracketRight', modifier: NO_MODIFIER },
	{ label: '\\', shiftLabel: '|', code: 'Backslash', modifier: NO_MODIFIER },

	{ label: 'CAPS', code: 'CapsLock', modifier: NO_MODIFIER },
	{ label: 'a', shiftLabel: 'A', code: 'KeyA', modifier: NO_MODIFIER },
	{ label: 's', shiftLabel: 'S', code: 'KeyS', modifier: NO_MODIFIER },
	{ label: 'd', shiftLabel: 'D', code: 'KeyD', modifier: NO_MODIFIER },
	{ label: 'f', shiftLabel: 'F', code: 'KeyF', modifier: NO_MODIFIER },
	{ label: 'g', shiftLabel: 'G', code: 'KeyG', modifier: NO_MODIFIER },
	{ label: 'h', shiftLabel: 'H', code: 'KeyH', modifier: NO_MODIFIER },
	{ label: 'j', shiftLabel: 'J', code: 'KeyJ', modifier: NO_MODIFIER },
	{ label: 'k', shiftLabel: 'K', code: 'KeyK', modifier: NO_MODIFIER },
	{ label: 'l', shiftLabel: 'L', code: 'KeyL', modifier: NO_MODIFIER },
	{ label: ';', shiftLabel: ':', code: 'Semicolon', modifier: NO_MODIFIER },
	{ label: "'", shiftLabel: '"', code: 'Quote', modifier: NO_MODIFIER },
	{ label: 'ENTER', code: 'Enter', modifier: NO_MODIFIER },

	{ label: 'SHIFT', code: 'ShiftLeft', modifier: MODIFIER_SHIFT },
	{ label: 'z', shiftLabel: 'Z', code: 'KeyZ', modifier: NO_MODIFIER },
	{ label: 'x', shiftLabel: 'X', code: 'KeyX', modifier: NO_MODIFIER },
	{ label: 'c', shiftLabel: 'C', code: 'KeyC', modifier: NO_MODIFIER },
	{ label: 'v', shiftLabel: 'V', code: 'KeyV', modifier: NO_MODIFIER },
	{ label: 'b', shiftLabel: 'B', code: 'KeyB', modifier: NO_MODIFIER },
	{ label: 'n', shiftLabel: 'N', code: 'KeyN', modifier: NO_MODIFIER },
	{ label: 'm', shiftLabel: 'M', code: 'KeyM', modifier: NO_MODIFIER },
	{ label: ',', shiftLabel: '<', code: 'Comma', modifier: NO_MODIFIER },
	{ label: '.', shiftLabel: '>', code: 'Period', modifier: NO_MODIFIER },
	{ label: '/', shiftLabel: '?', code: 'Slash', modifier: NO_MODIFIER },
	{ label: 'DEL', code: 'Delete', modifier: NO_MODIFIER },

	{ label: 'CTRL', code: 'ControlLeft', modifier: MODIFIER_CONTROL },
	{ label: 'ALT', code: 'AltLeft', modifier: MODIFIER_ALT },
	{ label: 'SPACE', code: 'Space', modifier: NO_MODIFIER },
	{ label: '<', code: 'ArrowLeft', modifier: NO_MODIFIER },
	{ label: 'v', code: 'ArrowDown', modifier: NO_MODIFIER },
	{ label: '^', code: 'ArrowUp', modifier: NO_MODIFIER },
	{ label: '>', code: 'ArrowRight', modifier: NO_MODIFIER },
	{ label: 'HOME', code: 'Home', modifier: NO_MODIFIER },
	{ label: 'END', code: 'End', modifier: NO_MODIFIER },
	{ label: 'F1', code: 'F1', modifier: NO_MODIFIER },
	{ label: 'F2', code: 'F2', modifier: NO_MODIFIER },
	{ label: 'F3', code: 'F3', modifier: NO_MODIFIER },
	{ label: 'F4', code: 'F4', modifier: NO_MODIFIER },
	{ label: 'F5', code: 'F5', modifier: NO_MODIFIER },
	{ label: 'F6', code: 'F6', modifier: NO_MODIFIER },
	{ label: 'F7', code: 'F7', modifier: NO_MODIFIER },
	{ label: 'F8', code: 'F8', modifier: NO_MODIFIER },
	{ label: 'F9', code: 'F9', modifier: NO_MODIFIER },
	{ label: 'F10', code: 'F10', modifier: NO_MODIFIER },
	{ label: 'F11', code: 'F11', modifier: NO_MODIFIER },
	{ label: 'F12', code: 'F12', modifier: NO_MODIFIER },
	{ label: '`', shiftLabel: '~', code: 'Backquote', modifier: NO_MODIFIER },
];

export const ON_SCREEN_KEY_INDEX_BY_CODE = new Map<string, number>();
for (let index = 0; index < ON_SCREEN_KEY_DEFINITIONS.length; index += 1) {
	ON_SCREEN_KEY_INDEX_BY_CODE.set(ON_SCREEN_KEY_DEFINITIONS[index].code, index);
}
export const MODIFIER_KEY_INDICES = MODIFIER_CODES.map(code => ON_SCREEN_KEY_INDEX_BY_CODE.get(code));

export type OnScreenKeyboardRow = {
	readonly keys: readonly number[];
	/** Left edge in row units; gaps reserve space without inventing key identities. */
	readonly starts: readonly number[];
	readonly spans: readonly number[];
	readonly units: number;
};
export type OnScreenKeyboardPage = {
	readonly rows: readonly OnScreenKeyboardRow[];
	readonly initialKey: number;
};

export const NATIVE_KEYBOARD_PAGES: readonly OnScreenKeyboardPage[] = [
	{ initialKey: 15, rows: [
		{ keys: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], starts: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], spans: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2], units: 16 },
		{ keys: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27], starts: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], spans: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 15 },
		{ keys: [28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40], starts: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], spans: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2], units: 15 },
		{ keys: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52], starts: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], spans: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2], units: 14 },
		{ keys: [53, 54, 55, 56, 57, 58, 59], starts: [0, 2, 4, 10, 11, 12, 13], spans: [2, 2, 6, 1, 1, 1, 1], units: 14 },
	] },
	{ initialKey: 1, rows: [
		{ keys: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], starts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 10 },
		{ keys: [74, 11, 12, 25, 26, 27, 38, 39, 49, 50, 51], starts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 11 },
		{ keys: [0, 14, 13, 52, 40, 60, 61], starts: [0, 2, 4, 6, 8, 10, 12], spans: [2, 2, 2, 2, 2, 2, 2], units: 14 },
		{ keys: [41, 53, 54, 28, 55], starts: [0, 2, 4, 6, 8], spans: [2, 2, 2, 2, 6], units: 14 },
	] },
	{ initialKey: 62, rows: [
		{ keys: [62, 63, 64, 65, 66, 67], starts: [0, 2, 4, 6, 8, 10], spans: [2, 2, 2, 2, 2, 2], units: 12 },
		{ keys: [68, 69, 70, 71, 72, 73], starts: [0, 2, 4, 6, 8, 10], spans: [2, 2, 2, 2, 2, 2], units: 12 },
		{ keys: [0, 13, 60, 61, 52, 40], starts: [0, 2, 4, 6, 8, 10], spans: [2, 2, 2, 2, 2, 2], units: 12 },
		{ keys: [41, 53, 54, 28, 55], starts: [0, 2, 4, 6, 8], spans: [2, 2, 2, 2, 6], units: 14 },
	] },
];
