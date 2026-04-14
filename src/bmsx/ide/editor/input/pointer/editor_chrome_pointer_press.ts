import { clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import type { PointerSnapshot } from '../../../common/types';
import { editorPointerState, resetPointerClickTracking } from './editor_pointer_state';

export function consumeChromePointerPress(snapshot: PointerSnapshot): void {
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	clearGotoHoverHighlight();
}
