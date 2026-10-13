import { ON_SCREEN_KEY_DEFINITIONS, type OnScreenKeyboardPage } from '../common/input/on_screen_keyboard_keys';

/** Authored touch rows also drive gamepad navigation and the packaged static HTML.
 * Physical special-key positions follow DOSBox Pure's keyboard matrix, while the
 * three compact pages retain a usable touch pitch instead of copying its full PC grid:
 * https://github.com/schellingb/dosbox-pure/blob/a4a0bab7f8931433588f2fcad9045c85b277373d/dosbox_pure_osd.h#L1166-L1182
 */
const BOTTOM_ROW = {
	keys: [53, 54, 55, 56, 57, 58, 59],
	spans: [1.25, 1.25, 2.5, 1.5, 1.5, 1.5, 1.5],
	units: 11,
} as const;

export const BROWSER_KEYBOARD_PAGES: readonly OnScreenKeyboardPage[] = [
	{ initialKey: 15, rows: [
		{ keys: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 13], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 11 },
		{ keys: [14, 29, 30, 31, 32, 33, 34, 35, 36, 37, 40], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 11 },
		{ keys: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 11 },
		BOTTOM_ROW,
	] },
	{ initialKey: 1, rows: [
		{ keys: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 11 },
		{ keys: [14, 11, 12, 25, 26, 27, 38, 39, 49, 50, 40], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 11 },
		{ keys: [41, 0, 28, 51, 52, 60, 61], spans: [2, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5], units: 11 },
		BOTTOM_ROW,
	] },
	{ initialKey: 62, rows: [
		{ keys: [62, 63, 64, 65, 66, 67, 13], spans: [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 2], units: 11 },
		{ keys: [14, 68, 69, 70, 71, 72, 73, 40], spans: [1, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1], units: 11 },
		{ keys: [41, 0, 28, 60, 61, 52], spans: [1.5, 1.5, 1.5, 2, 2, 2.5], units: 11 },
		BOTTOM_ROW,
	] },
];

/** Key-cap text belongs to the browser presentation, shared by packaging and updates. */
export const BROWSER_KEYBOARD_KEY_LABELS: readonly string[] = ON_SCREEN_KEY_DEFINITIONS.map(key => {
	switch (key.code) {
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
