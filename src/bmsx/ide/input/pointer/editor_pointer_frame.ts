import { $ } from '../../../core/engine_core';
import { ide_state } from '../../core/ide_state';
import { applyScrollbarScroll } from '../../browser/scrollbar';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { mapScreenPointToViewport } from '../../browser/editor_view';
import { updateTabHoverState } from './editor_tab_bar_pointer';
import type { PointerSnapshot } from '../../core/types';

export function readEditorPointerSnapshot(): PointerSnapshot {
	const playerInput = $.input.getPlayerInput(1);
	const primaryAction = playerInput.getActionState('pointer_primary');
	const primaryPressed = primaryAction.pressed === true && primaryAction.consumed !== true;
	const positionAction = playerInput.getActionState('pointer_position');
	const coords = positionAction.value2d;
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

export function prepareEditorPointerFrame(snapshot: PointerSnapshot, gotoModifierActive: boolean): boolean {
	if (!gotoModifierActive) {
		clearGotoHoverHighlight();
	}
	updateTabHoverState(snapshot);
	ide_state.lastPointerSnapshot = snapshot.valid ? snapshot : null;
	if (!snapshot.valid) {
		ide_state.scrollbarController.cancel();
		ide_state.lastPointerRowResolution = null;
		clearGotoHoverHighlight();
	} else if (ide_state.scrollbarController.hasActiveDrag() && !snapshot.primaryPressed) {
		ide_state.scrollbarController.cancel();
	} else if (ide_state.scrollbarController.hasActiveDrag() && snapshot.primaryPressed) {
		if (ide_state.scrollbarController.update(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, (kind, scroll) => applyScrollbarScroll(kind, scroll))) {
			ide_state.pointerSelecting = false;
			clearHoverTooltip();
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			return true;
		}
	}
	if (!snapshot.primaryPressed) {
		ide_state.searchField.pointerSelecting = false;
		ide_state.symbolSearchField.pointerSelecting = false;
		ide_state.resourceSearchField.pointerSelecting = false;
		ide_state.lineJumpField.pointerSelecting = false;
		ide_state.createResourceField.pointerSelecting = false;
		ide_state.symbolSearchHoverIndex = -1;
		ide_state.resourceSearchHoverIndex = -1;
	}
	return false;
}
