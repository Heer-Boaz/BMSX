import { write_rect_bounds } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { truncateTextToWidth } from '../../../editor/common/text/layout';
import { drawSingleLineField } from '../../../editor/ui/inline/single_line_render';
import { editorViewState } from '../../../editor/ui/view/state';
import { layoutWorkbenchList, revealWorkbenchListSelection } from '../../ui/list_view';
import type { QuickInputController } from './controller';

/** The picker floats over the workbench; it never changes a code viewport. */
export function layoutQuickPick(input: QuickInputController): void {
	const layout = input.layout;
	const view = editorViewState;
	if (!input.layoutDirty && layout.width === view.viewportWidth && layout.height === view.viewportHeight
		&& layout.headerHeight === view.headerHeight && layout.font === view.font) return;
	const labelsChanged = input.labelsDirty || layout.width !== view.viewportWidth || layout.font !== view.font;
	layout.width = view.viewportWidth;
	layout.height = view.viewportHeight;
	layout.headerHeight = view.headerHeight;
	layout.font = view.font;
	const left = 8;
	const right = view.viewportWidth - 8;
	const top = view.headerHeight + 4;
	const fieldTop = top + view.lineHeight + 6;
	const fieldBottom = fieldTop + view.lineHeight + 4;
	const rowsTop = fieldBottom + 4;
	const rowHeight = view.lineHeight * 2 + 2;
	const capacity = Math.min(10, ((view.viewportHeight - rowsTop - 8) / rowHeight) | 0);
	const visible = Math.min(input.model.list.rows.length, capacity);
	write_rect_bounds(layout.field, left + 4, fieldTop, right - 4, fieldBottom);
	layoutWorkbenchList(input.model.list.layout, left + 4, rowsTop, right - 4, rowsTop + visible * rowHeight, rowHeight);
	write_rect_bounds(layout.bounds, left, top, right, rowsTop + Math.max(1, visible) * rowHeight + 4);
	revealWorkbenchListSelection(input.model.list);
	if (labelsChanged) {
		input.titleText = truncateTextToWidth(input.title, right - left - 8);
		input.placeholderText = truncateTextToWidth(input.placeholder, right - left - 14);
		for (const row of input.model.entries) {
			row.labelText = truncateTextToWidth(row.item.label, right - left - 14);
			row.descriptionText = truncateTextToWidth(row.item.description, (right - left) / 2 - 8);
			row.detailText = truncateTextToWidth(row.item.detail, (right - left) / 2 - 8);
		}
		input.labelsDirty = false;
	}
	input.layoutDirty = false;
}

export function drawQuickPick(input: QuickInputController): void {
	const { bounds, field } = input.layout;
	const list = input.model.list;
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
	if (list.rows.length === 0) api.blit_text_inline_with_font('NO MATCHING ITEMS', list.layout.contentLeft + 3,
		list.layout.contentTop + 2, 0, constants.COLOR_STATUS_WARNING, font);
	const end = Math.min(list.rows.length, list.scroll + list.layout.visibleRowCount);
	for (let index = list.scroll; index < end; index += 1) {
		const row = list.rows[index];
		const y = list.layout.contentTop + (index - list.scroll) * list.layout.rowHeight;
		const selected = index === list.selectionIndex;
		const rowColor = selected ? constants.COLOR_QUICK_OPEN_SELECTION_TEXT : color;
		const detailColor = selected ? rowColor : constants.COLOR_QUICK_OPEN_KIND;
		if (selected || index === list.hoverIndex) {
			api.fill_rect(list.layout.contentLeft, y, list.layout.contentRight, y + list.layout.rowHeight, 0,
				selected ? constants.COLOR_QUICK_OPEN_SELECTION_BACKGROUND : constants.COLOR_QUICK_OPEN_HOVER_BACKGROUND);
		}
		api.blit_text_inline_with_font(row.labelText, list.layout.contentLeft + 3, y + 1, 0, rowColor, font);
		api.blit_text_inline_with_font(row.descriptionText, list.layout.contentLeft + 3, y + editorViewState.lineHeight + 1,
			0, detailColor, font);
		api.blit_text_inline_with_font(row.detailText, (bounds.left + bounds.right) / 2, y + editorViewState.lineHeight + 1,
			0, detailColor, font);
	}
}
