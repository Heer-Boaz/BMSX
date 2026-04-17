import { clamp } from '../../../../../common/clamp';
import type { RectBounds } from '../../../../../rompack/format';
import type { ResourceBrowserItem, ResourceDescriptor } from '../../../../common/models';
import type { CallHierarchyView } from '../../../../editor/contrib/call_hierarchy/view';
import {
	buildCallHierarchyPanelItems,
	buildResourcePanelItems,
	computeResourcePanelMaxLineWidth,
	findResourcePanelIndexByAssetId,
	findResourcePanelIndexByCallHierarchyNodeId,
	type ResourcePanelFilterMode,
} from './items';
import { ensureResourcePanelSelectionScroll } from './navigation';
import { resourcePanelLineCapacity } from './layout';

export type ResourcePanelRefreshResult = {
	items: ResourceBrowserItem[];
	maxLineWidth: number;
	selectionIndex: number;
	scroll: number;
};

export function refreshResourcePanelResourceState(options: {
	filterMode: ResourcePanelFilterMode;
	bounds: RectBounds;
	lineHeight: number;
	previousDescriptor: ResourceDescriptor;
	targetAssetId: string;
	previousIndex: number;
	previousScroll: number;
}): ResourcePanelRefreshResult {
	const items = buildResourcePanelItems(options.filterMode);
	const maxLineWidth = computeResourcePanelMaxLineWidth(items);
	const capacity = resourcePanelLineCapacity(options.bounds, items.length, maxLineWidth, options.lineHeight);
	const targetAssetId = options.targetAssetId ?? options.previousDescriptor?.asset_id ?? null;
	let selectionIndex = targetAssetId ? findResourcePanelIndexByAssetId(items, targetAssetId) : -1;
	if (selectionIndex === -1 && options.previousIndex >= 0 && options.previousIndex < items.length) {
		selectionIndex = options.previousIndex;
	}
	if (selectionIndex === -1 && items.length > 0) {
		selectionIndex = 0;
	}
	const maxScroll = Math.max(0, items.length - capacity);
	const scroll = selectionIndex >= 0
		? ensureResourcePanelSelectionScroll(selectionIndex, clamp(options.previousScroll, 0, maxScroll), capacity, items.length)
		: clamp(options.previousScroll, 0, maxScroll);
	return {
		items,
		maxLineWidth,
		selectionIndex,
		scroll,
	};
}

export function refreshResourcePanelCallHierarchyState(options: {
	view: CallHierarchyView;
	expandedNodeIds: ReadonlySet<string>;
	bounds: RectBounds;
	lineHeight: number;
	previousNodeId: string;
	previousScroll: number;
}): ResourcePanelRefreshResult {
	const items = buildCallHierarchyPanelItems(options.view, options.expandedNodeIds);
	const maxLineWidth = computeResourcePanelMaxLineWidth(items);
	const capacity = resourcePanelLineCapacity(options.bounds, items.length, maxLineWidth, options.lineHeight);
	let selectionIndex = options.previousNodeId ? findResourcePanelIndexByCallHierarchyNodeId(items, options.previousNodeId) : -1;
	if (selectionIndex === -1 && items.length > 0) {
		selectionIndex = 0;
	}
	const maxScroll = Math.max(0, items.length - capacity);
	const scroll = selectionIndex >= 0
		? ensureResourcePanelSelectionScroll(selectionIndex, clamp(options.previousScroll, 0, maxScroll), capacity, items.length)
		: clamp(options.previousScroll, 0, maxScroll);
	return {
		items,
		maxLineWidth,
		selectionIndex,
		scroll,
	};
}
