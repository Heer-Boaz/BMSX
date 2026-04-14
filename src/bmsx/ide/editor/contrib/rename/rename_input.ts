import { consumeIdeKey } from '../../input/keyboard/key_input';
import { isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../input/keyboard/key_input';
import { redo, undo } from '../../editing/undo_controller';
import type { RenameController } from './rename_controller';

export function handleRenameControllerInput(controller: RenameController): void {
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
		controller.commit();
		return;
	}
	if (isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('NumpadEnter');
		controller.commit();
		return;
	}
	controller.applyFieldEditing();
}
