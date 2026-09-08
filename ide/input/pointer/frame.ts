import type { PlayerInput } from '../../../hosts/common/input/player';
import { applyScrollbarScroll } from './scrollbar';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../editor/contrib/hover/controller';
import { mapScreenPointToViewport } from '../../editor/ui/view/view';
import { updateTabHoverState } from '../../workbench/input/pointer/tab_bar/pointer';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { endTabDrag } from '../../workbench/ui/tab/drag';
import type { PointerSnapshot } from '../../common/models';
import { editorPointerState } from './state';
import { editorViewState } from '../../editor/ui/view/state';
import { editorSearchState, lineJumpState } from '../../workbench/contrib/code_editor/find/widget_state';
import { symbolSearchState } from '../../workbench/contrib/code_editor/symbols/search/state';
import { createResourceState } from '../../workbench/contrib/resources/widget_state';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import type { EditorDisplay } from '../../common/viewport';

export function readEditorPointerSnapshot(display: EditorDisplay, playerInput: PlayerInput): PointerSnapshot {
	const primaryState = playerInput.getRawButtonState('pointer_primary', 'pointer');
	const primaryPressed = primaryState.pressed && !primaryState.consumed;
	const positionState = playerInput.getRawButtonState('pointer_position', 'pointer');
	const coords = positionState.value2d;
	if (!coords) {
		return {
			viewportX: 0,
			viewportY: 0,
			insideViewport: false,
			valid: false,
			primaryPressed,
		};
	}
	const mapped = mapScreenPointToViewport(display, coords[0], coords[1]);
	return {
		viewportX: mapped.x,
		viewportY: mapped.y,
		insideViewport: mapped.inside,
		valid: mapped.valid,
		primaryPressed,
	};
}

export function prepareEditorPointerFrame(
	resourcePanel: ResourcePanelController,
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
		editorChromeState.tabHoverId = null;
		editorChromeState.resourcePanelResizing = false;
	} else {
		updateTabHoverState(snapshot);
	}
	editorPointerState.lastPointerSnapshot = snapshot.valid ? snapshot : null;
	if (!snapshot.valid || workbenchInputBlocked) {
		editorViewState.scrollbarController.cancel();
		editorPointerState.lastPointerRowResolution = null;
		clearGotoHoverHighlight();
	} else if (editorViewState.scrollbarController.hasActiveDrag() && !snapshot.primaryPressed) {
		editorViewState.scrollbarController.cancel();
	} else if (editorViewState.scrollbarController.hasActiveDrag() && snapshot.primaryPressed) {
		if (editorViewState.scrollbarController.update(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, (kind, scroll) => applyScrollbarScroll(resourcePanel, kind, scroll))) {
			editorPointerState.pointerSelecting = false;
			clearHoverTooltip();
			return true;
		}
	}
	if (!snapshot.primaryPressed) {
		editorPointerState.pointerSelecting = false;
		editorSearchState.field.pointerSelecting = false;
		symbolSearchState.field.pointerSelecting = false;
		lineJumpState.field.pointerSelecting = false;
		createResourceState.field.pointerSelecting = false;
		symbolSearchState.hoverIndex = -1;
	}
	return false;
}
