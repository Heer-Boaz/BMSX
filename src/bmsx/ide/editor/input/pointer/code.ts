import { $ } from '../../../../core/engine';
import type { CodeTabContext, PointerSnapshot } from '../../../common/models';
import { getCodeAreaBounds } from '../../ui/view/view';
import { handleCodeAreaPointerGuards } from './code/guard';
import { handleCodeAreaPrimaryPressPointer } from './code/primary_press';
import { handleCodeAreaGutterPointer, handleCodeAreaSecondaryPointer } from './code/secondary_actions';
import { updateCodeAreaPointerFeedback } from './code/feedback';
import { handleCodeAreaSelectionPointer } from './code/selection';
import { editorPointerState } from './state';

export function handleCodeAreaPointerInput(
	snapshot: PointerSnapshot,
	justPressed: boolean,
	gotoModifierActive: boolean,
	activeContext: CodeTabContext,
	pointerSecondaryJustPressed: boolean,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): void {
	const bounds = getCodeAreaBounds();
	if (handleCodeAreaPointerGuards(snapshot, justPressed, bounds.codeTop, bounds.codeRight, bounds.textLeft)) {
		return;
	}
	const insideCodeArea = snapshot.viewportY >= bounds.codeTop
		&& snapshot.viewportY < bounds.codeBottom
		&& snapshot.viewportX >= bounds.codeLeft
		&& snapshot.viewportX < bounds.codeRight;
	const inGutter = insideCodeArea
		&& snapshot.viewportX >= bounds.gutterLeft
		&& snapshot.viewportX < bounds.gutterRight;
	if (handleCodeAreaSecondaryPointer(snapshot, insideCodeArea, inGutter, pointerSecondaryJustPressed, playerInput)) {
		return;
	}
	if (handleCodeAreaGutterPointer(snapshot, justPressed, inGutter, bounds)) {
		return;
	}
	if (handleCodeAreaPrimaryPressPointer(snapshot, justPressed, insideCodeArea, gotoModifierActive, bounds)) {
		return;
	}
	handleCodeAreaSelectionPointer(snapshot, bounds);
	updateCodeAreaPointerFeedback(snapshot, insideCodeArea, gotoModifierActive, editorPointerState.pointerSelecting, activeContext, bounds);
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
}
