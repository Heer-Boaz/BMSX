import { pointerHover } from './hover';
import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import { getProblemsPanelBounds, problemsPanel } from '../../workbench/contrib/problems/panel/controller';
import type { EditorGroupView } from '../../workbench/services/editor/editor_group';

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
	return true;
}
