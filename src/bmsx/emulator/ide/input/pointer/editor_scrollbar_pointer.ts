import { ide_state } from '../../ide_state';
import { applyScrollbarScroll } from '../../scrollbar';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../intellisense';
import { bottomMargin } from '../../editor_view';
import type { PointerSnapshot } from '../../types';

export function handleEditorScrollbarPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (!justPressed) {
		return false;
	}
	if (!ide_state.scrollbarController.begin(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, bottomMargin(), (kind, scroll) => applyScrollbarScroll(kind, scroll))) {
		return false;
	}
	ide_state.pointerSelecting = false;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	return true;
}
