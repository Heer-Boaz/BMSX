import type { EditorCommandRunner } from '../../common/commands';
import { inputFocus, type InputFocusTarget } from '../focus';
import { resolveEditorCommandKeybinding } from './command_keybindings';
import { consumeIdeKey } from './key_input';
import type { KeyInputEvent } from '../../../hosts/common/input/text';

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
