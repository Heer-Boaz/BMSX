import type { EditorFont } from '../editor_font';
import { applyCaseOutsideStrings, expandTabs as expandTabsExternal } from './text_utils';
import * as constants from './constants';
import { api } from '../runtime';
import { splitText } from './text/source_text';

let CASE_INSENSITIVE_EDITOR = true;

export function setEditorCaseInsensitivity(enabled: boolean): void {
	CASE_INSENSITIVE_EDITOR = enabled;
}

type DrawEditorTextOptions = {
	preserveCase?: boolean;
	forceUppercase?: boolean;
};

export function drawEditorText(font: EditorFont, text: string, originX: number, originY: number, z: number, color: number, options?: DrawEditorTextOptions): void {
	const baseX = originX;
	let cursorY = originY;
	const lines = splitText(text);
	const renderFont = font.renderFont();
	const preserveCase = options?.preserveCase ?? false;
	const forceUppercase = options?.forceUppercase ?? (font.variant === 'tiny');
	const useUppercase = !preserveCase && CASE_INSENSITIVE_EDITOR && forceUppercase;
	for (let i = 0; i < lines.length; i += 1) {
		const expanded = expandTabsExternal(lines[i]);
		if (expanded.length > 0) {
			const display = useUppercase ? applyCaseOutsideStrings(expanded, (ch) => ch.toUpperCase()) : expanded;
			api.blit_text_inline_with_font(display, baseX, cursorY, z, color, renderFont);
		}
		if (i < lines.length - 1) {
			cursorY += font.lineHeight;
		}
	}
}

export function drawEditorColoredText(font: EditorFont, text: string, colors: readonly number[], originX: number, originY: number, z: number, fallbackColor: number, options?: DrawEditorTextOptions): void {
	let cursorX = Math.floor(originX);
	const cursorY = Math.floor(originY);
	const renderFont = font.renderFont();
	const apiWithFont = api;
	const preserveCase = options?.preserveCase ?? false;
	const forceUppercase = options?.forceUppercase ?? (font.variant === 'tiny');
	const useUppercase = !preserveCase && CASE_INSENSITIVE_EDITOR && forceUppercase;
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
			apiWithFont.blit_text_inline_with_font(segment, cursorX, cursorY, z, colorIndex, renderFont);
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
