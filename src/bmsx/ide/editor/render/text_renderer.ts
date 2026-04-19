import type { EditorFont } from '../ui/view/font';
import type { Font } from '../../../render/shared/bmsx_font';
import { applyCaseOutsideStrings, expandTabs as expandTabsExternal } from '../../common/text';
import * as constants from '../../common/constants';
import { api } from '../ui/view/overlay_api';
import { ScratchBuffer } from '../../../common/scratchbuffer';

let CASE_INSENSITIVE_EDITOR = true;

export function setEditorCaseInsensitivity(enabled: boolean): void {
	CASE_INSENSITIVE_EDITOR = enabled;
}

type DrawEditorTextOptions = {
	preserveCase?: boolean;
	forceUppercase?: boolean;
};

const createStringSlot = (): string => '';
const uppercaseScratch = new ScratchBuffer<string>(createStringSlot, 32);

function drawEditorTextLine(renderFont: Font, text: string, x: number, y: number, z: number, color: number, useUppercase: boolean): void {
	const expanded = expandTabsExternal(text);
	if (expanded.length === 0) {
		return;
	}
	const display = useUppercase ? applyCaseOutsideStrings(expanded, (ch) => ch.toUpperCase()) : expanded;
	api.blit_text_inline_with_font(display, x, y, z, color, renderFont);
}

export function drawEditorText(font: EditorFont, text: string, originX: number, originY: number, z: number, color: number, options?: DrawEditorTextOptions): void {
	const renderFont = font.renderFont();
	const preserveCase = options?.preserveCase ?? false;
	const forceUppercase = options?.forceUppercase ?? true;
	const useUppercase = !preserveCase && CASE_INSENSITIVE_EDITOR && forceUppercase;

	let lineStart = 0;
	let cursorY = originY;
	for (let index = 0; index < text.length; index += 1) {
		if (text.charCodeAt(index) !== 10) {
			continue;
		}
		drawEditorTextLine(renderFont, text.slice(lineStart, index), originX, cursorY, z, color, useUppercase);
		cursorY += font.lineHeight;
		lineStart = index + 1;
	}
	drawEditorTextLine(renderFont, text.slice(lineStart), originX, cursorY, z, color, useUppercase);
}

export function drawEditorColoredText(font: EditorFont, text: string, colors: readonly number[], originX: number, originY: number, z: number, fallbackColor: number, options?: DrawEditorTextOptions): void {
	let cursorX = originX;
	const cursorY = originY;
	const renderFont = font.renderFont();
	const apiWithFont = api;
	const preserveCase = options?.preserveCase ?? false;
	const forceUppercase = options?.forceUppercase ?? true;
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
	uppercaseScratch.clear();
	uppercaseScratch.reserve(text.length);
	for (let i = 0; i < text.length; i += 1) {
		const ch = text.charAt(i);
		const color = colors[i] ?? fallbackColor;
		uppercaseScratch.set(i, color === constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING ? ch : ch.toUpperCase());
	}
	let result = '';
	for (let i = 0; i < text.length; i += 1) {
		result += uppercaseScratch.peek(i);
	}
	return result;
}
