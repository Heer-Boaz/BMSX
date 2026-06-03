import { consoleCore } from '../../../core/console';
import { applyScrollbarScroll } from './scrollbar';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { mapScreenPointToViewport } from '../../editor/ui/view/view';
import { updateTabHoverState } from '../../workbench/input/pointer/tab_bar/pointer';
import type { PointerSnapshot } from '../../common/models';
import { editorPointerState } from './state';
import { editorViewState } from '../../editor/ui/view/state';
import { editorSearchState, lineJumpState } from '../../editor/contrib/find/widget_state';
import { symbolSearchState } from '../../editor/contrib/symbols/search/state';
import { createResourceState, resourceSearchState } from '../../workbench/contrib/resources/widget_state';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';

export function readEditorPointerSnapshot(): PointerSnapshot {
	const playerInput = consoleCore.input.getPlayerInput(1);
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
	const mapped = mapScreenPointToViewport(coords[0], coords[1]);
	return {
		viewportX: mapped.x,
		viewportY: mapped.y,
		insideViewport: mapped.inside,
		valid: mapped.valid,
		primaryPressed,
	};
}

export function prepareEditorPointerFrame(resourcePanel: ResourcePanelController, snapshot: PointerSnapshot, gotoModifierActive: boolean): boolean {
	if (!gotoModifierActive) {
		clearGotoHoverHighlight();
	}
	updateTabHoverState(snapshot);
	editorPointerState.lastPointerSnapshot = snapshot.valid ? snapshot : null;
	if (!snapshot.valid) {
		editorViewState.scrollbarController.cancel();
		editorPointerState.lastPointerRowResolution = null;
		clearGotoHoverHighlight();
	} else if (editorViewState.scrollbarController.hasActiveDrag() && !snapshot.primaryPressed) {
		editorViewState.scrollbarController.cancel();
	} else if (editorViewState.scrollbarController.hasActiveDrag() && snapshot.primaryPressed) {
		if (editorViewState.scrollbarController.update(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, (kind, scroll) => applyScrollbarScroll(resourcePanel, kind, scroll))) {
			editorPointerState.pointerSelecting = false;
			clearHoverTooltip();
			editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
			return true;
		}
	}
	if (!snapshot.primaryPressed) {
		editorSearchState.field.pointerSelecting = false;
		symbolSearchState.field.pointerSelecting = false;
		resourceSearchState.field.pointerSelecting = false;
		lineJumpState.field.pointerSelecting = false;
		createResourceState.field.pointerSelecting = false;
		symbolSearchState.hoverIndex = -1;
		resourceSearchState.hoverIndex = -1;
	}
	return false;
}
