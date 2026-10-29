import { drawQuickPickRows, layoutQuickPickRows } from './list_render';
import { write_rect_bounds } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { truncateTextToWidth, writeWrappedOverlayLine } from '../../../editor/common/text/layout';
import { drawSingleLineField } from '../../../editor/ui/inline/single_line_render';
import { editorViewState } from '../../../editor/ui/view/state';
import type { QuickInputController } from './controller';

/** Pickers and input boxes share a workbench surface, not a code-editor bar. */
export function layoutQuickInput(input: QuickInputController): void {
	const layout = input.layout;
	const view = editorViewState;
	const area = input.presentation.bounds, width = area.right - area.left, height = area.bottom - area.top;
	const model = input.model;
	const geometryChanged = layout.width !== width || layout.height !== height || layout.left !== area.left
		|| layout.top !== area.top || layout.font !== view.font;
	const labelsChanged = input.labelsDirty || layout.width !== width || layout.font !== view.font;
	const layoutChanged = labelsChanged || layout.projectionRevision !== model.revision
		|| layout.height !== height || layout.left !== area.left || layout.top !== area.top;
	if (layoutChanged) {
		layout.left = area.left; layout.top = area.top;
		layout.width = width;
		layout.height = height;
		layout.font = view.font;
		layout.projectionRevision = model.revision;
		const left = area.left + 8;
		const right = area.right - 8;
		const top = area.top + 4;
		const fieldTop = top + view.lineHeight + 6;
		const fieldBottom = fieldTop + view.lineHeight + 4;
		const rowsTop = fieldBottom + 4;
		write_rect_bounds(layout.field, left + 4, fieldTop, right - 4, fieldBottom);
		if (labelsChanged) {
			input.titleText = truncateTextToWidth(input.title, right - left - 8);
			input.placeholderText = truncateTextToWidth(input.placeholder, right - left - 14);
			layout.messageLines.length = 0;
			if (input.failed) layout.messageLines.push('FAILED');
			const message = input.busy ? 'WORKING…' : input.message;
			if (message.length !== 0) for (const line of message.split(/\r?\n/)) {
				writeWrappedOverlayLine(layout.messageLines, line, right - left - 14);
			}
			layout.textRevision += 1;
			input.labelsDirty = false;
		}
		if (input.inputBox || input.busy || input.failed) {
			model.viewport.layout(left + 4, rowsTop, right - 4, rowsTop, 0);
			write_rect_bounds(layout.bounds, left, top, right,
				Math.min(area.bottom - 4, rowsTop + layout.messageLines.length * view.lineHeight + 4));
		} else {
			const rowHeight = view.lineHeight * 2 + 2;
			const capacity = Math.min(10, ((area.bottom - rowsTop - 8) / rowHeight) | 0);
			const visible = Math.min(model.list.rows.length, capacity);
			model.rowHeight = rowHeight;
			model.viewport.layout(left + 4, rowsTop, right - 4, rowsTop + Math.max(1, visible) * rowHeight, model.list.rows.length * rowHeight);
			write_rect_bounds(layout.bounds, left, top, right, rowsTop + Math.max(1, visible) * rowHeight + 4);
			if (geometryChanged || model.selectionRevealPending) model.revealSelection();
		}
	}
	if (input.inputBox || input.busy || input.failed) return;
	layoutQuickPickRows(model, layout, layoutChanged);
}

export function drawQuickInput(input: QuickInputController): void {
	const { bounds, field } = input.layout;
	const font = editorViewState.font.renderFont();
	const color = constants.COLOR_QUICK_OPEN_TEXT;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_QUICK_OPEN_BACKGROUND);
	api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_QUICK_OPEN_OUTLINE);
	api.blit_text_inline_with_font(input.titleText, bounds.left + 4, bounds.top + 3, 0, color, font);
	api.fill_rect(field.left, field.top, field.right, field.bottom, 0, constants.COLOR_INPUT_BACKGROUND);
	api.blit_rect(field.left, field.top, field.right, field.bottom, 0, constants.COLOR_QUICK_OPEN_OUTLINE);
	if (input.field.text.length === 0) {
		api.blit_text_inline_with_font(input.placeholderText, field.left + 3, field.top + 2, 0, constants.COLOR_INPUT_PLACEHOLDER, font);
	}
	drawSingleLineField(input.field, input.textViewport, constants.COLOR_INPUT_TEXT);
	if (input.inputBox || input.busy || input.failed) {
		api.pushClipRect(bounds.left + 4, field.bottom + 4, bounds.right - 4, bounds.bottom - 4);
		for (let index = 0; index < input.layout.messageLines.length; index += 1) {
			api.blit_text_inline_with_font(input.layout.messageLines[index], field.left + 3,
				field.bottom + 4 + index * editorViewState.lineHeight, 0,
				input.busy ? constants.COLOR_QUICK_OPEN_TEXT : constants.COLOR_CONTENT_ERROR_TEXT, font);
		}
		api.popClipRect();
		return;
	}
	drawQuickPickRows(input.model, input.layout);
}
