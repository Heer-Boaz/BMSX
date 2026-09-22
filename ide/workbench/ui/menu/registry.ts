import type { EditorCommandId } from '../../../common/commands';

export type WorkbenchDropdownMenuId =
	| 'menubar.file'
	| 'menubar.edit'
	| 'menubar.run'
	| 'menubar.view';

export type WorkbenchContextMenuId = 'actorLab.context' | 'code.context' | 'code.symbol.context' | 'behaviorLens.node.context' | 'behaviorLens.state.context' | 'behaviorLens.edge.context' | 'behaviorLens.property.context' | 'behaviorLens.canvas.context';

export type WorkbenchActionMenuId = 'gameView.title' | 'actorLab.title' | 'propertyInspector.title' | 'sourceEditReview.title' | 'scenarioLab.title' | 'sceneEditor.title' | 'behaviorLens.title' | 'behaviorLens.graph.title' | 'behaviorLens.stateGraph.title' | 'behaviorLens.properties.title';

export type WorkbenchMenuCommandItem = {
	readonly type: 'command';
	readonly command: EditorCommandId;
};

export type WorkbenchMenuSeparator = {
	readonly type: 'separator';
};

export type WorkbenchMenuItem = WorkbenchMenuCommandItem | WorkbenchMenuSeparator;

type WorkbenchMenuContributions = Record<WorkbenchContextMenuId, readonly WorkbenchMenuItem[]> & {
	readonly 'gameView.title': readonly WorkbenchMenuCommandItem[];
	readonly 'actorLab.title': readonly WorkbenchMenuCommandItem[];
	readonly 'propertyInspector.title': readonly WorkbenchMenuCommandItem[];
	readonly 'sourceEditReview.title': readonly WorkbenchMenuCommandItem[];
	readonly 'menubar.file': readonly WorkbenchMenuItem[];
	readonly 'menubar.edit': readonly WorkbenchMenuItem[];
	readonly 'menubar.run': readonly WorkbenchMenuItem[];
	readonly 'menubar.view': readonly WorkbenchMenuItem[];
	readonly 'scenarioLab.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.graph.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.stateGraph.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.properties.title': readonly WorkbenchMenuCommandItem[];
	readonly 'sceneEditor.title': readonly WorkbenchMenuCommandItem[];
};

const GRAPH_ZOOM_ACTIONS: readonly WorkbenchMenuCommandItem[] = [
	{ type: 'command', command: 'graph.zoomOut' },
	{ type: 'command', command: 'graph.resetZoom' },
	{ type: 'command', command: 'graph.zoomIn' },
];

/** Immutable built-in menu contributions; renderers only project these items. */
export const WORKBENCH_MENUS: WorkbenchMenuContributions = {
	'gameView.title': [
		{ type: 'command', command: 'stepFrameBack' },
		{ type: 'command', command: 'gameView.playback' },
		{ type: 'command', command: 'stepFrame' },
	],
	'actorLab.context': [
		{ type: 'command', command: 'actorLab.details' },
		{ type: 'command', command: 'actorLab.actions' },
		{ type: 'command', command: 'actorLab.call' },
	],
	'actorLab.title': [
		{ type: 'command', command: 'actorLab.playback' },
		{ type: 'command', command: 'actorLab.select' },
		{ type: 'command', command: 'actorLab.spawn' },
		{ type: 'command', command: 'actorLab.emit' },
		{ type: 'command', command: 'actorLab.actions' },
		{ type: 'command', command: 'actorLab.call' },
		{ type: 'command', command: 'actorLab.details' },
	],
	'propertyInspector.title': [{ type: 'command', command: 'propertyInspector.source' }, { type: 'command', command: 'propertyInspector.close' }],
	'code.context': [{ type: 'command', command: 'undo' }, { type: 'command', command: 'redo' }],
	'code.symbol.context': [
		{ type: 'command', command: 'goToDefinition' },
		{ type: 'command', command: 'referenceSearch' },
		{ type: 'command', command: 'callHierarchy' },
		{ type: 'command', command: 'rename' },
		{ type: 'separator' },
		{ type: 'command', command: 'undo' },
		{ type: 'command', command: 'redo' },
	],
	'behaviorLens.node.context': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeTree' },
		{ type: 'separator' },
		{ type: 'command', command: 'behaviorLens.duplicateChild' },
		{ type: 'command', command: 'behaviorLens.removeChild' },
		{ type: 'separator' },
		{ type: 'command', command: 'undo' },
		{ type: 'command', command: 'redo' },
	],
	'behaviorLens.state.context': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeStateMachine' },
		{ type: 'command', command: 'behaviorLens.inspectRegisteredDefinitions' },
		{ type: 'separator' },
		{ type: 'command', command: 'behaviorLens.setInitialState' },
		{ type: 'separator' },
		{ type: 'command', command: 'undo' },
		{ type: 'command', command: 'redo' },
	],
	'behaviorLens.edge.context': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
	],
	'behaviorLens.property.context': [{ type: 'command', command: 'behaviorLens.editProperty' }, { type: 'command', command: 'behaviorLens.source' }, { type: 'command', command: 'behaviorLens.details' }, { type: 'command', command: 'behaviorLens.inspectRuntimeEffect' }, { type: 'command', command: 'behaviorLens.inspectRegisteredDefinitions' }],
	'behaviorLens.canvas.context': [{ type: 'command', command: 'undo' }, { type: 'command', command: 'redo' }],
	'sourceEditReview.title': [
		{ type: 'command', command: 'sourceEditReview.source' },
		{ type: 'command', command: 'sourceEditReview.apply' },
		{ type: 'command', command: 'sourceEditReview.discard' },
	],
	'menubar.file': [
		{ type: 'command', command: 'createResource' },
		{ type: 'command', command: 'save' },
		{ type: 'command', command: 'resources' },
		{ type: 'command', command: 'keepEditor' },
	],
	'menubar.edit': [
		{ type: 'command', command: 'undo' },
		{ type: 'command', command: 'redo' },
	],
	'menubar.run': [
		{ type: 'command', command: 'pause' },
		{ type: 'command', command: 'stepFrameBack' },
		{ type: 'command', command: 'stepFrame' },
		{ type: 'command', command: 'debugEvaluation' },
		{ type: 'command', command: 'debugContinue' },
		{ type: 'command', command: 'debugStepOver' },
		{ type: 'command', command: 'debugStepInto' },
		{ type: 'command', command: 'debugStepOut' },
		{ type: 'separator' },
		{ type: 'command', command: 'hot-resume' },
		{ type: 'command', command: 'reboot' },
		{ type: 'command', command: 'runCurrentFile' },
		{ type: 'command', command: 'runProject' },
	],
	'menubar.view': [
		{ type: 'command', command: 'commandPalette' },
		{ type: 'separator' },
		{ type: 'command', command: 'gameView' },
		{ type: 'command', command: 'actorLab' },
		{ type: 'command', command: 'sceneEditor' },
		{ type: 'command', command: 'behaviorLens' },
		{ type: 'command', command: 'scenarioLab' },
		{ type: 'command', command: 'problems' },
		{ type: 'separator' },
		{ type: 'command', command: 'wrap' },
		{ type: 'command', command: 'filter' },
	],
	'scenarioLab.title': [
		{ type: 'command', command: 'scenarioLab.run' },
		{ type: 'command', command: 'scenarioLab.rerun' },
		{ type: 'command', command: 'scenarioLab.cancel' },
		{ type: 'command', command: 'scenarioLab.details' },
	],
	'behaviorLens.graph.title': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.duplicateChild' },
		{ type: 'command', command: 'behaviorLens.removeChild' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeTree' },
		...GRAPH_ZOOM_ACTIONS,
	],
	'behaviorLens.title': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
	],
	'behaviorLens.stateGraph.title': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.setInitialState' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeStateMachine' },
		...GRAPH_ZOOM_ACTIONS,
	],
	'behaviorLens.properties.title': [{ type: 'command', command: 'behaviorLens.source' }, { type: 'command', command: 'behaviorLens.details' }, { type: 'command', command: 'behaviorLens.editProperty' }, { type: 'command', command: 'behaviorLens.inspectRuntimeEffect' }],
	'sceneEditor.title': [
		{ type: 'command', command: 'sceneEditor.source' },
		{ type: 'command', command: 'sceneEditor.moveMemberUp' },
		{ type: 'command', command: 'sceneEditor.moveMemberDown' },
		{ type: 'command', command: 'sceneEditor.removeMember' },
	],
};
