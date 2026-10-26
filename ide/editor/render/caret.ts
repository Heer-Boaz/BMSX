import type { color } from '../../../machine/ts/render/shared/submissions';
import { invertThemeToken, resolveThemeTokenColor } from '../../theme/tokens';
import type { OverlayApi as Api } from '../../runtime/overlay_api';
import * as constants from '../../common/constants';
import { drawEditorText } from './text_renderer';
import type { CursorScreenInfo } from '../../common/models';
import type { TextField } from '../ui/inline/text_field_model';
import { getCursorOffset } from '../ui/inline/text_field';
import { api } from '../../runtime/overlay_api';
import { resetBlinkState } from '../ui/view/caret/blink';
import { editorCaretState } from '../ui/view/caret/state';
import { editorViewState } from '../ui/view/state';
import type { EditorFont } from '../ui/view/font';

export function drawInlineCaret(
	api: Api,
	field: TextField,
	font: EditorFont,
	left: number,
	top: number,
	right: number,
	bottom: number,
	cursorX: number,
	active: boolean,
	caretColor: number = constants.CARET_COLOR
): void {
	if (!editorCaretState.cursorVisible) return;
	const text = field.text;
	const cursorIndex = getCursorOffset(field);
	const caretGlyph = cursorIndex < text.length ? text.charAt(cursorIndex) : ' ';
	const caretValue = resolveThemeTokenColor(caretColor);
	const inverseColorIndex = invertThemeToken(caretColor);
	if (active) {
		api.fill_rect_color(left, top, right, bottom, 0, caretValue);
		drawEditorText(font, caretGlyph, cursorX, top, 0, inverseColorIndex, { preserveCase: true });
		return;
	}
	drawRectOutlineColor(left, top, right, bottom, 0, caretValue);
}

export function drawCursor(info: CursorScreenInfo, textX: number, active: boolean): void {
	const cursorX = info.x;
	const cursorY = info.y;
	const caretLeft = Math.max(textX, cursorX - 1);
	const caretRight = Math.max(caretLeft + 1, cursorX + info.width);
	const caretTop = cursorY;
	const caretBottom = caretTop + info.height;
	const caretGlyph = info.baseChar;
	const caretValue = resolveThemeTokenColor(constants.CARET_COLOR);
	if (active) {
		api.fill_rect_color(caretLeft, caretTop, caretRight, caretBottom, 0, caretValue);
		drawEditorText(editorViewState.font, caretGlyph, cursorX, caretTop, 0, invertThemeToken(constants.CARET_COLOR), { preserveCase: true });
		return;
	}
	drawRectOutlineColor(caretLeft, caretTop, caretRight, caretBottom, 0, caretValue);
}

export function resetBlink(): void {
	resetBlinkState(editorCaretState);
}

export function drawRectOutlineColor(left: number, top: number, right: number, bottom: number, z: number, color: color): void {
	if (right <= left || bottom <= top) {
		return;
	}
	api.fill_rect_color(left, top, right, top + 1, z, color);
	api.fill_rect_color(left, bottom - 1, right, bottom, z, color);
	api.fill_rect_color(left, top, left + 1, bottom, z, color);
	api.fill_rect_color(right - 1, top, right, bottom, z, color);
}
