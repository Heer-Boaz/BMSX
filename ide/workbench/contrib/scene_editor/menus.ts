import type { WorkbenchMenuDefinition } from '../../ui/menu/model';
import type { SceneAuthoredSelection } from './authoring_context';

const selectedObject = (selection: SceneAuthoredSelection): boolean => selection.kind === 'member' && selection.entry.kind === 'object';
export const SCENE_AUTHORING_CONTEXT_ACTIONS: WorkbenchMenuDefinition<SceneAuthoredSelection> = [
	{ type: 'command', command: 'editor.source' },
	{ type: 'command', command: 'sceneEditor.inspectLive', when: selection => selection.scene.resolution === 'complete' },
	{ type: 'separator' },
	{ type: 'command', command: 'sceneEditor.renameMember', when: selectedObject },
	{ type: 'command', command: 'sceneEditor.reparentMember', when: selectedObject },
	{ type: 'command', command: 'sceneEditor.removeMember', when: selectedObject },
	{ type: 'command', command: 'sceneEditor.removeSubtree', when: selectedObject },
];
