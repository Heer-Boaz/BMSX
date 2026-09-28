import type { IdeCommandController } from '../../commands/controller';
import {
	EDITOR_KEYBINDING_CODES,
	resolveEditorCommandKeybinding,
} from './command_keybindings';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from './key_input';
import { handleEscapeKey } from './modal_input';
import { ESCAPE_KEY } from '../../common/constants';
import type { PlayerInput } from '../../../hosts/common/input/player';
import type { EditorSearchController } from '../../workbench/contrib/code_editor/find/search';

export function handleEscapeBinding(playerInput: PlayerInput, search: EditorSearchController): boolean {
	if (!isKeyJustPressed(ESCAPE_KEY, playerInput) || !handleEscapeKey(search)) {
		return false;
	}
	consumeIdeKey(ESCAPE_KEY, playerInput);
	return true;
}

export function handleEditorCommandBindings(playerInput: PlayerInput, commands: IdeCommandController): boolean {
	const modifiers = playerInput.getModifiers();
	for (let index = 0; index < EDITOR_KEYBINDING_CODES.length; index += 1) {
		const code = EDITOR_KEYBINDING_CODES[index];
		const state = playerInput.inputHandlers.keyboard.getKeyState(code);
		if (!state.pressed || state.consumed) {
			continue;
		}
		const binding = resolveEditorCommandKeybinding(code, modifiers, commands);
		if (binding === null) {
			continue;
		}
		if (!(binding.repeat ? shouldRepeatKeyFromPlayer(code, playerInput) : state.justpressed)) {
			continue;
		}
		consumeIdeKey(code, playerInput);
		commands.execute(binding.command);
		return true;
	}
	return false;
}
