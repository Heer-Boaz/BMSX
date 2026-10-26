import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { drawInlineCaret } from '../../render/caret';
import { resolveInlineFieldSelectionState } from './field_view';
import type { SingleLineFieldViewport } from './single_line_viewport';
import type { TextField } from './text_field_model';

/** Draws only the retained visible span; no substring or per-frame measurement. */
export function drawSingleLineField(field: TextField, view: SingleLineFieldViewport, color: number): void {
	const left = view.textLeft, top = view.textTop, clip = view.clipBounds;
	const font = view.renderFont.renderFont();
	api.pushClipRect(clip.left, clip.top, clip.right, clip.bottom);
	const selection = resolveInlineFieldSelectionState(field), focused = field.focusTarget.hasFocus;
	const start = Math.max(view.start, selection.selectionStart);
	const end = Math.min(view.end, selection.selectionEnd);
	if (focused && selection.hasSelection && start < end) {
		const selectionLeft = left + view.advances[start] - view.offset;
		const selectionRight = left + view.advances[end] - view.offset;
		api.fill_rect(selectionLeft, top, selectionRight, top + view.lineHeight, 0, constants.SELECTION_OVERLAY);
		api.blit_text_inline_span_with_font(field.text, view.start, start, left, top, 0, color, font);
		api.blit_text_inline_span_with_font(field.text, start, end, selectionLeft, top, 0, constants.COLOR_SELECTION_TEXT, font);
		api.blit_text_inline_span_with_font(field.text, end, view.end, selectionRight, top, 0, color, font);
	} else {
		api.blit_text_inline_span_with_font(field.text, view.start, view.end, left, top, 0, color, font);
	}
	if (focused) {
		const caret = view.caretBounds;
		drawInlineCaret(api, field, view.renderFont, caret.left, caret.top, caret.right, caret.bottom, caret.left, true);
	}
	api.popClipRect();
}
