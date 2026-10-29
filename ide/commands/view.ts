import type { EditorGroupView } from '../workbench/services/editor/editor_group';
import type { EditorCommandDocument } from './context';
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
import type { EditorCommandId, EditorViewCommandId } from '../common/commands';
import type { RuntimeSourceState } from '../runtime/sources';
import { captureSourceViewOpening, openSourceView } from '../workbench/contrib/source_views/quick_access';
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
		case 'filter':
			return true;
		default:
			return false;
	}
}

export function executeEditorViewCommand(editor: CartEditor, sources: RuntimeSourceState, fault: RuntimeFaultState, command: EditorViewCommandId, group: EditorGroupView, document?: EditorCommandDocument): void {
	const picker = editor.editorParts.partForGroup(group).quickInput;
	switch (command) {
		case 'home': openHome(group, workspaceState.context); return;
		case 'animation': {
			const source = document === undefined ? undefined : captureSourceViewOpening(document.group, document.input, group);
			if (source !== null) editor.animations.open(group, picker, source);
			return;
		}
		case 'hostError': openHostError(group, fault.hostFrameFailure!); return;
		case 'romInspector': openRomInspector(group, picker, sources); return;
		case 'events': openEventViewer(group, editor.events); return;
		case 'gpuDebugger': openGpuDebugger(group, editor.gpu); return;
		case 'gteDebugger': openGteDebugger(group, editor.gte); return;
		case 'terminal':
			editor.terminal.open();
			openTerminal(group);
			return;
		case 'actorLab': editor.actorLab.open(group); return;
		case 'gameView': openGameView(group); return;
		case 'conversations': openObservedConversation(group, editor.observedConversation, picker); return;
		case 'assistant': openAssistant(group, editor.assistant); return;
		case 'resources':
			editor.resourcePanel.togglePanel();
			return;
		case 'resources.focus':
			editor.resourcePanel.show();
			return;
		case 'behaviorLens':
			editor.behaviorLens.open(group, picker);
			return;
		case 'behaviorLens.preview':
			editor.behaviorLens.open(group, picker, null, { pinned: false });
			return;
		case 'keepEditor':
			if (document !== undefined) document.group.model.pin(document.input);
			return;
		case 'openEditors': showOpenEditors(editor.editorParts, editor.quickInput); return;
		case 'behaviorLens.actionEffects':
			editor.behaviorLens.open(group, picker, 'action_effect');
			return;
		case 'behaviorLens.stateMachines':
			editor.behaviorLens.open(group, picker, 'state_machine');
			return;
		case 'behaviorLens.behaviorTrees':
			editor.behaviorLens.open(group, picker, 'behavior_tree');
			return;
		case 'cartMap': {
			const source = document === undefined ? undefined : captureSourceViewOpening(document.group, document.input, group);
			if (source !== null) editor.cartMaps.open(group, picker, source);
			return;
		}
		case 'aem': editor.aemEditor.open(group, picker); return;
		case 'progression': editor.luaPrograms.open(group, picker, 'progression'); return;
		case 'inputBindings': editor.luaPrograms.open(group, picker, 'input'); return;
		case 'scenarioLab':
			editor.scenarioLab.open(group);
			return;
		case 'sceneEditor': {
			const source = document === undefined ? undefined : captureSourceViewOpening(document.group, document.input, group);
			if (source === null) return;
			openSourceView(group, sources.catalog, picker, {
				title: 'SCENE EDITOR', accepts: hasSceneSourceDefinitions,
				openResource: (resource, options) => editor.sceneEditor.openResource(group, resource, options),
			}, source?.model.mode === 'lua' ? source : undefined);
			return;
		}
		case 'filter':
			editor.resourcePanel.toggleFilterMode();
			return;
	}
}
