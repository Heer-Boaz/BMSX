import type { RectBounds } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { drawInlineCaret } from '../../render/caret';
import { editorViewState } from '../view/state';
import { resolveInlineFieldSelectionState } from './field_view';
import type { SingleLineFieldViewport } from './single_line_viewport';
import type { TextField } from './text_field_model';

/** Draws only the retained visible span; no substring or per-frame measurement. */
export function drawSingleLineField(field: TextField, view: SingleLineFieldViewport, bounds: RectBounds, color: number): void {
	const left = bounds.left + 3;
	const top = bounds.top + 2;
	const font = editorViewState.font.renderFont();
	const selection = resolveInlineFieldSelectionState(field);
	const start = Math.max(view.start, selection.selectionStart);
	const end = Math.min(view.end, selection.selectionEnd);
	if (selection.hasSelection && start < end) {
		const selectionLeft = left + view.advances[start] - view.offset;
		const selectionRight = left + view.advances[end] - view.offset;
		api.fill_rect(selectionLeft, top, selectionRight, top + editorViewState.lineHeight, 0, constants.SELECTION_OVERLAY);
		api.blit_text_inline_span_with_font(field.text, view.start, start, left, top, 0, color, font);
		api.blit_text_inline_span_with_font(field.text, start, end, selectionLeft, top, 0, constants.COLOR_SELECTION_TEXT, font);
		api.blit_text_inline_span_with_font(field.text, end, view.end, selectionRight, top, 0, color, font);
	} else {
		api.blit_text_inline_span_with_font(field.text, view.start, view.end, left, top, 0, color, font);
	}
	const caretLeft = left + view.advances[selection.cursorOffset] - view.offset;
	drawInlineCaret(api, field, caretLeft, top, caretLeft + view.caretWidth, top + editorViewState.lineHeight,
		caretLeft, field.focusTarget.hasFocus);
}
