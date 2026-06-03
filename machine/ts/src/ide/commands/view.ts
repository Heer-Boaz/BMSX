import { toggleProblemsPanel } from '../workbench/contrib/problems/panel/controller';
import { toggleWordWrap } from '../editor/ui/view/view';
import type { EditorCommandId, EditorViewCommandId } from '../common/commands';
import type { Runtime } from '../../machine/runtime/runtime';

export function isEditorViewCommand(command: EditorCommandId): command is EditorViewCommandId {
	switch (command) {
		case 'resources':
		case 'problems':
		case 'filter':
		case 'wrap':
			return true;
		default:
			return false;
	}
}

export function executeEditorViewCommand(runtime: Runtime, command: EditorViewCommandId): void {
	switch (command) {
		case 'resources':
			runtime.editor.resourcePanel.togglePanel();
			return;
		case 'problems':
			toggleProblemsPanel();
			return;
		case 'filter':
			runtime.editor.resourcePanel.toggleFilterMode();
			return;
		case 'wrap':
			toggleWordWrap();
			return;
	}
}
