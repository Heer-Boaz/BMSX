import type { BmsxConsoleApi } from '../api';
import type { ConsoleEditorFont } from '../editor_font';
import type { ConsoleFont } from '../font';
import { expandTabs as expandTabsExternal } from './text_utils_local';
import * as constants from './constants';

let CASE_INSENSITIVE_EDITOR = true;

export function setEditorCaseInsensitivity(enabled: boolean): void {
	CASE_INSENSITIVE_EDITOR = enabled;
}

type ConsoleApiWithCustomFont = BmsxConsoleApi & {
	print_with_font?: (text: string, x: number, y: number, colorIndex: number, font: ConsoleFont) => void;
};

type DrawEditorTextOptions = {
	preserveCase?: boolean;
};

export function drawEditorText(api: BmsxConsoleApi, font: ConsoleEditorFont, text: string, originX: number, originY: number, color: number, options?: DrawEditorTextOptions): void {
	const baseX = Math.floor(originX);
	let cursorY = Math.floor(originY);
	const lines = text.split('\n');
	const renderFont = font.getRenderFont();
	const preserveCase = options?.preserveCase ?? false;
	const useUppercase = !preserveCase && CASE_INSENSITIVE_EDITOR && font.getVariant() === 'tiny';
	const apiWithFont = api as ConsoleApiWithCustomFont;
	for (let i = 0; i < lines.length; i += 1) {
		const expanded = expandTabsExternal(lines[i]);
		if (expanded.length > 0) {
			const display = useUppercase ? expanded.toUpperCase() : expanded;
			apiWithFont.write_with_font(display, baseX, cursorY, color, renderFont);
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
	const useUppercase = CASE_INSENSITIVE_EDITOR && font.getVariant() === 'tiny';
	const renderText = useUppercase ? toUpperExceptStrings(text, colors, fallbackColor) : text;
	let index = 0;
	while (index < renderText.length) {
		const colorIndex = colors[index] ?? fallbackColor;
		let end = index + 1;
		while (end < renderText.length) {
			const nextColor = colors[end] ?? fallbackColor;
			if (nextColor !== colorIndex) {
				break;
			}
			end += 1;
		}
		const segment = renderText.slice(index, end);
		if (segment.length > 0) {
			apiWithFont.write_with_font(segment, cursorX, cursorY, colorIndex, renderFont);
			cursorX += font.measure(segment);
		}
		index = end;
	}
}

function toUpperExceptStrings(text: string, colors: readonly number[], fallbackColor: number): string {
	if (text.length === 0) {
		return text;
	}
	const buffer: string[] = new Array(text.length);
	for (let i = 0; i < text.length; i += 1) {
		const ch = text.charAt(i);
		const color = colors[i] ?? fallbackColor;
		buffer[i] = color === constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING ? ch : ch.toUpperCase();
	}
	return buffer.join('');
}
