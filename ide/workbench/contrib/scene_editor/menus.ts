import type { WorkbenchMenuCommandDefinition, WorkbenchMenuDefinition } from '../../ui/menu/model';
import type { SceneEditorViewState } from './view_state';

const MEMBER_ACTIONS = [
	{ type: 'command', command: 'sceneEditor.moveMemberUp' },
	{ type: 'command', command: 'sceneEditor.moveMemberDown' },
	{ type: 'command', command: 'sceneEditor.removeMember' },
] as const;
const SOURCE_CONTEXT_ACTIONS = [
	{ type: 'command', command: 'editor.source' },
	{ type: 'command', command: 'editor.sourceToSide' },
	{ type: 'separator' },
	...MEMBER_ACTIONS,
] as const;

export const SCENE_TITLE_ACTIONS: readonly WorkbenchMenuCommandDefinition<SceneEditorViewState>[] = [
	{ type: 'command', command: 'sceneEditor.details', icon: 'info', when: input => input.layout.mode === 'outline' },
	{ type: 'command', command: 'sceneEditor.outline', icon: 'back', when: input => input.layout.mode === 'details' },
	{ type: 'command', command: 'editor.source' },
	...MEMBER_ACTIONS,
];
export const SCENE_CONTEXT_ACTIONS: WorkbenchMenuDefinition<SceneEditorViewState> = [
	{ type: 'command', command: 'sceneEditor.details', when: input => input.layout.mode !== 'details' },
	{ type: 'command', command: 'sceneEditor.outline', when: input => input.layout.mode === 'details' },
	...SOURCE_CONTEXT_ACTIONS,
];
export const SCENE_HIERARCHY_CONTEXT_ACTIONS: WorkbenchMenuDefinition<undefined> = [
	{ type: 'command', command: 'sceneEditor.details' },
	...SOURCE_CONTEXT_ACTIONS,
];
export const SCENE_DETAILS_CONTEXT_ACTIONS: WorkbenchMenuDefinition<undefined> = [
	{ type: 'command', command: 'sceneEditor.outline' },
	...SOURCE_CONTEXT_ACTIONS,
];
