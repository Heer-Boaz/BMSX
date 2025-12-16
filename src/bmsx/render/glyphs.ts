import { BFont } from '../core/font';
import { $ } from '../core/game';
import type { ImgRenderSubmission, RectRenderSubmission, RenderLayer, color } from './shared/render_types';

const CHAR_CACHE: string[] = (() => {
	const cache: string[] = new Array(256);
	for (let i = 0; i < cache.length; i += 1) {
		cache[i] = String.fromCharCode(i);
	}
	return cache;
})();

/**
 * Text rendering utility (engine-level). Preferred UE-style usage is via TextComponent + TextRenderSystem, which uses this internally.
 */
export function renderGlyphs(x: number, y: number, textToWrite: string | string[], start?: number, end?: number, z: number = 950, font?: BFont, color?: color, backgroundColor?: color, layer?: RenderLayer): void {
	font ??= $.view.default_font;
	if (!font) { throw new Error('No font or default font available for renderGlyphs'); }
	const startX = x;
	let stepY = 0;
	const spriteOptions: ImgRenderSubmission = { imgid: 'none', pos: { x, y, z }, colorize: color, layer };
	const spritePos = spriteOptions.pos;
	const rectoptions: RectRenderSubmission = backgroundColor
		? { area: { left: 0, top: 0, right: 0, bottom: 0 }, color: backgroundColor, kind: 'fill', layer }
		: null;

	start = start ?? 0;

	const renderSpan = (text: string) => {
		const endIndex = end ?? text.length;
		for (let i = start; i < endIndex; i += 1) {
			const code = text.charCodeAt(i);
			const letter = code < CHAR_CACHE.length ? CHAR_CACHE[code] : text.charAt(i);
			const glyph = font.getGlyph(letter);
			const stepX = glyph.advance;
			const height = glyph.height;
			if (height > stepY) {
				stepY = height;
			}
			if (rectoptions) {
				const area = rectoptions.area;
				area.left = x;
				area.top = y;
				area.right = x + stepX;
				area.bottom = y + stepY;
				$.view.renderer.submit.rect(rectoptions);
			}
			spritePos.x = x;
			spritePos.y = y;
			spriteOptions.imgid = glyph.imgid;
			$.view.renderer.submit.sprite(spriteOptions);
			x += stepX;
		}
		x = startX;
		y += stepY;
		stepY = 0;
	};

	if (Array.isArray(textToWrite)) {
		for (let a = 0; a < textToWrite.length; a += 1) {
			renderSpan(textToWrite[a]);
			if (y >= $.view.canvasSize.y) return;
		}
	}
	else {
		renderSpan(textToWrite);
	}
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
