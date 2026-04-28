import { activateCodeTab } from '../workbench/ui/tabs';
import { save } from '../workbench/ui/code_tab/io';
import { showActionPrompt } from '../workbench/contrib/modal/action_prompt';
import { performEditorAction } from './actions';
import type { Runtime } from '../../machine/runtime/runtime';
import type { EditorCommandId, EditorWorkspaceCommandId } from '../common/commands';
import { editorDocumentState } from '../editor/editing/document_state';

export function isEditorWorkspaceCommand(command: EditorCommandId): command is EditorWorkspaceCommandId {
	switch (command) {
		case 'hot-resume':
		case 'reboot':
		case 'save':
		case 'theme-toggle':
			return true;
		default:
			return false;
	}
}

export function executeEditorWorkspaceCommand(runtime: Runtime, command: EditorWorkspaceCommandId): void {
	switch (command) {
		case 'save':
			if (editorDocumentState.dirty) {
				void save(runtime);
			}
			return;
		case 'hot-resume':
		case 'reboot':
			activateCodeTab();
			if (editorDocumentState.dirty) {
				showActionPrompt(command);
				return;
			}
			performEditorAction(runtime, command);
			return;
		case 'theme-toggle':
			activateCodeTab();
			performEditorAction(runtime, command);
			return;
	}
}
