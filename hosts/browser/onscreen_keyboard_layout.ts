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
export type BrowserKeyboardPage = Omit<OnScreenKeyboardPage, 'rows'> & {
	readonly label: string;
	readonly description: string;
	readonly rows: readonly BrowserKeyboardRow[];
};

/** Conventional US typing rows and inverted-T navigation, following Hacker's
 * Keyboard's full layout rather than its separate coding-symbol extension.
 * https://github.com/klausw/hackerskeyboard/blob/9202d9d8b1d379f1a20edf08ed7e7149038c8e43/app/src/main/res/xml/kbd_full.xml
 * BMSX keeps Escape above Tab, every printable key at one unit, and a dedicated
 * supplementary Fn page. Those choices require a 15.75-unit number row.
 * These same rows drive packaged geometry and physical-gamepad navigation.
 * UI commands occupy authored gaps; they are not fake physical key identities.
 */
export const BROWSER_KEYBOARD_PAGES: readonly BrowserKeyboardPage[] = [
	{ label: 'ABC', description: 'letters, numbers and punctuation', initialKey: 15, rows: [
		{ keys: [0, 74, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
			starts: [0, 1.25, 2.25, 3.25, 4.25, 5.25, 6.25, 7.25, 8.25, 9.25, 10.25, 11.25, 12.25, 13.25, 14.25],
			spans: [1.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5], units: 15.75, controls: [] },
		{ keys: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
			starts: [0, 1.25, 2.25, 3.25, 4.25, 5.25, 6.25, 7.25, 8.25, 9.25, 10.25, 11.25, 12.25, 13.25],
			spans: [1.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 14.25, controls: [] },
		{ keys: [53, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
			starts: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
			spans: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25], units: 15.25, controls: [] },
		{ keys: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 58],
			starts: [0, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 13.5],
			spans: [2.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 15.25, controls: [] },
		{
			keys: [54, 55, 60, 61, 56, 57, 59],
			starts: [1.5, 3, 7.25, 9.25, 12.75, 13.75, 14.75],
			spans: [1.5, 4.25, 2, 2, 1, 1, 1],
			units: 15.75,
			controls: [
				{ action: BrowserKeyboardAction.NextPage, start: 0, span: 1.5 },
				{ action: BrowserKeyboardAction.Close, start: 11.25, span: 1.5 },
			],
		},
	] },
	{ label: 'Fn', description: 'function keys and forward delete', initialKey: 62, rows: [
		{ keys: [62, 63, 64, 65, 66, 67, 52, 40],
			starts: [0, 2, 4, 6, 8, 10, 12, 13.5], spans: [2, 2, 2, 2, 2, 2, 1.5, 2.25], units: 15.75, controls: [] },
		{ keys: [68, 69, 70, 71, 72, 73, 13, 58],
			starts: [0, 2, 4, 6, 8, 10, 12, 13.75], spans: [2, 2, 2, 2, 2, 2, 1.75, 1], units: 15.75, controls: [] },
		{ keys: [53, 54, 41, 55, 56, 57, 59],
			starts: [1.5, 3, 4.5, 6.25, 12.75, 13.75, 14.75],
			spans: [1.5, 1.5, 1.75, 5, 1, 1, 1], units: 15.75,
			controls: [
				{ action: BrowserKeyboardAction.NextPage, start: 0, span: 1.5 },
				{ action: BrowserKeyboardAction.Close, start: 11.25, span: 1.5 },
			],
		},
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
