import type { ResourceBrowserItem } from '../../../../common/models';
import { openResourceDescriptor, focusChunkSourceForContext } from '../navigation';
import { getActiveCodeTabContext } from '../../../ui/code_tab/contexts';
import { applyDefinitionSelection } from '../../../../editor/contrib/intellisense/engine';
import { toggleSelectedCallHierarchyExpansion } from './navigation';
import type { CartEditor } from '../../../../cart_editor';
import type { RuntimeSourceState } from '../../../../runtime/sources';

export function openResourcePanelDescriptorItem(
	editor: CartEditor,
	sources: RuntimeSourceState,
	item: ResourceBrowserItem,
): boolean {
	if (!item?.descriptor) {
		return false;
	}
	openResourceDescriptor(editor, sources, item.descriptor);
	return true;
}

export function openResourcePanelCallHierarchyLocation(
	editor: CartEditor,
	sources: RuntimeSourceState,
	item: ResourceBrowserItem,
): void {
	if (!item?.location) {
		return;
	}
	focusChunkSourceForContext(
		editor,
		sources,
		getActiveCodeTabContext().descriptor.domain,
		item.location.path,
	);
	applyDefinitionSelection(item.location.range);
}

export function openSelectedResourcePanelItem(
	editor: CartEditor,
	sources: RuntimeSourceState,
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
): void {
	const item = items[selectionIndex];
	if (openResourcePanelDescriptorItem(editor, sources, item)) {
		return;
	}
}

export function openSelectedResourcePanelCallHierarchyLocation(
	editor: CartEditor,
	sources: RuntimeSourceState,
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
): void {
	const item = items[selectionIndex];
	openResourcePanelCallHierarchyLocation(editor, sources, item);
}

export function activateSelectedCallHierarchyItem(
	editor: CartEditor,
	sources: RuntimeSourceState,
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
	expandedNodeIds: Set<string>,
): string {
	const toggledNodeId = toggleSelectedCallHierarchyExpansion(items, selectionIndex, expandedNodeIds);
	if (toggledNodeId) {
		return toggledNodeId;
	}
	openSelectedResourcePanelCallHierarchyLocation(editor, sources, items, selectionIndex);
	return null;
}
