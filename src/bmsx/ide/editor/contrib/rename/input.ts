import { consumeIdeKey } from '../../../input/keyboard/key_input';
import { isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { redo, undo } from '../../editing/undo_controller';
import type { RenameController } from './controller';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function handleRenameControllerInput(runtime: Runtime, controller: RenameController): void {
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
		controller.commit(runtime);
		return;
	}
	if (isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('NumpadEnter');
		controller.commit(runtime);
		return;
	}
	controller.applyFieldEditing();
}
