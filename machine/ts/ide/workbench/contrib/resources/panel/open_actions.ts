import type { ResourceBrowserItem } from '../../../../common/models';
import { openResourceDescriptor, focusChunkSource } from '../navigation';
import { applyDefinitionSelection } from '../../../../editor/contrib/intellisense/engine';
import { toggleSelectedCallHierarchyExpansion } from './navigation';
import type { Runtime } from '../../../../../machine/runtime/runtime';

export function openResourcePanelDescriptorItem(item: ResourceBrowserItem): boolean {
	if (!item?.descriptor) {
		return false;
	}
	openResourceDescriptor(item.descriptor);
	return true;
}

export function openResourcePanelCallHierarchyLocation(runtime: Runtime, item: ResourceBrowserItem): void {
	if (!item?.location) {
		return;
	}
	focusChunkSource(runtime, item.location.path);
	applyDefinitionSelection(item.location.range);
}

export function openSelectedResourcePanelItem(items: readonly ResourceBrowserItem[], selectionIndex: number): void {
	const item = items[selectionIndex];
	if (openResourcePanelDescriptorItem(item)) {
		return;
	}
}

export function openSelectedResourcePanelCallHierarchyLocation(runtime: Runtime, items: readonly ResourceBrowserItem[], selectionIndex: number): void {
	const item = items[selectionIndex];
	openResourcePanelCallHierarchyLocation(runtime, item);
}

export function activateSelectedCallHierarchyItem(
	runtime: Runtime,
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
	expandedNodeIds: Set<string>,
): string {
	const toggledNodeId = toggleSelectedCallHierarchyExpansion(items, selectionIndex, expandedNodeIds);
	if (toggledNodeId) {
		return toggledNodeId;
	}
	openSelectedResourcePanelCallHierarchyLocation(runtime, items, selectionIndex);
	return null;
}
