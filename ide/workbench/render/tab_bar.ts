import { api } from '../../runtime/overlay_api';
import * as constants from '../../common/constants';
import type { RectBounds } from '../../../machine/ts/common/rect';
import { editorChromeState } from '../ui/chrome_state';
import { tabBarItems } from '../ui/tab/layout';
import type { ChromeRenderContext } from './chrome_context';

/** Painting consumes the published strip; it never reveals tabs or changes hit geometry. */
export function renderTabBar(context: ChromeRenderContext): void {
	const { top: barTop, bottom: barBottom, right: viewportWidth } = editorChromeState.tabBarBounds;
	const rowBottom = barTop + context.tabBarHeight;
	const borderColor = constants.COLOR_TAB_BORDER;
	const scrollbar = editorChromeState.tabScrollbar;
	api.fill_rect(0, barTop, viewportWidth, barBottom, 0, constants.COLOR_TAB_BAR_BACKGROUND);
	api.pushClipRect(0, barTop, viewportWidth, rowBottom);
	for (let index = 0; index < tabBarItems.length; index++) {
		const entry = tabBarItems.peek(index), { bounds, closeBounds } = entry;
		if (bounds.right <= 0 || bounds.left >= viewportWidth) continue;
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

	}
	const drag = editorChromeState.tabDragState;
	if (drag !== null && drag.targetIndex >= 0) {
		const x = drag.markerX - Math.round(scrollbar.getScroll());
		api.fill_rect(x - 1, barTop, x + 1, rowBottom, 0, constants.COLOR_TAB_ACTIVE_TEXT);
	}
	api.popClipRect();
	if (scrollbar.isVisible()) scrollbar.draw(constants.COLOR_TAB_BAR_BACKGROUND, constants.COLOR_TAB_BORDER);
}

function centeredDirtyMarkerTop(bounds: RectBounds, markerHeight: number): number {
	return bounds.top + ((bounds.bottom - bounds.top - markerHeight) >> 1);
}

function drawDirtyMarker(left: number, top: number, width: number, height: number): void {
	api.fill_rect(left, top, left + width - 1, top + height - 1, 0, constants.COLOR_TAB_DIRTY_MARKER);
}
