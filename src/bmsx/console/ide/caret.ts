import type { BmsxConsoleApi } from '../api';
import { CaretNavigationState } from './caret_navigation';
import { blinkTimer, createResourceActive, cursorVisible, drawRectOutlineColor, font, invertColorIndex, lineJumpActive, problemsPanel, resolvePaletteIndex, resourcePanelFocused, searchActive } from './console_cart_editor';
import type * as constants from './constants';
import type * as constants from './constants';
import type * as constants from './constants';
import { drawEditorColoredText, drawEditorText } from './text_renderer';
import type { CursorScreenInfo, InlineTextField } from './types';


export function updateBlink(deltaSeconds: number): void {
	blinkTimer += deltaSeconds;
	if (blinkTimer >= constants.CURSOR_BLINK_INTERVAL) {
		blinkTimer -= constants.CURSOR_BLINK_INTERVAL;
		cursorVisible = !cursorVisible;
	}
}export const caretNavigation = new CaretNavigationState();
export function drawCursor(api: BmsxConsoleApi, info: CursorScreenInfo, textX: number): void {
	const cursorX = info.x;
	const cursorY = info.y;
	const caretLeft = Math.floor(Math.max(textX, cursorX - 1));
	const caretRight = Math.max(caretLeft + 1, Math.floor(cursorX + info.width));
	const caretTop = Math.floor(cursorY);
	const caretBottom = caretTop + info.height;
	const problemsPanelHasFocus = problemsPanel.isVisible() && problemsPanel.isFocused();
	if (searchActive || lineJumpActive || resourcePanelFocused || createResourceActive || problemsPanelHasFocus) {
		const innerLeft = caretLeft + 1;
		const innerRight = caretRight - 1;
		const innerTop = caretTop + 1;
		const innerBottom = caretBottom - 1;
		if (innerRight > innerLeft && innerBottom > innerTop) {
			api.rectfill(innerLeft, innerTop, innerRight, innerBottom, constants.COLOR_CODE_BACKGROUND);
		}
		drawRectOutlineColor(api, caretLeft, caretTop, caretRight, caretBottom, constants.CARET_COLOR);
		drawEditorColoredText(api, font, info.baseChar, [info.baseColor], cursorX, cursorY, info.baseColor);
	} else {
		api.rectfill_color(caretLeft, caretTop, caretRight, caretBottom, constants.CARET_COLOR);
		const caretPaletteIndex = resolvePaletteIndex(constants.CARET_COLOR);
		const caretInverseColor = caretPaletteIndex !== null
			? invertColorIndex(caretPaletteIndex)
			: invertColorIndex(info.baseColor);
		drawEditorColoredText(api, font, info.baseChar, [caretInverseColor], cursorX, cursorY, caretInverseColor);
	}
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
	caretColor: { r: number; g: number; b: number; a: number; } = constants.CARET_COLOR,
	baseTextColor: number = constants.COLOR_STATUS_TEXT
): void {
	if (!cursorVisible) {
		return;
	}
	if (active) {
		api.rectfill_color(left, top, right, bottom, caretColor);
		const caretIndex = resolvePaletteIndex(caretColor);
		const inverseColor = caretIndex !== null
			? invertColorIndex(caretIndex)
			: invertColorIndex(baseTextColor);
		const glyph = field.cursor < field.text.length ? field.text.charAt(field.cursor) : ' ';
		drawEditorText(api, font, glyph.length > 0 ? glyph : ' ', cursorX, top, inverseColor);
		return;
	}
	drawRectOutlineColor(api, left, top, right, bottom, caretColor);
}

