import { showCommandPalette } from '../workbench/contrib/commands/quick_access';
import { focusRuntimeErrorOverlay } from '../runtime_error/navigation';
import { showResourceQuickAccess } from '../workbench/contrib/resources/quick_access';
import { inputFocus, type InputFocusTarget } from '../input/focus';
import type { EditorCommandId, EditorSearchCommandId } from '../common/commands';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { EditorGroupView } from '../workbench/services/editor/editor_group';
import type { HostClock } from '../../hosts/common/clock';
import { editorTextModelService } from '../editor/model/model_service';
import { workspaceState } from '../workbench/workspace/state';
import { WorkspaceSearchInput } from '../workbench/contrib/workspace_search/editor_input';
import { WorkspaceSearchPane } from '../workbench/contrib/workspace_search/editor_pane';

type WorkbenchSearchCommand = Extract<EditorSearchCommandId, 'commandPalette' | 'resourceSearch' | 'runtimeErrorFocus' | 'findGlobal'>;

export function isEditorSearchCommand(command: EditorCommandId): command is WorkbenchSearchCommand {
	return command === 'commandPalette' || command === 'resourceSearch' || command === 'runtimeErrorFocus' || command === 'findGlobal';
}

export function executeEditorSearchCommand(editor: CartEditor, sources: RuntimeSourceState,
	command: WorkbenchSearchCommand, group: EditorGroupView, target: InputFocusTarget | null, clock: HostClock): void {
	switch (command) {
		case 'findGlobal': {
			const context = workspaceState.context;
			if (context === null) return;
			const selection = target?.textInput?.readText();
			const selectedText = selection === undefined || selection.selectionStart === selection.selectionEnd ? undefined
				: selection.text.slice(selection.selectionStart, selection.selectionEnd);
			const seed = selectedText !== undefined && !/[\r\n]/.test(selectedText) ? selectedText : undefined;
			for (const candidate of editor.editorParts.groups) for (const input of candidate.model.tabs) {
				if (!(input instanceof WorkspaceSearchInput) || input.contextId !== context.id) continue;
				if (editor.editorParts.revealEditor(input, candidate)) {
					if (seed !== undefined) input.setQuery(seed);
					(candidate.panes.activePane as WorkspaceSearchPane).focusQuery();
				}
				return;
			}
			const input = group.openProducedEditor(() => {
				const query = new WorkspaceSearchInput(editorTextModelService, sources.catalog, context.id, clock);
				if (seed !== undefined) query.setQuery(seed);
				return query;
			});
			if (input !== undefined && group.model.activeTab === input) (group.panes.activePane as WorkspaceSearchPane).focusQuery();
			return;
		}
		case 'commandPalette': {
			const picker = editor.quickInput;
			const invoking = target === null ? inputFocus.target : target;
			const main = editor.mainWorkspace;
			const contextOrigin = main.isPrimaryTarget(invoking) || main.isActivityTarget(invoking);
			const client = main.isActivityTarget(invoking) ? main.activity : main.primary;
			if (contextOrigin && (client === undefined || !client.scope.contains(invoking!.commandContext.scope))) return;
			const editorTarget = contextOrigin ? client!.commandTarget : group.panes.activePane?.commandTarget ?? group.tabFocusTarget;
			const origin = target === null ? editorTarget
				: target === inputFocus.target || target === picker.field.focusTarget ? undefined : target;
			showCommandPalette(picker, editor.commands, origin, editorTarget);
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
