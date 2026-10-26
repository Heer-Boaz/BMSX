import { pointerHover } from './hover';
import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import { getProblemsPanelBounds, isPointerOverProblemsPanelDivider, problemsPanel } from '../../workbench/contrib/problems/panel/controller';
import { clearEditorPointerSelectionState } from './state';
import type { EditorGroupView } from '../../workbench/services/editor/editor_group';

export function handleProblemsPanelResizePointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (!justPressed) {
		return false;
	}
	const bounds = getProblemsPanelBounds();
	if (bounds === null || !isPointerOverProblemsPanelDivider(bounds, snapshot.viewportX, snapshot.viewportY)) {
		return false;
	}
	problemsPanel.beginResize(snapshot, bounds.bottom - bounds.top);
	clearEditorPointerSelectionState();
	return true;
}

export function handleProblemsPanelPointer(
	editorGroup: EditorGroupView,
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
	if (!problemsPanel.handlePointer(editorGroup, snapshot, justPressed, justReleased, problemsBounds)) {
		return false;
	}
	clearEditorPointerSelectionState();
	return true;
}
