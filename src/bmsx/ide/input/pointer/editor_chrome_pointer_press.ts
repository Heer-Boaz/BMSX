import { ide_state } from '../../core/ide_state';
import { clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { resetPointerClickTracking } from '../../browser/editor_view';
import type { PointerSnapshot } from '../../core/types';

export function consumeChromePointerPress(snapshot: PointerSnapshot): void {
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	clearGotoHoverHighlight();
}
