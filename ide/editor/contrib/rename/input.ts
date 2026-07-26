import { consumeIdeKey } from '../../../input/keyboard/key_input';
import { isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { redo, undo } from '../../editing/undo_controller';
import type { RenameController } from './controller';
import type { CrossFileRenameManager } from './operations';

export function handleRenameControllerInput(controller: RenameController, crossFileRename: CrossFileRenameManager): void {
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const shiftDown = isShiftDown();

	if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyZ')) {
		consumeIdeKey('KeyZ');
		if (shiftDown) {
			redo();
		} else {
			undo();
		}
		return;
	}
	if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyY')) {
		consumeIdeKey('KeyY');
		redo();
		return;
	}
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		controller.cancel();
		return;
	}
	if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		controller.commit(crossFileRename);
		return;
	}
	if (isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('NumpadEnter');
		controller.commit(crossFileRename);
		return;
	}
	controller.applyFieldEditing();
}
