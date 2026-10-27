import { api } from '../../runtime/overlay_api';
import * as constants from '../../common/constants';
import type { RectBounds } from '../../../machine/ts/common/rect';
import type { EditorTabStrip } from '../ui/tab/control';
import { renderWorkbenchActionBar } from './action_bar';

export type EditorTabStripRenderContext = {
	drawText(text: string, x: number, y: number, z: number, color: number): void;
};

/** Painting consumes the published strip; it never reveals tabs or changes hit geometry. */
export function renderTabBar(strip: EditorTabStrip, context: EditorTabStripRenderContext): void {
	const layout = strip.layoutState;
	const { left: stripLeft, top: barTop, bottom: barBottom, right: stripRight } = layout.bounds;
	const rowBottom = barTop + layout.rowHeight;
	const borderColor = constants.COLOR_TAB_BORDER;
	const scrollbar = strip.scrollbar;
	api.fill_rect(stripLeft, barTop, stripRight, barBottom, 0, constants.COLOR_TAB_BAR_BACKGROUND);
	const tabsRight = layout.viewportBounds.right;
	api.pushClipRect(layout.viewportBounds.left, barTop, tabsRight, rowBottom);
	for (let index = 0; index < layout.items.length; index++) {
		const entry = layout.items.peek(index), { bounds, closeBounds } = entry;
		if (bounds.right <= layout.viewportBounds.left || bounds.left >= tabsRight) continue;
		const active = entry.active;
		const fillColor = active ? constants.COLOR_TAB_ACTIVE_BACKGROUND : constants.COLOR_TAB_INACTIVE_BACKGROUND;
		const textColor = active ? constants.COLOR_TAB_ACTIVE_TEXT : constants.COLOR_TAB_INACTIVE_TEXT;

		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, fillColor);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, borderColor);

		const textX = bounds.left + constants.TAB_BUTTON_PADDING_X;
		const textY = bounds.top + constants.TAB_BUTTON_PADDING_Y;
		context.drawText(entry.text, textX, textY, 0, textColor);

		const indicatorLeft = bounds.right - entry.indicatorWidth;
		const indicatorWidth = entry.indicatorWidth;
		const hovered = entry.hovered;

		if (entry.closable) {
			if (hovered) {
				const closeX = closeBounds.left + constants.TAB_CLOSE_BUTTON_PADDING_X;
				const closeY = closeBounds.top + constants.TAB_CLOSE_BUTTON_PADDING_Y;
				context.drawText(constants.TAB_CLOSE_BUTTON_SYMBOL, closeX, closeY, 0, textColor);
			} else {
				if (entry.dirty && entry.markerWidth > 0) {
					const markerLeft = bounds.right - entry.closeWidth;
					const markerX = markerLeft + ((entry.closeWidth - entry.markerWidth) >> 1);
					const markerY = centeredDirtyMarkerTop(bounds, entry.markerHeight);
					drawDirtyMarker(markerX, markerY, entry.markerWidth, entry.markerHeight);
				}
			}
		} else {
			if (entry.dirty && entry.markerWidth > 0) {
				const spacing = constants.TAB_DIRTY_MARKER_SPACING;
				const markerX = indicatorWidth > 0
					? indicatorLeft + ((indicatorWidth - entry.markerWidth) >> 1)
					: bounds.right - entry.markerWidth - spacing;
				const markerY = centeredDirtyMarkerTop(bounds, entry.markerHeight);
				drawDirtyMarker(markerX, markerY, entry.markerWidth, entry.markerHeight);
			}
		}

		if (active) {
			api.fill_rect(bounds.left, bounds.bottom - 1, bounds.right, bounds.bottom, 0, fillColor);
		}
		if (entry.focused) api.blit_rect(bounds.left + 1, bounds.top + 1, bounds.right - 1, bounds.bottom - 1,
			0, constants.COLOR_FOCUS_BORDER);

	}
	api.popClipRect();
	renderWorkbenchActionBar(strip.actions, layout.font, constants.COLOR_STATUS_TEXT, constants.COLOR_HEADER_BUTTON_TEXT_DISABLED);
	if (scrollbar.isVisible()) scrollbar.draw(constants.COLOR_TAB_BAR_BACKGROUND, constants.COLOR_TAB_BORDER);
}

function centeredDirtyMarkerTop(bounds: RectBounds, markerHeight: number): number {
	return bounds.top + ((bounds.bottom - bounds.top - markerHeight) >> 1);
}

function drawDirtyMarker(left: number, top: number, width: number, height: number): void {
	api.fill_rect(left, top, left + width - 1, top + height - 1, 0, constants.COLOR_TAB_DIRTY_MARKER);
}
