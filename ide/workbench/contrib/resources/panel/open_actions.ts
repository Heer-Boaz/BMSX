import type { ResourceBrowserItem } from '../../../../common/models';
import { getActiveCodeTabContext } from '../../../ui/code_tab/contexts';
import { toggleSelectedCallHierarchyExpansion } from './navigation';
import type { CartEditor } from '../../../../cart_editor';

export function openResourcePanelItem(
	editor: CartEditor,
	item: ResourceBrowserItem,
): boolean {
	if (!item?.resource) {
		return false;
	}
	void editor.navigation.openResource(item.resource);
	return true;
}

export function openResourcePanelCallHierarchyLocation(
	editor: CartEditor,
	item: ResourceBrowserItem,
): void {
	if (!item?.location) {
		return;
	}
	editor.navigation.focusChunkSourceForContext(
		getActiveCodeTabContext().resource.domain,
		item.location.path,
		{
			row: item.location.range.startLine - 1,
			startColumn: item.location.range.startColumn - 1,
			endColumn: item.location.range.startColumn - 1,
		},
	);
}

export function openSelectedResourcePanelItem(
	editor: CartEditor,
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
): void {
	const item = items[selectionIndex];
	if (openResourcePanelItem(editor, item)) {
		return;
	}
}

export function openSelectedResourcePanelCallHierarchyLocation(
	editor: CartEditor,
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
): void {
	const item = items[selectionIndex];
	openResourcePanelCallHierarchyLocation(editor, item);
}

export function activateSelectedCallHierarchyItem(
	editor: CartEditor,
	items: readonly ResourceBrowserItem[],
	selectionIndex: number,
	expandedNodeIds: Set<string>,
): string {
	const toggledNodeId = toggleSelectedCallHierarchyExpansion(items, selectionIndex, expandedNodeIds);
	if (toggledNodeId) {
		return toggledNodeId;
	}
	openSelectedResourcePanelCallHierarchyLocation(editor, items, selectionIndex);
	return null;
}
