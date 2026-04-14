import { isResourceViewActive } from '../../ui/editor_tabs';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import type { PointerSnapshot } from '../../core/types';
import { handleActionPromptPointer } from '../overlays/action_prompt';
import { actionPromptState } from '../overlays/action_prompt_state';
import { editorPointerState, resetPointerClickTracking } from './editor_pointer_state';

export function handleEditorPointerGuards(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (isResourceViewActive()) {
		resetPointerClickTracking();
		editorPointerState.pointerSelecting = false;
		editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return true;
	}
	if (!actionPromptState.prompt) {
		return false;
	}
	resetPointerClickTracking();
	if (justPressed) {
		handleActionPromptPointer(snapshot);
	}
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
