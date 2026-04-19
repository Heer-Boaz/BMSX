import { create_rect_bounds } from '../../../../common/rect';
import type { EditorContextMenuEntry, EditorContextMenuState } from '../../../common/models';

const EMPTY_CONTEXT_MENU_ENTRIES: readonly EditorContextMenuEntry[] = [];

export const editorContextMenuState: EditorContextMenuState = {
	visible: false,
	anchorX: 0,
	anchorY: 0,
	token: null,
	entries: EMPTY_CONTEXT_MENU_ENTRIES,
	hoverIndex: -1,
	bounds: create_rect_bounds(),
	itemBounds: [],
	itemCount: 0,
};

export function resetEditorContextMenuState(): void {
	editorContextMenuState.visible = false;
	editorContextMenuState.token = null;
	editorContextMenuState.entries = EMPTY_CONTEXT_MENU_ENTRIES;
	editorContextMenuState.hoverIndex = -1;
	editorContextMenuState.itemCount = 0;
}
