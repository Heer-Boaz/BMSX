import { pointerHover } from './hover';
import { PointerButton } from './buttons';
import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import { getProblemsPanelBounds, isPointerOverProblemsPanelDivider, problemsPanel, setProblemsPanelHeightFromViewportY } from '../../workbench/contrib/problems/panel/controller';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { clearEditorPointerSelectionState } from './state';
import type { EditorPanes } from '../../workbench/services/editor/editor_panes';

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
	clearEditorPointerSelectionState();
	return true;
}

export function handleProblemsPanelPointer(
	editorPanes: EditorPanes,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	justReleased: boolean,
): boolean {
	const problemsBounds = getProblemsPanelBounds();
	if (!problemsPanel.isVisible || !problemsBounds) {
		return false;
	}
	const insideProblems = snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, problemsBounds);
	if (!insideProblems) {
		pointerHover.release(problemsPanel);
		if (justPressed) {
			problemsPanel.setFocused(false);
		}
		return false;
	}
	pointerHover.visit(problemsPanel);
	if (!problemsPanel.handlePointer(editorPanes, snapshot, justPressed, justReleased, problemsBounds)) {
		return false;
	}
	clearEditorPointerSelectionState();
	return true;
}

function updateProblemsPanelResize(snapshot: PointerSnapshot): void {
	if (!snapshot.valid || (snapshot.pressedButtons & PointerButton.Primary) === 0) {
		editorChromeState.problemsPanelResizing = false;
		return;
	}
	setProblemsPanelHeightFromViewportY(snapshot.viewportY);
	clearEditorPointerSelectionState();
}
