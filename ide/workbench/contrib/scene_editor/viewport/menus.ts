import type { WorkbenchMenuDefinition } from '../../../ui/menu/model';
import type { SceneViewportViewState } from './view_state';

/** Viewport reading and interaction modes, not panel chrome or member edits. */
export const SCENE_VIEWPORT_ACTIONS: WorkbenchMenuDefinition<SceneViewportViewState> = [
	{ type: 'command', command: 'sceneViewport.viewOptions', icon: 'chevronDown', showLabel: true },
	{ type: 'command', command: 'sceneViewport.navigationOptions', icon: 'camera' },
	{ type: 'command', command: 'sceneViewport.frameSelection', icon: 'follow' },
];

export const SCENE_VIEWPORT_VIEWS: WorkbenchMenuDefinition<SceneViewportViewState> = [
	{ type: 'command', command: 'sceneViewport.view2d' },
	{ type: 'command', command: 'sceneViewport.view3d' },
];

export const SCENE_VIEWPORT_NAVIGATION: WorkbenchMenuDefinition<SceneViewportViewState> = [
	{ type: 'command', command: 'sceneViewport.select' },
	{ type: 'command', command: 'sceneViewport.pan' },
	{ type: 'command', command: 'sceneViewport.orbit', when: view => view.camera.mode === '3d' },
	{ type: 'separator' },
	{ type: 'command', command: 'sceneViewport.frameSelection' },
	{ type: 'command', command: 'sceneViewport.frameAll' },
	{ type: 'separator' },
	{ type: 'command', command: 'sceneViewport.zoomIn' },
	{ type: 'command', command: 'sceneViewport.zoomOut' },
];
