import { clamp } from '../../../../../machine/ts/common/clamp';
import type { ResourceBrowserItem } from '../../../../common/models';

export function resourcePanelIndexAtRelativeY(scroll: number, relativeY: number, lineHeight: number, itemCount: number): number {
	const index = scroll + ((relativeY / lineHeight) | 0);
	return index >= 0 && index < itemCount ? index : -1;
}

export function clampResourcePanelSelectionIndex(index: number, itemCount: number): number {
	return clamp(index, -1, itemCount - 1);
}

export function moveResourcePanelSelectionIndex(selectionIndex: number, itemCount: number, delta: number): number {
	let next: number;
	if (delta === Number.NEGATIVE_INFINITY) next = 0;
	else if (delta === Number.POSITIVE_INFINITY) next = itemCount - 1;
	else next = (selectionIndex >= 0 ? selectionIndex : 0) + delta;
	return clamp(next, 0, itemCount - 1);
}

export function ensureResourcePanelSelectionScroll(selectionIndex: number, scroll: number, capacity: number, itemCount: number): number {
	const scrollLimit = itemCount - capacity;
	const maxScroll = scrollLimit > 0 ? scrollLimit : 0;
	if (selectionIndex < scroll) {
		return selectionIndex;
	}
	const overflow = selectionIndex - (scroll + capacity - 1);
	if (overflow <= 0) {
		return scroll;
	}
	const requestedScroll = scroll + overflow;
	return requestedScroll < maxScroll ? requestedScroll : maxScroll;
}

export function scrollResourcePanelHorizontalOffset(hscroll: number, amount: number, maxScroll: number): number {
	if (maxScroll <= 0) {
		return 0;
	}
	return clamp(hscroll + amount, 0, maxScroll);
}

export function expandSelectedCallHierarchyNode(
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
	expandedNodeIds: Set<string>,
): string {
	const item = items[selectionIndex];
	const nodeId = item?.callHierarchyNodeId;
	if (!item?.callHierarchyExpandable || !nodeId) {
		return null;
	}
	if (expandedNodeIds.has(nodeId)) {
		return null;
	}
	expandedNodeIds.add(nodeId);
	return nodeId;
}

export function collapseSelectedCallHierarchyNode(
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
	expandedNodeIds: Set<string>,
): string {
	const item = items[selectionIndex];
	const nodeId = item?.callHierarchyNodeId;
	if (!item?.callHierarchyExpandable || !nodeId) {
		return null;
	}
	if (!expandedNodeIds.has(nodeId)) {
		return null;
	}
	expandedNodeIds.delete(nodeId);
	return nodeId;
}
