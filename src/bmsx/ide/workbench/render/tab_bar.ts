import { api } from '../../editor/ui/view/overlay_api';
import * as constants from '../../common/constants';
import type { EditorTabDescriptor } from '../../common/models';
import type { RectBounds } from '../../../rompack/format';
import { TAB_DIRTY_LEFT_MARGIN, TAB_DIRTY_RIGHT_MARGIN } from '../../common/constants';
import { ScratchBuffer } from '../../../common/scratchbuffer';
import { editorChromeState } from '../ui/chrome_state';
import { measureText } from '../../editor/common/text_layout';
import { editorPointerState } from '../../editor/input/pointer/state';
import { drawEditorText } from '../../editor/render/text_renderer';
import { editorViewState } from '../../editor/ui/view/state';
import { tabSessionState } from '../ui/tab/session_state';

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

const createNumber = (): number => 0;

const tabMetricsScratch = new ScratchBuffer<TabMetrics>(createTabMetrics, 8);
const costsScratch = new ScratchBuffer<number>(createNumber, 8);
const nextBreakScratch = new ScratchBuffer<number>(createNumber, 8);

function writeRect(bounds: RectBounds, left: number, top: number, right: number, bottom: number): void {
	bounds.left = left;
	bounds.top = top;
	bounds.right = right;
	bounds.bottom = bottom;
}

function clearRect(bounds: RectBounds): void {
	writeRect(bounds, 0, 0, 0, 0);
}

function getTabButtonBounds(tabId: string): RectBounds {
	let bounds = editorChromeState.tabButtonBounds.get(tabId);
	if (!bounds) {
		bounds = { left: 0, top: 0, right: 0, bottom: 0 };
		editorChromeState.tabButtonBounds.set(tabId, bounds);
	}
	return bounds;
}

function getTabCloseBounds(tabId: string): RectBounds {
	let bounds = editorChromeState.tabCloseButtonBounds.get(tabId);
	if (!bounds) {
		bounds = { left: 0, top: 0, right: 0, bottom: 0 };
		editorChromeState.tabCloseButtonBounds.set(tabId, bounds);
	}
	return bounds;
}

export function renderTabBar(): number {
	tabMetricsScratch.clear();
	costsScratch.clear();
	nextBreakScratch.clear();

	const rowHeight = editorViewState.tabBarHeight;
	const closeButtonWidth = measureText(constants.TAB_CLOSE_BUTTON_SYMBOL);
	const markerWidth = constants.TAB_DIRTY_MARKER_METRICS.width;
	const markerHeight = constants.TAB_DIRTY_MARKER_METRICS.height;

	const tabs = tabSessionState.tabs;
	const tabCount = tabs.length;
	const rowHeightTotal = rowHeight;
	if (tabCount === 0) {
		const barTop = editorViewState.headerHeight;
		const barBottom = barTop + rowHeightTotal;
		api.fill_rect(0, barTop, editorViewState.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BAR_BACKGROUND);
		api.fill_rect(0, barBottom - 1, editorViewState.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BORDER);
		return 1;
	}

	tabMetricsScratch.reserve(tabCount);
	costsScratch.reserve(tabCount + 1);
	nextBreakScratch.reserve(tabCount);

	for (let index = 0; index < tabCount; index += 1) {
		const tab = tabs[index];
		const metric = tabMetricsScratch.get(index);
		const textWidth = measureText(tab.title);
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
	const minTabRowWidth = TAB_DIRTY_LEFT_MARGIN + TAB_DIRTY_RIGHT_MARGIN + 1;
	const availableTabRowWidth = editorViewState.viewportWidth - TAB_DIRTY_RIGHT_MARGIN;
	const maxWidth = availableTabRowWidth > minTabRowWidth ? availableTabRowWidth : minTabRowWidth;
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
			const leftover = maxWidth - usedWidth;
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
			bestBreak = i + 1;
		}
		costs.set(i, bestRows);
		nextBreak.set(i, bestBreak);
	}

	const totalRows = costs.peek(0);
	const barTop = editorViewState.headerHeight;
	const totalHeight = totalRows * rowHeightTotal;
	const barBottom = barTop + totalHeight;

	api.fill_rect(0, barTop, editorViewState.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BAR_BACKGROUND);
	api.fill_rect(0, barBottom - 1, editorViewState.viewportWidth, barBottom, undefined, constants.COLOR_TAB_BORDER);

	let rowStart = 0;
	let rowIndex = 0;
	while (rowStart < n) {
		const rowEnd = nextBreak.peek(rowStart);
		let cursor = TAB_DIRTY_LEFT_MARGIN;
		const rowTop = barTop + rowIndex * rowHeightTotal;
		const boundsTop = rowTop + 1;
		const boundsBottom = rowTop + rowHeightTotal - 1;
		for (let i = rowStart; i < rowEnd; i += 1) {
			const entry = tabMetricsScratch.peek(i);
			const tab = entry.tab;
			const left = cursor;
			const right = left + entry.tabWidth;
			const bounds = getTabButtonBounds(tab.id);
			writeRect(bounds, left, boundsTop, right, boundsBottom);

			const active = tabSessionState.activeTabId === tab.id;
			const fillColor = active ? constants.COLOR_TAB_ACTIVE_BACKGROUND : constants.COLOR_TAB_INACTIVE_BACKGROUND;
			const textColor = active ? constants.COLOR_TAB_ACTIVE_TEXT : constants.COLOR_TAB_INACTIVE_TEXT;

			api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, undefined, fillColor);
			api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, undefined, constants.COLOR_TAB_BORDER);

			const textX = bounds.left + constants.TAB_BUTTON_PADDING_X;
			const textY = bounds.top + constants.TAB_BUTTON_PADDING_Y;
			drawEditorText(editorViewState.font, tab.title, textX, textY, undefined, textColor);

			const indicatorLeft = bounds.right - entry.indicatorWidth;
			const indicatorWidth = entry.indicatorWidth;
			const hovered = tab.id === editorPointerState.tabHoverId;

			if (entry.closable) {
				const closeBounds = getTabCloseBounds(tab.id);
				writeRect(closeBounds, bounds.right - entry.closeWidth, bounds.top, bounds.right, bounds.bottom);
				if (hovered) {
					const closeX = closeBounds.left + constants.TAB_CLOSE_BUTTON_PADDING_X;
					const closeY = closeBounds.top + constants.TAB_CLOSE_BUTTON_PADDING_Y;
					drawEditorText(editorViewState.font, constants.TAB_CLOSE_BUTTON_SYMBOL, closeX, closeY, undefined, textColor);
				} else {
					clearRect(closeBounds);
					if (entry.dirty && entry.markerWidth > 0) {
						const markerLeft = bounds.right - entry.closeWidth;
						const markerX = markerLeft + ((entry.closeWidth - entry.markerWidth) >> 1);
						const markerY = bounds.top + ((bounds.bottom - bounds.top - entry.markerHeight) >> 1);
						const markerRight = markerX + entry.markerWidth - 1;
						const markerBottom = markerY + entry.markerHeight - 1;
						api.fill_rect(markerX, markerY, markerRight, markerBottom, undefined, constants.COLOR_TAB_DIRTY_MARKER);
					}
				}
			} else {
				clearRect(getTabCloseBounds(tab.id));
				if (entry.dirty && entry.markerWidth > 0) {
					const spacing = constants.TAB_DIRTY_MARKER_SPACING;
					const markerX = indicatorWidth > 0
						? indicatorLeft + ((indicatorWidth - entry.markerWidth) >> 1)
						: bounds.right - entry.markerWidth - spacing;
					const markerY = bounds.top + ((bounds.bottom - bounds.top - entry.markerHeight) >> 1);
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
