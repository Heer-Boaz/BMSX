import type { BmsxConsoleApi } from '../api';
import type { ConsoleEditorFont } from '../editor_font';
import type { ConsoleFont } from '../font';
import { expandTabs as expandTabsExternal } from './text_utils_local';

type ConsoleApiWithCustomFont = BmsxConsoleApi & {
	printWithFont?: (text: string, x: number, y: number, colorIndex: number, font: ConsoleFont) => void;
};

export function drawEditorText(api: BmsxConsoleApi, font: ConsoleEditorFont, text: string, originX: number, originY: number, color: number): void {
	const baseX = Math.floor(originX);
	let cursorY = Math.floor(originY);
	const lines = text.split('\n');
	const renderFont = font.getRenderFont();
	const apiWithFont = api as ConsoleApiWithCustomFont;
	for (let i = 0; i < lines.length; i += 1) {
		const expanded = expandTabsExternal(lines[i]);
		if (expanded.length > 0) {
			if (typeof apiWithFont.printWithFont === 'function') {
				apiWithFont.printWithFont(expanded, baseX, cursorY, color, renderFont);
			} else {
				api.print(expanded, baseX, cursorY, color);
			}
		}
		if (i < lines.length - 1) {
			cursorY += font.lineHeight();
		}
	}
}

export function drawEditorColoredText(api: BmsxConsoleApi, font: ConsoleEditorFont, text: string, colors: readonly number[], originX: number, originY: number, fallbackColor: number): void {
	let cursorX = Math.floor(originX);
	const cursorY = Math.floor(originY);
	const renderFont = font.getRenderFont();
	const apiWithFont = api as ConsoleApiWithCustomFont;
	let index = 0;
	while (index < text.length) {
		const colorIndex = colors[index] ?? fallbackColor;
		let end = index + 1;
		while (end < text.length) {
			const nextColor = colors[end] ?? fallbackColor;
			if (nextColor !== colorIndex) {
				break;
			}
			end += 1;
		}
		const segment = text.slice(index, end);
		if (segment.length > 0) {
			if (typeof apiWithFont.printWithFont === 'function') {
				apiWithFont.printWithFont(segment, cursorX, cursorY, colorIndex, renderFont);
			} else {
				api.print(segment, cursorX, cursorY, colorIndex);
			}
			cursorX += font.measure(segment);
		}
		index = end;
	}
}
