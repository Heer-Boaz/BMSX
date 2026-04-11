import { $ } from '../../../core/engine_core';
import { point_in_rect } from '../../../utils/rect_operations';
import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { isCodeTabActive, isResourceViewActive } from '../../ui/editor_tabs';
import { getProblemsPanelBounds } from '../../contrib/problems/problems_panel';
import { isPointInHoverTooltip, pointerHitsHoverTarget, adjustHoverTooltipScroll } from '../../ui/hover_tooltip';
import { getCodeAreaBounds, getResourceSearchBarBounds, scrollResourceBrowser, scrollRows } from '../../ui/editor_view';
import { moveResourceSearchSelection } from '../../contrib/resources/resource_search_catalog';
import { isShiftDown } from '../keyboard/key_input';
import { scrollResourceBrowserHorizontal, scrollResourceViewer } from '../keyboard/resource_viewer_input';

export function handleEditorWheelInput(): void {
	const playerInput = $.input.getPlayerInput(1);
	const wheelAction = playerInput.getActionState('pointer_wheel');
	if (wheelAction.consumed === true) {
		return;
	}
	const delta = wheelAction.value;
	if (!delta) {
		return;
	}
	const magnitude = Math.abs(delta);
	const steps = ~~(magnitude / constants.WHEEL_SCROLL_STEP);
	const direction = delta > 0 ? 1 : -1;
	const pointer = ide_state.lastPointerSnapshot;
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
	if (ide_state.completion.handlePointerWheel(direction, steps, activePointer !== null ? { x: activePointer.viewportX, y: activePointer.viewportY } : null)) {
		playerInput.consumeAction('pointer_wheel');
		return;
	}
	if (isResourceViewActive()) {
		scrollResourceViewer(direction * steps);
		playerInput.consumeAction('pointer_wheel');
		return;
	}
	if (isCodeTabActive() && pointer !== null) {
		const bounds = getCodeAreaBounds();
		if (!pointer.valid || !pointer.insideViewport || pointer.viewportY < bounds.codeTop || pointer.viewportY >= bounds.codeBottom || pointer.viewportX < bounds.codeLeft || pointer.viewportX >= bounds.codeRight) {
			playerInput.consumeAction('pointer_wheel');
			return;
		}
	}
	scrollRows(direction * steps);
	ide_state.cursorRevealSuspended = true;
	playerInput.consumeAction('pointer_wheel');
}

function handleHoverTooltipWheel(
	direction: number,
	steps: number,
	activePointer: typeof ide_state.lastPointerSnapshot,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	if (!ide_state.hoverTooltip) {
		return false;
	}
	const tooltip = ide_state.hoverTooltip;
	const pointerInTooltip = activePointer !== null && isPointInHoverTooltip(activePointer.viewportX, activePointer.viewportY);
	const pointerInTarget = activePointer !== null && pointerHitsHoverTarget(activePointer, tooltip);
	const allowTooltipScroll = pointerInTooltip || pointerInTarget || activePointer === null;
	if (allowTooltipScroll && adjustHoverTooltipScroll(direction * steps)) {
		playerInput.consumeAction('pointer_wheel');
		return true;
	}
	if (!pointerInTooltip) {
		return false;
	}
	playerInput.consumeAction('pointer_wheel');
	return true;
}

function handleResourceSearchWheel(
	direction: number,
	steps: number,
	activePointer: typeof ide_state.lastPointerSnapshot,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	if (!ide_state.resourceSearch.visible) {
		return false;
	}
	const bounds = getResourceSearchBarBounds();
	const pointerInQuickOpen = bounds !== null
		&& activePointer !== null
		&& point_in_rect(activePointer.viewportX, activePointer.viewportY, bounds);
	if (!pointerInQuickOpen && !ide_state.resourceSearch.active) {
		return false;
	}
	moveResourceSearchSelection(direction * steps);
	playerInput.consumeAction('pointer_wheel');
	return true;
}

function handleResourcePanelWheel(
	direction: number,
	steps: number,
	activePointer: typeof ide_state.lastPointerSnapshot,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	const panelBounds = ide_state.resourcePanel.getBounds();
	const pointerInPanel = ide_state.resourcePanelVisible
		&& panelBounds !== null
		&& activePointer !== null
		&& point_in_rect(activePointer.viewportX, activePointer.viewportY, panelBounds);
	if (!pointerInPanel) {
		return false;
	}
	if (isShiftDown()) {
		const horizontalPixels = direction * steps * ide_state.charAdvance * 4;
		scrollResourceBrowserHorizontal(horizontalPixels);
		ide_state.resourcePanel.ensureSelectionVisible();
	} else {
		scrollResourceBrowser(direction * steps);
	}
	playerInput.consumeAction('pointer_wheel');
	return true;
}

function handleProblemsPanelWheel(
	direction: number,
	steps: number,
	activePointer: typeof ide_state.lastPointerSnapshot,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	if (!ide_state.problemsPanel.isVisible) {
		return false;
	}
	const bounds = getProblemsPanelBounds();
	if (!bounds) {
		return false;
	}
	let allowScroll = false;
	if (activePointer === null) {
		allowScroll = ide_state.problemsPanel.isFocused;
	} else if (point_in_rect(activePointer.viewportX, activePointer.viewportY, bounds)) {
		allowScroll = true;
	}
	if (ide_state.problemsPanel.isFocused) {
		for (let i = 0; i < steps; i += 1) {
			void ide_state.problemsPanel.handleKeyboardCommand(direction > 0 ? 'down' : 'up');
		}
		playerInput.consumeAction('pointer_wheel');
		return true;
	}
	if (!allowScroll || !ide_state.problemsPanel.handlePointerWheel(direction, steps)) {
		return false;
	}
	playerInput.consumeAction('pointer_wheel');
	return true;
}
