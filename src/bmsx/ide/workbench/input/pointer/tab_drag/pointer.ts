import { endTabDrag, updateTabDrag } from '../../../ui/tab/drag';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../../../editor/contrib/intellisense/engine';
import type { PointerSnapshot } from '../../../../common/models';
import { editorPointerState } from '../../../../editor/input/pointer/state';

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
