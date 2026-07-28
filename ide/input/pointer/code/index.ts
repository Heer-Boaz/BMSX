import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { PlayerInput } from '../../../../machine/ts/input/player';
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
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ClipboardService } from '../../../../machine/ts/platform/platform';

export function handleCodeAreaPointerInput(
	editor: CartEditor,
	sources: RuntimeSourceState,
	bridge: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	runtime: Runtime,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	gotoModifierActive: boolean,
	activeContext: CodeTabContext,
	pointerSecondaryJustPressed: boolean,
	playerInput: PlayerInput,
	now: number,
	clipboard: ClipboardService,
): void {
	const bounds = getCodeAreaBounds();
	const contentBottom = editorViewState.codeHorizontalScrollbarVisible
		? bounds.codeBottom - constants.SCROLLBAR_WIDTH
		: bounds.codeBottom;
	if (handleCodeAreaPointerGuards(
		clipboard,
		editor,
		runtime,
		snapshot,
		justPressed,
		bounds.codeTop,
		bounds.codeRight,
		bounds.textLeft,
		contentBottom,
	)) {
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
		now,
	)) {
		return;
	}
	handleCodeAreaSelectionPointer(snapshot, bounds);
	updateCodeAreaPointerFeedback(
		playerInput,
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
