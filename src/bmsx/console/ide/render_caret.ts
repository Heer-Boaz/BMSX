import type { color } from '../../render/shared/render_types';

export interface CaretDrawOps {
	fillRect(x0: number, y0: number, x1: number, y1: number, color: color): void;
	strokeRect(x0: number, y0: number, x1: number, y1: number, color: color): void;
	drawGlyph(text: string, x: number, y: number, color: color): void;
}

/**
 * Draws a simple block caret using the provided renderer.
 * This helper is intentionally generic so it can be reused in the IDE and other modules (e.g. console).
 *
 * Contract:
 * - x, y: top-left caret position in pixels
 * - height: caret height in pixels
 * - color: fill color for the caret block
 * - width: optional caret width (defaults to 1 px if not specified or invalid)
 */
/**
 * Shared inline caret renderer (single entry point for IDE and console).
 * - When active, draws a filled caret plus the underlying glyph in the given glyphColor.
 * - When inactive, draws an outline only.
 */
export function renderInlineCaret(
	ops: CaretDrawOps,
	left: number,
	top: number,
	right: number,
	bottom: number,
	cursorX: number,
	active: boolean,
	caretColor: color,
	glyph?: string,
	glyphColor?: color,
): void {
	if (active) {
		ops.fillRect(left, top, right, bottom, caretColor);
		if (glyph && glyphColor) {
			ops.drawGlyph(glyph, cursorX, top, glyphColor);
		}
		return;
	}
	ops.strokeRect(left, top, right, bottom, caretColor);
}
