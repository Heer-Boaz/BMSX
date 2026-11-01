import type { WorkbenchMenuCommandDefinition, WorkbenchMenuDefinition } from '../../ui/menu/model';
import type { SceneEditorViewState } from './view_state';

const MEMBER_ACTIONS = [
	{ type: 'command', command: 'sceneEditor.renameMember' },
	{ type: 'command', command: 'sceneEditor.reparentMember' },
	{ type: 'command', command: 'sceneEditor.removeMember' },
	{ type: 'command', command: 'sceneEditor.removeSubtree' },
] as const;
export const SCENE_AUTHORING_CONTEXT_ACTIONS = [
	{ type: 'command', command: 'editor.source' },
	{ type: 'separator' },
	...MEMBER_ACTIONS,
] as const;

export const SCENE_TITLE_ACTIONS: readonly WorkbenchMenuCommandDefinition<SceneEditorViewState>[] = [
	{ type: 'command', command: 'sceneEditor.details', icon: 'info', when: input => input.layout.mode === 'outline' },
	{ type: 'command', command: 'sceneEditor.outline', icon: 'back', when: input => input.layout.mode === 'details' },
];
export const SCENE_CONTEXT_ACTIONS: WorkbenchMenuDefinition<SceneEditorViewState> = [
	{ type: 'command', command: 'sceneEditor.details', when: input => input.layout.mode === 'outline' },
	{ type: 'command', command: 'sceneEditor.outline', when: input => input.layout.mode === 'details' },
];
