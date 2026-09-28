import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { editorViewState } from '../../../editor/ui/view/state';
import type { QuickPickModel, QuickPickRenderRow } from './model';

export type QuickPickRows = { preparedStart: number; preparedEnd: number; textRevision: number; renderRows: QuickPickRenderRow[] };

export function layoutQuickPickRows(model: QuickPickModel, layout: QuickPickRows, layoutChanged: boolean): void {
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

export function drawQuickPickRows(model: QuickPickModel, layout: QuickPickRows): void {
	const list = model.list, viewport = model.viewport, content = viewport.bounds;
	const font = editorViewState.font.renderFont(), color = constants.COLOR_QUICK_OPEN_TEXT;
	api.pushClipRect(content.left, content.top, content.right, content.bottom);
	if (list.rows.length === 0) api.blit_text_inline_with_font('NO MATCHING ITEMS', content.left + 3,
		content.top + 2, 0, constants.COLOR_STATUS_WARNING, font);
	const end = model.endVisibleIndex;
	for (let index = model.firstVisibleIndex; index < end; index += 1) {
		const row = layout.renderRows[index - layout.preparedStart];
		const y = model.rowTop(index);
		const selected = index === list.selectionIndex;
		const rowColor = selected ? constants.COLOR_QUICK_OPEN_SELECTION_TEXT : color;
		const detailColor = selected ? rowColor : constants.COLOR_QUICK_OPEN_KIND;
		const matchColor = selected ? constants.COLOR_QUICK_OPEN_SELECTION_MATCH : constants.COLOR_QUICK_OPEN_MATCH;
		if (selected || index === list.hoverIndex) {
			api.fill_rect(content.left, y, content.right, y + model.rowHeight, 0,
				selected ? constants.COLOR_QUICK_OPEN_SELECTION_BACKGROUND : constants.COLOR_QUICK_OPEN_HOVER_BACKGROUND);
		}
		row.label.draw(content.left + 3, y + 1, rowColor, matchColor);
		row.description.draw(content.left + 3, y + editorViewState.lineHeight + 1, detailColor, matchColor);
		row.detail.draw((content.left + content.right) / 2, y + editorViewState.lineHeight + 1, detailColor, matchColor);
	}
	api.popClipRect();
	viewport.scrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
}
