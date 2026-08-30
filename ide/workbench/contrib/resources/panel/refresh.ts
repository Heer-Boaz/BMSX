import type { RectBounds } from '../../../../../machine/ts/common/rect';
import type { ResourceBrowserItem, RuntimeResource } from '../../../../common/models';
import type {
	CallHierarchyDirection,
	CallHierarchyModel,
} from '../../../../editor/contrib/call_hierarchy/model';
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
	previousResource: RuntimeResource;
	targetIdentity: ResourceIdentity;
	previousIndex: number;
	previousScroll: number;
}): ResourcePanelRefreshResult {
	const items = buildResourcePanelItems(options.sources, options.filterMode);
	const maxLineWidth = computeResourcePanelMaxLineWidth(items);
	const capacity = resourcePanelLineCapacity(options.bounds, items.length, maxLineWidth, options.lineHeight);
	const targetIdentity = options.targetIdentity || options.previousResource;
	let selectionIndex = targetIdentity ? findResourcePanelIndexByIdentity(items, targetIdentity) : -1;
	if (selectionIndex === -1 && options.previousIndex >= 0 && options.previousIndex < items.length) {
		selectionIndex = options.previousIndex;
	}
	if (selectionIndex === -1 && items.length > 0) {
		selectionIndex = 0;
	}
	const scroll = ensureResourcePanelSelectionScroll(
		selectionIndex,
		options.previousScroll,
		capacity,
		items.length,
	);
	return {
		items,
		maxLineWidth,
		selectionIndex,
		scroll,
	};
}

export function refreshResourcePanelCallHierarchyState(options: {
	model: CallHierarchyModel;
	direction: CallHierarchyDirection;
	expandedNodeIds: ReadonlySet<string>;
	bounds: RectBounds;
	lineHeight: number;
	previousNodeId: string;
	previousScroll: number;
}): ResourcePanelRefreshResult {
	const items = buildCallHierarchyPanelItems(options.model, options.direction, options.expandedNodeIds);
	const maxLineWidth = computeResourcePanelMaxLineWidth(items);
	const capacity = resourcePanelLineCapacity(options.bounds, items.length, maxLineWidth, options.lineHeight);
	let selectionIndex = options.previousNodeId ? findResourcePanelIndexByCallHierarchyNodeId(items, options.previousNodeId) : -1;
	if (selectionIndex === -1 && items.length > 0) {
		selectionIndex = 0;
	}
	const scroll = ensureResourcePanelSelectionScroll(
		selectionIndex,
		options.previousScroll,
		capacity,
		items.length,
	);
	return {
		items,
		maxLineWidth,
		selectionIndex,
		scroll,
	};
}
