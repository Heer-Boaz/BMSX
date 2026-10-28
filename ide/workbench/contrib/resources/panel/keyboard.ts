import type { KeyInputEvent } from '../../../../../hosts/common/input/text';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown } from '../../../../input/keyboard/key_input';
import { resetInlineBlink } from '../../../../editor/render/caret';
import type { ResourcePanelController } from './controller';

export function handleResourcePanelKeyboardInput(playerInput: KeyInputEvent, controller: ResourcePanelController): void {
	const ctrlDown = isCtrlDown(playerInput);
	const metaDown = isMetaDown(playerInput);
	for (const [key, command] of FILE_NAVIGATION) {
		if (!isKeyJustPressed(key, playerInput)) continue;
		consumeIdeKey(key, playerInput); controller.navigateFiles(command); return;
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
		resetInlineBlink();
		return;
	}
	if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		controller.openSelected();
	}
}

const FILE_NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;
