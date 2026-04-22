import * as constants from '../../../common/constants';
import type { EditorTabDescriptor } from '../../../common/models';
import { clamp } from '../../../../common/clamp';
import { editorChromeState } from '../chrome_state';
import { getTabBarTotalHeight } from '../../common/layout';
import { measureText } from '../../../editor/common/text/layout';
import { editorPointerState, resetPointerClickTracking } from '../../../editor/input/pointer/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { tabSessionState } from './session_state';

export type TabLayoutEntry = {
	id: string;
	left: number;
	right: number;
	width: number;
	center: number;
	rowIndex: number;
};

const tabLayoutScratch: TabLayoutEntry[] = [];

function getTabLayoutEntry(index: number): TabLayoutEntry {
	let entry = tabLayoutScratch[index];
	if (!entry) {
		entry = {
			id: '',
			left: 0,
			right: 0,
			width: 0,
			center: 0,
			rowIndex: 0,
		};
		tabLayoutScratch[index] = entry;
	}
	return entry;
}

function writeTabLayoutEntry(entry: TabLayoutEntry, id: string, left: number, right: number, width: number, rowIndex: number): void {
	entry.id = id;
	entry.left = left;
	entry.right = right;
	entry.width = width;
	entry.center = (left + right) * 0.5;
	entry.rowIndex = rowIndex;
}

export function measureTabWidth(tab: EditorTabDescriptor): number {
	const textWidth = measureText(tab.title);
	let indicatorWidth = 0;
	if (tab.closable) {
		indicatorWidth = measureText(constants.TAB_CLOSE_BUTTON_SYMBOL) + constants.TAB_CLOSE_BUTTON_PADDING_X * 2;
	} else if (tab.dirty) {
		indicatorWidth = constants.TAB_DIRTY_MARKER_METRICS.width + constants.TAB_DIRTY_MARKER_SPACING;
	}
	return textWidth + constants.TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
}

export function computeTabLayout(): TabLayoutEntry[] {
	const layout = tabLayoutScratch;
	layout.length = tabSessionState.tabs.length;
	for (let index = 0; index < tabSessionState.tabs.length; index += 1) {
		const tab = tabSessionState.tabs[index];
		const entry = getTabLayoutEntry(index);
		const bounds = editorChromeState.tabButtonBounds.get(tab.id)!;
		const left = bounds.left;
		const right = bounds.right;
		const width = right - left;
		const rowIndex = ((bounds.top - editorViewState.headerHeight) / editorViewState.tabBarHeight) | 0;
		writeTabLayoutEntry(entry, tab.id, left, right, width, rowIndex);
	}
	return layout;
}

export function beginTabDrag(tabId: string, pointerX: number): void {
	if (tabSessionState.tabs.length <= 1) {
		editorPointerState.tabDragState = null;
		return;
	}
	const bounds = editorChromeState.tabButtonBounds.get(tabId)!;
	const pointerOffset = pointerX - bounds.left;
	editorPointerState.tabDragState = {
		tabId,
		pointerOffset,
		startX: pointerX,
		hasDragged: false,
	};
}

export function updateTabDrag(pointerX: number, pointerY: number): void {
	const state = editorPointerState.tabDragState!;
	const distance = Math.abs(pointerX - state.startX);
	if (!state.hasDragged && distance < constants.TAB_DRAG_ACTIVATION_THRESHOLD) {
		return;
	}
	if (!state.hasDragged) {
		state.hasDragged = true;
		resetPointerClickTracking();
	}
	const layout = computeTabLayout();
	let currentIndex = 0;
	while (layout[currentIndex].id !== state.tabId) {
		currentIndex += 1;
	}
	const dragged = layout[currentIndex];
	const pointerLeft = pointerX - state.pointerOffset;
	const pointerCenter = pointerLeft + (dragged.width >> 1);
	const totalTabHeight = getTabBarTotalHeight();
	const withinTabBar = pointerY >= editorViewState.headerHeight && pointerY < editorViewState.headerHeight + totalTabHeight;
	const maxRowIndex = editorViewState.tabBarRowCount - 1;
	const pointerRow = withinTabBar
		? clamp(((pointerY - editorViewState.headerHeight) / editorViewState.tabBarHeight) | 0, 0, maxRowIndex)
		: dragged.rowIndex;
	const rowStride = editorViewState.viewportWidth + constants.TAB_BUTTON_SPACING * 4;
	const pointerValue = pointerRow * rowStride + pointerCenter;
	let desiredIndex = currentIndex;
	for (let i = 0; i < layout.length; i += 1) {
		const item = layout[i];
		const itemValue = item.rowIndex * rowStride + item.center;
		if (pointerValue > itemValue) {
			desiredIndex = i + 1;
		}
	}
	if (desiredIndex > currentIndex) {
		desiredIndex -= 1;
	}
	if (desiredIndex === currentIndex) {
		return;
	}
	const tabs = tabSessionState.tabs;
	let tabIndex = 0;
	while (tabs[tabIndex].id !== state.tabId) {
		tabIndex += 1;
	}
	const tab = tabs[tabIndex];
	for (let index = tabIndex; index < tabs.length - 1; index += 1) {
		tabs[index] = tabs[index + 1];
	}
	tabs.length -= 1;
	const targetIndex = clamp(desiredIndex, 0, tabSessionState.tabs.length);
	tabs.length += 1;
	for (let index = tabs.length - 1; index > targetIndex; index -= 1) {
		tabs[index] = tabs[index - 1];
	}
	tabs[targetIndex] = tab;
}

export function endTabDrag(): void {
	editorPointerState.tabDragState = null;
}
