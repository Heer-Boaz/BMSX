import { BmsxColors, resolvePaletteIndex, invertColorIndex } from '../../vdp';
import type { OverlayApi as Api } from '../../overlay_api';
import * as constants from '../constants';
import { ide_state } from '../ide_state';
import { drawEditorText } from './text_renderer';
import type { CursorScreenInfo, TextField } from '../types';
import { getCursorOffset } from '../inline_text_field';
import { api } from '../../overlay_api';
import { textFromLines } from '../text/source_text';
import { resetBlinkState } from '../caret_blink';

export function drawInlineCaret(
	api: Api,
	field: TextField,
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
	const text = textFromLines(field.lines);
	const cursorIndex = getCursorOffset(field);
	const rawGlyph = cursorIndex < text.length ? text.charAt(cursorIndex) : ' ';
	const caretGlyph = getCaretGlyphForDisplay(rawGlyph);
	const caretIndex = resolvePaletteIndex(caretColor);
	const caretColorIndex = caretIndex ?? baseTextColor;
	const caretValue = BmsxColors[caretColorIndex];
	const inverseColorIndex = invertColorIndex(caretColorIndex);
	if (active) {
		api.fill_rect_color(left, top, right, bottom, undefined, caretValue);
		drawEditorText(ide_state.font, caretGlyph, cursorX, top, undefined, inverseColorIndex, { preserveCase: true });
		return;
	}
	drawRectOutlineColor(left, top, right, bottom, undefined, caretValue);
}

export function getCaretGlyphForDisplay(baseChar: string, baseColor?: number): string {
	if (!ide_state.caseInsensitive) {
		return baseChar;
	}
	if (baseColor === constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING) {
		return baseChar;
	}
	return baseChar.toUpperCase();
}

export function drawCursor(info: CursorScreenInfo, textX: number): void {
	const cursorX = info.x;
	const cursorY = info.y;
	const caretLeft = Math.floor(Math.max(textX, cursorX - 1));
	const caretRight = Math.max(caretLeft + 1, Math.floor(cursorX + info.width));
	const caretTop = Math.floor(cursorY);
	const caretBottom = caretTop + info.height;
	const problemsPanelHasFocus = ide_state.problemsPanel.isVisible && ide_state.problemsPanel.isFocused;
	const active = !(ide_state.searchActive || ide_state.lineJumpActive || ide_state.resourcePanelFocused || ide_state.createResourceActive || problemsPanelHasFocus);
	const caretGlyph = getCaretGlyphForDisplay(info.baseChar, info.baseColor);
	const caretValue = BmsxColors[constants.CARET_COLOR];
	if (active) {
		api.fill_rect_color(caretLeft, caretTop, caretRight, caretBottom, undefined, caretValue);
		drawEditorText(ide_state.font, caretGlyph, cursorX, caretTop, undefined, 1, { preserveCase: true });
		return;
	}
	drawRectOutlineColor(caretLeft, caretTop, caretRight, caretBottom, undefined, caretValue);
}

export function resetBlink(): void {
	resetBlinkState(ide_state);
}

export function drawRectOutlineColor(left: number, top: number, right: number, bottom: number, z: number, color: { r: number; g: number; b: number; a: number; } | number): void {
	if (right <= left || bottom <= top) {
		return;
	}
	const resolved = typeof color === 'number' ? BmsxColors[color] : color;
	api.fill_rect_color(left, top, right, top + 1, z, resolved);
	api.fill_rect_color(left, bottom - 1, right, bottom, z, resolved);
	api.fill_rect_color(left, top, left + 1, bottom, z, resolved);
	api.fill_rect_color(right - 1, top, right, bottom, z, resolved);
}
