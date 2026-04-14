import { BmsxColors, resolvePaletteIndex, invertColorIndex } from '../../emulator/vdp';
import type { OverlayApi as Api } from '../ui/view/overlay_api';
import * as constants from '../core/constants';
import { ide_state } from '../core/ide_state';
import { drawEditorText } from './text_renderer';
import type { CursorScreenInfo, TextField } from '../core/types';
import { getCursorOffset } from '../ui/inline_text_field';
import { api } from '../ui/view/overlay_api';
import { textFromLines } from '../text/source_text';
import { resetBlinkState } from '../ui/caret_blink';
import { editorCaretState } from '../ui/caret_state';
import { editorViewState } from '../ui/editor_view_state';

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
	if (!editorCaretState.cursorVisible) return;
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
		drawEditorText(editorViewState.font, caretGlyph, cursorX, top, undefined, inverseColorIndex, { preserveCase: true });
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
	const caretLeft = Math.max(textX, cursorX - 1);
	const caretRight = Math.max(caretLeft + 1, cursorX + info.width);
	const caretTop = cursorY;
	const caretBottom = caretTop + info.height;
	const problemsPanelHasFocus = ide_state.problemsPanel.isVisible && ide_state.problemsPanel.isFocused;
	const active = !(ide_state.search.active || ide_state.lineJump.active || ide_state.resourcePanel.isFocused() || ide_state.createResource.active || problemsPanelHasFocus);
	const caretGlyph = getCaretGlyphForDisplay(info.baseChar, info.baseColor);
	const caretValue = BmsxColors[constants.CARET_COLOR];
	if (active) {
		api.fill_rect_color(caretLeft, caretTop, caretRight, caretBottom, undefined, caretValue);
		drawEditorText(editorViewState.font, caretGlyph, cursorX, caretTop, undefined, 1, { preserveCase: true });
		return;
	}
	drawRectOutlineColor(caretLeft, caretTop, caretRight, caretBottom, undefined, caretValue);
}

export function resetBlink(): void {
	resetBlinkState(editorCaretState);
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
