import type { RectBounds } from '../../../../machine/ts/common/rect';
import { TextStyle } from '../../../common/markdown/model';
import * as colors from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { drawInlineCaret } from '../../render/caret';
import { drawStyledTextSpan } from '../../render/markdown';
import { editorViewState } from '../view/state';
import { resolveInlineFieldSelectionState } from './field_view';
import type { TextField } from './text_field_model';
import type { MultilineFieldViewport } from './multiline_viewport';

export function drawMultilineField(field: TextField, view: MultilineFieldViewport, bounds: RectBounds): void {
	const selection = resolveInlineFieldSelectionState(field);
	const left = bounds.left + 3;
	const height = editorViewState.lineHeight;
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	for (let index = view.firstRow, top = bounds.top + 2; index < view.rows.length && top + height <= bounds.bottom; index++, top += height) {
		const row = view.rows[index];
		const start = Math.max(0, selection.selectionStart - row.offset), end = Math.min(row.text.length, selection.selectionEnd - row.offset);
		if (selection.hasSelection && start < end) {
			api.fill_rect(left + row.advances[start], top, left + row.advances[end], top + height, 0, colors.SELECTION_OVERLAY);
		}
		let from = 0, styleIndex = 0;
		while (from < row.text.length) {
			const style = row.styles === undefined ? TextStyle.Plain : row.styles[styleIndex].style;
			const styleEnd = row.styles === undefined ? row.text.length : row.styles[styleIndex].to;
			let to = styleEnd;
			const selected = selection.hasSelection && from >= start && from < end;
			if (selection.hasSelection) {
				if (from < start) to = Math.min(to, start);
				else if (selected) to = Math.min(to, end);
			}
			drawStyledTextSpan(row.text, from, to, left + row.advances[from], top, row.advances[to] - row.advances[from],
				style, selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, selected);
			from = to;
			if (from === styleEnd) styleIndex++;
		}
		if (field.focusTarget.hasFocus && view.cursorRow === index) {
			const x = left + row.advances[selection.cursorOffset - row.offset];
			drawInlineCaret(api, field, x, top, x + editorViewState.spaceAdvance, top + height, x, true);
		}
	}
	api.popClipRect();
}
