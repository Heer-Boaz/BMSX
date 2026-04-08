import { ide_state } from '../../core/ide_state';
import { endTabDrag, updateTabDrag } from '../../browser/editor_tabs';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import type { PointerSnapshot } from '../../core/types';

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
