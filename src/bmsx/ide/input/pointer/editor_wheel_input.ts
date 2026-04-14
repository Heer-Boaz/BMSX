import { $ } from '../../../core/engine_core';
import { point_in_rect } from '../../../utils/rect_operations';
import * as constants from '../../core/constants';
import { problemsPanel } from '../../contrib/problems/problems_panel';
import { resourcePanel } from '../../contrib/resources/resource_panel_controller';
import type { PointerSnapshot } from '../../core/types';
import { isCodeTabActive, isResourceViewActive } from '../../ui/editor_tabs';
import { getProblemsPanelBounds } from '../../contrib/problems/problems_panel';
import { isPointInHoverTooltip, pointerHitsHoverTarget, adjustHoverTooltipScroll } from '../../ui/hover_tooltip';
import { getCodeAreaBounds, getResourceSearchBarBounds, scrollResourceBrowser, scrollRows } from '../../ui/editor_view';
import { moveResourceSearchSelection } from '../../contrib/resources/resource_search_catalog';
import { isShiftDown } from '../keyboard/key_input';
import { scrollResourceBrowserHorizontal, scrollResourceViewer } from '../keyboard/resource_viewer_input';
import { editorPointerState } from './editor_pointer_state';
import { editorCaretState } from '../../ui/caret_state';
import { intellisenseUiState } from '../../contrib/intellisense/intellisense_ui_state';
import { editorViewState } from '../../ui/editor_view_state';
import { editorFeatureState } from '../../core/editor_feature_state';

export function handleEditorWheelInput(): void {
	const playerInput = $.input.getPlayerInput(1);
	const wheelState = playerInput.getRawButtonState('pointer_wheel', 'pointer');
	if (wheelState.consumed === true) {
		return;
	}
	const delta = wheelState.value;
	if (!delta) {
		return;
	}
	const magnitude = Math.abs(delta);
	const steps = ~~(magnitude / constants.WHEEL_SCROLL_STEP);
	const direction = delta > 0 ? 1 : -1;
	const pointer = editorPointerState.lastPointerSnapshot;
	const activePointer = pointer !== null && pointer.valid && pointer.insideViewport ? pointer : null;
	if (handleHoverTooltipWheel(direction, steps, activePointer, playerInput)) {
		return;
	}
	if (handleResourceSearchWheel(direction, steps, activePointer, playerInput)) {
		return;
	}
	if (handleResourcePanelWheel(direction, steps, activePointer, playerInput)) {
		return;
	}
	if (handleProblemsPanelWheel(direction, steps, activePointer, playerInput)) {
		return;
	}
	if (editorFeatureState.completion.handlePointerWheel(direction, steps, activePointer !== null ? { x: activePointer.viewportX, y: activePointer.viewportY } : null)) {
		playerInput.consumeRawButton('pointer_wheel', 'pointer');
		return;
	}
	if (isResourceViewActive()) {
		scrollResourceViewer(direction * steps);
		playerInput.consumeRawButton('pointer_wheel', 'pointer');
		return;
	}
	if (isCodeTabActive() && pointer !== null) {
		const bounds = getCodeAreaBounds();
		if (!pointer.valid || !pointer.insideViewport || pointer.viewportY < bounds.codeTop || pointer.viewportY >= bounds.codeBottom || pointer.viewportX < bounds.codeLeft || pointer.viewportX >= bounds.codeRight) {
			playerInput.consumeRawButton('pointer_wheel', 'pointer');
			return;
		}
	}
	scrollRows(direction * steps);
	editorCaretState.cursorRevealSuspended = true;
	playerInput.consumeRawButton('pointer_wheel', 'pointer');
}

function handleHoverTooltipWheel(
	direction: number,
	steps: number,
	activePointer: PointerSnapshot,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	if (!intellisenseUiState.hoverTooltip) {
		return false;
	}
	const tooltip = intellisenseUiState.hoverTooltip;
	const pointerInTooltip = activePointer !== null && isPointInHoverTooltip(activePointer.viewportX, activePointer.viewportY);
	const pointerInTarget = activePointer !== null && pointerHitsHoverTarget(activePointer, tooltip);
	const allowTooltipScroll = pointerInTooltip || pointerInTarget || activePointer === null;
	if (allowTooltipScroll && adjustHoverTooltipScroll(direction * steps)) {
		playerInput.consumeRawButton('pointer_wheel', 'pointer');
		return true;
	}
	if (!pointerInTooltip) {
		return false;
	}
	playerInput.consumeRawButton('pointer_wheel', 'pointer');
	return true;
}

function handleResourceSearchWheel(
	direction: number,
	steps: number,
	activePointer: PointerSnapshot,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	if (!editorFeatureState.resourceSearch.visible) {
		return false;
	}
	const bounds = getResourceSearchBarBounds();
	const pointerInQuickOpen = bounds !== null
		&& activePointer !== null
		&& point_in_rect(activePointer.viewportX, activePointer.viewportY, bounds);
	if (!pointerInQuickOpen && !editorFeatureState.resourceSearch.active) {
		return false;
	}
	moveResourceSearchSelection(direction * steps);
	playerInput.consumeRawButton('pointer_wheel', 'pointer');
	return true;
}

function handleResourcePanelWheel(
	direction: number,
	steps: number,
	activePointer: PointerSnapshot,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	const panelBounds = resourcePanel.getBounds();
	const pointerInPanel = resourcePanel.isVisible()
		&& panelBounds !== null
		&& activePointer !== null
		&& point_in_rect(activePointer.viewportX, activePointer.viewportY, panelBounds);
	if (!pointerInPanel) {
		return false;
	}
	if (isShiftDown()) {
		const horizontalPixels = direction * steps * editorViewState.charAdvance * 4;
		scrollResourceBrowserHorizontal(horizontalPixels);
		resourcePanel.ensureSelectionVisible();
	} else {
		scrollResourceBrowser(direction * steps);
	}
	playerInput.consumeRawButton('pointer_wheel', 'pointer');
	return true;
}

function handleProblemsPanelWheel(
	direction: number,
	steps: number,
	activePointer: PointerSnapshot,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	if (!problemsPanel.isVisible) {
		return false;
	}
	const bounds = getProblemsPanelBounds();
	if (!bounds) {
		return false;
	}
	let allowScroll = false;
	if (activePointer === null) {
		allowScroll = problemsPanel.isFocused;
	} else if (point_in_rect(activePointer.viewportX, activePointer.viewportY, bounds)) {
		allowScroll = true;
	}
	if (problemsPanel.isFocused) {
		for (let i = 0; i < steps; i += 1) {
			void problemsPanel.handleKeyboardCommand(direction > 0 ? 'down' : 'up');
		}
		playerInput.consumeRawButton('pointer_wheel', 'pointer');
		return true;
	}
	if (!allowScroll || !problemsPanel.handlePointerWheel(direction, steps)) {
		return false;
	}
	playerInput.consumeRawButton('pointer_wheel', 'pointer');
	return true;
}
