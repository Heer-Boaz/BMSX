import type { CallHierarchyPanelItem } from './items';
import { getActiveCodeTabContext } from '../../../ui/code_tab/contexts';
import type { CartEditor } from '../../../../cart_editor';

export function openResourcePanelCallHierarchyLocation(
	editor: CartEditor,
	item: CallHierarchyPanelItem,
): void {
	editor.navigation.focusChunkSourceForContext(
		getActiveCodeTabContext().model.resource.domain,
		item.location.path,
		{
			row: item.location.range.startLine - 1,
			startColumn: item.location.range.startColumn - 1,
			endColumn: item.location.range.startColumn - 1,
		},
	);
}

export function openSelectedResourcePanelCallHierarchyLocation(
	editor: CartEditor,
	items: readonly CallHierarchyPanelItem[],
	selectionIndex: number,
): void {
	if (selectionIndex < 0) {
		return;
	}
	openResourcePanelCallHierarchyLocation(editor, items[selectionIndex]);
}
