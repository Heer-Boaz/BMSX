import type { IdeCommandController } from '../../commands/controller';
import {
	EDITOR_KEYBINDING_CODES,
	resolveEditorCommandKeybinding,
} from './command_keybindings';
import { consumeIdeKey, isKeyJustPressed } from './key_input';
import { handleEscapeKey } from './modal_input';
import { ESCAPE_KEY } from '../../common/constants';
import type { PlayerInput } from '../../../hosts/common/input/player';

function handleEscapeBinding(playerInput: PlayerInput): boolean {
	if (!isKeyJustPressed(ESCAPE_KEY, playerInput) || !handleEscapeKey()) {
		return false;
	}
	consumeIdeKey(ESCAPE_KEY, playerInput);
	return true;
}

export function handleEditorGlobalBindings(playerInput: PlayerInput, commands: IdeCommandController): boolean {
	if (handleEscapeBinding(playerInput)) {
		return true;
	}
	const modifiers = playerInput.getModifiers();
	for (let index = 0; index < EDITOR_KEYBINDING_CODES.length; index += 1) {
		const code = EDITOR_KEYBINDING_CODES[index];
		if (!isKeyJustPressed(code, playerInput)) {
			continue;
		}
		const command = resolveEditorCommandKeybinding(code, modifiers, commands);
		if (command === null) {
			continue;
		}
		consumeIdeKey(code, playerInput);
		commands.execute(command);
		return true;
	}
	return false;
}
