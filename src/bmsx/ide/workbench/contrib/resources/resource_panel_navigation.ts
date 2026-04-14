import { clamp } from '../../../../utils/clamp';
import type { ResourceBrowserItem } from '../../../common/types';

export function resourcePanelIndexAtRelativeY(scroll: number, relativeY: number, lineHeight: number, itemCount: number): number {
	const index = scroll + Math.floor(relativeY / lineHeight);
	return index >= 0 && index < itemCount ? index : -1;
}

export function clampResourcePanelSelectionIndex(index: number, itemCount: number): number {
	return clamp(index, -1, Math.max(-1, itemCount - 1));
}

export function moveResourcePanelSelectionIndex(selectionIndex: number, itemCount: number, delta: number): number {
	let next: number;
	if (delta === Number.NEGATIVE_INFINITY) next = 0;
	else if (delta === Number.POSITIVE_INFINITY) next = itemCount - 1;
	else next = (selectionIndex >= 0 ? selectionIndex : 0) + delta;
	return clamp(next, 0, itemCount - 1);
}

export function ensureResourcePanelSelectionScroll(selectionIndex: number, scroll: number, capacity: number, itemCount: number): number {
	const maxScroll = Math.max(0, itemCount - capacity);
	if (selectionIndex < scroll) {
		return selectionIndex;
	}
	const overflow = selectionIndex - (scroll + capacity - 1);
	return overflow > 0 ? Math.min(scroll + overflow, maxScroll) : scroll;
}

export function scrollResourcePanelHorizontalOffset(hscroll: number, amount: number, maxScroll: number): number {
	if (maxScroll <= 0) {
		return 0;
	}
	return clamp(hscroll + amount, 0, maxScroll);
}

export function toggleSelectedCallHierarchyExpansion(
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
	expandedNodeIds: Set<string>,
): string {
	const item = items[selectionIndex];
	if (!item?.callHierarchyExpandable || !item.callHierarchyNodeId) {
		return null;
	}
	if (expandedNodeIds.has(item.callHierarchyNodeId)) {
		expandedNodeIds.delete(item.callHierarchyNodeId);
	} else {
		expandedNodeIds.add(item.callHierarchyNodeId);
	}
	return item.callHierarchyNodeId;
}

export function expandSelectedCallHierarchyNode(
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
	expandedNodeIds: Set<string>,
): string {
	const item = items[selectionIndex];
	if (!item?.callHierarchyExpandable || !item.callHierarchyNodeId) {
		return null;
	}
	if (expandedNodeIds.has(item.callHierarchyNodeId)) {
		return null;
	}
	expandedNodeIds.add(item.callHierarchyNodeId);
	return item.callHierarchyNodeId;
}

export function collapseSelectedCallHierarchyNode(
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
	expandedNodeIds: Set<string>,
): string {
	const item = items[selectionIndex];
	if (!item?.callHierarchyExpandable || !item.callHierarchyNodeId) {
		return null;
	}
	if (!expandedNodeIds.has(item.callHierarchyNodeId)) {
		return null;
	}
	expandedNodeIds.delete(item.callHierarchyNodeId);
	return item.callHierarchyNodeId;
}
