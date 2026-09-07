import type { RectBounds } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { drawInlineCaret } from '../../render/caret';
import { editorViewState } from '../view/state';
import { measureInlineFieldDecoration, resolveInlineFieldSelectionState } from './field_view';
import type { IntegerInput } from './integer_input';

export function drawIntegerInput(input: IntegerInput, bounds: RectBounds): void {
	const field = input.field;
	const focused = field.focusTarget.hasFocus;
	const font = editorViewState.font.renderFont();
	const color = input.error.length > 0 ? constants.COLOR_STATUS_ERROR : constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_CODE_BACKGROUND);
	api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0,
		input.error.length > 0 ? constants.COLOR_STATUS_ERROR
			: focused ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_BORDER);
	const left = bounds.left + 3;
	const top = bounds.top + 2;
	const decoration = measureInlineFieldDecoration(field, editorViewState.inlineFieldMetricsRef, left);
	if (focused && decoration.hasSelection) {
		const selection = resolveInlineFieldSelectionState(field);
		api.fill_rect(decoration.selectionLeft, top, decoration.selectionLeft + decoration.selectionWidth,
			top + editorViewState.lineHeight, 0, constants.SELECTION_OVERLAY);
		api.blit_text_inline_span_with_font(field.text, 0, selection.selectionStart, left, top, 0, color, font);
		api.blit_text_inline_span_with_font(field.text, selection.selectionStart, selection.selectionEnd,
			decoration.selectionLeft, top, 0, constants.COLOR_SELECTION_TEXT, font);
		api.blit_text_inline_span_with_font(field.text, selection.selectionEnd, field.text.length,
			decoration.selectionLeft + decoration.selectionWidth, top, 0, color, font);
	} else {
		api.blit_text_inline_with_font(field.text, left, top, 0, color, font);
	}
	if (focused) drawInlineCaret(api, field, decoration.caretBaseX, top,
		decoration.caretBaseX + editorViewState.charAdvance, top + editorViewState.lineHeight,
		decoration.caretBaseX, true);
}
