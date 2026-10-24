import type { KeyInputEvent } from '../../../../../hosts/common/input/text';
import { showEditorMessage } from '../../../../common/feedback_state';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../../../input/keyboard/key_input';
import { resetBlink } from '../../../../editor/render/caret';
import type { ResourcePanelController } from './controller';

export function handleResourcePanelKeyboardInput(playerInput: KeyInputEvent, controller: ResourcePanelController): void {
	const ctrlDown = isCtrlDown(playerInput);
	const metaDown = isMetaDown(playerInput);
	const shiftDown = isShiftDown(playerInput);
	if (controller.getMode() === 'resources') for (const [key, command] of FILE_NAVIGATION) {
		if (!isKeyJustPressed(key, playerInput)) continue;
		consumeIdeKey(key, playerInput); controller.navigateFiles(command); return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyR', playerInput)) {
		consumeIdeKey('KeyR', playerInput);
		showEditorMessage('Resolution toggle not handled by panel controller.', 'info', 1.2);
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressed('KeyB', playerInput)) {
		consumeIdeKey('KeyB', playerInput);
		controller.togglePanel();
		return;
	}
	if (isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		controller.hide();
		return;
	}
	if (isKeyJustPressed('Tab', playerInput)) {
		consumeIdeKey('Tab', playerInput);
		controller.setFocused(false);
		resetBlink();
		return;
	}
	if (controller.getMode() !== 'resources') {
		if (shiftDown && isAltDown(playerInput) && isKeyJustPressed('KeyH', playerInput)) {
			consumeIdeKey('KeyH', playerInput);
			controller.toggleCallHierarchyDirection();
			return;
		}
		if (isKeyJustPressed('ArrowLeft', playerInput)) {
			consumeIdeKey('ArrowLeft', playerInput);
			controller.collapseSelectedCallHierarchyNode();
			return;
		}
		if (isKeyJustPressed('ArrowRight', playerInput)) {
			consumeIdeKey('ArrowRight', playerInput);
			controller.expandSelectedCallHierarchyNode();
			return;
		}
	}
	if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		if (controller.getMode() === 'command') {
			controller.openSelectedCallHierarchyLocation();
		} else {
			controller.openSelected();
		}
		return;
	}
	if (controller.getMode() !== 'resources' && isKeyJustPressed('Space', playerInput)) {
		consumeIdeKey('Space', playerInput);
		controller.openSelected();
		return;
	}
	if (isKeyJustPressed('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		controller.moveSelectionBy(-1);
		return;
	}
	if (isKeyJustPressed('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		controller.moveSelectionBy(1);
		return;
	}
	if (isKeyJustPressed('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		controller.moveSelectionBy(-controller.lineCapacity());
		return;
	}
	if (isKeyJustPressed('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		controller.moveSelectionBy(controller.lineCapacity());
		return;
	}
	if (isKeyJustPressed('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		controller.moveSelectionBy(Number.NEGATIVE_INFINITY);
		return;
	}
	if (isKeyJustPressed('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		controller.moveSelectionBy(Number.POSITIVE_INFINITY);
	}
}

const FILE_NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;
