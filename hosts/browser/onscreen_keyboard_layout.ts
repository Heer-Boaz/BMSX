import { ON_SCREEN_KEY_DEFINITIONS, type OnScreenKeyboardPage, type OnScreenKeyboardRow } from '../common/input/on_screen_keyboard_keys';

export const enum BrowserKeyboardAction { NextPage, Close }
export type BrowserKeyboardControl = {
	readonly action: BrowserKeyboardAction;
	readonly start: number;
	readonly span: number;
};
export type BrowserKeyboardRow = OnScreenKeyboardRow & {
	readonly controls: readonly BrowserKeyboardControl[];
};
export type BrowserKeyboardPage = OnScreenKeyboardPage & {
	readonly label: string;
	readonly description: string;
	readonly rows: readonly BrowserKeyboardRow[];
};

/** Five useful rows, not four rows plus a page toolbar. Hacker's Keyboard's
 * compact layout supplies the number/QWERTY pitch and integrated Fn key; its
 * full layout supplies the full-height inverted-T rather than half-height arrows.
 * https://github.com/klausw/hackerskeyboard/blob/9202d9d8b1d379f1a20edf08ed7e7149038c8e43/app/src/main/res/xml/kbd_compact.xml
 * https://github.com/klausw/hackerskeyboard/blob/9202d9d8b1d379f1a20edf08ed7e7149038c8e43/app/src/main/res/xml/kbd_full.xml
 * These same rows drive packaged geometry and physical-gamepad navigation.
 * UI commands occupy authored gaps; they are not fake physical key identities.
 */
const BOTTOM_ROW: BrowserKeyboardRow = {
	keys: [53, 54, 55, 49, 50, 56, 57, 59],
	starts: [1.5, 2.5, 3.5, 5.5, 6.5, 9, 10, 11],
	spans: [1, 1, 2, 1, 1, 1, 1, 1],
	units: 12,
	controls: [
		{ action: BrowserKeyboardAction.NextPage, start: 0, span: 1.5 },
		{ action: BrowserKeyboardAction.Close, start: 7.5, span: 1.5 },
	],
};

export const BROWSER_KEYBOARD_PAGES: readonly BrowserKeyboardPage[] = [
	{ label: 'ABC', description: 'letters and numbers', initialKey: 15, rows: [
		{ keys: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13],
			starts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2], units: 12, controls: [] },
		{ keys: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 51],
			starts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 12, controls: [] },
		{ keys: [0, 29, 30, 31, 32, 33, 34, 35, 36, 37, 40],
			starts: [0, 1.25, 2.25, 3.25, 4.25, 5.25, 6.25, 7.25, 8.25, 9.25, 10.25],
			spans: [1.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.75], units: 12, controls: [] },
		{ keys: [41, 42, 43, 44, 45, 46, 47, 48, 58],
			starts: [0, 1.75, 2.75, 3.75, 4.75, 5.75, 6.75, 7.75, 10],
			spans: [1.75, 1, 1, 1, 1, 1, 1, 1, 1], units: 12, controls: [] },
		BOTTOM_ROW,
	] },
	{ label: 'Fn', description: 'function keys and symbols', initialKey: 62, rows: [
		{ keys: [62, 63, 64, 65, 66, 67, 0, 13],
			starts: [0, 1.5, 3, 4.5, 6, 7.5, 9, 10], spans: [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1, 2], units: 12, controls: [] },
		{ keys: [14, 68, 69, 70, 71, 72, 73, 52],
			starts: [0, 1, 2.5, 4, 5.5, 7, 8.5, 10], spans: [1, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 2], units: 12, controls: [] },
		{ keys: [28, 11, 12, 25, 26, 27, 38, 39, 40],
			starts: [0, 1.25, 2.5, 3.75, 5, 6.25, 7.5, 8.75, 10.25],
			spans: [1.25, 1.25, 1.25, 1.25, 1.25, 1.25, 1.25, 1.25, 1.75], units: 12, controls: [] },
		{ keys: [41, 60, 61, 51, 58], starts: [0, 1.75, 4, 6.25, 10],
			spans: [1.75, 2.25, 2.25, 2.5, 1], units: 12, controls: [] },
		BOTTOM_ROW,
	] },
];

/** Key-cap text belongs to the browser presentation, shared by packaging and updates. */
export const BROWSER_KEYBOARD_KEY_LABELS: readonly string[] = ON_SCREEN_KEY_DEFINITIONS.map(key => {
	switch (key.code) {
		case 'ControlLeft': return 'Ctrl';
		case 'AltLeft': return 'Alt';
		case 'Tab': return 'Tab';
		case 'CapsLock': return '⇪';
		case 'Escape': return 'Esc';
		case 'Delete': return 'Del';
		case 'Home': return 'Home';
		case 'End': return 'End';
		case 'ArrowLeft': return '←';
		case 'ArrowDown': return '↓';
		case 'ArrowUp': return '↑';
		case 'ArrowRight': return '→';
		case 'ShiftLeft': return '⇧';
		case 'Backspace': return '⌫';
		case 'Enter': return '↵';
		default: return key.label;
	}
});
