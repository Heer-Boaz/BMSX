import type { ResourceBrowserItem } from '../../../../common/models';
import * as constants from '../../../../common/constants';
import { showEditorMessage } from '../../../../common/feedback_state';
import { openResourceDescriptor, focusChunkSource } from '../navigation';
import { applyDefinitionSelection } from '../../../../editor/contrib/intellisense/engine';
import { releaseResourcePanelFocus } from '../../../../navigation/source_focus';
import { toggleSelectedCallHierarchyExpansion } from './navigation';
import type { Runtime } from '../../../../../machine/runtime/runtime';

export function tryOpenResourcePanelDescriptorItem(runtime: Runtime, item: ResourceBrowserItem): boolean {
	if (!item?.descriptor) {
		return false;
	}
	if (item.descriptor.type === 'atlas') {
		return false;
	}
	openResourceDescriptor(runtime, item.descriptor);
	return true;
}

export function openResourcePanelCallHierarchyLocation(runtime: Runtime, item: ResourceBrowserItem): void {
	if (!item?.location) {
		return;
	}
	focusChunkSource(runtime, item.location.path);
	applyDefinitionSelection(item.location.range);
}

export function openSelectedResourcePanelItem(runtime: Runtime, items: readonly ResourceBrowserItem[], selectionIndex: number): void {
	const item = items[selectionIndex];
	if (tryOpenResourcePanelDescriptorItem(runtime, item)) {
		return;
	}
	if (item?.descriptor?.type === 'atlas') {
		showEditorMessage('Atlas resources cannot be previewed in the IDE.', constants.COLOR_STATUS_WARNING, 3.2);
		releaseResourcePanelFocus(runtime.editor.resourcePanel);
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
