import { ide_state } from '../../ide_state';
import { isResourceViewActive } from '../../browser/editor_tabs';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../intellisense';
import { resetPointerClickTracking } from '../../browser/editor_view';
import type { PointerSnapshot } from '../../types';
import { handleActionPromptPointer } from '../overlays/action_prompt';

export function handleEditorPointerGuards(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (isResourceViewActive()) {
		resetPointerClickTracking();
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return true;
	}
	if (!ide_state.pendingActionPrompt) {
		return false;
	}
	resetPointerClickTracking();
	if (justPressed) {
		handleActionPromptPointer(snapshot);
	}
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
