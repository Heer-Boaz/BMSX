import type { WorkbenchMenuCommandDefinition, WorkbenchMenuDefinition } from '../../ui/menu/model';
import type { SceneEditorViewState } from './view_state';

export const SCENE_TITLE_ACTIONS: readonly WorkbenchMenuCommandDefinition<SceneEditorViewState>[] = [
	{ type: 'command', command: 'sceneEditor.details', icon: 'info', when: input => input.layout.mode === 'outline' },
	{ type: 'command', command: 'sceneEditor.outline', icon: 'back', when: input => input.layout.mode === 'details' },
	{ type: 'command', command: 'editor.source' },
	{ type: 'command', command: 'sceneEditor.moveMemberUp' },
	{ type: 'command', command: 'sceneEditor.moveMemberDown' },
	{ type: 'command', command: 'sceneEditor.removeMember' },
];

export const SCENE_CONTEXT_ACTIONS: WorkbenchMenuDefinition<SceneEditorViewState> = [
	{ type: 'command', command: 'sceneEditor.details', when: input => input.layout.mode !== 'details' },
	{ type: 'command', command: 'sceneEditor.outline', when: input => input.layout.mode === 'details' },
	{ type: 'command', command: 'editor.source' },
	{ type: 'command', command: 'editor.sourceToSide' },
	{ type: 'separator' },
	{ type: 'command', command: 'sceneEditor.moveMemberUp' },
	{ type: 'command', command: 'sceneEditor.moveMemberDown' },
	{ type: 'command', command: 'sceneEditor.removeMember' },
];
