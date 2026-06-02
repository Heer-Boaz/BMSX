import { TAB_SPACES, type FontGlyph } from './bitmap_font';
import type { GlyphRenderSubmission } from './submissions';

export function forEachBatchBlitGlyph(command: GlyphRenderSubmission, fn: (item: FontGlyph, x: number, y: number) => void): void {
	const font = command.font;
	const arrayLines = Array.isArray(command.items);
	const lineCount = arrayLines ? command.items.length : 1;
	let originY = command.y;
	for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
		const line = arrayLines ? command.items[lineIndex] : command.items;
		const start = arrayLines ? 0 : command.item_start;
		const end = arrayLines ? line.length : command.item_end;
		let originX = command.x;
		let itemIndex = 0;
		for (const char of line) {
			if (itemIndex >= end) {
				break;
			}
			if (itemIndex < start) {
				itemIndex += 1;
				continue;
			}
			if (char === '\n') {
				originX = command.x;
				originY += font.lineHeight;
				itemIndex += 1;
				continue;
			}
			if (char === '\t') {
				originX += font.advance(' ') * TAB_SPACES;
				itemIndex += 1;
				continue;
			}
			const item = font.getGlyph(char);
			fn(item, originX, originY);
			originX += item.advance;
			itemIndex += 1;
		}
		originY += font.lineHeight;
	}
}
