import { drawQuickPickRows, layoutQuickPickRows } from './list_render';
import { write_rect_bounds } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { appendMeasuredTruncationMarker } from '../../../common/text';
import { measureText, measureTextRange, truncateTextToWidth, writeWrappedOverlayLine } from '../../../editor/common/text/layout';
import { drawSingleLineField } from '../../../editor/ui/inline/single_line_render';
import { editorViewState } from '../../../editor/ui/view/state';
import type { QuickInputController } from './controller';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import { drawWorkbenchIcon } from '../../render/icon';
import { drawWorkbenchCheckbox } from '../../render/checkbox';

/** Pickers and input boxes share a workbench surface, not a code-editor bar. */
export function layoutQuickInput(input: QuickInputController): void {
	const layout = input.layout;
	const view = editorViewState;
	const area = input.presentation.bounds, width = area.right - area.left, height = area.bottom - area.top;
	const model = input.model;
	const geometryChanged = layout.width !== width || layout.height !== height || layout.left !== area.left
		|| layout.top !== area.top || layout.font !== view.font;
	const labelsChanged = input.labelsDirty || layout.width !== width || layout.font !== view.font
		|| layout.height !== height && input.message.length !== 0 && !input.inputBox && !input.busy && !input.failed;
	const layoutChanged = labelsChanged || layout.projectionRevision !== model.revision
		|| layout.height !== height || layout.left !== area.left || layout.top !== area.top;
	if (layoutChanged) {
		layout.revision++;
		layout.left = area.left; layout.top = area.top;
		layout.width = width;
		layout.height = height;
		layout.font = view.font;
		layout.projectionRevision = model.revision;
		const left = area.left + 8;
		const right = area.right - 8;
		const top = area.top + 4;
		const back = input.step?.back !== undefined, titleHeight = back ? Math.max(view.lineHeight, WORKBENCH_ICON_SIZE) : view.lineHeight;
		const backSize = titleHeight + 4;
		write_rect_bounds(layout.back, left + 2, top + 1, left + 2 + (back ? backSize : 0), top + 1 + (back ? backSize : 0));
		layout.titleLeft = back ? layout.back.right + 4 : left + 4;
		const fieldTop = top + titleHeight + 6;
		const fieldBottom = fieldTop + view.lineHeight + 4;
		const toggleTop = fieldBottom + 4;
		const toggleBottom = toggleTop + (input.toggle === undefined ? 0 : Math.max(view.lineHeight, WORKBENCH_ICON_SIZE) + 4);
		const rowsTop = toggleBottom + (input.toggle === undefined ? 0 : 4);
		write_rect_bounds(layout.field, left + 4, fieldTop, right - 4, fieldBottom);
		write_rect_bounds(layout.toggle, left + 4, toggleTop, right - 4, toggleBottom);
		layout.messageTop = rowsTop;
		if (labelsChanged) {
			const step = input.step;
			layout.stepText = step === undefined ? '' : truncateTextToWidth(`${step.index}/${step.total}`, right - layout.titleLeft - 4);
			layout.stepWidth = measureText(layout.stepText);
			input.titleText = truncateTextToWidth(input.title, right - 4 - layout.titleLeft - (step === undefined ? 0 : layout.stepWidth + 4));
			input.placeholderText = truncateTextToWidth(input.placeholder, right - left - 14);
			layout.messageLines.length = 0;
			if (input.failed) layout.messageLines.push('FAILED');
			const message = input.busy ? 'WORKING…' : input.message;
			if (message.length !== 0) for (const line of message.split(/\r?\n/)) {
				writeWrappedOverlayLine(layout.messageLines, line, right - left - 14);
			}
			if (!input.inputBox && !input.busy && !input.failed && layout.messageLines.length !== 0) {
				const available = Math.max(0, area.bottom - rowsTop - 8);
				const rowHeight = view.lineHeight * 2 + 2;
				const maxLines = Math.max(1, Math.trunc((available - rowHeight - 4) / view.lineHeight));
				if (layout.messageLines.length > maxLines) {
					layout.messageLines.length = maxLines;
					layout.messageLines[maxLines - 1] = appendMeasuredTruncationMarker(layout.messageLines[maxLines - 1], right - left - 14, measureTextRange);
				}
			}
			layout.textRevision += 1;
			input.labelsDirty = false;
		}
		layout.stepLeft = right - 4 - layout.stepWidth;
		if (input.inputBox || input.busy || input.failed) {
			model.viewport.layout(left + 4, rowsTop, right - 4, rowsTop, 0);
			write_rect_bounds(layout.bounds, left, top, right,
				Math.min(area.bottom - 4, rowsTop + layout.messageLines.length * view.lineHeight + 4));
		} else {
			const rowHeight = view.lineHeight * 2 + 2;
			const pickerTop = layout.messageLines.length === 0 ? rowsTop
				: Math.max(rowsTop, Math.min(area.bottom - 8, rowsTop + layout.messageLines.length * view.lineHeight + 4));
			const available = Math.max(0, area.bottom - pickerTop - 8);
			const capacity = Math.min(10, Math.trunc(available / rowHeight));
			const visible = Math.min(model.list.rows.length, capacity);
			const listHeight = capacity === 0 ? available : Math.max(1, visible) * rowHeight;
			model.rowHeight = rowHeight;
			model.viewport.layout(left + 4, pickerTop, right - 4, pickerTop + listHeight, model.list.rows.length * rowHeight);
			write_rect_bounds(layout.bounds, left, top, right, pickerTop + listHeight + 4);
			if (geometryChanged || labelsChanged || model.selectionRevealPending) model.revealSelection();
		}
	}
	if (input.inputBox || input.busy || input.failed) return;
	layoutQuickPickRows(model, layout, layoutChanged);
}

export function drawQuickInput(input: QuickInputController): void {
	const { bounds, field, back } = input.layout;
	const font = editorViewState.font.renderFont();
	const color = constants.COLOR_QUICK_OPEN_TEXT;
	const step = input.step;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_QUICK_OPEN_BACKGROUND);
	api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_QUICK_OPEN_OUTLINE);
	if (step !== undefined) api.pushClipRect(bounds.left + 2, bounds.top + 1, bounds.right - 2, field.top - 1);
	if (step?.back !== undefined) {
		const pressed = input.backPressed && input.backHovered;
		if (input.backHovered) api.fill_rect(back.left, back.top, back.right, back.bottom, 0,
			pressed ? constants.COLOR_HEADER_BUTTON_PRESSED_BACKGROUND : constants.COLOR_QUICK_OPEN_HOVER_BACKGROUND);
		drawWorkbenchIcon('back', back.left + Math.trunc((back.right - back.left - WORKBENCH_ICON_SIZE) / 2),
			back.top + Math.trunc((back.bottom - back.top - WORKBENCH_ICON_SIZE) / 2), pressed ? constants.COLOR_HEADER_BUTTON_PRESSED_TEXT : color);
	}
	api.blit_text_inline_with_font(input.titleText, input.layout.titleLeft, bounds.top + 3, 0, color, font);
	if (step !== undefined) {
		api.blit_text_inline_with_font(input.layout.stepText, input.layout.stepLeft, bounds.top + 3, 0, color, font);
		api.popClipRect();
	}
	api.fill_rect(field.left, field.top, field.right, field.bottom, 0, constants.COLOR_INPUT_BACKGROUND);
	api.blit_rect(field.left, field.top, field.right, field.bottom, 0, constants.COLOR_QUICK_OPEN_OUTLINE);
	if (input.field.text.length === 0) {
		api.blit_text_inline_with_font(input.placeholderText, field.left + 3, field.top + 2, 0, constants.COLOR_INPUT_PLACEHOLDER, font);
	}
	drawSingleLineField(input.field, input.textViewport, constants.COLOR_INPUT_TEXT);
	if (input.toggle !== undefined) drawWorkbenchCheckbox(input.toggle);
	if (input.layout.messageLines.length !== 0) {
		const messageBottom = Math.max(input.layout.messageTop,
			input.inputBox || input.busy || input.failed ? bounds.bottom - 4 : input.model.viewport.bounds.top - 4);
		api.pushClipRect(bounds.left + 4, input.layout.messageTop, bounds.right - 4, messageBottom);
		for (let index = 0; index < input.layout.messageLines.length; index += 1) {
			api.blit_text_inline_with_font(input.layout.messageLines[index], field.left + 3,
				input.layout.messageTop + index * editorViewState.lineHeight, 0,
				input.busy ? constants.COLOR_QUICK_OPEN_TEXT : constants.COLOR_CONTENT_ERROR_TEXT, font);
		}
		api.popClipRect();
	}
	if (input.inputBox || input.busy || input.failed) return;
	drawQuickPickRows(input.model, input.layout);
}
