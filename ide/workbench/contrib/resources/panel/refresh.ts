import type { RectBounds } from '../../../../../machine/ts/common/rect';
import type {
	CallHierarchyDirection,
	CallHierarchyModel,
} from '../../../../editor/contrib/call_hierarchy/model';
import {
	buildCallHierarchyPanelItems,
	computeResourcePanelMaxLineWidth,
	findResourcePanelIndexByCallHierarchyNodeId,
	type CallHierarchyPanelItem,
} from './items';
import { ensureResourcePanelSelectionScroll } from './navigation';
import { resourcePanelLineCapacity } from './layout';

export type ResourcePanelRefreshResult = {
	items: CallHierarchyPanelItem[];
	maxLineWidth: number;
	selectionIndex: number;
	scroll: number;
};

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
