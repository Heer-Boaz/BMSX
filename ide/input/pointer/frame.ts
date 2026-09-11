import { PointerButton, readEditorPointerButtons } from './buttons';
import type { PlayerInput } from '../../../hosts/common/input/player';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { mapScreenPointToViewport } from '../../editor/ui/view/view';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { endTabDrag } from '../../workbench/ui/tab/drag';
import type { PointerSnapshot } from '../../common/models';
import { editorPointerState } from './state';
import { editorViewState } from '../../editor/ui/view/state';
import { editorSearchState, lineJumpState } from '../../workbench/contrib/code_editor/find/widget_state';
import { symbolSearchState } from '../../workbench/contrib/code_editor/symbols/search/state';
import { createResourceState } from '../../workbench/contrib/resources/widget_state';
import type { EditorDisplay } from '../../common/viewport';

export function readEditorPointerSnapshot(display: EditorDisplay, playerInput: PlayerInput): PointerSnapshot {
	const snapshot: PointerSnapshot = {
		viewportX: 0, viewportY: 0, insideViewport: false, valid: false,
		pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0,
	};
	readEditorPointerButtons(playerInput, snapshot);
	const coords = playerInput.getRawButtonState('pointer_position', 'pointer').value2d;
	if (coords === null) return snapshot;
	const mapped = mapScreenPointToViewport(display, coords[0], coords[1]);
	snapshot.viewportX = mapped.x;
	snapshot.viewportY = mapped.y;
	snapshot.insideViewport = mapped.inside;
	snapshot.valid = mapped.valid;
	return snapshot;
}

export function prepareEditorPointerFrame(
	snapshot: PointerSnapshot,
	gotoModifierActive: boolean,
	workbenchInputBlocked: boolean,
): boolean {
	if (!gotoModifierActive) {
		clearGotoHoverHighlight();
	}
	if (workbenchInputBlocked) {
		// An exclusive input surface ends lower gestures; it never suspends a
		// captured drag to resume later with the popup's release/cancel press.
		endTabDrag();
		editorChromeState.resourcePanelResizing = false;
	}
	editorPointerState.lastPointerSnapshot = snapshot.valid ? snapshot : null;
	if (!snapshot.valid || workbenchInputBlocked) {
		editorViewState.scrollbarController.cancel();
		editorPointerState.lastPointerRowResolution = null;
	} else if (editorViewState.scrollbarController.hasActiveDrag() && (snapshot.pressedButtons & PointerButton.Primary) === 0) {
		editorViewState.scrollbarController.cancel();
	} else if (editorViewState.scrollbarController.hasActiveDrag() && ((snapshot.pressedButtons & PointerButton.Primary) !== 0)) {
		if (editorViewState.scrollbarController.update(snapshot.viewportX, snapshot.viewportY, ((snapshot.pressedButtons & PointerButton.Primary) !== 0))) {
			editorPointerState.pointerSelecting = false;
			return true;
		}
	}
	if ((snapshot.pressedButtons & PointerButton.Primary) === 0) {
		editorPointerState.pointerSelecting = false;
		editorSearchState.field.pointerSelecting = false;
		symbolSearchState.field.pointerSelecting = false;
		lineJumpState.field.pointerSelecting = false;
		createResourceState.field.pointerSelecting = false;
	}
	return false;
}
