import { isResourceViewActive } from '../../../workbench/ui/tabs';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/engine';
import type { PointerSnapshot } from '../../../common/models';
import { handleBlockingWorkbenchModalPointer, hasBlockingWorkbenchModal } from '../../../workbench/contrib/modal/blocking_modal';
import { editorPointerState, resetPointerClickTracking } from './state';

export function handleEditorPointerGuards(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (isResourceViewActive()) {
		resetPointerClickTracking();
		editorPointerState.pointerSelecting = false;
		editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return true;
	}
	if (!hasBlockingWorkbenchModal()) {
		return false;
	}
	resetPointerClickTracking();
	if (justPressed) {
		handleBlockingWorkbenchModalPointer(snapshot);
	}
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
