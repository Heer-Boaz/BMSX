import * as constants from '../../../../common/constants';
import { showEditorMessage } from '../../../../common/feedback_state';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../../../input/keyboard/key_input';
import { resetBlink } from '../../../../editor/render/caret';
import type { ResourcePanelController } from './controller';
import type { PlayerInput } from '../../../../../machine/ts/input/player';

export function handleResourcePanelKeyboardInput(playerInput: PlayerInput, controller: ResourcePanelController): void {
	const ctrlDown = isCtrlDown(playerInput);
	const metaDown = isMetaDown(playerInput);
	const shiftDown = isShiftDown(playerInput);
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyR', playerInput)) {
		consumeIdeKey('KeyR', playerInput);
		showEditorMessage('Resolution toggle not handled by panel controller.', constants.COLOR_STATUS_TEXT, 1.2);
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
	} else {
		const horizontalStep = controller.getHorizontalScrollStep();
		if (isKeyJustPressed('ArrowLeft', playerInput)) {
			consumeIdeKey('ArrowLeft', playerInput);
			controller.scrollHorizontalBy(-horizontalStep);
			controller.ensureSelectionVisible();
			return;
		}
		if (isKeyJustPressed('ArrowRight', playerInput)) {
			consumeIdeKey('ArrowRight', playerInput);
			controller.scrollHorizontalBy(horizontalStep);
			controller.ensureSelectionVisible();
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
