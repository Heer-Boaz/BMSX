import type { EditorCommandId } from '../../../common/commands';

export type WorkbenchDropdownMenuId =
	| 'menubar.file'
	| 'menubar.edit'
	| 'menubar.run'
	| 'menubar.view';

export type WorkbenchContextMenuId = 'behaviorLens.graph.actions' | 'behaviorLens.stateGraph.actions' | 'behaviorLens.properties.actions' | 'aem.context' | 'luaProgram.context' | 'actorLab.context' | 'code.context' | 'code.symbol.context' | 'behaviorLens.node.context' | 'behaviorLens.state.context' | 'behaviorLens.edge.context' | 'behaviorLens.property.context' | 'behaviorLens.canvas.context';

export type WorkbenchActionMenuId = 'gamePanel.title' | 'runtime.title' | 'editorTabs.title' | 'terminal.input' | 'assistant.turn' | 'workspaceEditReview.title' | 'actorLab.title' | 'propertyInspector.title' | 'sourceEditReview.title' | 'scenarioLab.title' | 'scenarioLab.target' | 'aem.title' | 'luaProgram.title' | 'sceneEditor.title' | 'behaviorLens.title' | 'behaviorLens.graph.title' | 'behaviorLens.stateGraph.title' | 'behaviorLens.properties.title';

export type WorkbenchMenuCommandItem = {
	readonly type: 'command';
	readonly command: EditorCommandId;
};

export type WorkbenchMenuSeparator = {
	readonly type: 'separator';
};

export type WorkbenchMenuItem = WorkbenchMenuCommandItem | WorkbenchMenuSeparator;

type WorkbenchMenuContributions = Record<WorkbenchContextMenuId, readonly WorkbenchMenuItem[]> & {
	readonly 'actorLab.title': readonly WorkbenchMenuCommandItem[];
	readonly 'propertyInspector.title': readonly WorkbenchMenuCommandItem[];
	readonly 'sourceEditReview.title': readonly WorkbenchMenuCommandItem[];
	readonly 'terminal.input': readonly WorkbenchMenuCommandItem[];
	readonly 'assistant.turn': readonly WorkbenchMenuCommandItem[];
	readonly 'workspaceEditReview.title': readonly WorkbenchMenuCommandItem[];
	readonly 'menubar.file': readonly WorkbenchMenuItem[];
	readonly 'menubar.edit': readonly WorkbenchMenuItem[];
	readonly 'menubar.run': readonly WorkbenchMenuItem[];
	readonly 'menubar.view': readonly WorkbenchMenuItem[];
	readonly 'scenarioLab.title': readonly WorkbenchMenuCommandItem[];
	readonly 'scenarioLab.target': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.graph.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.stateGraph.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.properties.title': readonly WorkbenchMenuCommandItem[];
	readonly 'aem.title': readonly WorkbenchMenuCommandItem[];
	readonly 'luaProgram.title': readonly WorkbenchMenuCommandItem[];
	readonly 'gamePanel.title': readonly WorkbenchMenuCommandItem[];
	readonly 'runtime.title': readonly WorkbenchMenuCommandItem[];
	readonly 'editorTabs.title': readonly WorkbenchMenuCommandItem[];
	readonly 'sceneEditor.title': readonly WorkbenchMenuCommandItem[];
};

const GRAPH_ZOOM_ACTIONS: readonly WorkbenchMenuCommandItem[] = [
	{ type: 'command', command: 'graph.zoomOut' },
	{ type: 'command', command: 'graph.resetZoom' },
	{ type: 'command', command: 'graph.zoomIn' },
];

const TEST_DEBUG_ACTIONS: readonly WorkbenchMenuCommandItem[] = [
	{ type: 'command', command: 'scenarioLab.continue' },
	{ type: 'command', command: 'scenarioLab.stepInto' },
	{ type: 'command', command: 'scenarioLab.stepOver' },
	{ type: 'command', command: 'scenarioLab.stepOut' },
	{ type: 'command', command: 'scenarioLab.pause' },
	{ type: 'command', command: 'scenarioLab.breakpoints' },
];

/** Immutable built-in menu contributions; renderers only project these items. */
export const WORKBENCH_MENUS: WorkbenchMenuContributions = {
	'behaviorLens.graph.actions': [
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.duplicateChild' },
		{ type: 'command', command: 'behaviorLens.removeChild' },
		{ type: 'separator' }, ...GRAPH_ZOOM_ACTIONS,
	],
	'behaviorLens.stateGraph.actions': [
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.setInitialState' },
		{ type: 'command', command: 'behaviorLens.inspectRegisteredDefinitions' },
		{ type: 'separator' }, ...GRAPH_ZOOM_ACTIONS,
	],
	'behaviorLens.properties.actions': [
		{ type: 'command', command: 'behaviorLens.testEffect' },
		{ type: 'command', command: 'inputBindings' },
		{ type: 'separator' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.editProperty' },
		{ type: 'command', command: 'behaviorLens.addProperty' },
		{ type: 'command', command: 'behaviorLens.removeProperty' },
		{ type: 'command', command: 'behaviorLens.inspectRegisteredDefinitions' },
	],
	'actorLab.context': [
		{ type: 'command', command: 'actorLab.details' },
		{ type: 'command', command: 'actorLab.actions' },
		{ type: 'command', command: 'actorLab.call' },
	],
	'actorLab.title': [
		{ type: 'command', command: 'actorLab.select' },
		{ type: 'command', command: 'actorLab.spawn' },
		{ type: 'command', command: 'actorLab.emit' },
		{ type: 'command', command: 'actorLab.actions' },
		{ type: 'command', command: 'actorLab.call' },
		{ type: 'command', command: 'actorLab.details' },
	],
	'propertyInspector.title': [{ type: 'command', command: 'propertyInspector.source' }, { type: 'command', command: 'propertyInspector.close' }],
	'code.context': [
		{ type: 'command', command: 'undo' }, { type: 'command', command: 'redo' },
		{ type: 'separator' },
		{ type: 'command', command: 'cut' }, { type: 'command', command: 'copy' }, { type: 'command', command: 'paste' },
	],
	'code.symbol.context': [
		{ type: 'command', command: 'cut' }, { type: 'command', command: 'copy' }, { type: 'command', command: 'paste' },
		{ type: 'separator' },
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
	'behaviorLens.property.context': [
		{ type: 'command', command: 'behaviorLens.editProperty' },
		{ type: 'command', command: 'behaviorLens.addProperty' },
		{ type: 'command', command: 'behaviorLens.removeProperty' },
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeEffect' },
		{ type: 'command', command: 'behaviorLens.inspectRegisteredDefinitions' },
	],
	'behaviorLens.canvas.context': [{ type: 'command', command: 'undo' }, { type: 'command', command: 'redo' }],
	'sourceEditReview.title': [
		{ type: 'command', command: 'sourceEditReview.source' },
		{ type: 'command', command: 'sourceEditReview.apply' },
		{ type: 'command', command: 'sourceEditReview.discard' },
	],
	'terminal.input': [
		{ type: 'command', command: 'terminal.context' },
		{ type: 'command', command: 'terminal.evaluate' },
		{ type: 'command', command: 'terminal.pause' },
		{ type: 'command', command: 'terminal.continue' },
	],
	'assistant.turn': [
		{ type: 'command', command: 'assistant.send' },
		{ type: 'command', command: 'assistant.queue' },
		{ type: 'command', command: 'assistant.direct' },
		{ type: 'command', command: 'assistant.stop' },
		{ type: 'command', command: 'assistant.review' },
	],
	'workspaceEditReview.title': [
		{ type: 'command', command: 'workspaceEditReview.apply' },
		{ type: 'command', command: 'workspaceEditReview.discard' },
	],
	'menubar.file': [
		{ type: 'command', command: 'createResource' },
		{ type: 'command', command: 'projects.createCartridge' },
		{ type: 'command', command: 'resources.import' },
		{ type: 'command', command: 'save' },
		{ type: 'command', command: 'resources' },
		{ type: 'command', command: 'keepEditor' },
	],
	'menubar.edit': [
		{ type: 'command', command: 'undo' },
		{ type: 'command', command: 'redo' },
		{ type: 'separator' },
		{ type: 'command', command: 'cut' },
		{ type: 'command', command: 'copy' },
		{ type: 'command', command: 'paste' },
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
		{ type: 'command', command: 'assistant' },
		{ type: 'command', command: 'conversations' },
		{ type: 'command', command: 'terminal' },
		{ type: 'command', command: 'gameView' },
		{ type: 'command', command: 'gameView.togglePanel' },
		{ type: 'command', command: 'actorLab' },
		{ type: 'command', command: 'sceneEditor' },
		{ type: 'command', command: 'behaviorLens' },
		{ type: 'command', command: 'scenarioLab' },
		{ type: 'command', command: 'problems' },
		{ type: 'separator' },
		{ type: 'command', command: 'wrap' },
		{ type: 'command', command: 'filter' },
	],
	'scenarioLab.target': [
		...TEST_DEBUG_ACTIONS,
		{ type: 'command', command: 'scenarioLab.cancel' },
		{ type: 'command', command: 'scenarioLab.details' },
		{ type: 'command', command: 'scenarioLab.closeTarget' },
	],
	'scenarioLab.title': [
		{ type: 'command', command: 'scenarioLab.run' },
		{ type: 'command', command: 'scenarioLab.debug' },
		...TEST_DEBUG_ACTIONS,
		{ type: 'command', command: 'scenarioLab.inspectStop' },
		{ type: 'command', command: 'scenarioLab.rerun' },
		{ type: 'command', command: 'scenarioLab.revealRun' },
		{ type: 'command', command: 'scenarioLab.cancel' },
		{ type: 'command', command: 'scenarioLab.details' },
		{ type: 'command', command: 'scenarioLab.inspectTarget' },
	],
	'behaviorLens.graph.title': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeTree' },
		{ type: 'command', command: 'behaviorLens.more' },
	],
	'behaviorLens.title': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
	],
	'behaviorLens.stateGraph.title': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeStateMachine' },
		{ type: 'command', command: 'behaviorLens.more' },
	],
	'aem.title': [
		{ type: 'command', command: 'aem.add' },
		{ type: 'command', command: 'aem.edit' },
		{ type: 'command', command: 'aem.remove' },
		{ type: 'command', command: 'aem.source' },
		{ type: 'command', command: 'aem.testEvent' },
	],
	'luaProgram.title': [
		{ type: 'command', command: 'luaProgram.add' },
		{ type: 'command', command: 'luaProgram.edit' },
		{ type: 'command', command: 'luaProgram.source' },
		{ type: 'command', command: 'luaProgram.live' },
		{ type: 'command', command: 'luaProgram.authoring' },
		{ type: 'command', command: 'luaProgram.more' },
	],
	'gamePanel.title': [{ type: 'command', command: 'gameView.closePanel' }],
	'runtime.title': [
		{ type: 'command', command: 'stepFrameBack' },
		{ type: 'command', command: 'pause' },
		{ type: 'command', command: 'stepFrame' },
		{ type: 'command', command: 'runtime.present' },
	],
	'editorTabs.title': [
		{ type: 'command', command: 'tabs.scrollLeft' },
		{ type: 'command', command: 'tabs.scrollRight' },
		{ type: 'command', command: 'openEditors' },
	],
	'aem.context': [
		{ type: 'command', command: 'aem.add' },
		{ type: 'command', command: 'aem.edit' },
		{ type: 'command', command: 'aem.remove' },
		{ type: 'command', command: 'aem.source' },
		{ type: 'command', command: 'aem.testEvent' },
	],
	'luaProgram.context': [
		{ type: 'command', command: 'luaProgram.add' },
		{ type: 'command', command: 'luaProgram.edit' },
		{ type: 'command', command: 'luaProgram.remove' },
		{ type: 'command', command: 'luaProgram.source' },
		{ type: 'command', command: 'luaProgram.live' },
		{ type: 'command', command: 'luaProgram.authoring' },
		{ type: 'command', command: 'luaProgram.selectInstance' },
		{ type: 'command', command: 'luaProgram.testInput' },
	],
	'behaviorLens.properties.title': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeEffect' },
		{ type: 'command', command: 'behaviorLens.more' },
	],
	'sceneEditor.title': [
		{ type: 'command', command: 'sceneEditor.source' },
		{ type: 'command', command: 'sceneEditor.moveMemberUp' },
		{ type: 'command', command: 'sceneEditor.moveMemberDown' },
		{ type: 'command', command: 'sceneEditor.removeMember' },
	],
};
