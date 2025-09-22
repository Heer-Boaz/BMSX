import { BFont } from '../core/font';
import { $ } from '../core/game';
import type { vec2 } from "../rompack/rompack";
import type { color, RectRenderSubmission, RenderLayer } from './gameview';

/**
 * Text rendering utility (engine-level). Preferred UE-style usage is via TextComponent + TextRenderSystem.
 * This function exists as an immediate-mode bridge for custom producers and legacy code.
 */
export function renderGlyphs(x: number, y: number, textToWrite: string | string[], z: number = 950, _font?: BFont, color?: color, backgroundColor?: color, layer?: RenderLayer): void {
	const font = _font ?? $.view.default_font;
	if (!font) { console.error('No default font available for drawText'); return; }
	const startPos: vec2 = { x, y };
	let stepX = 0; let stepY = 0;
	const pos: vec2 = { x: startPos.x, y: startPos.y, z };

	const drawLine = (text: string): boolean => {
		for (let i = 0; i < text.length; i++) {
			const letter = text[i];
			stepX = font.char_width(letter);
			stepY = Math.max(stepY, font.char_height(letter));
			if (backgroundColor) {
				const rectoptions: RectRenderSubmission = { area: { start: { x: pos.x, y: pos.y }, end: { x: pos.x + stepX, y: pos.y + stepY } }, color: backgroundColor, kind: 'fill', layer };
				$.view.renderer.submit.rect(rectoptions);
			}
			$.view.renderer.submit.sprite({ imgid: font.char_to_img(letter), pos, colorize: color, layer });
			pos.x += stepX;
		}
		pos.x = startPos.x; pos.y += stepY; stepY = 0;
		return pos.y >= $.view.canvasSize.y;
	};

	if (Array.isArray(textToWrite)) { for (const t of textToWrite) if (drawLine(t)) return; }
	else drawLine(textToWrite);
}

/**
 * Calculates the X coordinate for centering a block of text on the screen.
 *
 * This method determines the longest line of text from `this.fullTextLines`,
 * calculates its width in pixels, and then computes the X coordinate needed
 * to center this line on a screen with a fixed width of 256 pixels.
 *
 * @param fullTextLines - The array of text lines to be centered.
 * @param charWidth - The width of each character in pixels.
 * @param blockWidth - The total width of the block to center the text within.
 * @returns The X coordinate for centering the text block.
 */

export function calculateCenteredBlockX(fullTextLines: string[], charWidth: number, blockWidth: number): number {
	const longestLine = fullTextLines.reduce((a, b) => a.length > b.length ? a : b, '');
	const longestLineWidth = longestLine.length * charWidth;
	return (blockWidth - longestLineWidth) / 2;
}
/**
 * Splits a given text into an array of strings, where each string represents a line of text
 * that does not exceed the maximum number of characters per line. The method also respects
 * newline characters in the input text.
 *
 * @param text - The input text to be wrapped into lines.
 * @param maxLineLength - The maximum number of characters allowed per line.
 * @returns An array of strings, where each string is a line of text.
 */

export function wrapGlyphs(text: string, maxLineLength: number): string[] {
	const words = text.match(/(\S+|\n)/g) || [];
	const lines: string[] = [];
	let currentLine = '';

	for (const word of words) {
		if (word === '\n') {
			lines.push(currentLine.trim());
			currentLine = '';
			lines.push('');
		} else {
			const tentativeLine = currentLine ? currentLine + ' ' + word : word;
			if (tentativeLine.length <= maxLineLength) {
				currentLine = tentativeLine;
			} else {
				if (currentLine) {
					lines.push(currentLine.trim());
					currentLine = word;
				} else {
					lines.push(word);
					currentLine = '';
				}
			}
		}
	}

	if (currentLine.trim()) {
		lines.push(currentLine.trim());
	}

	return lines;
}

