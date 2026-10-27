import { showCommandPalette } from '../workbench/contrib/commands/quick_access';
import { focusRuntimeErrorOverlay } from '../runtime_error/navigation';
import { showResourceQuickAccess } from '../workbench/contrib/resources/quick_access';
import type { InputFocusTarget } from '../input/focus';
import type { EditorCommandId, EditorSearchCommandId } from '../common/commands';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { EditorGroupView } from '../workbench/services/editor/editor_group';
import { findEditorGroup } from '../workbench/services/editor/editor_group';

type WorkbenchSearchCommand = Extract<EditorSearchCommandId, 'commandPalette' | 'resourceSearch' | 'runtimeErrorFocus'>;

export function isEditorSearchCommand(command: EditorCommandId): command is WorkbenchSearchCommand {
	return command === 'commandPalette' || command === 'resourceSearch' || command === 'runtimeErrorFocus';
}

export function executeEditorSearchCommand(editor: CartEditor, sources: RuntimeSourceState,
	command: WorkbenchSearchCommand, group: EditorGroupView, target: InputFocusTarget | null): void {
	switch (command) {
		case 'commandPalette': {
			const editorTarget = findEditorGroup(target) === group ? target : group.panes.activePane?.commandTarget ?? group.tabFocusTarget;
			showCommandPalette(editor.quickInput, editor.commands,
				target === editor.quickInput.field.focusTarget ? undefined : target === null ? editorTarget : target, editorTarget);
			return;
		}
		case 'resourceSearch': {
			showResourceQuickAccess(editor, sources.catalog, group);
			return;
		}
		case 'runtimeErrorFocus':
			focusRuntimeErrorOverlay(group);
			return;
	}
}
