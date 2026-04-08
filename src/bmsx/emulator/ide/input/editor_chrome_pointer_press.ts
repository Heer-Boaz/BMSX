import { ide_state } from '../ide_state';
import { clearGotoHoverHighlight } from '../intellisense';
import { resetPointerClickTracking } from '../editor_view';
import type { PointerSnapshot } from '../types';

export function consumeChromePointerPress(snapshot: PointerSnapshot): void {
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	clearGotoHoverHighlight();
}
