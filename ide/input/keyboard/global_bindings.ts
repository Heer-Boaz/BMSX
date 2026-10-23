import type { EditorCommandRunner } from '../../common/commands';
import { inputFocus, type InputFocusTarget } from '../focus';
import { resolveEditorCommandKeybinding } from './command_keybindings';
import { consumeIdeKey, isKeyJustPressed } from './key_input';
import { handleEscapeKey } from './modal_input';
import { ESCAPE_KEY } from '../../common/constants';
import type { KeyInputEvent } from '../../../hosts/common/input/text';
import type { EditorSearchController } from '../../workbench/contrib/code_editor/find/search';

export function handleEscapeBinding(event: KeyInputEvent, search: EditorSearchController): boolean {
	if (!isKeyJustPressed(ESCAPE_KEY, event) || !handleEscapeKey(search)) return false;
	consumeIdeKey(ESCAPE_KEY, event);
	return true;
}

export function handleEditorCommandBindings(event: KeyInputEvent, commands: EditorCommandRunner | undefined, target: InputFocusTarget | null = inputFocus.target): boolean {
	if (!event.down || event.consumed) return false;
	const binding = resolveEditorCommandKeybinding(event.code, event.modifiers, commands, target);
	if (binding === null || event.repeat && !binding.repeat) return false;
	consumeIdeKey(event.code, event);
	const command = target?.getCommand(binding.command);
	if (command !== undefined) {
		// Presence owns the binding, even when local history is disabled.
		if (command.isEnabled()) command.run();
	} else {
		commands!.execute(binding.command, target);
	}
	return true;
}
