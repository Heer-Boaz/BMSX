import type { OnScreenKeyboardPage } from '../common/input/on_screen_keyboard_keys';

/** Browser CSS-keyboard pages, not the native bitmap keyboard's sixteen-unit grid.
 * The same authored rows/spans drive shared gamepad navigation and touch layout.
 * Separate text/Fn pages are also used by RetroArch's touch keyboard:
 * https://github.com/libretro/common-overlays/blob/42c21b99889468a8e77fd7f002229ec16e2f9fa2/keyboards/split-qwerty/split-qwerty.cfg#L1-L65
 */
export const BROWSER_KEYBOARD_PAGES: readonly OnScreenKeyboardPage[] = [
	{ initialKey: 15, rows: [
		{ keys: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 10 },
		{ keys: [29, 30, 31, 32, 33, 34, 35, 36, 37], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1], units: 9 },
		{ keys: [41, 42, 43, 44, 45, 46, 47, 48, 13], spans: [1.5, 1, 1, 1, 1, 1, 1, 1, 1.5], units: 10 },
		{ keys: [53, 54, 55, 14, 40], spans: [1.5, 1.5, 3.5, 1.5, 2], units: 10 },
	] },
	{ initialKey: 1, rows: [
		{ keys: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 10 },
		{ keys: [11, 12, 25, 26, 27, 38, 39, 49, 50, 51], spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], units: 10 },
		{ keys: [0, 28, 13, 52, 14, 40], spans: [1.5, 1.5, 2, 1.5, 1.5, 2], units: 10 },
		{ keys: [41, 53, 54, 55], spans: [1.5, 1.5, 1.5, 5.5], units: 10 },
	] },
	{ initialKey: 62, rows: [
		{ keys: [62, 63, 64, 65, 66, 67], spans: [2, 2, 2, 2, 2, 2], units: 12 },
		{ keys: [68, 69, 70, 71, 72, 73], spans: [2, 2, 2, 2, 2, 2], units: 12 },
		{ keys: [0, 14, 60, 61, 52, 40], spans: [2, 2, 2, 2, 2, 2], units: 12 },
		{ keys: [41, 53, 54, 56, 57, 58, 59], spans: [2, 2, 2, 1.5, 1.5, 1.5, 1.5], units: 12 },
	] },
];
