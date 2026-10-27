import { showCommandPalette } from '../workbench/contrib/commands/quick_access';
import { focusRuntimeErrorOverlay } from '../runtime_error/navigation';
import { buildResourceQuickPickItems } from '../workbench/contrib/resources/quick_access';
import { FileQuickPickProvider } from '../workbench/services/quick_input/file_provider';
import { EditorNavigationController } from '../workbench/contrib/resources/navigation';
import type { EditorCommandId, EditorSearchCommandId } from '../common/commands';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { EditorGroupView } from '../workbench/services/editor/editor_group';

type WorkbenchSearchCommand = Extract<EditorSearchCommandId, 'commandPalette' | 'resourceSearch' | 'runtimeErrorFocus'>;

export function isEditorSearchCommand(command: EditorCommandId): command is WorkbenchSearchCommand {
	return command === 'commandPalette' || command === 'resourceSearch' || command === 'runtimeErrorFocus';
}

export function executeEditorSearchCommand(editor: CartEditor, sources: RuntimeSourceState,
	command: WorkbenchSearchCommand, group: EditorGroupView): void {
	switch (command) {
		case 'commandPalette':
			showCommandPalette(editor.quickInput, editor.commands);
			return;
		case 'resourceSearch': {
			const navigation = new EditorNavigationController(sources.catalog, editor.resourcePanel, editor.resourceEditors, group);
			editor.quickInput.pick('GO TO FILE', 'Type a file name or path', () => new FileQuickPickProvider(buildResourceQuickPickItems(sources.catalog.resources)),
				item => { void navigation.openResource(item.resource); },
			lifetime => lifetime.add({ dispose: group.onWillDispose(() => editor.quickInput.hide()) }));
			return;
		}
		case 'runtimeErrorFocus':
			focusRuntimeErrorOverlay(group);
			return;
	}
}
