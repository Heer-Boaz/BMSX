import { WORKBENCH_TEXT_EDITOR_ID } from '../../code_editor/editor_input';
import type { CallHierarchyPanelItem } from './items';
import type { CartEditor } from '../../../../cart_editor';

export function openResourcePanelCallHierarchyLocation(
	editor: CartEditor,
	item: CallHierarchyPanelItem,
): void {
	void editor.navigation.focusChunkSource(
		editor.editorParts.documentDestination(undefined, { resource: item.resource, editorId: WORKBENCH_TEXT_EDITOR_ID }), item.resource,
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
