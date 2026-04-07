import { $ } from '../../../core/engine_core';
import { ide_state } from '../ide_state';
import type { PointerSnapshot } from '../types';
import { isResourceViewActive, getActiveCodeTabContext, updateTabDrag, endTabDrag } from '../editor_tabs';
import { applyScrollbarScroll } from '../scrollbar';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../intellisense';
import { handleActionPromptPointer } from './action_prompt';
import { handleTopBarPointer, handleTabBarMiddleClick, handleTabBarPointer, updateTabHoverState } from './editor_chrome_input';
import { handleEditorContextMenuPointer } from './editor_context_menu_input';
import { getTabBarTotalHeight, bottomMargin, resetPointerClickTracking, mapScreenPointToViewport } from '../editor_view';
import { isCtrlDown, isMetaDown } from './key_input';
import { handleQuickInputPointer } from './editor_quick_input_pointer';
import { handleCodeAreaPointerInput } from './editor_code_pointer';
import { handleEditorPanelPointer, handleEditorPanelResizePointer } from './editor_panel_pointer';

export function handleTextEditorPointerInput(): void {
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const gotoModifierActive = ctrlDown || metaDown;
	if (!gotoModifierActive) {
		clearGotoHoverHighlight();
	}
	const activeContext = getActiveCodeTabContext();
	const snapshot = readPointerSnapshot();
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
			return;
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
	const playerInput = $.input.getPlayerInput(1);
	const secondaryAction = playerInput.getActionState('pointer_secondary');
	const pointerSecondaryPressed = secondaryAction.pressed === true && secondaryAction.consumed !== true;
	const pointerSecondaryJustPressed = secondaryAction.justpressed === true && secondaryAction.consumed !== true
		|| (pointerSecondaryPressed && !ide_state.pointerSecondaryWasPressed);
	const auxAction = playerInput.getActionState('pointer_aux');
	const pointerAuxPressed = auxAction.pressed === true && auxAction.consumed !== true;
	const pointerAuxJustPressed = auxAction.justpressed === true && auxAction.consumed !== true
		|| (pointerAuxPressed && !ide_state.pointerAuxWasPressed);
	ide_state.pointerSecondaryWasPressed = pointerSecondaryPressed;
	ide_state.pointerAuxWasPressed = pointerAuxPressed;
	const wasPressed = ide_state.pointerPrimaryWasPressed;
	const justPressed = snapshot.primaryPressed && !wasPressed;
	const justReleased = !snapshot.primaryPressed && wasPressed;
	if (justReleased || (!snapshot.primaryPressed && ide_state.pointerSelecting)) {
		ide_state.pointerSelecting = false;
	}
	if (handleEditorContextMenuPointer(snapshot, justPressed, pointerSecondaryJustPressed, playerInput)) {
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (ide_state.tabDragState) {
		if (!snapshot.primaryPressed) {
			endTabDrag();
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearGotoHoverHighlight();
			clearHoverTooltip();
			return;
		}
		updateTabDrag(snapshot.viewportX, snapshot.viewportY);
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		clearHoverTooltip();
		return;
	}
	if (justPressed && ide_state.scrollbarController.begin(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, bottomMargin(), (kind, scroll) => applyScrollbarScroll(kind, scroll))) {
		ide_state.pointerSelecting = false;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		return;
	}
	if (justPressed && handleTopBarPointer(snapshot)) {
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		resetPointerClickTracking();
		clearGotoHoverHighlight();
		return;
	}
	if (handleEditorPanelResizePointer(snapshot, justPressed)) {
		return;
	}
	if (!snapshot.valid) {
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	if (pointerAuxJustPressed && handleTabBarMiddleClick(snapshot)) {
		playerInput.consumeAction('pointer_aux');
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		resetPointerClickTracking();
		clearGotoHoverHighlight();
		return;
	}
	if (justPressed && snapshot.viewportY >= tabTop && snapshot.viewportY < tabBottom) {
		if (handleTabBarPointer(snapshot)) {
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			clearGotoHoverHighlight();
			return;
		}
	}
	if (handleEditorPanelPointer(snapshot, justPressed, justReleased)) {
		return;
	}
	if (isResourceViewActive()) {
		resetPointerClickTracking();
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (ide_state.pendingActionPrompt) {
		resetPointerClickTracking();
		if (justPressed) {
			handleActionPromptPointer(snapshot);
		}
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (handleQuickInputPointer(snapshot, justPressed)) {
		return;
	}
	handleCodeAreaPointerInput(snapshot, justPressed, gotoModifierActive, activeContext, pointerSecondaryJustPressed, playerInput);
}

function readPointerSnapshot(): PointerSnapshot {
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
