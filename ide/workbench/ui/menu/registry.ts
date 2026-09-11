import type { EditorCommandId } from '../../../common/commands';

export type WorkbenchDropdownMenuId =
	| 'menubar.file'
	| 'menubar.edit'
	| 'menubar.run'
	| 'menubar.view';

export type WorkbenchContextMenuId = 'code.context' | 'code.symbol.context' | 'behaviorLens.node.context' | 'behaviorLens.state.context' | 'behaviorLens.edge.context' | 'behaviorLens.property.context' | 'behaviorLens.canvas.context';

export type WorkbenchActionMenuId = 'propertyInspector.title' | 'sourceEditReview.title' | 'scenarioLab.title' | 'sceneEditor.title' | 'behaviorLens.title' | 'behaviorLens.graph.title' | 'behaviorLens.stateGraph.title' | 'behaviorLens.properties.title';

export type WorkbenchMenuCommandItem = {
	readonly type: 'command';
	readonly command: EditorCommandId;
};

export type WorkbenchMenuSeparator = {
	readonly type: 'separator';
};

export type WorkbenchMenuItem = WorkbenchMenuCommandItem | WorkbenchMenuSeparator;

type WorkbenchMenuContributions = Record<WorkbenchContextMenuId, readonly WorkbenchMenuItem[]> & {
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
		{ type: 'separator' },
		{ type: 'command', command: 'behaviorLens.duplicateChild' },
		{ type: 'command', command: 'behaviorLens.removeChild' },
		{ type: 'separator' },
		{ type: 'command', command: 'undo' },
		{ type: 'command', command: 'redo' },
		{ type: 'separator' },
		...GRAPH_ZOOM_ACTIONS,
	],
	'behaviorLens.state.context': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'separator' },
		{ type: 'command', command: 'behaviorLens.setInitialState' },
		{ type: 'separator' },
		{ type: 'command', command: 'undo' },
		{ type: 'command', command: 'redo' },
		{ type: 'separator' },
		...GRAPH_ZOOM_ACTIONS,
	],
	'behaviorLens.edge.context': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'separator' },
		...GRAPH_ZOOM_ACTIONS,
	],
	'behaviorLens.property.context': [{ type: 'command', command: 'behaviorLens.source' }, { type: 'command', command: 'behaviorLens.details' }],
	'behaviorLens.canvas.context': [...GRAPH_ZOOM_ACTIONS, { type: 'separator' }, { type: 'command', command: 'undo' }, { type: 'command', command: 'redo' }],
	'sourceEditReview.title': [
		{ type: 'command', command: 'sourceEditReview.source' },
		{ type: 'command', command: 'sourceEditReview.apply' },
		{ type: 'command', command: 'sourceEditReview.discard' },
	],
	'menubar.file': [
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
		{ type: 'command', command: 'debugContinue' },
		{ type: 'command', command: 'debugStepOver' },
		{ type: 'command', command: 'debugStepInto' },
		{ type: 'command', command: 'debugStepOut' },
		{ type: 'separator' },
		{ type: 'command', command: 'hot-resume' },
		{ type: 'command', command: 'reboot' },
	],
	'menubar.view': [
		{ type: 'command', command: 'commandPalette' },
		{ type: 'separator' },
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
		...GRAPH_ZOOM_ACTIONS,
	],
	'behaviorLens.properties.title': [{ type: 'command', command: 'behaviorLens.source' }, { type: 'command', command: 'behaviorLens.details' }],
	'sceneEditor.title': [
		{ type: 'command', command: 'sceneEditor.source' },
		{ type: 'command', command: 'sceneEditor.moveMemberUp' },
		{ type: 'command', command: 'sceneEditor.moveMemberDown' },
		{ type: 'command', command: 'sceneEditor.removeMember' },
	],
};
