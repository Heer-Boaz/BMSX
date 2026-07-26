import { clamp } from '../../../../../machine/ts/common/clamp';
import type { RectBounds } from '../../../../../machine/ts/rompack/format';
import type { ResourceBrowserItem, ResourceDescriptor } from '../../../../common/models';
import type { CallHierarchyView } from '../../../../editor/contrib/call_hierarchy/view';
import {
	buildCallHierarchyPanelItems,
	buildResourcePanelItems,
	computeResourcePanelMaxLineWidth,
	findResourcePanelIndexByIdentity,
	findResourcePanelIndexByCallHierarchyNodeId,
	type ResourcePanelFilterMode,
} from './items';
import { ensureResourcePanelSelectionScroll } from './navigation';
import { resourcePanelLineCapacity } from './layout';
import type { ResourceIdentity } from '../../../../common/resource';
import type { RuntimeSourceState } from '../../../../runtime/sources';

export type ResourcePanelRefreshResult = {
	items: ResourceBrowserItem[];
	maxLineWidth: number;
	selectionIndex: number;
	scroll: number;
};

export function refreshResourcePanelResourceState(options: {
	sources: RuntimeSourceState;
	filterMode: ResourcePanelFilterMode;
	bounds: RectBounds;
	lineHeight: number;
	previousDescriptor: ResourceDescriptor;
	targetIdentity: ResourceIdentity;
	previousIndex: number;
	previousScroll: number;
}): ResourcePanelRefreshResult {
	const items = buildResourcePanelItems(options.sources, options.filterMode);
	const maxLineWidth = computeResourcePanelMaxLineWidth(items);
	const capacity = resourcePanelLineCapacity(options.bounds, items.length, maxLineWidth, options.lineHeight);
	const targetIdentity = options.targetIdentity || options.previousDescriptor;
	let selectionIndex = targetIdentity ? findResourcePanelIndexByIdentity(items, targetIdentity) : -1;
	if (selectionIndex === -1 && options.previousIndex >= 0 && options.previousIndex < items.length) {
		selectionIndex = options.previousIndex;
	}
	if (selectionIndex === -1 && items.length > 0) {
		selectionIndex = 0;
	}
	const scrollLimit = items.length - capacity;
	const maxScroll = scrollLimit > 0 ? scrollLimit : 0;
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
	const scrollLimit = items.length - capacity;
	const maxScroll = scrollLimit > 0 ? scrollLimit : 0;
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
