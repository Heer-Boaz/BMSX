import { runtimeWorkbenchState } from '../runtime/workbench_state';
import { toggleProblemsPanel } from '../workbench/contrib/problems/panel/controller';
import { toggleWordWrap } from '../editor/ui/view/view';
import type { EditorCommandId, EditorViewCommandId } from '../common/commands';

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

export function executeEditorViewCommand(command: EditorViewCommandId): void {
	switch (command) {
		case 'resources':
			runtimeWorkbenchState.ide.editor.resourcePanel.togglePanel();
			return;
		case 'problems':
			toggleProblemsPanel();
			return;
		case 'filter':
			runtimeWorkbenchState.ide.editor.resourcePanel.toggleFilterMode();
			return;
		case 'wrap':
			toggleWordWrap();
			return;
	}
}
