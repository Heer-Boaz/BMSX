import { consumeIdeKey } from '../../../../input/keyboard/key_input';
import { isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../../../input/keyboard/key_input';
import { redo, undo } from '../../../../editor/editing/undo_controller';
import type { RenameController } from './controller';
import type { CrossFileRenameManager } from './operations';
import type { PlayerInput } from '../../../../../hosts/common/input/player';
import type { Clipboard } from '../../../../common/clipboard';

export function handleRenameControllerInput(
	playerInput: PlayerInput,
	clipboard: Clipboard,
	controller: RenameController,
	crossFileRename: CrossFileRenameManager,
): void {
	const ctrlDown = isCtrlDown(playerInput);
	const metaDown = isMetaDown(playerInput);
	const shiftDown = isShiftDown(playerInput);

	if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyZ', playerInput)) {
		consumeIdeKey('KeyZ', playerInput);
		if (shiftDown) {
			redo();
		} else {
			undo();
		}
		return;
	}
	if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyY', playerInput)) {
		consumeIdeKey('KeyY', playerInput);
		redo();
		return;
	}
	if (isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		controller.cancel();
		return;
	}
	if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		controller.commit(crossFileRename);
		return;
	}
	if (isKeyJustPressed('NumpadEnter', playerInput)) {
		consumeIdeKey('NumpadEnter', playerInput);
		controller.commit(crossFileRename);
		return;
	}
	controller.applyFieldEditing(playerInput, clipboard);
}
