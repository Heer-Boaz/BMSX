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
	const model = input.model;
	const labelsChanged = input.labelsDirty || layout.width !== view.viewportWidth || layout.font !== view.font;
	const layoutChanged = labelsChanged || layout.projectionRevision !== model.revision
		|| layout.height !== view.viewportHeight || layout.headerHeight !== view.headerHeight;
	if (layoutChanged) {
		layout.width = view.viewportWidth;
		layout.height = view.viewportHeight;
		layout.headerHeight = view.headerHeight;
		layout.font = view.font;
		layout.projectionRevision = model.revision;
		const left = 8;
		const right = view.viewportWidth - 8;
		const top = view.headerHeight + 4;
		const fieldTop = top + view.lineHeight + 6;
		const fieldBottom = fieldTop + view.lineHeight + 4;
		const rowsTop = fieldBottom + 4;
		write_rect_bounds(layout.field, left + 4, fieldTop, right - 4, fieldBottom);
		if (labelsChanged) {
			input.titleText = truncateTextToWidth(input.title, right - left - 8);
			input.placeholderText = truncateTextToWidth(input.placeholder, right - left - 14);
			layout.messageLines.length = 0;
			if (input.message.length !== 0) for (const line of input.message.split(/\r?\n/)) {
				writeWrappedOverlayLine(layout.messageLines, line, right - left - 14);
			}
			layout.textRevision += 1;
			input.labelsDirty = false;
		}
		if (input.inputBox) {
			write_rect_bounds(layout.bounds, left, top, right,
				Math.min(view.viewportHeight - 4, rowsTop + layout.messageLines.length * view.lineHeight + 4));
		} else {
			const rowHeight = view.lineHeight * 2 + 2;
			const capacity = Math.min(10, ((view.viewportHeight - rowsTop - 8) / rowHeight) | 0);
			const visible = Math.min(model.list.rows.length, capacity);
			model.rowHeight = rowHeight;
			model.viewport.layout(left + 4, rowsTop, right - 4, rowsTop + Math.max(1, visible) * rowHeight, model.list.rows.length * rowHeight);
			write_rect_bounds(layout.bounds, left, top, right, rowsTop + Math.max(1, visible) * rowHeight + 4);
			model.revealSelection();
		}
	}
	if (input.inputBox) return;
	const first = model.firstVisibleIndex, end = model.endVisibleIndex;
	if (!layoutChanged && first === layout.preparedStart && end === layout.preparedEnd) return;
	layout.preparedStart = first;
	layout.preparedEnd = end;
	layout.renderRows.length = end - first;
	const bounds = model.viewport.bounds;
	const textWidth = bounds.right - bounds.left - 6;
	for (let index = first; index < end; index += 1) {
		const match = model.list.rows[index], row = model.getRenderRow(match);
		layout.renderRows[index - first] = row;
		const textChanged = row.textRevision !== layout.textRevision;
		if (textChanged) {
			row.label.layout(row.item.label, textWidth);
			row.description.layout(row.item.description, row.item.detail.length === 0 ? textWidth : textWidth / 2 - 3);
			row.detail.layout(row.item.detail, textWidth / 2 - 3);
			row.textRevision = layout.textRevision;
		}
		if (textChanged || row.highlightRevision !== model.revision) {
			row.label.beginHighlights(); row.description.beginHighlights(); row.detail.beginHighlights();
			for (let at = match.highlightStart; at < match.highlightEnd; at += 1) {
				const highlight = model.highlights.peek(at);
				row[highlight.field].addHighlight(highlight.start, highlight.end);
			}
			row.label.endHighlights(); row.description.endHighlights(); row.detail.endHighlights();
			row.highlightRevision = model.revision;
		}
	}
}

export function drawQuickInput(input: QuickInputController): void {
	const { bounds, field } = input.layout;
	const list = input.model.list;
	const viewport = input.model.viewport;
	const content = viewport.bounds;
	const font = editorViewState.font.renderFont();
	const color = constants.COLOR_QUICK_OPEN_TEXT;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_QUICK_OPEN_BACKGROUND);
	api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_QUICK_OPEN_OUTLINE);
	api.blit_text_inline_with_font(input.titleText, bounds.left + 4, bounds.top + 3, 0, color, font);
	api.fill_rect(field.left, field.top, field.right, field.bottom, 0, constants.COLOR_CODE_BACKGROUND);
	api.blit_rect(field.left, field.top, field.right, field.bottom, 0, constants.COLOR_QUICK_OPEN_OUTLINE);
	if (input.field.text.length === 0) {
		api.blit_text_inline_with_font(input.placeholderText, field.left + 3, field.top + 2, 0, constants.COLOR_QUICK_OPEN_PLACEHOLDER, font);
	}
	drawSingleLineField(input.field, input.textViewport, field, color);
	if (input.inputBox) {
		api.pushClipRect(bounds.left + 4, field.bottom + 4, bounds.right - 4, bounds.bottom - 4);
		for (let index = 0; index < input.layout.messageLines.length; index += 1) {
			api.blit_text_inline_with_font(input.layout.messageLines[index], field.left + 3,
				field.bottom + 4 + index * editorViewState.lineHeight, 0,
				input.field.readOnly ? constants.COLOR_STATUS_TEXT : constants.COLOR_STATUS_ERROR, font);
		}
		api.popClipRect();
		return;
	}
	api.pushClipRect(content.left, content.top, content.right, content.bottom);
	if (list.rows.length === 0) api.blit_text_inline_with_font('NO MATCHING ITEMS', content.left + 3,
		content.top + 2, 0, constants.COLOR_STATUS_WARNING, font);
	const end = input.model.endVisibleIndex;
	for (let index = input.model.firstVisibleIndex; index < end; index += 1) {
		const row = input.layout.renderRows[index - input.layout.preparedStart];
		const y = input.model.rowTop(index);
		const selected = index === list.selectionIndex;
		const rowColor = selected ? constants.COLOR_QUICK_OPEN_SELECTION_TEXT : color;
		const detailColor = selected ? rowColor : constants.COLOR_QUICK_OPEN_KIND;
		const matchColor = selected ? constants.COLOR_QUICK_OPEN_SELECTION_MATCH : constants.COLOR_QUICK_OPEN_MATCH;
		if (selected || index === list.hoverIndex) {
			api.fill_rect(content.left, y, content.right, y + input.model.rowHeight, 0,
				selected ? constants.COLOR_QUICK_OPEN_SELECTION_BACKGROUND : constants.COLOR_QUICK_OPEN_HOVER_BACKGROUND);
		}
		row.label.draw(content.left + 3, y + 1, rowColor, matchColor);
		row.description.draw(content.left + 3, y + editorViewState.lineHeight + 1, detailColor, matchColor);
		row.detail.draw((content.left + content.right) / 2, y + editorViewState.lineHeight + 1, detailColor, matchColor);
	}
	api.popClipRect();
	viewport.scrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
}
