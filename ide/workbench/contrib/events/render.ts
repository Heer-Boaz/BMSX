import * as colors from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { EventViewerInput } from './editor_input';
import type { EventViewerPresentation } from './presentation';

export function drawEventViewer(input: EventViewerInput, view: EventViewerPresentation, focused: boolean): void {
	const { layout, viewport } = input, font = layout.font!.renderFont();
	api.pushClipRect(layout.left, layout.top, layout.right, layout.bottom);
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	renderWorkbenchActionBar(input.actions, font, colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
	if (!layout.compact) {
		api.blit_text_inline_with_font('Event / Emitter', layout.eventLeft, layout.headerTop, 0, colors.COLOR_DESCRIPTION_TEXT, font);
		api.blit_text_inline_with_font('Timeline', layout.timelineLeft, layout.headerTop, 0, colors.COLOR_DESCRIPTION_TEXT, font);
		api.blit_text_inline_with_font('Tick', layout.tickLeft, layout.headerTop, 0, colors.COLOR_DESCRIPTION_TEXT, font);
	}
	api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
	if (input.projection.rows.length === 0) for (let index = 0; index < view.emptyLines.length; index++)
		api.blit_text_inline_with_font(view.emptyLines[index], viewport.bounds.left, viewport.bounds.top + 4 + index * layout.rowHeight,
			0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
	for (const row of view.rows) {
		const selected = row.index === input.selected;
		if (selected) api.fill_rect(viewport.bounds.left, row.top, viewport.bounds.right, row.top + layout.rowHeight, 0,
			focused ? colors.SELECTION_OVERLAY : colors.INACTIVE_SELECTION_OVERLAY);
		const color = selected ? focused ? colors.COLOR_SELECTION_TEXT : colors.COLOR_INACTIVE_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT;
		api.blit_text_inline_with_font(row.label.event, layout.eventLeft, row.top, 0, color, font);
		if (!layout.compact) {
			api.blit_text_inline_with_font(row.label.timeline, layout.timelineLeft, row.top, 0, color, font);
			api.blit_text_inline_with_font(row.label.tick, layout.tickLeft, row.top, 0, color, font);
		}
	}
	api.popClipRect();
	viewport.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	api.popClipRect();
}
