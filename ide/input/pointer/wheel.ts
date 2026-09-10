import type { CartEditor } from '../../cart_editor';
import type { PlayerInput } from '../../../hosts/common/input/player';
import { point_in_rect } from '../../../machine/ts/common/rect';
import * as constants from '../../common/constants';
import { problemsPanel } from '../../workbench/contrib/problems/panel/controller';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import type { PointerSnapshot } from '../../common/models';
import { getProblemsPanelBounds } from '../../workbench/contrib/problems/panel/controller';
import { isPointInHoverTooltip, pointerHitsHoverTarget, adjustHoverTooltipScroll } from '../../editor/ui/hover_tooltip';
import { isShiftDown } from '../keyboard/key_input';
import { scrollResourceBrowserHorizontal } from '../../workbench/input/keyboard/resource_viewer_input';
import { editorPointerState } from './state';
import { hoverState } from '../../editor/contrib/hover/state';
import { editorViewState } from '../../editor/ui/view/state';
import { editorChromeState } from '../../workbench/ui/chrome_state';

export function handleEditorWheelInput(editor: CartEditor, playerInput: PlayerInput): void {
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
	if (editor.quickInput.visible) {
		editor.quickInput.handleWheel(direction * steps);
		playerInput.inputHandlers.pointer.consumeButton('pointer_wheel');
		return;
	}
	const pointer = editorPointerState.lastPointerSnapshot;
	const activePointer = pointer !== null && pointer.valid && pointer.insideViewport ? pointer : null;
	if (handleHoverTooltipWheel(direction, steps, activePointer, playerInput)) {
		return;
	}
	if (activePointer !== null && point_in_rect(activePointer.viewportX, activePointer.viewportY, editorChromeState.tabBarBounds)) {
		editorChromeState.tabScrollControl.cancelPointer();
		const bar = editorChromeState.tabScrollbar;
		bar.setScroll(bar.getScroll() + direction * steps * editorViewState.charAdvance * 4);
		playerInput.inputHandlers.pointer.consumeButton('pointer_wheel');
		return;
	}
	if (handleResourcePanelWheel(editor.resourcePanel, direction, steps, activePointer, playerInput)) {
		return;
	}
	if (handleProblemsPanelWheel(editor, direction, steps, activePointer, playerInput)) {
		return;
	}
	editor.editorPanes.activePane.handleWheel(direction, steps, activePointer, playerInput);
}

function handleHoverTooltipWheel(
	direction: number,
	steps: number,
	activePointer: PointerSnapshot,
	playerInput: PlayerInput
): boolean {
	if (!hoverState.tooltip) {
		return false;
	}
	const tooltip = hoverState.tooltip;
	const pointerInTooltip = activePointer !== null && isPointInHoverTooltip(activePointer.viewportX, activePointer.viewportY);
	const pointerInTarget = activePointer !== null && pointerHitsHoverTarget(activePointer, tooltip);
	const allowTooltipScroll = pointerInTooltip || pointerInTarget || activePointer === null;
	if (allowTooltipScroll && adjustHoverTooltipScroll(direction * steps)) {
		playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
		return true;
	}
	if (!pointerInTooltip) {
		return false;
	}
	playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
	return true;
}

function handleResourcePanelWheel(
	resourcePanel: ResourcePanelController,
	direction: number,
	steps: number,
	activePointer: PointerSnapshot,
	playerInput: PlayerInput
): boolean {
	const panelBounds = resourcePanel.getBounds();
	const pointerInPanel = resourcePanel.isVisible()
		&& panelBounds !== null
		&& activePointer !== null
		&& point_in_rect(activePointer.viewportX, activePointer.viewportY, panelBounds);
	if (!pointerInPanel) {
		return false;
	}
	if (isShiftDown(playerInput)) {
		const horizontalPixels = direction * steps * editorViewState.charAdvance * 4;
		scrollResourceBrowserHorizontal(resourcePanel, horizontalPixels);
		resourcePanel.ensureSelectionVisible();
	} else {
		resourcePanel.scrollBy(direction * steps);
	}
	playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
	return true;
}

function handleProblemsPanelWheel(
	editor: CartEditor,
	direction: number,
	steps: number,
	activePointer: PointerSnapshot,
	playerInput: PlayerInput
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
			void problemsPanel.handleKeyboardCommand(editor.editorPanes, direction > 0 ? 'down' : 'up');
		}
		playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
		return true;
	}
	if (!allowScroll || !problemsPanel.handlePointerWheel(direction, steps)) {
		return false;
	}
	playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
	return true;
}
