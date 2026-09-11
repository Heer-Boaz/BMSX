import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import { INSPECTOR_PADDING, type InspectedProperty } from '../ui/property_inspector/model';
import type { WorkbenchPropertyInspector } from '../ui/property_inspector/control';
import { renderWorkbenchActionBar } from './action_bar';

/** Visible rows consume retained wrapped text; no provider/source queries while drawing. */
export function drawWorkbenchPropertyInspector<Element extends InspectedProperty>(inspector: WorkbenchPropertyInspector<Element>): void {
	const { model, bounds } = inspector;
	const font = model.font!;
	const view = model.viewport;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	api.fill_rect(bounds.left, bounds.top, bounds.right, view.bounds.top, 0, colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
	api.blit_text_inline_with_font(inspector.title, bounds.left + 4, bounds.top + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
	renderWorkbenchActionBar(inspector.actionBar, inspector, font);
	api.pushClipRect(view.bounds.left, view.bounds.top, view.bounds.right, view.bounds.bottom);
	const offset = view.offsetTop;
	for (let index = Math.max(0, model.rowAt(view.bounds.top)); index < model.rows.length; index += 1) {
		const row = model.rows[index];
		const top = offset + row.top, bottom = offset + row.bottom;
		if (bottom < view.bounds.top) continue;
		if (top >= view.bounds.bottom) break;
		const selected = index === model.selectionIndex;
		const labelBottom = top + row.label.length * font.lineHeight + INSPECTOR_PADDING * 2;
		api.fill_rect(view.bounds.left, top, view.bounds.right, labelBottom, 0, colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
		if (selected || index === model.hoverIndex) api.fill_rect(view.bounds.left, top, view.bounds.right, labelBottom, 0,
			selected ? colors.SELECTION_OVERLAY : colors.HIGHLIGHT_OVERLAY);
		let y = top + INSPECTOR_PADDING;
		for (const field of FIELDS) {
			const lines = row[field];
			if (lines.length === 0) continue;
			const color = field === 'label' && selected ? colors.COLOR_SELECTION_TEXT
				: field === 'description' ? colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM
					: row.element.warning ? colors.COLOR_STATUS_WARNING : colors.COLOR_RESOURCE_VIEWER_TEXT;
			const first = Math.max(0, Math.trunc((view.bounds.top - y) / font.lineHeight));
			const end = Math.min(lines.length, Math.trunc((view.bounds.bottom - y + font.lineHeight - 1) / font.lineHeight));
			for (let line = first; line < end; line += 1)
				api.blit_text_inline_with_font(lines[line], view.bounds.left + INSPECTOR_PADDING, y + line * font.lineHeight, 0, color, font);
			y += lines.length * font.lineHeight + INSPECTOR_PADDING;
		}
		api.fill_rect(view.bounds.left, bottom - 1, view.bounds.right, bottom, 0, colors.COLOR_TAB_BORDER);
	}
	api.popClipRect();
	view.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
}

const FIELDS = ['label', 'value', 'description'] as const;
