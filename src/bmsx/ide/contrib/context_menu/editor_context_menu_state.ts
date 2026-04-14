import type { EditorContextMenuEntry, EditorContextMenuState } from '../../core/types';

const EMPTY_CONTEXT_MENU_ENTRIES: readonly EditorContextMenuEntry[] = [];

export const editorContextMenuState: EditorContextMenuState = {
	visible: false,
	anchorX: 0,
	anchorY: 0,
	token: null,
	entries: EMPTY_CONTEXT_MENU_ENTRIES,
	hoverIndex: -1,
	bounds: null,
	itemBounds: [],
};

export function resetEditorContextMenuState(): void {
	editorContextMenuState.visible = false;
	editorContextMenuState.token = null;
	editorContextMenuState.entries = EMPTY_CONTEXT_MENU_ENTRIES;
	editorContextMenuState.hoverIndex = -1;
	editorContextMenuState.bounds = null;
	editorContextMenuState.itemBounds.length = 0;
}
