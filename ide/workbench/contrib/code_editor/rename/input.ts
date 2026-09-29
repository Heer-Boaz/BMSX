import { consumeIdeKey } from '../../../../input/keyboard/key_input';
import { isKeyJustPressed } from '../../../../input/keyboard/key_input';
import type { RenameController } from './controller';
import type { CrossFileRenameManager } from './operations';
import type { PlayerInput } from '../../../../../hosts/common/input/player';

export function handleRenameControllerInput(
	playerInput: PlayerInput,
	controller: RenameController,
	crossFileRename: CrossFileRenameManager,
): void {
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
	controller.applyFieldEditing(playerInput);
}
