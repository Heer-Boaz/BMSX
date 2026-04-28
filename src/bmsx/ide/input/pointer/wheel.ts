import { consoleCore } from '../../../core/console';
import { point_in_rect } from '../../../common/rect';
import * as constants from '../../common/constants';
import { problemsPanel } from '../../workbench/contrib/problems/panel/controller';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import type { PointerSnapshot } from '../../common/models';
import { isResourceViewActive } from '../../workbench/ui/tabs';
import { isCodeTabActive } from '../../workbench/ui/code_tab/contexts';
import { getProblemsPanelBounds } from '../../workbench/contrib/problems/panel/controller';
import { isPointInHoverTooltip, pointerHitsHoverTarget, adjustHoverTooltipScroll } from '../../editor/ui/hover_tooltip';
import { getCodeAreaBounds, getResourceSearchBarBounds, scrollRows } from '../../editor/ui/view/view';
import { moveResourceSearchSelection } from '../../workbench/contrib/resources/search/catalog';
import { isShiftDown } from '../keyboard/key_input';
import { scrollResourceBrowserHorizontal, scrollResourceViewer } from '../../workbench/input/keyboard/resource_viewer_input';
import { editorPointerState } from './state';
import { editorCaretState } from '../../editor/ui/view/caret/state';
import { intellisenseUiState } from '../../editor/contrib/intellisense/ui_state';
import { editorViewState } from '../../editor/ui/view/state';
import { resourceSearchState } from '../../workbench/contrib/resources/widget_state';
import type { Runtime } from '../../../machine/runtime/runtime';

export function handleEditorWheelInput(runtime: Runtime): void {
	const playerInput = consoleCore.input.getPlayerInput(1);
	const wheelState = playerInput.getRawButtonState('pointer_wheel', 'pointer');
	if (wheelState.consumed) {
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
	if (handleResourcePanelWheel(runtime.editor.resourcePanel, direction, steps, activePointer, playerInput)) {
		return;
	}
	if (handleProblemsPanelWheel(direction, steps, activePointer, playerInput)) {
		return;
	}
	if (runtime.editor.completion.handlePointerWheel(direction, steps, activePointer !== null ? { x: activePointer.viewportX, y: activePointer.viewportY } : null)) {
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
	playerInput: ReturnType<typeof consoleCore.input.getPlayerInput>
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
	playerInput: ReturnType<typeof consoleCore.input.getPlayerInput>
): boolean {
	if (!resourceSearchState.visible) {
		return false;
	}
	const bounds = getResourceSearchBarBounds();
	const pointerInQuickOpen = bounds !== null
		&& activePointer !== null
		&& point_in_rect(activePointer.viewportX, activePointer.viewportY, bounds);
	if (!pointerInQuickOpen && !resourceSearchState.active) {
		return false;
	}
	moveResourceSearchSelection(direction * steps);
	playerInput.consumeRawButton('pointer_wheel', 'pointer');
	return true;
}

function handleResourcePanelWheel(
	resourcePanel: ResourcePanelController,
	direction: number,
	steps: number,
	activePointer: PointerSnapshot,
	playerInput: ReturnType<typeof consoleCore.input.getPlayerInput>
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
		scrollResourceBrowserHorizontal(resourcePanel, horizontalPixels);
		resourcePanel.ensureSelectionVisible();
	} else {
		resourcePanel.scrollBy(direction * steps);
	}
	playerInput.consumeRawButton('pointer_wheel', 'pointer');
	return true;
}

function handleProblemsPanelWheel(
	direction: number,
	steps: number,
	activePointer: PointerSnapshot,
	playerInput: ReturnType<typeof consoleCore.input.getPlayerInput>
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
