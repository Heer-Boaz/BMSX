import type { CartEditor } from '../cart_editor';
import { toggleProblemsPanel } from '../workbench/contrib/problems/panel/controller';
import { toggleWordWrap } from '../editor/ui/view/view';
import type { EditorCommandId, EditorViewCommandId } from '../common/commands';

export function isEditorViewCommand(command: EditorCommandId): command is EditorViewCommandId {
	switch (command) {
		case 'resources':
		case 'problems':
		case 'behaviorLens':
		case 'scenarioLab':
		case 'sceneEditor':
		case 'sceneEditor.source':
		case 'filter':
		case 'wrap':
			return true;
		default:
			return false;
	}
}

export function executeEditorViewCommand(editor: CartEditor, command: EditorViewCommandId): void {
	switch (command) {
		case 'resources':
			editor.resourcePanel.togglePanel();
			return;
		case 'problems':
			toggleProblemsPanel(editor.editorPanes);
			return;
		case 'behaviorLens':
			editor.behaviorLens.openActiveDocument();
			return;
		case 'scenarioLab':
			editor.scenarioLab.open();
			return;
		case 'sceneEditor':
			editor.sceneEditor.openActiveDocument();
			return;
		case 'sceneEditor.source':
			editor.sceneEditor.openSource();
			return;
		case 'filter':
			editor.resourcePanel.toggleFilterMode();
			return;
		case 'wrap':
			toggleWordWrap();
			return;
	}
}
