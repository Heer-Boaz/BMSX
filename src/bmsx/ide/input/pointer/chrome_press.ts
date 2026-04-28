import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import type { PointerSnapshot } from '../../common/models';
import { editorPointerState, resetPointerClickTracking } from './state';

export function consumeChromePointerPress(snapshot: PointerSnapshot): void {
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	clearGotoHoverHighlight();
}
