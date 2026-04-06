import type { OverlayApi as Api } from '../../overlay_api';
import * as constants from '../constants';
import type { EditorTabDescriptor } from '../types';
import type { RectBounds } from '../../../rompack/rompack';
import { TAB_DIRTY_LEFT_MARGIN, TAB_DIRTY_RIGHT_MARGIN } from '../constants';
import { ScratchBuffer } from '../../../utils/scratchbuffer';

type TabMetrics = {
	tab: EditorTabDescriptor;
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
	tab: null,
	textWidth: 0,
	closeWidth: 0,
	indicatorWidth: 0,
	dirty: false,
	markerWidth: 0,
	markerHeight: 0,
	closable: false,
	tabWidth: 0,
});

const createRectBounds = (): RectBounds => ({
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
});

const createNumber = (): number => 0;

const tabMetricsScratch = new ScratchBuffer<TabMetrics>(createTabMetrics, 8);
const tabBoundsScratch = new ScratchBuffer<RectBounds>(createRectBounds, 8);
const closeBoundsScratch = new ScratchBuffer<RectBounds>(createRectBounds, 8);
const costsScratch = new ScratchBuffer<number>(createNumber, 8);
const nextBreakScratch = new ScratchBuffer<number>(createNumber, 8);

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
	tabMetricsScratch.clear();
	tabBoundsScratch.clear();
	closeBoundsScratch.clear();
	costsScratch.clear();
	nextBreakScratch.clear();
	host.tabButtonBounds.clear();
	host.tabCloseButtonBounds.clear();

	const rowHeight = Math.max(1, host.rowHeight);
	const closeButtonWidth = host.measureText(constants.TAB_CLOSE_BUTTON_SYMBOL);
	const markerMetrics = host.getDirtyMarkerMetrics();
	const markerWidth = markerMetrics.width;
	const markerHeight = markerMetrics.height;

	const tabs = host.tabs;
	const tabCount = tabs.length;
	const rowHeightTotal = rowHeight;
	if (tabCount === 0) {
		const barTop = host.headerHeight;
		const barBottom = barTop + rowHeightTotal;
		api.fill_rect(0, barTop, host.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BAR_BACKGROUND);
		api.fill_rect(0, Math.max(barTop, barBottom - 1), host.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BORDER);
		return 1;
	}

	tabMetricsScratch.reserve(tabCount);
	tabBoundsScratch.reserve(tabCount);
	closeBoundsScratch.reserve(tabCount);
	costsScratch.reserve(tabCount + 1);
	nextBreakScratch.reserve(tabCount);

	for (let index = 0; index < tabCount; index += 1) {
		const tab = tabs[index];
		const metric = tabMetricsScratch.get(index);
		const textWidth = host.measureText(tab.title);
		const dirty = tab.dirty === true;
		const closable = tab.closable === true;
		const closeWidth = closable
			? closeButtonWidth + constants.TAB_CLOSE_BUTTON_PADDING_X * 2
			: 0;
		const indicatorWidth = closable
			? closeWidth
			: (dirty ? markerWidth + constants.TAB_DIRTY_MARKER_SPACING : 0);
		metric.tab = tab;
		metric.textWidth = textWidth;
		metric.closeWidth = closeWidth;
		metric.indicatorWidth = indicatorWidth;
		metric.dirty = dirty;
		metric.markerWidth = dirty ? markerWidth : 0;
		metric.markerHeight = dirty ? markerHeight : 0;
		metric.closable = closable;
		metric.tabWidth = textWidth + constants.TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
	}

	const n = tabCount;
	const spacing = constants.TAB_BUTTON_SPACING;
	const maxWidth = Math.max(TAB_DIRTY_LEFT_MARGIN + TAB_DIRTY_RIGHT_MARGIN + 1, host.viewportWidth - TAB_DIRTY_RIGHT_MARGIN);
	const costs = costsScratch;
	const nextBreak = nextBreakScratch;
	costs.set(n, 0);

	for (let i = n - 1; i >= 0; i -= 1) {
		let bestRows = Number.POSITIVE_INFINITY;
		let bestPenalty = Number.POSITIVE_INFINITY;
		let bestBreak = i + 1;
		let cursor = TAB_DIRTY_LEFT_MARGIN;
		for (let j = i; j < n; j += 1) {
			const entry = tabMetricsScratch.peek(j);
			const candidateRight = cursor + entry.tabWidth;
			if (cursor > TAB_DIRTY_LEFT_MARGIN && candidateRight > maxWidth) {
				break;
			}
			const fits = candidateRight <= maxWidth || cursor === TAB_DIRTY_LEFT_MARGIN;
			if (!fits) {
				break;
			}
			const rows = 1 + costs.peek(j + 1);
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
			bestRows = 1 + costs.peek(i + 1);
			bestBreak = Math.min(n, i + 1);
		}
		costs.set(i, bestRows);
		nextBreak.set(i, Math.min(n, bestBreak));
	}

	const totalRows = Math.max(costs.peek(0) ?? 0, 1);
	const barTop = host.headerHeight;
	const totalHeight = totalRows * rowHeightTotal;
	const barBottom = barTop + totalHeight;

	api.fill_rect(0, barTop, host.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BAR_BACKGROUND);
	api.fill_rect(0, Math.max(barTop, barBottom - 1), host.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BORDER);

	let rowStart = 0;
	let rowIndex = 0;
	while (rowStart < n) {
		const rowEnd = Math.max(rowStart + 1, nextBreak.peek(rowStart) ?? rowStart + 1);
		let cursor = TAB_DIRTY_LEFT_MARGIN;
		const rowTop = barTop + rowIndex * rowHeightTotal;
		const boundsTop = rowTop + 1;
		const boundsBottom = rowTop + rowHeightTotal - 1;
		for (let i = rowStart; i < rowEnd; i += 1) {
			const entry = tabMetricsScratch.peek(i);
			const tab = entry.tab;
			const left = cursor;
			const right = left + entry.tabWidth;
			const bounds = tabBoundsScratch.get(i);
			bounds.left = left;
			bounds.top = boundsTop;
			bounds.right = right;
			bounds.bottom = boundsBottom;
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
				const closeBounds = closeBoundsScratch.get(i);
				closeBounds.left = bounds.right - entry.closeWidth;
				closeBounds.top = bounds.top;
				closeBounds.right = bounds.right;
				closeBounds.bottom = bounds.bottom;
				if (hovered) {
					host.tabCloseButtonBounds.set(tab.id, closeBounds);
					const closeX = closeBounds.left + constants.TAB_CLOSE_BUTTON_PADDING_X;
					const closeY = closeBounds.top + constants.TAB_CLOSE_BUTTON_PADDING_Y;
					host.drawText(constants.TAB_CLOSE_BUTTON_SYMBOL, closeX, closeY, textColor);
				} else {
					host.tabCloseButtonBounds.delete(tab.id);
					if (entry.dirty && entry.markerWidth > 0) {
						const markerX = closeBounds.left + Math.floor((entry.closeWidth - entry.markerWidth) / 2);
						const markerY = bounds.top + Math.floor((bounds.bottom - bounds.top - entry.markerHeight) / 2);
						const markerRight = markerX + entry.markerWidth - 1;
						const markerBottom = markerY + entry.markerHeight - 1;
						api.fill_rect(markerX, markerY, markerRight, markerBottom, undefined, constants.COLOR_TAB_DIRTY_MARKER);
					}
				}
			} else {
				host.tabCloseButtonBounds.delete(tab.id);
				if (entry.dirty && entry.markerWidth > 0) {
					const spacing = Math.max(0, constants.TAB_DIRTY_MARKER_SPACING);
					const markerX = indicatorWidth > 0
						? indicatorLeft + Math.floor(Math.max(0, (indicatorWidth - entry.markerWidth) / 2))
						: bounds.right - entry.markerWidth - spacing;
					const markerY = bounds.top + Math.floor((bounds.bottom - bounds.top - entry.markerHeight) / 2);
					const markerRight = markerX + entry.markerWidth - 1;
					const markerBottom = markerY + entry.markerHeight - 1;
					api.fill_rect(markerX, markerY, markerRight, markerBottom, undefined, constants.COLOR_TAB_DIRTY_MARKER);
				}
			}

			if (active) {
				api.fill_rect(bounds.left, bounds.bottom - 1, bounds.right, bounds.bottom, undefined, fillColor);
			}

			cursor = right + spacing;
		}
		rowStart = rowEnd;
		rowIndex += 1;
	}

	return totalRows;
}
