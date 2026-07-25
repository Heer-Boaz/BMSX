import * as constants from '../../../../common/constants';
import { showEditorMessage } from '../../../../common/feedback_state';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../../../input/keyboard/key_input';
import { resetBlink } from '../../../../editor/render/caret';
import type { ResourcePanelController } from './controller';

export function handleResourcePanelKeyboardInput(controller: ResourcePanelController): void {
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const shiftDown = isShiftDown();
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyR')) {
		consumeIdeKey('KeyR');
		showEditorMessage('Resolution toggle not handled by panel controller.', constants.COLOR_STATUS_TEXT, 1.2);
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressed('KeyB')) {
		consumeIdeKey('KeyB');
		controller.togglePanel();
		return;
	}
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		controller.hide();
		return;
	}
	if (isKeyJustPressed('Tab')) {
		consumeIdeKey('Tab');
		controller.setFocused(false);
		resetBlink();
		return;
	}
	if (controller.getMode() !== 'resources') {
		if (isKeyJustPressed('ArrowLeft')) {
			consumeIdeKey('ArrowLeft');
			controller.collapseSelectedCallHierarchyNode();
			return;
		}
		if (isKeyJustPressed('ArrowRight')) {
			consumeIdeKey('ArrowRight');
			controller.expandSelectedCallHierarchyNode();
			return;
		}
	} else {
		const horizontalStep = controller.getHorizontalScrollStep();
		if (isKeyJustPressed('ArrowLeft')) {
			consumeIdeKey('ArrowLeft');
			controller.scrollHorizontalBy(-horizontalStep);
			controller.ensureSelectionVisible();
			return;
		}
		if (isKeyJustPressed('ArrowRight')) {
			consumeIdeKey('ArrowRight');
			controller.scrollHorizontalBy(horizontalStep);
			controller.ensureSelectionVisible();
			return;
		}
	}
	if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		if (controller.getMode() === 'command') {
			controller.openSelectedCallHierarchyLocation();
		} else {
			controller.openSelected();
		}
		return;
	}
	if (controller.getMode() !== 'resources' && isKeyJustPressed('Space')) {
		consumeIdeKey('Space');
		controller.openSelected();
		return;
	}
	if (isKeyJustPressed('ArrowUp')) {
		consumeIdeKey('ArrowUp');
		controller.moveSelectionBy(-1);
		return;
	}
	if (isKeyJustPressed('ArrowDown')) {
		consumeIdeKey('ArrowDown');
		controller.moveSelectionBy(1);
		return;
	}
	if (isKeyJustPressed('PageUp')) {
		consumeIdeKey('PageUp');
		controller.moveSelectionBy(-controller.lineCapacity());
		return;
	}
	if (isKeyJustPressed('PageDown')) {
		consumeIdeKey('PageDown');
		controller.moveSelectionBy(controller.lineCapacity());
		return;
	}
	if (isKeyJustPressed('Home')) {
		consumeIdeKey('Home');
		controller.moveSelectionBy(Number.NEGATIVE_INFINITY);
		return;
	}
	if (isKeyJustPressed('End')) {
		consumeIdeKey('End');
		controller.moveSelectionBy(Number.POSITIVE_INFINITY);
	}
}
