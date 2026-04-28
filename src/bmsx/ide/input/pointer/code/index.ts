import { consoleCore } from '../../../../core/console';
import type { Runtime } from '../../../../machine/runtime/runtime';
import type { CodeTabContext, PointerSnapshot } from '../../../common/models';
import * as constants from '../../../common/constants';
import { getCodeAreaBounds } from '../../../editor/ui/view/view';
import { editorViewState } from '../../../editor/ui/view/state';
import { handleCodeAreaPointerGuards } from './guard';
import { handleCodeAreaPrimaryPressPointer } from './primary_press';
import { handleCodeAreaGutterPointer, handleCodeAreaSecondaryPointer } from './secondary_actions';
import { updateCodeAreaPointerFeedback } from './feedback';
import { handleCodeAreaSelectionPointer } from './selection';
import { editorPointerState } from '../state';

export function handleCodeAreaPointerInput(
	runtime: Runtime,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	gotoModifierActive: boolean,
	activeContext: CodeTabContext,
	pointerSecondaryJustPressed: boolean,
	playerInput: ReturnType<typeof consoleCore.input.getPlayerInput>
): void {
	const bounds = getCodeAreaBounds();
	const contentBottom = editorViewState.codeHorizontalScrollbarVisible
		? bounds.codeBottom - constants.SCROLLBAR_WIDTH
		: bounds.codeBottom;
	if (handleCodeAreaPointerGuards(runtime, snapshot, justPressed, bounds.codeTop, bounds.codeRight, bounds.textLeft, contentBottom)) {
		return;
	}
	const insideCodeArea = snapshot.viewportY >= bounds.codeTop
		&& snapshot.viewportY < bounds.codeBottom
		&& snapshot.viewportX >= bounds.codeLeft
		&& snapshot.viewportX < bounds.codeRight;
	const inGutter = insideCodeArea
		&& snapshot.viewportX >= bounds.gutterLeft
		&& snapshot.viewportX < bounds.gutterRight;
	if (handleCodeAreaSecondaryPointer(runtime, snapshot, insideCodeArea, inGutter, pointerSecondaryJustPressed, playerInput)) {
		return;
	}
	if (handleCodeAreaGutterPointer(runtime, snapshot, justPressed, inGutter, bounds)) {
		return;
	}
	if (handleCodeAreaPrimaryPressPointer(runtime, snapshot, justPressed, insideCodeArea, gotoModifierActive, bounds)) {
		return;
	}
	handleCodeAreaSelectionPointer(snapshot, bounds);
	updateCodeAreaPointerFeedback(runtime, snapshot, insideCodeArea, gotoModifierActive, editorPointerState.pointerSelecting, activeContext, bounds);
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
}
