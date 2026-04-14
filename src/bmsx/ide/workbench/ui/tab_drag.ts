import * as constants from '../../common/constants';
import type { EditorTabDescriptor } from '../../common/types';
import { clamp } from '../../../utils/clamp';
import { editorChromeState } from './chrome_state';
import { getTabBarTotalHeight } from '../common/layout';
import { measureText } from '../../editor/common/text_layout';
import { editorPointerState, resetPointerClickTracking } from '../../editor/input/pointer/editor_pointer_state';
import { editorSessionState } from '../../editor/ui/editor_session_state';
import { editorViewState } from '../../editor/ui/editor_view_state';

export type TabLayoutEntry = {
	id: string;
	left: number;
	right: number;
	width: number;
	center: number;
	rowIndex: number;
};

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
	const layout: TabLayoutEntry[] = [];
	for (let index = 0; index < editorSessionState.tabs.length; index += 1) {
		const tab = editorSessionState.tabs[index];
		const bounds = editorChromeState.tabButtonBounds.get(tab.id);
		if (bounds) {
			const left = bounds.left;
			const right = bounds.right;
			const width = Math.max(0, right - left);
			const rowIndex = Math.max(0, Math.floor((bounds.top - editorViewState.headerHeight) / editorViewState.tabBarHeight));
			layout.push({
				id: tab.id,
				left,
				right,
				width,
				center: (left + right) * 0.5,
				rowIndex,
			});
			continue;
		}
		const width = measureTabWidth(tab);
		const previous = layout.length > 0 ? layout[layout.length - 1] : null;
		const left = previous ? previous.right + constants.TAB_BUTTON_SPACING : 4;
		const right = left + width;
		layout.push({
			id: tab.id,
			left,
			right,
			width,
			center: (left + right) * 0.5,
			rowIndex: previous ? previous.rowIndex : 0,
		});
	}
	return layout;
}

export function beginTabDrag(tabId: string, pointerX: number): void {
	if (editorSessionState.tabs.length <= 1) {
		editorPointerState.tabDragState = null;
		return;
	}
	const bounds = editorChromeState.tabButtonBounds.get(tabId);
	const pointerOffset = bounds ? pointerX - bounds.left : 0;
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
	const currentIndex = layout.findIndex(item => item.id === state.tabId);
	const dragged = layout[currentIndex];
	const pointerLeft = pointerX - state.pointerOffset;
	const pointerCenter = pointerLeft + Math.max(dragged.width, 1) * 0.5;
	const totalTabHeight = getTabBarTotalHeight();
	const withinTabBar = pointerY >= editorViewState.headerHeight && pointerY < editorViewState.headerHeight + totalTabHeight;
	const maxRowIndex = Math.max(0, editorViewState.tabBarRowCount - 1);
	const pointerRow = withinTabBar
		? clamp(Math.floor((pointerY - editorViewState.headerHeight) / editorViewState.tabBarHeight), 0, maxRowIndex)
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
	const tabIndex = editorSessionState.tabs.findIndex(entry => entry.id === state.tabId);
	const removed = editorSessionState.tabs.splice(tabIndex, 1);
	const tab = removed[0];
	const targetIndex = clamp(desiredIndex, 0, editorSessionState.tabs.length);
	editorSessionState.tabs.splice(targetIndex, 0, tab);
}

export function endTabDrag(): void {
	editorPointerState.tabDragState = null;
}
