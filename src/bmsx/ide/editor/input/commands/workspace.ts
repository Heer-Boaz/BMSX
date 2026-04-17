import { activateCodeTab } from '../../../workbench/ui/tabs';
import { save } from '../../../workbench/ui/code_tab/io';
import { showActionPrompt } from '../../../workbench/contrib/modal/action_prompt';
import { performEditorAction } from './actions';
import type { EditorCommandId } from './dispatcher';
import { editorDocumentState } from '../../editing/document_state';

export type EditorWorkspaceCommandId =
	| 'hot-resume'
	| 'reboot'
	| 'save'
	| 'theme-toggle';

export function isEditorWorkspaceCommand(command: EditorCommandId): command is EditorWorkspaceCommandId {
	return command === 'hot-resume'
		|| command === 'reboot'
		|| command === 'save'
		|| command === 'theme-toggle';
}

export function executeEditorWorkspaceCommand(command: EditorWorkspaceCommandId): void {
	switch (command) {
		case 'save':
			if (editorDocumentState.dirty) {
				void save();
			}
			return;
		case 'hot-resume':
		case 'reboot':
			activateCodeTab();
			if (editorDocumentState.dirty) {
				showActionPrompt(command);
				return;
			}
			performEditorAction(command);
			return;
		case 'theme-toggle':
			activateCodeTab();
			performEditorAction(command);
			return;
	}
}
