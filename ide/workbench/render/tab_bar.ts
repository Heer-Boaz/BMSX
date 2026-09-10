import { api } from '../../runtime/overlay_api';
import * as constants from '../../common/constants';
import type { EditorTabId } from '../ui/tab/id';
import type { EditorInput } from '../ui/tab/model';
import type { RectBounds } from '../../../machine/ts/common/rect';
import { clear_rect_bounds, create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import { TAB_DIRTY_LEFT_MARGIN, TAB_DIRTY_RIGHT_MARGIN } from '../../common/constants';
import { ScratchBuffer } from '../../../machine/ts/common/scratchbuffer';
import { editorChromeState } from '../ui/chrome_state';
import { editorTabGroup } from '../ui/tab/group_model';
import type { ChromeRenderContext } from './chrome_context';
import { editorViewState } from '../../editor/ui/view/state';
import { truncateTextToWidth } from '../../editor/common/text/layout';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';

type TabMetrics = {
	text: string;
	textWidth: number;
	closeWidth: number;
	indicatorWidth: number;
	dirty: boolean;
	markerWidth: number;
	markerHeight: number;
	closable: boolean;
	tabWidth: number;
};

const createTabMetrics = (): TabMetrics => ({
	text: '',
	textWidth: 0,
	closeWidth: 0,
	indicatorWidth: 0,
	dirty: false,
	markerWidth: 0,
	markerHeight: 0,
	closable: false,
	tabWidth: 0,
});

const tabMetricsScratch = new ScratchBuffer<TabMetrics>(createTabMetrics, 8);
const tabTrack = create_rect_bounds();
let revealedGroupRevision = -1;
let revealedScrollbarRevision = -1;
const measuredLabels = new WeakMap<EditorInput, { label: string; font: BFont; availableWidth: number; text: string; width: number }>();

function getStoredTabBounds(boundsByTabId: Map<EditorTabId, RectBounds>, tab: EditorInput): RectBounds {
	let bounds = boundsByTabId.get(tab.id);
	if (!bounds) {
		bounds = create_rect_bounds();
		boundsByTabId.set(tab.id, bounds);
		tab.onWillDispose(() => boundsByTabId.delete(tab.id));
	}
	return bounds;
}

export function renderTabBar(context: ChromeRenderContext): number {
	tabMetricsScratch.clear();

	const rowHeight = context.tabBarHeight;
	const closeButtonWidth = context.measureText(constants.TAB_CLOSE_BUTTON_SYMBOL);
	const markerWidth = constants.TAB_DIRTY_MARKER_METRICS.width;
	const markerHeight = constants.TAB_DIRTY_MARKER_METRICS.height;
	const borderColor = constants.COLOR_TAB_BORDER;
	const viewportWidth = context.viewportWidth;

	const tabs = editorTabGroup.tabs;
	const tabCount = tabs.length;
	tabMetricsScratch.reserve(tabCount);
	let contentWidth = TAB_DIRTY_LEFT_MARGIN;
	let activeLeft = 0;
	let activeRight = 0;

	for (let index = 0; index < tabCount; index += 1) {
		const tab = tabs[index];
		const metric = tabMetricsScratch.get(index);
		const dirty = tab.isDirty();
		const closable = tab.closable;
		const closeWidth = closable
			? closeButtonWidth + constants.TAB_CLOSE_BUTTON_PADDING_X * 2
			: 0;
		const indicatorWidth = closable
			? closeWidth
			: (dirty ? markerWidth + constants.TAB_DIRTY_MARKER_SPACING : 0);
		const label = editorTabGroup.getLabel(tab);
		const font = editorViewState.font.renderFont();
		const availableWidth = viewportWidth - TAB_DIRTY_LEFT_MARGIN - TAB_DIRTY_RIGHT_MARGIN
			- constants.TAB_BUTTON_PADDING_X * 2 - indicatorWidth;
		let measured = measuredLabels.get(tab);
		if (measured === undefined || measured.label !== label || measured.font !== font || measured.availableWidth !== availableWidth) {
			const text = truncateTextToWidth(label, availableWidth);
			measured = { label, font, availableWidth, text, width: context.measureText(text) };
			measuredLabels.set(tab, measured);
		}
		const textWidth = measured.width;
		metric.text = measured.text;
		metric.textWidth = textWidth;
		metric.closeWidth = closeWidth;
		metric.indicatorWidth = indicatorWidth;
		metric.dirty = dirty;
		metric.markerWidth = dirty ? markerWidth : 0;
		metric.markerHeight = dirty ? markerHeight : 0;
		metric.closable = closable;
		metric.tabWidth = textWidth + constants.TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
		if (tab === editorTabGroup.activeTab) { activeLeft = contentWidth; activeRight = contentWidth + metric.tabWidth; }
		contentWidth += metric.tabWidth + constants.TAB_BUTTON_SPACING;
	}

	contentWidth += TAB_DIRTY_RIGHT_MARGIN;
	const barTop = context.headerHeight;
	const rowBottom = barTop + rowHeight;
	const totalHeight = rowHeight + (contentWidth > viewportWidth ? constants.SCROLLBAR_WIDTH : 0);
	const barBottom = barTop + totalHeight;
	write_rect_bounds(editorChromeState.tabBarBounds, 0, barTop, viewportWidth, barBottom);
	write_rect_bounds(tabTrack, 0, rowBottom, viewportWidth, barBottom);
	const scrollbar = editorChromeState.tabScrollbar;
	scrollbar.layout(tabTrack, contentWidth, viewportWidth, scrollbar.getScroll());
	editorChromeState.tabScrollControl.update();
	if (revealedGroupRevision !== editorTabGroup.revision || revealedScrollbarRevision !== scrollbar.revision) {
		if (!editorChromeState.tabDragState?.hasDragged) scrollbar.reveal(activeLeft, activeRight);
		revealedGroupRevision = editorTabGroup.revision;
		revealedScrollbarRevision = scrollbar.revision;
	}
	api.fill_rect(0, barTop, viewportWidth, barBottom, 0, constants.COLOR_TAB_BAR_BACKGROUND);
	api.pushClipRect(0, barTop, viewportWidth, rowBottom);
	let cursor = TAB_DIRTY_LEFT_MARGIN - Math.round(scrollbar.getScroll());
	for (let index = 0; index < tabCount; index += 1) {
		const entry = tabMetricsScratch.peek(index);
		const tab = tabs[index];
		const left = cursor;
		const right = left + entry.tabWidth;
		const bounds = getStoredTabBounds(editorChromeState.tabButtonBounds, tab);
		write_rect_bounds(bounds, left, barTop + 1, right, rowBottom - 1);
		const closeBounds = getStoredTabBounds(editorChromeState.tabCloseButtonBounds, tab);
		cursor = right + constants.TAB_BUTTON_SPACING;
		if (right <= 0 || left >= viewportWidth) {
			clear_rect_bounds(closeBounds);
			continue;
		}

		const active = editorTabGroup.activeTab === tab;
		const fillColor = active ? constants.COLOR_TAB_ACTIVE_BACKGROUND : constants.COLOR_TAB_INACTIVE_BACKGROUND;
		const textColor = active ? constants.COLOR_TAB_ACTIVE_TEXT : constants.COLOR_TAB_INACTIVE_TEXT;

		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, fillColor);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, borderColor);

		const textX = bounds.left + constants.TAB_BUTTON_PADDING_X;
		const textY = bounds.top + constants.TAB_BUTTON_PADDING_Y;
		context.drawText(entry.text, textX, textY, 0, textColor);

		const indicatorLeft = bounds.right - entry.indicatorWidth;
		const indicatorWidth = entry.indicatorWidth;
		const hovered = tab.id === editorChromeState.tabHoverId;

		if (entry.closable) {
			write_rect_bounds(closeBounds, bounds.right - entry.closeWidth, bounds.top, bounds.right, bounds.bottom);
			if (hovered) {
				const closeX = closeBounds.left + constants.TAB_CLOSE_BUTTON_PADDING_X;
				const closeY = closeBounds.top + constants.TAB_CLOSE_BUTTON_PADDING_Y;
				context.drawText(constants.TAB_CLOSE_BUTTON_SYMBOL, closeX, closeY, 0, textColor);
			} else {
				clear_rect_bounds(closeBounds);
				if (entry.dirty && entry.markerWidth > 0) {
					const markerLeft = bounds.right - entry.closeWidth;
					const markerX = markerLeft + ((entry.closeWidth - entry.markerWidth) >> 1);
					const markerY = centeredDirtyMarkerTop(bounds, entry.markerHeight);
					drawDirtyMarker(markerX, markerY, entry.markerWidth, entry.markerHeight);
				}
			}
		} else {
			clear_rect_bounds(closeBounds);
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
	return totalHeight;
}

function centeredDirtyMarkerTop(bounds: RectBounds, markerHeight: number): number {
	return bounds.top + ((bounds.bottom - bounds.top - markerHeight) >> 1);
}

function drawDirtyMarker(left: number, top: number, width: number, height: number): void {
	api.fill_rect(left, top, left + width - 1, top + height - 1, 0, constants.COLOR_TAB_DIRTY_MARKER);
}
