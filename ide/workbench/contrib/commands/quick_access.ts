import { COLOR_STATUS_WARNING } from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import type { IdeCommandController } from '../../../commands/controller';
import { EDITOR_COMMAND_IDS, EDITOR_COMMAND_PRESENTATION, editorCommandTitle } from '../../../commands/catalog';
import type { InputFocusTarget } from '../../../input/focus';
import { EDITOR_COMMAND_KEYBINDING_LABELS } from '../../../input/keyboard/command_keybindings';
import type { QuickInputController } from '../../services/quick_input/controller';
import { CommandQuickPickProvider, type CommandQuickPickItem } from './quick_pick_provider';

/** Menu, keybinding and Palette actions share one command catalog and controller. */
export function buildCommandQuickPickItems(commands: IdeCommandController, origin: InputFocusTarget | null): CommandQuickPickItem[] {
	const items: CommandQuickPickItem[] = [];
	for (const command of EDITOR_COMMAND_IDS) {
		if (!commands.isEnabled(command, origin)) continue;
		const presentation = EDITOR_COMMAND_PRESENTATION[command];
		const binding = EDITOR_COMMAND_KEYBINDING_LABELS.get(command);
		items.push({
			command,
			label: `${presentation.category}: ${editorCommandTitle(command, commands.isActive(command))}`,
			description: '',
			detail: binding === undefined ? '' : binding,
		});
	}
	items.sort((left, right) => left.label.localeCompare(right.label));
	return items;
}

export function showCommandPalette(picker: QuickInputController, commands: IdeCommandController): void {
	picker.pick('COMMAND PALETTE', 'Type a command', origin => new CommandQuickPickProvider(buildCommandQuickPickItems(commands, origin)), item => {
		// Selection is new user input. An asynchronous operation may have ended
		// since the available actions were enumerated; never execute a stale Cancel.
		if (!commands.isEnabled(item.command)) {
			showEditorMessage(`${item.label} is no longer available.`, COLOR_STATUS_WARNING, 2);
			return;
		}
		commands.execute(item.command);
	});
}
