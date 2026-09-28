import { TAB_SPACES, type FontGlyph } from './bitmap_font';
import type { GlyphRenderSubmission } from './submissions';

export function forEachBatchBlitGlyph<T>(command: GlyphRenderSubmission, context: T, fn: (context: T, item: FontGlyph, x: number, y: number) => void): void {
	const font = command.font;
	const items = command.items;
	const arrayLines = Array.isArray(items);
	const lineCount = arrayLines ? items.length : 1;
	let originY = command.y;
	for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
		const line = arrayLines ? items[lineIndex] : items;
		const start = arrayLines ? 0 : command.item_start;
		const end = arrayLines ? line.length : command.item_end;
		let originX = command.x;
		for (let itemIndex = start; itemIndex < end;) {
			const next = itemIndex + (line.codePointAt(itemIndex)! > 0xffff ? 2 : 1);
			const char = line.slice(itemIndex, next);
			itemIndex = next;
			if (char === '\n') {
				originX = command.x;
				originY += font.lineHeight;
				continue;
			}
			if (char === '\t') {
				originX += font.advance(' ') * TAB_SPACES;
				continue;
			}
			const item = font.getGlyph(char);
			fn(context, item, originX, originY);
			originX += item.advance;
		}
		originY += font.lineHeight;
	}
}
