import type { OverlayApi as Api } from '../../overlay_api';
import * as constants from '../constants';
import type { EditorTabDescriptor } from '../types';
import type { RectBounds } from '../../../rompack/rompack';
import { TAB_DIRTY_LEFT_MARGIN, TAB_DIRTY_RIGHT_MARGIN } from '../constants';

type TabMetrics = {
	tab: EditorTabDescriptor;
	textWidth: number;
	closeWidth: number;
	indicatorWidth: number;
	dirty: boolean;
	markerMetrics: { width: number; height: number };
	closable: boolean;
	tabWidth: number;
};

type LayoutEntry = TabMetrics & {
	left: number;
	right: number;
	rowIndex: number;
};

export interface TabBarHost {
	viewportWidth: number;
	headerHeight: number;
	rowHeight: number;
	lineHeight: number;
	tabs: EditorTabDescriptor[];
	activeTabId: string;
	tabHoverId: string;
	measureText: (text: string) => number;
	drawText: (text: string, x: number, y: number, color: number) => void;
	getDirtyMarkerMetrics: () => { width: number; height: number };
	tabButtonBounds: Map<string, RectBounds>;
	tabCloseButtonBounds: Map<string, RectBounds>;
}

export function renderTabBar(api: Api, host: TabBarHost): number {
	host.tabButtonBounds.clear();
	host.tabCloseButtonBounds.clear();

	const rowHeight = Math.max(1, host.rowHeight);
	let markerMetricsCache: { width: number; height: number } = null;
	const resolveMarkerMetrics = (): { width: number; height: number } => {
		if (!markerMetricsCache) {
			markerMetricsCache = host.getDirtyMarkerMetrics();
		}
		return markerMetricsCache;
	};

	const metrics: TabMetrics[] = host.tabs.map((tab) => {
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
		return {
			tab,
			textWidth,
			closeWidth,
			indicatorWidth,
			dirty,
			markerMetrics,
			closable,
			tabWidth,
		};
	});

	const rowHeightTotal = rowHeight;
	if (metrics.length === 0) {
		const barTop = host.headerHeight;
		const barBottom = barTop + rowHeightTotal;
		api.fill_rect(0, barTop, host.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BAR_BACKGROUND);
		api.fill_rect(0, Math.max(barTop, barBottom - 1), host.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BORDER);
		return 1;
	}

	const n = metrics.length;
	const spacing = constants.TAB_BUTTON_SPACING;
	const maxWidth = Math.max(TAB_DIRTY_LEFT_MARGIN + TAB_DIRTY_RIGHT_MARGIN + 1, host.viewportWidth - TAB_DIRTY_RIGHT_MARGIN);
	const costs: number[] = new Array(n + 1).fill(0);
	const nextBreak: number[] = new Array(n).fill(n);

	for (let i = n - 1; i >= 0; i -= 1) {
		let bestRows = Number.POSITIVE_INFINITY;
		let bestPenalty = Number.POSITIVE_INFINITY;
		let bestBreak = i + 1;
		let cursor = TAB_DIRTY_LEFT_MARGIN;
		for (let j = i; j < n; j += 1) {
			const entry = metrics[j];
			const candidateRight = cursor + entry.tabWidth;
			if (cursor > TAB_DIRTY_LEFT_MARGIN && candidateRight > maxWidth) {
				break;
			}
			const fits = candidateRight <= maxWidth || cursor === TAB_DIRTY_LEFT_MARGIN;
			if (!fits) {
				break;
			}
			const rows = 1 + costs[j + 1];
			const usedWidth = candidateRight;
			const leftover = Math.max(0, maxWidth - usedWidth);
			const penalty = leftover * leftover;
			if (rows < bestRows || (rows === bestRows && penalty < bestPenalty)) {
				bestRows = rows;
				bestPenalty = penalty;
				bestBreak = j + 1;
			}
			cursor = candidateRight + spacing;
		}
		if (!Number.isFinite(bestRows)) {
			bestRows = 1 + costs[i + 1];
			bestBreak = Math.min(n, i + 1);
		}
		costs[i] = bestRows;
		nextBreak[i] = Math.min(n, bestBreak);
	}

	const layout: LayoutEntry[] = [];
	let rowStart = 0;
	let rowIndex = 0;
	while (rowStart < n) {
		const rowEnd = Math.max(rowStart + 1, nextBreak[rowStart] ?? rowStart + 1);
		let cursor = TAB_DIRTY_LEFT_MARGIN;
		for (let i = rowStart; i < rowEnd; i += 1) {
			const entry = metrics[i];
			const left = cursor;
			const right = left + entry.tabWidth;
			layout.push({
				...entry,
				left,
				right,
				rowIndex,
			});
			cursor = right + spacing;
		}
		rowStart = rowEnd;
		rowIndex += 1;
	}

	const totalRows = Math.max(rowIndex, 1);
	const barTop = host.headerHeight;
	const totalHeight = totalRows * rowHeightTotal;
	const barBottom = barTop + totalHeight;

	api.fill_rect(0, barTop, host.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BAR_BACKGROUND);
	api.fill_rect(0, Math.max(barTop, barBottom - 1), host.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BORDER);

	if (layout.length === 0) {
		return totalRows;
	}

	for (const entry of layout) {
		const tab = entry.tab;
		const rowTop = barTop + entry.rowIndex * rowHeightTotal;
		const boundsTop = rowTop + 1;
		const boundsBottom = rowTop + rowHeightTotal - 1;
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

		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, undefined, fillColor);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, undefined, constants.COLOR_TAB_BORDER);

		const textX = bounds.left + constants.TAB_BUTTON_PADDING_X;
		const textY = bounds.top + constants.TAB_BUTTON_PADDING_Y;
		host.drawText(tab.title, textX, textY, textColor);

		const indicatorLeft = bounds.right - entry.indicatorWidth;
		const indicatorWidth = entry.indicatorWidth;
		const hovered = tab.id === host.tabHoverId;

		if (entry.closable) {
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
				host.drawText(constants.TAB_CLOSE_BUTTON_SYMBOL, closeX, closeY, textColor);
			} else {
				host.tabCloseButtonBounds.delete(tab.id);
				if (entry.dirty && entry.markerMetrics) {
					const markerX = closeBounds.left + Math.floor((entry.closeWidth - entry.markerMetrics.width) / 2);
					const markerY = bounds.top + Math.floor((bounds.bottom - bounds.top - entry.markerMetrics.height) / 2);
					const markerRight = markerX + entry.markerMetrics.width - 1;
					const markerBottom = markerY + entry.markerMetrics.height - 1;
					api.fill_rect(markerX, markerY, markerRight, markerBottom, undefined, constants.COLOR_TAB_DIRTY_MARKER);
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
				const markerRight = markerX + entry.markerMetrics.width - 1;
				const markerBottom = markerY + entry.markerMetrics.height - 1;
				api.fill_rect(markerX, markerY, markerRight, markerBottom, undefined, constants.COLOR_TAB_DIRTY_MARKER);
			}
		}

		if (active) {
			api.fill_rect(bounds.left, bounds.bottom - 1, bounds.right, bounds.bottom, undefined, fillColor);
		}
	}

	return totalRows;
}
