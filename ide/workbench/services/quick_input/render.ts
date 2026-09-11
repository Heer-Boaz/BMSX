import { write_rect_bounds } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { truncateTextToWidth } from '../../../editor/common/text/layout';
import { drawSingleLineField } from '../../../editor/ui/inline/single_line_render';
import { editorViewState } from '../../../editor/ui/view/state';
import type { QuickInputController } from './controller';

/** The picker floats over the workbench; it never changes a code viewport. */
export function layoutQuickPick(input: QuickInputController): void {
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
		const rowHeight = view.lineHeight * 2 + 2;
		const capacity = Math.min(10, ((view.viewportHeight - rowsTop - 8) / rowHeight) | 0);
		const visible = Math.min(model.list.rows.length, capacity);
		write_rect_bounds(layout.field, left + 4, fieldTop, right - 4, fieldBottom);
		model.rowHeight = rowHeight;
		model.viewport.layout(left + 4, rowsTop, right - 4, rowsTop + Math.max(1, visible) * rowHeight, model.list.rows.length * rowHeight);
		write_rect_bounds(layout.bounds, left, top, right, rowsTop + Math.max(1, visible) * rowHeight + 4);
		model.revealSelection();
		if (labelsChanged) {
			input.titleText = truncateTextToWidth(input.title, right - left - 8);
			input.placeholderText = truncateTextToWidth(input.placeholder, right - left - 14);
			layout.textRevision += 1;
			input.labelsDirty = false;
		}
	}
	const first = model.firstVisibleIndex, end = model.endVisibleIndex;
	if (!layoutChanged && first === layout.preparedStart && end === layout.preparedEnd) return;
	layout.preparedStart = first;
	layout.preparedEnd = end;
	layout.renderRows.length = end - first;
	const bounds = model.viewport.bounds;
	const textWidth = bounds.right - bounds.left - 6;
	for (let index = first; index < end; index += 1) {
		const row = model.getRenderRow(model.list.rows[index]);
		layout.renderRows[index - first] = row;
		if (row.textRevision === layout.textRevision) continue;
		row.labelText = truncateTextToWidth(row.item.label, textWidth);
		row.descriptionText = truncateTextToWidth(row.item.description, row.item.detail.length === 0 ? textWidth : textWidth / 2 - 3);
		row.detailText = truncateTextToWidth(row.item.detail, textWidth / 2 - 3);
		row.textRevision = layout.textRevision;
	}
}

export function drawQuickPick(input: QuickInputController): void {
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
		if (selected || index === list.hoverIndex) {
			api.fill_rect(content.left, y, content.right, y + input.model.rowHeight, 0,
				selected ? constants.COLOR_QUICK_OPEN_SELECTION_BACKGROUND : constants.COLOR_QUICK_OPEN_HOVER_BACKGROUND);
		}
		api.blit_text_inline_with_font(row.labelText, content.left + 3, y + 1, 0, rowColor, font);
		api.blit_text_inline_with_font(row.descriptionText, content.left + 3, y + editorViewState.lineHeight + 1,
			0, detailColor, font);
		api.blit_text_inline_with_font(row.detailText, (content.left + content.right) / 2, y + editorViewState.lineHeight + 1,
			0, detailColor, font);
	}
	api.popClipRect();
	viewport.scrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
}
