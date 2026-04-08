import { ide_state } from '../../core/ide_state';
import { applyScrollbarScroll } from '../../browser/scrollbar';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { bottomMargin } from '../../browser/editor_view';
import type { PointerSnapshot } from '../../core/types';

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
