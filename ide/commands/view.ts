import type { CartEditor } from '../cart_editor';
import { toggleProblemsPanel } from '../workbench/contrib/problems/panel/controller';
import { toggleWordWrap } from '../editor/ui/view/view';
import type { EditorCommandId, EditorViewCommandId } from '../common/commands';
import type { RuntimeSourceState } from '../runtime/sources';
import { openSourceView } from '../workbench/contrib/source_views/quick_access';
import { hasSceneSourceDefinitions } from '../workbench/contrib/scene_editor/source';
import { editorTabGroup } from '../workbench/ui/tab/group_model';

export function isEditorViewCommand(command: EditorCommandId): command is EditorViewCommandId {
	switch (command) {
		case 'resources':
		case 'problems':
		case 'behaviorLens':
		case 'behaviorLens.preview':
		case 'keepEditor':
		case 'behaviorLens.actionEffects':
		case 'behaviorLens.stateMachines':
		case 'behaviorLens.behaviorTrees':
		case 'scenarioLab':
		case 'sceneEditor':
		case 'sceneEditor.source':
		case 'behaviorLens.source':
		case 'filter':
		case 'wrap':
			return true;
		default:
			return false;
	}
}

export function executeEditorViewCommand(editor: CartEditor, sources: RuntimeSourceState, command: EditorViewCommandId): void {
	switch (command) {
		case 'resources':
			editor.resourcePanel.togglePanel();
			return;
		case 'problems':
			toggleProblemsPanel(editor.editorPanes);
			return;
		case 'behaviorLens':
			editor.behaviorLens.open();
			return;
		case 'behaviorLens.preview':
			editor.behaviorLens.open(null, { pinned: false });
			return;
		case 'keepEditor':
			editorTabGroup.pin(editorTabGroup.activeTab);
			return;
		case 'behaviorLens.actionEffects':
			editor.behaviorLens.open('action_effect');
			return;
		case 'behaviorLens.stateMachines':
			editor.behaviorLens.open('state_machine');
			return;
		case 'behaviorLens.behaviorTrees':
			editor.behaviorLens.open('behavior_tree');
			return;
		case 'scenarioLab':
			editor.scenarioLab.open();
			return;
		case 'sceneEditor':
			openSourceView(sources, editor.quickInput, {
				title: 'SCENE EDITOR', accepts: hasSceneSourceDefinitions,
				openResource: resource => editor.sceneEditor.openResource(resource),
			});
			return;
		case 'sceneEditor.source':
			editor.sceneEditor.openSource();
			return;
		case 'behaviorLens.source':
			editor.behaviorLens.openSource();
			return;
		case 'filter':
			editor.resourcePanel.toggleFilterMode();
			return;
		case 'wrap':
			toggleWordWrap();
			return;
	}
}
