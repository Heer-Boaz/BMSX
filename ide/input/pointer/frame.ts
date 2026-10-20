import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { mapDisplayPointToViewport, DisplayPointMappingResult } from '../../../machine/ts/render/video_output';
import type { PointerInputEvent } from '../../../hosts/common/input/pointer_event';
import { editorViewState } from '../../editor/ui/view/state';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { endTabDrag } from '../../workbench/ui/tab/drag';
import type { PointerInputSnapshot } from '../../common/models';
import { editorPointerState } from './state';
import { editorSearchState, lineJumpState } from '../../workbench/contrib/code_editor/find/widget_state';
import type { EditorDisplay } from '../../common/viewport';

const mapped = { x: 0, y: 0 };

/** Project native client coordinates into the retained editor's logical viewport. */
export function projectEditorPointerEvent(display: EditorDisplay, event: PointerInputEvent, snapshot: PointerInputSnapshot): void {
	const result = mapDisplayPointToViewport(display.measureDisplay(), editorViewState.viewportWidth, editorViewState.viewportHeight, event.x, event.y, mapped);
	snapshot.viewportX = mapped.x;
	snapshot.viewportY = mapped.y;
	snapshot.insideViewport = result === DisplayPointMappingResult.Inside;
	snapshot.valid = result !== DisplayPointMappingResult.Invalid;
	snapshot.pressedButtons = event.buttons;
	snapshot.justPressedButtons = event.pressedButtons;
	snapshot.justReleasedButtons = event.releasedButtons;
	snapshot.modifiers = event.modifiers;
	snapshot.spaceDown = event.spaceDown;
}

export function prepareEditorPointerFrame(
	snapshot: PointerInputSnapshot,
	gotoModifierActive: boolean,
	workbenchInputBlocked: boolean,
): void {
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
		editorPointerState.lastPointerRowResolution = null;
	}
	if ((snapshot.pressedButtons & PointerButton.Primary) === 0) {
		editorPointerState.pointerSelecting = false;
		editorSearchState.field.pointerSelecting = false;
		lineJumpState.field.pointerSelecting = false;
	}
}
