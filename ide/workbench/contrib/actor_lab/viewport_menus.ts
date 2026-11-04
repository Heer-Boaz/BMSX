import type { WorkbenchMenuItem } from '../../ui/menu/registry';

/** These menus address the viewport reading and camera, never an actor or panel chrome. */
export const ACTOR_VIEWPORT_VIEWS: readonly WorkbenchMenuItem[] = [
	{ type: 'command', command: 'actorLab.gameView' },
	{ type: 'separator' },
	{ type: 'command', command: 'sceneViewport.view2d' },
	{ type: 'command', command: 'sceneViewport.view3d' },
];

export const ACTOR_VIEWPORT_CAMERA: readonly WorkbenchMenuItem[] = [
	{ type: 'command', command: 'sceneViewport.frameSelection' },
	{ type: 'command', command: 'sceneViewport.frameAll' },
	{ type: 'separator' },
	{ type: 'command', command: 'sceneViewport.zoomIn' },
	{ type: 'command', command: 'sceneViewport.zoomOut' },
	{ type: 'separator' },
	{ type: 'command', command: 'actorLab.selectVisual' },
	{ type: 'command', command: 'sceneViewport.pan' },
	{ type: 'command', command: 'sceneViewport.orbit' },
];
