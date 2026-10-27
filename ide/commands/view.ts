import type { EditorGroupView } from '../workbench/services/editor/editor_group';
import { openHome } from '../workbench/contrib/home/editor_input';
import { workspaceState } from '../workbench/workspace/state';
import type { RuntimeFaultState } from '../runtime/fault_state';
import { openHostError } from '../workbench/contrib/host_error/editor_input';
import { openRomInspector } from '../workbench/contrib/rom_inspector/quick_access';
import { openEventViewer } from '../workbench/contrib/events/editor_input';
import { openGpuDebugger } from '../workbench/contrib/gpu_debugger/editor_input';
import { openGteDebugger } from '../workbench/contrib/gte_debugger/editor_input';
import { openObservedConversation } from '../workbench/contrib/conversations/quick_access';
import { openAssistant } from '../workbench/contrib/assistant/editor_input';
import { openTerminal } from '../workbench/contrib/terminal/editor_input';
import type { CartEditor } from '../cart_editor';
import { toggleProblemsPanel } from '../workbench/contrib/problems/panel/controller';
import type { EditorCommandId, EditorViewCommandId } from '../common/commands';
import type { RuntimeSourceState } from '../runtime/sources';
import { openSourceView } from '../workbench/contrib/source_views/quick_access';
import { hasSceneSourceDefinitions } from '../workbench/contrib/scene_editor/source';
import { openGameView } from '../workbench/contrib/game_view/editor_input';
import { showOpenEditors } from '../workbench/services/editor/open_editors';

export function isEditorViewCommand(command: EditorCommandId): command is EditorViewCommandId {
	switch (command) {
		case 'home':
		case 'hostError':
		case 'romInspector':
		case 'events':
		case 'gteDebugger':
		case 'gpuDebugger':
		case 'terminal':
		case 'assistant':
		case 'conversations':
		case 'resources':
		case 'resources.focus':
		case 'problems':
		case 'behaviorLens':
		case 'behaviorLens.preview':
		case 'keepEditor':
		case 'openEditors':
		case 'behaviorLens.actionEffects':
		case 'behaviorLens.stateMachines':
		case 'behaviorLens.behaviorTrees':
		case 'aem':
		case 'animation':
		case 'progression':
		case 'inputBindings':
		case 'scenarioLab':
		case 'cartMap':
		case 'sceneEditor':
		case 'actorLab':
		case 'gameView':
		case 'sceneEditor.source':
		case 'behaviorLens.source':
		case 'filter':
			return true;
		default:
			return false;
	}
}

export function executeEditorViewCommand(editor: CartEditor, sources: RuntimeSourceState, fault: RuntimeFaultState, command: EditorViewCommandId, group: EditorGroupView): void {
	switch (command) {
		case 'home': openHome(group, workspaceState.context); return;
		case 'animation': editor.animations.open(); return;
		case 'hostError': openHostError(group, fault.hostFrameFailure!); return;
		case 'romInspector': openRomInspector(group, editor.quickInput, sources); return;
		case 'events': openEventViewer(group, editor.events); return;
		case 'gpuDebugger': openGpuDebugger(group, editor.gpu); return;
		case 'gteDebugger': openGteDebugger(group, editor.gte); return;
		case 'terminal':
			editor.terminal.open();
			openTerminal(group);
			return;
		case 'actorLab': editor.actorLab.open(); return;
		case 'gameView': openGameView(group); return;
		case 'conversations': openObservedConversation(group, editor.observedConversation, editor.quickInput); return;
		case 'assistant': openAssistant(group, editor.assistant); return;
		case 'resources':
			editor.resourcePanel.togglePanel();
			return;
		case 'resources.focus':
			editor.resourcePanel.show();
			return;
		case 'problems':
			toggleProblemsPanel(group);
			return;
		case 'behaviorLens':
			editor.behaviorLens.open();
			return;
		case 'behaviorLens.preview':
			editor.behaviorLens.open(null, { pinned: false });
			return;
		case 'keepEditor':
			group.model.pin(group.model.activeTab);
			return;
		case 'openEditors': showOpenEditors(group, editor.quickInput); return;
		case 'behaviorLens.actionEffects':
			editor.behaviorLens.open('action_effect');
			return;
		case 'behaviorLens.stateMachines':
			editor.behaviorLens.open('state_machine');
			return;
		case 'behaviorLens.behaviorTrees':
			editor.behaviorLens.open('behavior_tree');
			return;
		case 'cartMap': editor.cartMaps.open(); return;
		case 'aem': editor.aemEditor.open(); return;
		case 'progression': editor.luaPrograms.open('progression'); return;
		case 'inputBindings': editor.luaPrograms.open('input'); return;
		case 'scenarioLab':
			editor.scenarioLab.open();
			return;
		case 'sceneEditor':
			openSourceView(group, sources.catalog, editor.quickInput, {
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
	}
}
