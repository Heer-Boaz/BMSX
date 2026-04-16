import { point_in_rect } from '../../../../common/rect_operations';
import { editorChromeState } from '../../ui/chrome_state';
import type { PointerSnapshot } from '../../../common/types';
import { getProblemsPanelBounds, isPointerOverProblemsPanelDivider, setProblemsPanelHeightFromViewportY } from '../../contrib/problems/problems_panel';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../../editor/contrib/intellisense/intellisense';
import { editorPointerState, resetPointerClickTracking } from '../../../editor/input/pointer/editor_pointer_state';
import { problemsPanel } from '../../contrib/problems/problems_panel';

export function handleProblemsPanelResizePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (editorChromeState.problemsPanelResizing) {
		updateProblemsPanelResize(snapshot);
		return true;
	}
	if (!justPressed) {
		return false;
	}
	if (!problemsPanel.isVisible || !isPointerOverProblemsPanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		return false;
	}
	editorChromeState.problemsPanelResizing = true;
	editorPointerState.pointerSelecting = false;
	resetPointerClickTracking();
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
	return true;
}

export function handleProblemsPanelPointer(snapshot: PointerSnapshot, justPressed: boolean, justReleased: boolean): boolean {
	const problemsBounds = getProblemsPanelBounds();
	if (!problemsPanel.isVisible || !problemsBounds) {
		return false;
	}
	const insideProblems = point_in_rect(snapshot.viewportX, snapshot.viewportY, problemsBounds);
	if (!insideProblems) {
		if (justPressed) {
			problemsPanel.setFocused(false);
		}
		return false;
	}
	if (!problemsPanel.handlePointer(snapshot, justPressed, justReleased, problemsBounds)) {
		return false;
	}
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}

function updateProblemsPanelResize(snapshot: PointerSnapshot): void {
	if (!snapshot.valid || !snapshot.primaryPressed) {
		editorChromeState.problemsPanelResizing = false;
		editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	setProblemsPanelHeightFromViewportY(snapshot.viewportY);
	editorPointerState.pointerSelecting = false;
	resetPointerClickTracking();
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
}
