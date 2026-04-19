import { BmsxColors, resolvePaletteIndex, invertColorIndex } from '../../../machine/devices/vdp/vdp';
import type { OverlayApi as Api } from '../ui/view/overlay_api';
import * as constants from '../../common/constants';
import { drawEditorText } from './text_renderer';
import type { CursorScreenInfo, TextField } from '../../common/models';
import { getCursorOffset } from '../ui/inline_text_field';
import { api } from '../ui/view/overlay_api';
import { resetBlinkState } from '../ui/view/caret/blink';
import { editorCaretState } from '../ui/view/caret/state';
import { editorViewState } from '../ui/view/state';
import { editorRuntimeState } from '../common/runtime_state';
import { problemsPanel } from '../../workbench/contrib/problems/panel/controller';
import { resourcePanel } from '../../workbench/contrib/resources/panel/controller';
import { editorSearchState, lineJumpState } from '../contrib/find/widget_state';
import { createResourceState } from '../../workbench/contrib/resources/widget_state';

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
	const text = field.text;
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
	if (!editorRuntimeState.uppercaseDisplay) {
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
	const problemsPanelHasFocus = problemsPanel.isVisible && problemsPanel.isFocused;
	const active = !(editorSearchState.active || lineJumpState.active || resourcePanel.isFocused() || createResourceState.active || problemsPanelHasFocus);
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
