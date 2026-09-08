import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { editorPointerState, resetPointerClickTracking } from './state';

export function consumeChromePointerPress(): void {
	editorPointerState.pointerSelecting = false;
	resetPointerClickTracking();
	clearGotoHoverHighlight();
}
