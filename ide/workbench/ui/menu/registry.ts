import type { EditorCommandId } from '../../../common/commands';
import type { WorkbenchIcon } from '../icon';

export type WorkbenchDropdownMenuId =
	| 'menubar.file'
	| 'menubar.edit'
	| 'menubar.run'
	| 'menubar.view'
	| 'menubar.tools'
	| 'menubar.window';

export type WorkbenchContextMenuId = 'scenarioLab.context' | 'play.context' | 'gamePanel.context' | 'animation.context' | 'events.context' | 'gte.context' | 'gpu.context' | 'behaviorLens.graph.actions' | 'behaviorLens.stateGraph.actions' | 'behaviorLens.properties.actions' | 'aem.context' | 'luaProgram.context' | 'actorLab.context' | 'actorLab.property.context' | 'code.context' | 'code.symbol.context' | 'behaviorLens.node.context' | 'behaviorLens.state.context' | 'behaviorLens.edge.context' | 'behaviorLens.property.context' | 'behaviorLens.canvas.context';

export type WorkbenchActionMenuId = 'home.work' | 'home.author' | 'home.run' | 'home.tools' | 'buildLog.title' | 'window.status' | 'window.title' | 'play.title' | 'animation.title' | 'animation.clients' | 'romInspector.title' | 'romInspector.reader.content' | 'romInspector.reader.title' | 'cartMap.title' | 'events.title' | 'gte.title' | 'gte.details.title' | 'gpu.title' | 'gpu.inspector.content' | 'gte.inspector.content' | 'gamePanel.title' | 'runtime.title' | 'editorTabs.title' | 'assistant.turn' | 'workspaceEditReview.title' | 'workspaceEditReview.evidence.title' | 'actorLab.title' | 'actorLab.details.title' | 'actorLab.stateGraph.title' | 'propertyInspector.title' | 'problems.title' | 'scenarioLab.title' | 'scenarioLab.target' | 'aem.title' | 'luaProgram.title' | 'sceneEditor.title' | 'behaviorLens.title' | 'behaviorLens.graph.title' | 'behaviorLens.stateGraph.title' | 'behaviorLens.properties.title';

export type WorkbenchMenuCommandItem = {
	readonly type: 'command';
	readonly command: EditorCommandId;
	readonly icon?: WorkbenchIcon;
	readonly checkedIcon?: WorkbenchIcon;
	readonly showLabel?: boolean;
};

export type WorkbenchMenuSeparator = {
	readonly type: 'separator';
};

export type WorkbenchMenuItem = WorkbenchMenuCommandItem | WorkbenchMenuSeparator;

type WorkbenchMenuContributions = Record<WorkbenchContextMenuId, readonly WorkbenchMenuItem[]> & {
	readonly 'home.work': readonly WorkbenchMenuCommandItem[];
	readonly 'home.author': readonly WorkbenchMenuCommandItem[];
	readonly 'home.run': readonly WorkbenchMenuCommandItem[];
	readonly 'home.tools': readonly WorkbenchMenuCommandItem[];
	readonly 'buildLog.title': readonly WorkbenchMenuCommandItem[];
	readonly 'play.title': readonly WorkbenchMenuCommandItem[];
	readonly 'actorLab.title': readonly WorkbenchMenuCommandItem[];
	readonly 'actorLab.details.title': readonly WorkbenchMenuCommandItem[];
	readonly 'actorLab.stateGraph.title': readonly WorkbenchMenuCommandItem[];
	readonly 'propertyInspector.title': readonly WorkbenchMenuCommandItem[];
	readonly 'problems.title': readonly WorkbenchMenuCommandItem[];
	readonly 'window.status': readonly WorkbenchMenuCommandItem[];
	readonly 'window.title': readonly WorkbenchMenuCommandItem[];
	readonly 'romInspector.reader.title': readonly WorkbenchMenuCommandItem[];
	readonly 'romInspector.reader.content': readonly WorkbenchMenuCommandItem[];
	readonly 'romInspector.title': readonly WorkbenchMenuCommandItem[];
	readonly 'events.title': readonly WorkbenchMenuCommandItem[];
	readonly 'gte.title': readonly WorkbenchMenuCommandItem[];
	readonly 'gte.details.title': readonly WorkbenchMenuCommandItem[];
	readonly 'gpu.title': readonly WorkbenchMenuCommandItem[];
	readonly 'gpu.inspector.content': readonly WorkbenchMenuCommandItem[];
	readonly 'gte.inspector.content': readonly WorkbenchMenuCommandItem[];
	readonly 'assistant.turn': readonly WorkbenchMenuCommandItem[];
	readonly 'workspaceEditReview.title': readonly WorkbenchMenuCommandItem[];
	readonly 'workspaceEditReview.evidence.title': readonly WorkbenchMenuCommandItem[];
	readonly 'menubar.file': readonly WorkbenchMenuItem[];
	readonly 'menubar.edit': readonly WorkbenchMenuItem[];
	readonly 'menubar.run': readonly WorkbenchMenuItem[];
	readonly 'menubar.view': readonly WorkbenchMenuItem[];
	readonly 'menubar.tools': readonly WorkbenchMenuItem[];
	readonly 'menubar.window': readonly WorkbenchMenuItem[];
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
	readonly 'cartMap.title': readonly WorkbenchMenuCommandItem[];
	readonly 'animation.title': readonly WorkbenchMenuCommandItem[];
	readonly 'animation.clients': readonly WorkbenchMenuCommandItem[];
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
	'home.work': [
		{ type: 'command', command: 'resources.focus', icon: 'source' },
		{ type: 'command', command: 'resourceSearch', icon: 'filter' },
		{ type: 'command', command: 'createResource', icon: 'source' },
		{ type: 'command', command: 'commandPalette', icon: 'menu' },
	],
	'home.author': [
		{ type: 'command', command: 'sceneEditor', icon: 'grid' },
		{ type: 'command', command: 'animation', icon: 'play' },
		{ type: 'command', command: 'behaviorLens', icon: 'actor' },
		{ type: 'command', command: 'cartMap', icon: 'grid' },
	],
	'home.run': [
		{ type: 'command', command: 'scenarioLab', icon: 'accept' },
		{ type: 'command', command: 'gameView', icon: 'play' },
		{ type: 'command', command: 'terminal', icon: 'menu' },
	],
	'home.tools': [
		{ type: 'command', command: 'builds.start', icon: 'refresh' },
		{ type: 'command', command: 'builds.jobs', icon: 'info' },
		{ type: 'command', command: 'assistant', icon: 'actor' },
	],
	'play.title': [{ type: 'command', command: 'play.stop' }, { type: 'command', command: 'play.more' }],
	'gamePanel.context': [{ type: 'command', command: 'runtime.toggleTimeline' }],
	'play.context': [
		{ type: 'command', command: 'runtime.toggleTimeline' },
		{ type: 'separator' },
		{ type: 'command', command: 'play.actors' },
		{ type: 'command', command: 'play.reset' },
		{ type: 'command', command: 'play.source' },
		{ type: 'command', command: 'play.breakpoints' },
		{ type: 'separator' },
		{ type: 'command', command: 'play.continue' },
		{ type: 'command', command: 'play.stepInto' },
		{ type: 'command', command: 'play.stepOver' },
		{ type: 'command', command: 'play.stepOut' },
		{ type: 'separator' },
		{ type: 'command', command: 'play.details' },
	],
	'animation.title': [
		{ type: 'command', command: 'animation.addKey' },
		{ type: 'command', command: 'animation.addTrack' },
		{ type: 'command', command: 'animation.addFrame' },
	],
	'animation.clients': [
		{ type: 'command', command: 'animation.tracks' },
		{ type: 'command', command: 'animation.keys' },
		{ type: 'command', command: 'animation.details' },
	],
	'animation.context': [
		{ type: 'command', command: 'animation.duplicate' },
		{ type: 'command', command: 'animation.earlier' },
		{ type: 'command', command: 'animation.later' },
		{ type: 'command', command: 'animation.addClip' },
		{ type: 'command', command: 'animation.addFrame' },
		{ type: 'command', command: 'animation.addProperty' },
		{ type: 'command', command: 'animation.openClip' },
		{ type: 'separator' },
		{ type: 'command', command: 'animation.fit' },
		{ type: 'command', command: 'animation.snap' },
		{ type: 'command', command: 'animation.edit' },
		{ type: 'command', command: 'animation.remove' },
		{ type: 'command', command: 'animation.source' },
		{ type: 'command', command: 'animation.producerSource' },
	],
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
		{ type: 'command', command: 'actorLab.find' },
		{ type: 'command', command: 'actorLab.revealActive' },
		{ type: 'command', command: 'actorLab.follow' },
		{ type: 'command', command: 'actorLab.stateGraph' },
		{ type: 'command', command: 'actorLab.details' },
		{ type: 'command', command: 'actorLab.actions' },
		{ type: 'command', command: 'actorLab.call' },
		{ type: 'command', command: 'actorLab.spawn' },
		{ type: 'command', command: 'actorLab.emit' },
		{ type: 'separator' },
		{ type: 'command', command: 'graph.zoomIn' },
		{ type: 'command', command: 'graph.zoomOut' },
		{ type: 'command', command: 'graph.resetZoom' },
	],
	'actorLab.stateGraph.title': [
		{ type: 'command', command: 'actorLab.outline', icon: 'back' },
		{ type: 'command', command: 'actorLab.follow', icon: 'follow' },
		{ type: 'command', command: 'actorLab.more', icon: 'more' },
	],
	'actorLab.title': [
		{ type: 'command', command: 'actorLab.select', icon: 'actor' },
		{ type: 'command', command: 'actorLab.follow', icon: 'follow' },
		{ type: 'command', command: 'actorLab.more', icon: 'more' },
	],
	'actorLab.details.title': [
		{ type: 'command', command: 'actorLab.lockDetails', icon: 'pin', checkedIcon: 'unpin' },
		{ type: 'command', command: 'window.maximize', icon: 'maximize', checkedIcon: 'restore' },
		{ type: 'command', command: 'window.hide', icon: 'close' },
	],
	'actorLab.property.context': [
		{ type: 'command', command: 'actorLab.pinProperty' },
		{ type: 'command', command: 'actorLab.unpinProperty' },
		{ type: 'command', command: 'actorLab.revealPinnedProperty' },
		{ type: 'separator' },
		{ type: 'command', command: 'propertyInspector.source' },
	],
	'propertyInspector.title': [{ type: 'command', command: 'propertyInspector.source' }, { type: 'command', command: 'propertyInspector.close' }],
	'problems.title': [{ type: 'command', command: 'problems.coverage', icon: 'info' }],
	'window.status': [{ type: 'command', command: 'window.restoreMinimized', icon: 'restore', showLabel: true }],
	'window.title': [{ type: 'command', command: 'window.minimize', icon: 'minimize' },
		{ type: 'command', command: 'window.maximize', icon: 'maximize', checkedIcon: 'restore' },
		{ type: 'command', command: 'window.hide', icon: 'close' }],
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
	'romInspector.reader.title': [
		{ type: 'command', command: 'romInspector.hold', icon: 'pin', checkedIcon: 'unpin' },
		{ type: 'command', command: 'window.maximize', icon: 'maximize', checkedIcon: 'restore' },
		{ type: 'command', command: 'window.hide', icon: 'close' },
	],
	'romInspector.reader.content': [
		{ type: 'command', command: 'romInspector.content' },
		{ type: 'command', command: 'romInspector.zoom' },
		{ type: 'command', command: 'romInspector.collision' },
		{ type: 'command', command: 'romInspector.source', icon: 'source' },
	],
	'romInspector.title': [
		{ type: 'command', command: 'romInspector.inspect', icon: 'info' },
		{ type: 'command', command: 'romInspector.key', icon: 'legend' },
		{ type: 'command', command: 'romInspector.assets' },
		{ type: 'command', command: 'romInspector.structure' },
		{ type: 'command', command: 'romInspector.code' },
		{ type: 'command', command: 'romInspector.sort' },
		{ type: 'command', command: 'romInspector.source', icon: 'source' },
	],
	'gpu.title': [
		{ type: 'command', command: 'gpu.follow', icon: 'follow' },
		{ type: 'command', command: 'gpu.details', icon: 'info' },
	],
	'gpu.inspector.content': [{ type: 'command', command: 'gpu.view' }],
	'gpu.context': [
		{ type: 'command', command: 'gpu.view' },
		{ type: 'command', command: 'gpu.details' },
		{ type: 'command', command: 'gpu.goToFrame' },
		{ type: 'separator' },
		{ type: 'command', command: 'gpu.filter' },
		{ type: 'command', command: 'gpu.clear' },
	],
	'gte.title': [
		{ type: 'command', command: 'gte.follow', icon: 'follow' },
		{ type: 'command', command: 'gte.details', icon: 'info' },
	],
	'gte.inspector.content': [{ type: 'command', command: 'gte.view' }],
	'gte.details.title': [{ type: 'command', command: 'gte.source', icon: 'source' },
		{ type: 'command', command: 'window.maximize', icon: 'maximize', checkedIcon: 'restore' },
		{ type: 'command', command: 'window.hide', icon: 'close' }],
	'gte.context': [
		{ type: 'command', command: 'gte.view' },
		{ type: 'command', command: 'gte.details' },
		{ type: 'command', command: 'gte.source' },
		{ type: 'command', command: 'gte.goToFrame' },
		{ type: 'separator' },
		{ type: 'command', command: 'gte.filter' },
		{ type: 'command', command: 'gte.clear' },
	],
	'events.title': [
		{ type: 'command', command: 'events.filter', icon: 'filter' },
		{ type: 'command', command: 'events.details', icon: 'info' },
	],
	'events.context': [
		{ type: 'command', command: 'events.details' },
		{ type: 'command', command: 'events.goToFrame' },
		{ type: 'command', command: 'events.previousFrame' },
		{ type: 'command', command: 'events.nextFrame' },
		{ type: 'separator' },
		{ type: 'command', command: 'events.filter' },
		{ type: 'command', command: 'events.clear' },
	],
	'assistant.turn': [
		{ type: 'command', command: 'assistant.send' },
		{ type: 'command', command: 'assistant.stop' },
		{ type: 'command', command: 'assistant.queue' },
		{ type: 'command', command: 'assistant.direct' },
		{ type: 'command', command: 'assistant.review' },
	],
	'workspaceEditReview.title': [
		{ type: 'command', command: 'workspaceEditReview.apply', icon: 'accept' },
		{ type: 'command', command: 'workspaceEditReview.discard', icon: 'close' },
	],
	'workspaceEditReview.evidence.title': [
		{ type: 'command', command: 'workspaceEditReview.apply', icon: 'accept' },
		{ type: 'command', command: 'workspaceEditReview.source', icon: 'source' },
		{ type: 'command', command: 'workspaceEditReview.impacts', icon: 'info' },
		{ type: 'command', command: 'workspaceEditReview.discard', icon: 'close' },
	],
	'menubar.file': [
		{ type: 'command', command: 'createResource' },
		{ type: 'command', command: 'projects.createCartridge' },
		{ type: 'separator' },
		{ type: 'command', command: 'resourceSearch' },
		{ type: 'command', command: 'resources.import' },
		{ type: 'separator' },
		{ type: 'command', command: 'save' },
		{ type: 'command', command: 'keepEditor' },
		{ type: 'command', command: 'tabs.close' },
	],
	'menubar.edit': [
		{ type: 'command', command: 'undo' },
		{ type: 'command', command: 'redo' },
		{ type: 'separator' },
		{ type: 'command', command: 'cut' },
		{ type: 'command', command: 'copy' },
		{ type: 'command', command: 'paste' },
		{ type: 'separator' },
		{ type: 'command', command: 'findLocal' },
		{ type: 'command', command: 'findGlobal' },
		{ type: 'separator' },
		{ type: 'command', command: 'rename' },
		{ type: 'command', command: 'renamePreview' },
	],
	'menubar.run': [
		{ type: 'command', command: 'play.reveal' },
		{ type: 'command', command: 'runCurrentFile' },
		{ type: 'command', command: 'runProject' },
		{ type: 'separator' },
		{ type: 'command', command: 'pause' },
		{ type: 'command', command: 'stepFrameBack' },
		{ type: 'command', command: 'stepFrame' },
		{ type: 'separator' },
		{ type: 'command', command: 'debugEvaluation' },
		{ type: 'command', command: 'debugContinue' },
		{ type: 'command', command: 'debugStepOver' },
		{ type: 'command', command: 'debugStepInto' },
		{ type: 'command', command: 'debugStepOut' },
		{ type: 'separator' },
		{ type: 'command', command: 'hot-resume' },
		{ type: 'command', command: 'reboot' },
	],
	'menubar.view': [
		{ type: 'command', command: 'home' },
		{ type: 'command', command: 'commandPalette' },
		{ type: 'command', command: 'openEditors' },
		{ type: 'separator' },
		{ type: 'command', command: 'resources' },
		{ type: 'command', command: 'problems' },
		{ type: 'command', command: 'runtime.toggleTimeline' },
		{ type: 'command', command: 'terminal' },
		{ type: 'separator' },
		{ type: 'command', command: 'assistant' },
		{ type: 'command', command: 'conversations' },
		{ type: 'separator' },
		{ type: 'command', command: 'gameView' },
		{ type: 'command', command: 'gameView.togglePanel' },
		{ type: 'separator' },
		{ type: 'command', command: 'wrap' },
		{ type: 'command', command: 'filter' },
		{ type: 'command', command: 'theme-toggle' },
	],
	'menubar.window': [
		{ type: 'command', command: 'window.focusMain' },
		{ type: 'command', command: 'window.showAll' },
		{ type: 'command', command: 'window.restoreMinimized' },
		{ type: 'separator' },
		{ type: 'command', command: 'window.newEditor' },
		{ type: 'command', command: 'window.copyEditor' },
		{ type: 'separator' },
		{ type: 'command', command: 'window.maximize' },
		{ type: 'command', command: 'window.minimize' },
		{ type: 'command', command: 'window.hide' },
	],
	'menubar.tools': [
		{ type: 'command', command: 'sceneEditor' },
		{ type: 'command', command: 'animation' },
		{ type: 'command', command: 'cartMap' },
		{ type: 'command', command: 'behaviorLens' },
		{ type: 'separator' },
		{ type: 'command', command: 'scenarioLab' },
		{ type: 'separator' },
		{ type: 'command', command: 'actorLab' },
		{ type: 'command', command: 'events' },
		{ type: 'command', command: 'romInspector' },
		{ type: 'command', command: 'gteDebugger' },
		{ type: 'command', command: 'gpuDebugger' },
		{ type: 'command', command: 'hostError' },
	],
	'scenarioLab.target': [
		...TEST_DEBUG_ACTIONS,
		{ type: 'command', command: 'scenarioLab.cancel' },
		{ type: 'command', command: 'scenarioLab.details' },
		{ type: 'command', command: 'scenarioLab.closeTarget' },
	],
	'scenarioLab.title': [
		{ type: 'command', command: 'scenarioLab.play' },
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
	'scenarioLab.context': [
		{ type: 'command', command: 'scenarioLab.runWithCompanion' },
		{ type: 'command', command: 'scenarioLab.debugWithCompanion' },
		{ type: 'command', command: 'scenarioLab.playWithCompanion' },
	],
	'behaviorLens.graph.title': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeTree' },
	],
	'behaviorLens.title': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
	],
	'behaviorLens.stateGraph.title': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeStateMachine' },
	],
	'aem.title': [
		{ type: 'command', command: 'aem.add' },
		{ type: 'command', command: 'aem.edit' },
		{ type: 'command', command: 'aem.remove' },
		{ type: 'command', command: 'aem.source' },
		{ type: 'command', command: 'aem.apply' },
		{ type: 'command', command: 'aem.testEvent' },
	],
	'luaProgram.title': [
		{ type: 'command', command: 'luaProgram.add' },
		{ type: 'command', command: 'luaProgram.edit' },
		{ type: 'command', command: 'luaProgram.source' },
		{ type: 'command', command: 'luaProgram.live' },
		{ type: 'command', command: 'luaProgram.authoring' },
	],
	'gamePanel.title': [{ type: 'command', command: 'gameView.closePanel', icon: 'close' }],
	'runtime.title': [
		{ type: 'command', command: 'stepFrameBack', icon: 'stepBack' },
		{ type: 'command', command: 'runtime.playback', icon: 'play' },
		{ type: 'command', command: 'stepFrame', icon: 'stepForward' },
		{ type: 'command', command: 'runtime.resume', icon: 'accept' },
		{ type: 'command', command: 'runtime.present', icon: 'present' },
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
		{ type: 'command', command: 'aem.apply' },
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
	],
	'cartMap.title': [
		{ type: 'command', command: 'cartMap.map', icon: 'grid' },
		{ type: 'command', command: 'cartMap.outline', icon: 'back' },
		{ type: 'command', command: 'cartMap.source', icon: 'source' },
	],
	'buildLog.title': [
		{ type: 'command', command: 'buildLog.error' },
		{ type: 'command', command: 'buildLog.output' },
		{ type: 'command', command: 'buildLog.refresh', icon: 'refresh' },
		{ type: 'command', command: 'buildLog.copyAll', icon: 'copy' },
	],
	'sceneEditor.title': [
		{ type: 'command', command: 'sceneEditor.details', icon: 'info' },
		{ type: 'command', command: 'sceneEditor.outline', icon: 'back' },
		{ type: 'command', command: 'sceneEditor.source' },
		{ type: 'command', command: 'sceneEditor.moveMemberUp' },
		{ type: 'command', command: 'sceneEditor.moveMemberDown' },
		{ type: 'command', command: 'sceneEditor.removeMember' },
	],
};
