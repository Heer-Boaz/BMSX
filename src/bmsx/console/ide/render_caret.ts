import type { color } from '../../render/shared/render_types';
import { Msx1Colors } from '../../systems/msx';
import type { BmsxConsoleApi } from '../api';
import { resolvePaletteIndex, invertColorIndex, drawRectOutlineColor } from './console_cart_editor';
import * as constants from './constants';
import { ide_state } from './ide_state';
import { drawEditorText } from './text_renderer';
import type { CursorScreenInfo, InlineTextField } from './types';

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

export function drawInlineCaret(
	api: BmsxConsoleApi,
	field: InlineTextField,
	left: number,
	top: number,
	right: number,
	bottom: number,
	cursorX: number,
	active: boolean,
	caretColor: { r: number; g: number; b: number; a: number; } | number = constants.CARET_COLOR,
	baseTextColor: number = constants.COLOR_STATUS_TEXT
): void {
	if (!ide_state.cursorVisible) return;
	const rawGlyph = field.cursor < field.text.length ? field.text.charAt(field.cursor) : ' ';
	const caretGlyph = getCaretGlyphForDisplay(rawGlyph);
	const caretIndex = resolvePaletteIndex(caretColor);
	const caretColorIndex = caretIndex ?? baseTextColor;
	const inverseColorIndex = invertColorIndex(caretColorIndex);
	const caretValue = Msx1Colors[caretColorIndex];
	const inverseColor = Msx1Colors[inverseColorIndex];
	renderInlineCaret({
		fillRect: (x0, y0, x1, y1, col) => api.rectfill_color(x0, y0, x1, y1, col),
		strokeRect: (x0, y0, x1, y1, col) => drawRectOutlineColor(api, x0, y0, x1, y1, col),
		drawGlyph: (text, x, y, col) => drawEditorText(api, ide_state.font, text, x, y, resolvePaletteIndex(col) ?? 0, { preserveCase: true }),
	}, left, top, right, bottom, cursorX, active, caretValue, caretGlyph, inverseColor);
}export function getCaretGlyphForDisplay(baseChar: string, baseColor?: number): string {
	if (!ide_state.caseInsensitive) {
		return baseChar;
	}
	if (ide_state.font.getVariant() !== 'tiny') {
		return baseChar;
	}
	if (baseColor === constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING) {
		return baseChar;
	}
	return baseChar.toUpperCase();
}

export function drawCursor(api: BmsxConsoleApi, info: CursorScreenInfo, textX: number): void {
	const cursorX = info.x;
	const cursorY = info.y;
	const caretLeft = Math.floor(Math.max(textX, cursorX - 1));
	const caretRight = Math.max(caretLeft + 1, Math.floor(cursorX + info.width));
	const caretTop = Math.floor(cursorY);
	const caretBottom = caretTop + info.height;
	const problemsPanelHasFocus = ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused();
	const active = !(ide_state.searchActive || ide_state.lineJumpActive || ide_state.resourcePanelFocused || ide_state.createResourceActive || problemsPanelHasFocus);
	const glyphColor = Msx1Colors[1];
	const caretGlyph = getCaretGlyphForDisplay(info.baseChar, info.baseColor);
	renderInlineCaret({
		fillRect: (x0, y0, x1, y1, col) => api.rectfill_color(x0, y0, x1, y1, col),
		strokeRect: (x0, y0, x1, y1, col) => drawRectOutlineColor(api, x0, y0, x1, y1, col),
		drawGlyph: (text, x, y, col) => drawEditorText(api, ide_state.font, text, x, y, resolvePaletteIndex(col) ?? 0, { preserveCase: true }),
	}, caretLeft, caretTop, caretRight, caretBottom, cursorX, active, Msx1Colors[constants.CARET_COLOR], caretGlyph, glyphColor);
}
export function resetBlink(): void {
	ide_state.blinkTimer = 0;
	ide_state.cursorVisible = true;
}

