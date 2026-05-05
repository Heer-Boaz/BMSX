import { TAB_SPACES, type FontGlyph } from './bitmap_font';
import type { GlyphRenderSubmission } from './submissions';

export function forEachGlyphRunGlyph(command: GlyphRenderSubmission, fn: (glyph: FontGlyph, x: number, y: number) => void): void {
	const font = command.font!;
	const arrayLines = Array.isArray(command.glyphs);
	const lineCount = arrayLines ? command.glyphs.length : 1;
	let originY = command.y;
	for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
		const line = arrayLines ? command.glyphs[lineIndex] : command.glyphs;
		const start = arrayLines ? 0 : command.glyph_start!;
		const end = arrayLines ? line.length : command.glyph_end!;
		let originX = command.x;
		let glyphIndex = 0;
		for (const char of line) {
			if (glyphIndex >= end) {
				break;
			}
			if (glyphIndex < start) {
				glyphIndex += 1;
				continue;
			}
			if (char === '\n') {
				originX = command.x;
				originY += font.lineHeight;
				glyphIndex += 1;
				continue;
			}
			if (char === '\t') {
				originX += font.advance(' ') * TAB_SPACES;
				glyphIndex += 1;
				continue;
			}
			const glyph = font.getGlyph(char);
			fn(glyph, originX, originY);
			originX += glyph.advance;
			glyphIndex += 1;
		}
		originY += font.lineHeight;
	}
}
