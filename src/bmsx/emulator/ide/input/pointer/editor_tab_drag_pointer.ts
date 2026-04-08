import { ide_state } from '../../ide_state';
import { endTabDrag, updateTabDrag } from '../../browser/editor_tabs';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../intellisense';
import type { PointerSnapshot } from '../../types';

export function handleEditorTabDragPointer(snapshot: PointerSnapshot): boolean {
	if (!ide_state.tabDragState) {
		return false;
	}
	if (!snapshot.primaryPressed) {
		endTabDrag();
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		clearHoverTooltip();
		return true;
	}
	updateTabDrag(snapshot.viewportX, snapshot.viewportY);
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
	clearHoverTooltip();
	return true;
}
