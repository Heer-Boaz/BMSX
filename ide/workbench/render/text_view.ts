import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import type { EditorFont } from '../../editor/ui/view/font';
import { TEXT_VIEW_PADDING } from '../ui/text_view/layout';
import type { WorkbenchTextViewModel } from '../ui/text_view/model';

/** Only visible retained glyph ranges are submitted; painting never reads or wraps a document. */
export function drawWorkbenchTextView(model: WorkbenchTextViewModel, font: EditorFont, focused: boolean): void {
	const view = model.viewport, bounds = view.bounds, rows = model.projection.rows, height = model.rowHeight;
	api.fill_rect(bounds.left, bounds.top, view.scrollbar.getTrack().right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	const first = Math.max(0, Math.trunc((view.scrollTop - TEXT_VIEW_PADDING) / height));
	const left = bounds.left + TEXT_VIEW_PADDING, bitmap = font.renderFont();
	for (let index = first; index < rows.length; index++) {
		const y = view.offsetTop + TEXT_VIEW_PADDING + index * height;
		if (y >= bounds.bottom) break;
		const row = rows[index], line = row.line, origin = line.advances[row.start];
		api.blit_text_inline_span_with_font(line.display, row.start, row.end, left, y, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, bitmap);
		for (let matchIndex = model.firstMatchAt(row.sourceStart); matchIndex < model.matches.length; matchIndex++) {
			const match = model.matches[matchIndex];
			if (match.start > row.sourceEnd) break;
			const start = Math.max(row.start, model.projection.displayAt(line, match.start));
			const end = Math.min(row.end, model.projection.displayAt(line, match.end));
			if (end <= start) continue;
			const x = left + line.advances[start] - origin;
			api.fill_rect(x, y, left + line.advances[end] - origin, y + height, 0, colors.COLOR_RESOURCE_MATCH_BACKGROUND);
			api.blit_text_inline_span_with_font(line.display, start, end, x, y, 0, colors.COLOR_RESOURCE_MATCH_TEXT, bitmap);
		}
		if (model.selectionStart !== model.selectionEnd) {
			const start = Math.max(row.start, model.projection.displayAt(line, model.selectionStart));
			const end = Math.min(row.end, model.projection.displayAt(line, model.selectionEnd));
			const newline = row.end === line.display.length && line.breakEnd > line.end
				&& model.selectionStart <= line.end && model.selectionEnd > line.end;
			if (end > start || newline) {
				const x = left + line.advances[start] - origin;
				api.fill_rect(x, y, newline ? bounds.right : left + line.advances[end] - origin, y + height, 0, colors.SELECTION_OVERLAY);
				if (end > start) api.blit_text_inline_span_with_font(line.display, start, end, x, y, 0, colors.COLOR_SELECTION_TEXT, bitmap);
			}
		}
	}
	if (focused && model.selectionStart === model.selectionEnd && rows.length !== 0) {
		const index = model.projection.rowAtOffset(model.cursorOffset), row = rows[index];
		const y = view.offsetTop + TEXT_VIEW_PADDING + index * height;
		if (y + height > bounds.top && y < bounds.bottom) {
			const x = left + row.line.advances[model.projection.displayAt(row.line, model.cursorOffset)] - row.line.advances[row.start];
			api.fill_rect(x, y, x + 1, y + height, 0, colors.COLOR_FOCUS_BORDER);
		}
	}
	api.popClipRect();
	view.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
}
