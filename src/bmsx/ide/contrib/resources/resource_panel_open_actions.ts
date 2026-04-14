import type { ResourceBrowserItem } from '../../core/types';
import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { focusEditorFromResourcePanel, openResourceDescriptor, focusChunkSource } from '../../ui/editor_tabs';
import { applyDefinitionSelection } from '../intellisense/intellisense';
import { toggleSelectedCallHierarchyExpansion } from './resource_panel_navigation';

export function tryOpenResourcePanelDescriptorItem(item: ResourceBrowserItem): boolean {
	if (!item?.descriptor) {
		return false;
	}
	if (item.descriptor.type === 'atlas') {
		return false;
	}
	openResourceDescriptor(item.descriptor);
	focusEditorFromResourcePanel();
	return true;
}

export function openResourcePanelCallHierarchyLocation(item: ResourceBrowserItem): void {
	if (!item?.location) {
		return;
	}
	focusChunkSource(item.location.path);
	applyDefinitionSelection(item.location.range);
	focusEditorFromResourcePanel();
}

export function openSelectedResourcePanelItem(items: readonly ResourceBrowserItem[], selectionIndex: number): void {
	const item = items[selectionIndex];
	if (tryOpenResourcePanelDescriptorItem(item)) {
		return;
	}
	if (item?.descriptor?.type === 'atlas') {
		showResourcePanelAtlasWarning();
		focusEditorFromResourcePanel();
	}
}

export function openSelectedResourcePanelCallHierarchyLocation(items: readonly ResourceBrowserItem[], selectionIndex: number): void {
	openResourcePanelCallHierarchyLocation(items[selectionIndex]);
}

export function activateSelectedCallHierarchyItem(
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
	expandedNodeIds: Set<string>,
): string {
	const toggledNodeId = toggleSelectedCallHierarchyExpansion(items, selectionIndex, expandedNodeIds);
	if (toggledNodeId) {
		return toggledNodeId;
	}
	openSelectedResourcePanelCallHierarchyLocation(items, selectionIndex);
	return null;
}

export function showResourcePanelAtlasWarning(): void {
	ide_state.showMessage('Atlas resources cannot be previewed in the IDE.', constants.COLOR_STATUS_WARNING, 3.2);
}
