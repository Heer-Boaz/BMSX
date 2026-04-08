import { point_in_rect } from '../../../../utils/rect_operations';
import { ide_state } from '../../ide_state';
import type { PointerSnapshot } from '../../types';
import { getProblemsPanelBounds, isPointerOverProblemsPanelDivider, setProblemsPanelHeightFromViewportY } from '../../problems_panel';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../intellisense';
import { resetPointerClickTracking } from '../../editor_view';

export function handleProblemsPanelResizePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (ide_state.problemsPanelResizing) {
		updateProblemsPanelResize(snapshot);
		return true;
	}
	if (!justPressed) {
		return false;
	}
	if (!ide_state.problemsPanel.isVisible || !isPointerOverProblemsPanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		return false;
	}
	ide_state.problemsPanelResizing = true;
	ide_state.pointerSelecting = false;
	resetPointerClickTracking();
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
	return true;
}

export function handleProblemsPanelPointer(snapshot: PointerSnapshot, justPressed: boolean, justReleased: boolean): boolean {
	const problemsBounds = getProblemsPanelBounds();
	if (!ide_state.problemsPanel.isVisible || !problemsBounds) {
		return false;
	}
	const insideProblems = point_in_rect(snapshot.viewportX, snapshot.viewportY, problemsBounds);
	if (!insideProblems) {
		if (justPressed) {
			ide_state.problemsPanel.setFocused(false);
		}
		return false;
	}
	if (!ide_state.problemsPanel.handlePointer(snapshot, justPressed, justReleased, problemsBounds)) {
		return false;
	}
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}

function updateProblemsPanelResize(snapshot: PointerSnapshot): void {
	if (!snapshot.valid || !snapshot.primaryPressed) {
		ide_state.problemsPanelResizing = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	setProblemsPanelHeightFromViewportY(snapshot.viewportY);
	ide_state.pointerSelecting = false;
	resetPointerClickTracking();
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	clearGotoHoverHighlight();
}
