import type { WorkbenchMenuCommandDefinition, WorkbenchMenuDefinition } from '../../ui/menu/model';
import type { SceneAuthoredSelection } from './authoring_context';
import type { SceneEditorViewState } from './view_state';

const selectedObject = (selection: SceneAuthoredSelection): boolean => selection.kind === 'member' && selection.entry.kind === 'object';
export const SCENE_AUTHORING_CONTEXT_ACTIONS: WorkbenchMenuDefinition<SceneAuthoredSelection> = [
	{ type: 'command', command: 'editor.source' },
	{ type: 'separator' },
	{ type: 'command', command: 'sceneEditor.renameMember', when: selectedObject },
	{ type: 'command', command: 'sceneEditor.reparentMember', when: selectedObject },
	{ type: 'command', command: 'sceneEditor.removeMember', when: selectedObject },
	{ type: 'command', command: 'sceneEditor.removeSubtree', when: selectedObject },
];

export const SCENE_TITLE_ACTIONS: readonly WorkbenchMenuCommandDefinition<SceneEditorViewState>[] = [
	{ type: 'command', command: 'sceneEditor.details', icon: 'info', when: input => input.layout.mode === 'outline' },
	{ type: 'command', command: 'sceneEditor.outline', icon: 'back', when: input => input.layout.mode === 'details' },
];
export const SCENE_CONTEXT_ACTIONS: WorkbenchMenuDefinition<SceneEditorViewState> = [
	{ type: 'command', command: 'sceneEditor.details', when: input => input.layout.mode === 'outline' },
	{ type: 'command', command: 'sceneEditor.outline', when: input => input.layout.mode === 'details' },
];
