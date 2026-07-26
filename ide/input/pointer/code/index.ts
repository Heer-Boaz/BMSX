import { machineManager } from '../../../../machine/ts/core/machine_manager';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
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
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeNativeBridge } from '../../../runtime/native_bridge';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { RuntimeSourceState } from '../../../runtime/sources';

export function handleCodeAreaPointerInput(
	editor: CartEditor,
	sources: RuntimeSourceState,
	bridge: RuntimeNativeBridge,
	fault: RuntimeFaultState,
	runtime: Runtime,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	gotoModifierActive: boolean,
	activeContext: CodeTabContext,
	pointerSecondaryJustPressed: boolean,
	playerInput: ReturnType<typeof machineManager.input.getPlayerInput>
): void {
	const bounds = getCodeAreaBounds();
	const contentBottom = editorViewState.codeHorizontalScrollbarVisible
		? bounds.codeBottom - constants.SCROLLBAR_WIDTH
		: bounds.codeBottom;
	if (handleCodeAreaPointerGuards(editor, sources, runtime, snapshot, justPressed, bounds.codeTop, bounds.codeRight, bounds.textLeft, contentBottom)) {
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
	if (handleCodeAreaGutterPointer(editor.breakpoints, snapshot, justPressed, inGutter, bounds)) {
		return;
	}
	if (handleCodeAreaPrimaryPressPointer(
		editor,
		sources,
		bridge,
		fault,
		runtime,
		snapshot,
		justPressed,
		insideCodeArea,
		gotoModifierActive,
		bounds,
	)) {
		return;
	}
	handleCodeAreaSelectionPointer(snapshot, bounds);
	updateCodeAreaPointerFeedback(
		bridge,
		fault,
		runtime,
		snapshot,
		insideCodeArea,
		gotoModifierActive,
		editorPointerState.pointerSelecting,
		activeContext,
		bounds,
	);
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
}
