import type { RectBounds } from '../../../../machine/ts/common/rect';
import * as colors from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { drawInlineCaret } from '../../render/caret';
import { editorViewState } from '../view/state';
import { resolveInlineFieldSelectionState } from './field_view';
import type { TextField } from './text_field_model';
import type { MultilineFieldViewport } from './multiline_viewport';

export function drawMultilineField(field: TextField, view: MultilineFieldViewport, bounds: RectBounds): void {
	const font = editorViewState.font.renderFont();
	const selection = resolveInlineFieldSelectionState(field);
	const left = bounds.left + 3;
	const height = editorViewState.lineHeight;
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	for (let index = view.firstRow, top = bounds.top + 2; index < view.rows.length && top + height <= bounds.bottom; index++, top += height) {
		const row = view.rows[index];
		const start = Math.max(0, selection.selectionStart - row.offset), end = Math.min(row.text.length, selection.selectionEnd - row.offset);
		if (selection.hasSelection && start < end) {
			api.fill_rect(left + row.advances[start], top, left + row.advances[end], top + height, 0, colors.SELECTION_OVERLAY);
			api.blit_text_inline_span_with_font(row.text, 0, start, left, top, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			api.blit_text_inline_span_with_font(row.text, start, end, left + row.advances[start], top, 0, colors.COLOR_SELECTION_TEXT, font);
			api.blit_text_inline_span_with_font(row.text, end, row.text.length, left + row.advances[end], top, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		} else api.blit_text_inline_with_font(row.text, left, top, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		if (field.focusTarget.hasFocus && view.cursorRow === index) {
			const x = left + row.advances[selection.cursorOffset - row.offset];
			drawInlineCaret(api, field, x, top, x + editorViewState.spaceAdvance, top + height, x, true);
		}
	}
	api.popClipRect();
}
