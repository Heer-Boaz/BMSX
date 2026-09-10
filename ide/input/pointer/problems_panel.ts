import { PointerButton } from './buttons';
import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../editor/contrib/hover/controller';
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
	clearGotoHoverHighlight();
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
	const insideProblems = point_in_rect(snapshot.viewportX, snapshot.viewportY, problemsBounds);
	if (!insideProblems) {
		if (justPressed) {
			problemsPanel.setFocused(false);
		}
		return false;
	}
	if (!problemsPanel.handlePointer(editorPanes, snapshot, justPressed, justReleased, problemsBounds)) {
		return false;
	}
	clearEditorPointerSelectionState();
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}

function updateProblemsPanelResize(snapshot: PointerSnapshot): void {
	if (!snapshot.valid || (snapshot.pressedButtons & PointerButton.Primary) === 0) {
		editorChromeState.problemsPanelResizing = false;
		clearGotoHoverHighlight();
		return;
	}
	setProblemsPanelHeightFromViewportY(snapshot.viewportY);
	clearEditorPointerSelectionState();
	clearGotoHoverHighlight();
}
