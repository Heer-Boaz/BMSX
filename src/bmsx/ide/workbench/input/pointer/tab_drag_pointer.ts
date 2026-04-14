import { endTabDrag, updateTabDrag } from '../../ui/tabs';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../../editor/contrib/intellisense/intellisense';
import type { PointerSnapshot } from '../../../common/types';
import { editorPointerState } from '../../../editor/input/pointer/editor_pointer_state';

export function handleEditorTabDragPointer(snapshot: PointerSnapshot): boolean {
	if (!editorPointerState.tabDragState) {
		return false;
	}
	if (!snapshot.primaryPressed) {
		endTabDrag();
		editorPointerState.pointerSelecting = false;
		editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		clearHoverTooltip();
		return true;
	}
	updateTabDrag(snapshot.viewportX, snapshot.viewportY);
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
	clearHoverTooltip();
	return true;
}
