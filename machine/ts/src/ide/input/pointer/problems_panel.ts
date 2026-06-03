import { point_in_rect } from '../../../common/rect';
import type { PointerSnapshot } from '../../common/models';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { getProblemsPanelBounds, isPointerOverProblemsPanelDivider, problemsPanel, setProblemsPanelHeightFromViewportY } from '../../workbench/contrib/problems/panel/controller';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { editorPointerState, stopPointerSelectionAndResetClicks } from './state';

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
	stopPointerSelectionAndResetClicks(snapshot);
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
	stopPointerSelectionAndResetClicks(snapshot);
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
	stopPointerSelectionAndResetClicks(snapshot);
	clearGotoHoverHighlight();
}
