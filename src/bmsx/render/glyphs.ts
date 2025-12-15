import { BFont } from '../core/font';
import { $ } from '../core/game';
import type { vec2 } from "../rompack/rompack";
import type { color, RectRenderSubmission, RenderLayer } from './gameview';
import type { ImgRenderSubmission } from './shared/render_types';

const CHAR_CACHE: string[] = (() => {
	const cache: string[] = new Array(256);
	for (let i = 0; i < cache.length; i += 1) {
		cache[i] = String.fromCharCode(i);
	}
	return cache;
})();

/**
 * Text rendering utility (engine-level). Preferred UE-style usage is via TextComponent + TextRenderSystem.
 * This function exists as an immediate-mode bridge for custom producers and legacy code.
 */
export function renderGlyphs(x: number, y: number, textToWrite: string | string[], z: number = 950, _font?: BFont, color?: color, backgroundColor?: color, layer?: RenderLayer): void {
	const font = _font ?? $.view.default_font;
	if (!font) { console.error('No default font available for drawText'); return; }
	const startX = x;
	let stepY = 0;
	const pos: vec2 = { x, y, z };
	const spriteOptions: ImgRenderSubmission = { imgid: 'none', pos, colorize: color, layer };
	const rectoptions: RectRenderSubmission = backgroundColor
		? { area: { left: 0, top: 0, right: 0, bottom: 0 }, color: backgroundColor, kind: 'fill', layer }
		: null;

	const glyphGetter = (font as unknown as { getGlyph?: (char: string) => { imgId: string; width: number; height: number } }).getGlyph;
	const getGlyph = glyphGetter ? ((char: string) => glyphGetter.call(font, char)) : null;
	const drawLine = getGlyph
		? (text: string): boolean => {
			for (let i = 0; i < text.length; i += 1) {
				const code = text.charCodeAt(i);
				const letter = code < CHAR_CACHE.length ? CHAR_CACHE[code] : text.charAt(i);
				const glyph = getGlyph(letter);
				const stepX = glyph.width;
				const height = glyph.height;
				if (height > stepY) {
					stepY = height;
				}
				if (rectoptions) {
					const area = rectoptions.area;
					area.left = pos.x;
					area.top = pos.y;
					area.right = pos.x + stepX;
					area.bottom = pos.y + stepY;
					$.view.renderer.submit.rect(rectoptions);
				}
				spriteOptions.imgid = glyph.imgId;
				$.view.renderer.submit.sprite(spriteOptions);
				pos.x += stepX;
			}
			pos.x = startX;
			pos.y += stepY;
			stepY = 0;
			return pos.y >= $.view.canvasSize.y;
		}
		: (text: string): boolean => {
		for (let i = 0; i < text.length; i += 1) {
			const code = text.charCodeAt(i);
			const letter = code < CHAR_CACHE.length ? CHAR_CACHE[code] : text.charAt(i);
			const stepX = font.char_width(letter);
			const height = font.char_height(letter);
			if (height > stepY) {
				stepY = height;
			}
			if (rectoptions) {
				const area = rectoptions.area;
				area.left = pos.x;
				area.top = pos.y;
				area.right = pos.x + stepX;
				area.bottom = pos.y + stepY;
				$.view.renderer.submit.rect(rectoptions);
			}
			spriteOptions.imgid = font.char_to_img(letter);
			$.view.renderer.submit.sprite(spriteOptions);
			pos.x += stepX;
		}
		pos.x = startX;
		pos.y += stepY;
		stepY = 0;
		return pos.y >= $.view.canvasSize.y;
	};

	if (Array.isArray(textToWrite)) {
		for (let i = 0; i < textToWrite.length; i += 1) {
			if (drawLine(textToWrite[i])) {
				return;
			}
		}
		return;
	}
	drawLine(textToWrite);
}

export function renderGlyphsSpan(
	x: number,
	y: number,
	text: string,
	start: number,
	end: number,
	z: number = 950,
	_font?: BFont,
	color?: color,
	backgroundColor?: color,
	layer?: RenderLayer,
): void {
	const font = _font ?? $.view.default_font;
	if (!font) { console.error('No default font available for drawText'); return; }
	let stepY = 0;
	const pos: vec2 = { x, y, z };
	const spriteOptions: ImgRenderSubmission = { imgid: 'none', pos, colorize: color, layer };
	const rectoptions: RectRenderSubmission = backgroundColor
		? { area: { left: 0, top: 0, right: 0, bottom: 0 }, color: backgroundColor, kind: 'fill', layer }
		: null;

	const glyphGetter = (font as unknown as { getGlyph?: (char: string) => { imgId: string; width: number; height: number } }).getGlyph;
	if (glyphGetter) {
		for (let i = start; i < end; i += 1) {
			const code = text.charCodeAt(i);
			const letter = code < CHAR_CACHE.length ? CHAR_CACHE[code] : text.charAt(i);
			const glyph = glyphGetter.call(font, letter);
			const stepX = glyph.width;
			const height = glyph.height;
			if (height > stepY) {
				stepY = height;
			}
			if (rectoptions) {
				const area = rectoptions.area;
				area.left = pos.x;
				area.top = pos.y;
				area.right = pos.x + stepX;
				area.bottom = pos.y + stepY;
				$.view.renderer.submit.rect(rectoptions);
			}
			spriteOptions.imgid = glyph.imgId;
			$.view.renderer.submit.sprite(spriteOptions);
			pos.x += stepX;
		}
		return;
	}

	for (let i = start; i < end; i += 1) {
		const code = text.charCodeAt(i);
		const letter = code < CHAR_CACHE.length ? CHAR_CACHE[code] : text.charAt(i);
		const stepX = font.char_width(letter);
		const height = font.char_height(letter);
		if (height > stepY) {
			stepY = height;
		}
		if (rectoptions) {
			const area = rectoptions.area;
			area.left = pos.x;
			area.top = pos.y;
			area.right = pos.x + stepX;
			area.bottom = pos.y + stepY;
			$.view.renderer.submit.rect(rectoptions);
		}
		spriteOptions.imgid = font.char_to_img(letter);
		$.view.renderer.submit.sprite(spriteOptions);
		pos.x += stepX;
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
