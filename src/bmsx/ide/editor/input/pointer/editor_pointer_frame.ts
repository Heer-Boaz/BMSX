import { $ } from '../../../../core/engine_core';
import { applyScrollbarScroll } from '../../ui/scrollbar';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { mapScreenPointToViewport } from '../../ui/editor_view';
import { updateTabHoverState } from '../../../workbench/input/pointer/tab_bar_pointer';
import type { PointerSnapshot } from '../../../common/types';
import { editorPointerState } from './editor_pointer_state';
import { editorViewState } from '../../ui/editor_view_state';
import { editorFeatureState } from '../../common/editor_feature_state';

export function readEditorPointerSnapshot(): PointerSnapshot {
	const playerInput = $.input.getPlayerInput(1);
	const primaryState = playerInput.getRawButtonState('pointer_primary', 'pointer');
	const primaryPressed = primaryState.pressed === true && primaryState.consumed !== true;
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

export function prepareEditorPointerFrame(snapshot: PointerSnapshot, gotoModifierActive: boolean): boolean {
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
		if (editorViewState.scrollbarController.update(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, (kind, scroll) => applyScrollbarScroll(kind, scroll))) {
			editorPointerState.pointerSelecting = false;
			clearHoverTooltip();
			editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
			return true;
		}
	}
	if (!snapshot.primaryPressed) {
		editorFeatureState.search.field.pointerSelecting = false;
		editorFeatureState.symbolSearch.field.pointerSelecting = false;
		editorFeatureState.resourceSearch.field.pointerSelecting = false;
		editorFeatureState.lineJump.field.pointerSelecting = false;
		editorFeatureState.createResource.field.pointerSelecting = false;
		editorFeatureState.symbolSearch.hoverIndex = -1;
		editorFeatureState.resourceSearch.hoverIndex = -1;
	}
	return false;
}
