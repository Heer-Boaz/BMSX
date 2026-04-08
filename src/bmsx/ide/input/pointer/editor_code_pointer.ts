import { $ } from '../../../core/engine_core';
import { ide_state } from '../../core/ide_state';
import type { CodeTabContext, PointerSnapshot } from '../../core/types';
import { getCodeAreaBounds } from '../../ui/editor_view';
import { handleCodeAreaPointerGuards } from './editor_code_pointer_guard';
import { handleCodeAreaPrimaryPressPointer } from './editor_code_pointer_primary_press';
import { handleCodeAreaGutterPointer, handleCodeAreaSecondaryPointer } from './editor_code_pointer_secondary_actions';
import { updateCodeAreaPointerFeedback } from './editor_code_pointer_feedback';
import { handleCodeAreaSelectionPointer } from './editor_code_pointer_selection';

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
	if (handleCodeAreaGutterPointer(snapshot, justPressed, inGutter)) {
		return;
	}
	if (handleCodeAreaPrimaryPressPointer(snapshot, justPressed, insideCodeArea, gotoModifierActive)) {
		return;
	}
	handleCodeAreaSelectionPointer(snapshot);
	updateCodeAreaPointerFeedback(snapshot, insideCodeArea, gotoModifierActive, ide_state.pointerSelecting, activeContext);
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
}
