import { showEditorMessage } from '../../../common/feedback_state';
import type { IdeCommandController } from '../../../commands/controller';
import { EDITOR_COMMAND_IDS, EDITOR_COMMAND_PRESENTATION, editorCommandTitle } from '../../../commands/catalog';
import type { InputFocusTarget } from '../../../input/focus';
import { EDITOR_COMMAND_KEYBINDING_LABELS } from '../../../input/keyboard/command_keybindings';
import type { QuickInputController } from '../../services/quick_input/controller';
import { CommandQuickPickProvider, type CommandQuickPickItem } from './quick_pick_provider';

type WorkbenchCommandPick = CommandQuickPickItem & { readonly target: InputFocusTarget | null };

/** Menu, keybinding and Palette actions share one command catalog and controller. */
export function buildCommandQuickPickItems(commands: Pick<IdeCommandController, 'isEnabled' | 'isActive'>, origin: InputFocusTarget | null,
	editorTarget: InputFocusTarget | null = origin): WorkbenchCommandPick[] {
	const items: WorkbenchCommandPick[] = [];
	for (const command of EDITOR_COMMAND_IDS) {
		// An explicit Palette action can address its view without granting that
		// view's keyboard capabilities to a field or toolbar. Local commands win,
		// including a disabled local Undo rather than another document's Undo.
		const target = origin !== null && origin.getCommand(command) !== undefined ? origin
			: origin !== null && origin.commandContext.getCommand(command) !== undefined ? origin.commandContext
			: origin?.clipboard !== undefined && (command === 'copy' || command === 'cut' || command === 'paste') ? origin : editorTarget;
		if (!commands.isEnabled(command, target)) continue;
		const presentation = EDITOR_COMMAND_PRESENTATION[command];
		const binding = EDITOR_COMMAND_KEYBINDING_LABELS.get(command);
		items.push({
			command,
			target,
			label: `${presentation.category}: ${editorCommandTitle(command, commands.isActive(command, target))}`,
			description: '',
			detail: binding === undefined ? '' : binding,
		});
	}
	items.sort((left, right) => left.label.localeCompare(right.label));
	return items;
}

export function showCommandPalette(picker: QuickInputController, commands: Pick<IdeCommandController, 'isEnabled' | 'isActive' | 'execute'>,
	invocationOrigin?: InputFocusTarget | null, editorTarget?: InputFocusTarget): void {
	const editorScope = editorTarget?.commandContext.scope, editorGeneration = editorScope?.contextGeneration;
	let nativeOrigin: InputFocusTarget | null = null;
	picker.pick('COMMAND PALETTE', 'Type a command', target => {
		nativeOrigin = target;
		return new CommandQuickPickProvider(buildCommandQuickPickItems(commands, target, editorTarget === undefined ? target : editorTarget));
	}, item => {
		if (editorScope?.contextGeneration !== editorGeneration) return;
		// Selection is new user input. An asynchronous operation may have ended
		// since the available actions were enumerated; never execute a stale Cancel.
		if (!commands.isEnabled(item.command, item.target)) {
			showEditorMessage(`${item.label} is no longer available.`, 'warning', 2);
			return;
		}
		const origin = nativeOrigin !== null && (editorScope === undefined || editorScope.contains(nativeOrigin.commandContext.scope))
			? nativeOrigin : editorTarget;
		commands.execute(item.command, item.target, undefined, origin);
	}, lifetime => {
		if (editorScope !== undefined) lifetime.add({ dispose: editorScope.onDidRetireContext(() => picker.hide(false)) });
	}, { invocationOrigin, commandTarget: editorTarget });
}
