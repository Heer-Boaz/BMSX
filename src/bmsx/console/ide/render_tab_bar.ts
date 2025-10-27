import { BmsxConsoleApi } from '../api';
import * as constants from './constants';
import type { EditorTabDescriptor, RectBounds } from './types';

export interface TabBarHost {
	viewportWidth: number;
	headerHeight: number;
	rowHeight: number;
	lineHeight: number;
	tabs: EditorTabDescriptor[];
	activeTabId: string | null;
	tabHoverId: string | null;
	measureText: (text: string) => number;
	drawText: (api: BmsxConsoleApi, text: string, x: number, y: number, color: number) => void;
	getDirtyMarkerMetrics: () => { width: number; height: number };
	tabDirtyMarkerAssetId: string;
	tabButtonBounds: Map<string, RectBounds>;
	tabCloseButtonBounds: Map<string, RectBounds>;
}

type LayoutEntry = {
	tab: EditorTabDescriptor;
	left: number;
	right: number;
	rowIndex: number;
	textWidth: number;
	closeWidth: number;
	indicatorWidth: number;
	dirty: boolean;
	markerMetrics: { width: number; height: number } | null;
};

const LEFT_MARGIN = 4;
const RIGHT_MARGIN = 4;

export function renderTabBar(api: BmsxConsoleApi, host: TabBarHost): number {
	host.tabButtonBounds.clear();
	host.tabCloseButtonBounds.clear();

	const rowHeight = Math.max(1, host.rowHeight);
	const layout: LayoutEntry[] = [];

	let markerMetricsCache: { width: number; height: number } | null = null;
	const resolveMarkerMetrics = (): { width: number; height: number } => {
		if (!markerMetricsCache) {
			markerMetricsCache = host.getDirtyMarkerMetrics();
		}
		return markerMetricsCache;
	};

	let cursorX = LEFT_MARGIN;
	let currentRow = 0;
	let maxRowIndex = 0;

	for (let index = 0; index < host.tabs.length; index += 1) {
		const tab = host.tabs[index];
		const textWidth = host.measureText(tab.title);
		const dirty = tab.dirty === true;
		const closable = tab.closable === true;
		const closeWidth = closable
			? host.measureText(constants.TAB_CLOSE_BUTTON_SYMBOL) + constants.TAB_CLOSE_BUTTON_PADDING_X * 2
			: 0;
		const markerMetrics = dirty ? resolveMarkerMetrics() : null;
		let indicatorWidth = 0;
		if (closable) {
			indicatorWidth = closeWidth;
		} else if (markerMetrics) {
			indicatorWidth = markerMetrics.width + constants.TAB_DIRTY_MARKER_SPACING;
		}
		const tabWidth = textWidth + constants.TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
		const rowWrapThreshold = host.viewportWidth - RIGHT_MARGIN;
		if (cursorX > LEFT_MARGIN && cursorX + tabWidth > rowWrapThreshold) {
			currentRow += 1;
			cursorX = LEFT_MARGIN;
		}
		const left = cursorX;
		const right = left + tabWidth;
		layout.push({
			tab,
			left,
			right,
			rowIndex: currentRow,
			textWidth,
			closeWidth,
			indicatorWidth,
			dirty,
			markerMetrics,
		});
		cursorX = right + constants.TAB_BUTTON_SPACING;
		if (currentRow > maxRowIndex) {
			maxRowIndex = currentRow;
		}
	}

	const totalRows = Math.max(maxRowIndex + 1, 1);
	const barTop = host.headerHeight;
	const totalHeight = totalRows * rowHeight;
	const barBottom = barTop + totalHeight;

	api.rectfill(0, barTop, host.viewportWidth, barBottom, constants.COLOR_TAB_BAR_BACKGROUND);
	for (let row = 1; row < totalRows; row += 1) {
		const separatorTop = barTop + row * rowHeight;
		api.rectfill(0, separatorTop, host.viewportWidth, separatorTop + 1, constants.COLOR_TAB_BORDER);
	}
	api.rectfill(0, Math.max(barTop, barBottom - 1), host.viewportWidth, barBottom, constants.COLOR_TAB_BORDER);

	if (layout.length === 0) {
		return totalRows;
	}

	for (const entry of layout) {
		const tab = entry.tab;
		const rowTop = barTop + entry.rowIndex * rowHeight;
		const boundsTop = rowTop + 1;
		const boundsBottom = rowTop + rowHeight - 1;
		const bounds: RectBounds = {
			left: entry.left,
			top: boundsTop,
			right: entry.right,
			bottom: boundsBottom,
		};
		host.tabButtonBounds.set(tab.id, bounds);

		const active = host.activeTabId === tab.id;
		const fillColor = active ? constants.COLOR_TAB_ACTIVE_BACKGROUND : constants.COLOR_TAB_INACTIVE_BACKGROUND;
		const textColor = active ? constants.COLOR_TAB_ACTIVE_TEXT : constants.COLOR_TAB_INACTIVE_TEXT;

		api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, fillColor);
		api.rect(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_TAB_BORDER);

		const textX = bounds.left + constants.TAB_BUTTON_PADDING_X;
		const textY = bounds.top + constants.TAB_BUTTON_PADDING_Y;
		host.drawText(api, tab.title, textX, textY, textColor);

		const indicatorLeft = bounds.right - entry.indicatorWidth;
		const indicatorWidth = entry.indicatorWidth;
		const hovered = tab.id === host.tabHoverId;

		if (tab.closable) {
			const closeBounds: RectBounds = {
				left: bounds.right - entry.closeWidth,
				top: bounds.top,
				right: bounds.right,
				bottom: bounds.bottom,
			};
			if (hovered) {
				host.tabCloseButtonBounds.set(tab.id, closeBounds);
				const closeX = closeBounds.left + constants.TAB_CLOSE_BUTTON_PADDING_X;
				const closeY = closeBounds.top + constants.TAB_CLOSE_BUTTON_PADDING_Y;
				host.drawText(api, constants.TAB_CLOSE_BUTTON_SYMBOL, closeX, closeY, textColor);
			} else {
				host.tabCloseButtonBounds.delete(tab.id);
				if (entry.dirty && entry.markerMetrics) {
					const markerX = closeBounds.left + Math.floor((entry.closeWidth - entry.markerMetrics.width) / 2);
					const markerY = bounds.top + Math.floor((bounds.bottom - bounds.top - entry.markerMetrics.height) / 2);
					api.spr(host.tabDirtyMarkerAssetId, markerX, markerY);
				}
			}
		} else {
			host.tabCloseButtonBounds.delete(tab.id);
			if (entry.dirty && entry.markerMetrics) {
				const spacing = Math.max(0, constants.TAB_DIRTY_MARKER_SPACING);
				const markerX = indicatorWidth > 0
					? indicatorLeft + Math.floor(Math.max(0, (indicatorWidth - entry.markerMetrics.width) / 2))
					: bounds.right - entry.markerMetrics.width - spacing;
				const markerY = bounds.top + Math.floor((bounds.bottom - bounds.top - entry.markerMetrics.height) / 2);
				api.spr(host.tabDirtyMarkerAssetId, markerX, markerY);
			}
		}

		if (active) {
			api.rectfill(bounds.left, bounds.bottom - 1, bounds.right, bounds.bottom, fillColor);
		}
	}

	return totalRows;
}
