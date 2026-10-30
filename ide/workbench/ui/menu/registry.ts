import type { EditorCommandId } from '../../../common/commands';
import type { WorkbenchIcon } from '../icon';

export type WorkbenchDropdownMenuId =
	| 'menubar.file'
	| 'menubar.edit'
	| 'menubar.run'
	| 'menubar.view'
	| 'menubar.tools'
	| 'menubar.window';

export type WorkbenchContextMenuId = 'resources.directory.context' | 'resourceViewer.context' | 'editor.source.actions' | 'resources.open.context' | 'resources.resource.context' | 'resources.disclosure.context' | 'editorTabs.context' | 'editorGroup.context' | 'window.context' | 'window.minimizable.context' | 'activity.context' | 'activity.window.context' | 'scenarioLab.context' | 'play.context' | 'gamePanel.context' | 'events.context' | 'gte.context' | 'gpu.context' | 'behaviorLens.graph.actions' | 'behaviorLens.stateGraph.actions' | 'behaviorLens.properties.actions' | 'aem.context' | 'actorLab.context' | 'actorLab.stateGraph.context' | 'actorLab.property.context' | 'code.context' | 'code.symbol.context' | 'behaviorLens.node.context' | 'behaviorLens.state.context' | 'behaviorLens.edge.context' | 'behaviorLens.property.context' | 'behaviorLens.canvas.context' | 'behaviorLens.graphCanvas.context';

export type WorkbenchActionMenuId = 'home.work' | 'home.author' | 'home.behavior' | 'home.gameplay' | 'home.run' | 'home.tools' | 'window.status' | 'status.context' | 'window.title' | 'window.minimizable.title' | 'play.title' | 'animation.clients' | 'romInspector.title' | 'romInspector.reader.title' | 'events.title' | 'gte.title' | 'gte.details.title' | 'gpu.title' | 'gpu.inspector.content' | 'gte.inspector.content' | 'gamePanel.title' | 'runtime.title' | 'editorTabs.title' | 'workspaceEditReview.title' | 'workspaceEditReview.evidence.title' | 'actorLab.title' | 'actorLab.details.title' | 'actorLab.stateGraph.title' | 'propertyInspector.title' | 'problems.title' | 'aem.title' | 'behaviorLens.title' | 'behaviorLens.graph.title' | 'behaviorLens.stateGraph.title' | 'behaviorLens.properties.title';

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
	readonly 'home.behavior': readonly WorkbenchMenuCommandItem[];
	readonly 'home.gameplay': readonly WorkbenchMenuCommandItem[];
	readonly 'home.run': readonly WorkbenchMenuCommandItem[];
	readonly 'home.tools': readonly WorkbenchMenuCommandItem[];
	readonly 'play.title': readonly WorkbenchMenuCommandItem[];
	readonly 'actorLab.title': readonly WorkbenchMenuCommandItem[];
	readonly 'actorLab.details.title': readonly WorkbenchMenuCommandItem[];
	readonly 'actorLab.stateGraph.title': readonly WorkbenchMenuCommandItem[];
	readonly 'propertyInspector.title': readonly WorkbenchMenuCommandItem[];
	readonly 'problems.title': readonly WorkbenchMenuCommandItem[];
	readonly 'window.status': readonly WorkbenchMenuCommandItem[];
	readonly 'status.context': readonly WorkbenchMenuCommandItem[];
	readonly 'window.title': readonly WorkbenchMenuCommandItem[];
	readonly 'window.minimizable.title': readonly WorkbenchMenuCommandItem[];
	readonly 'romInspector.reader.title': readonly WorkbenchMenuCommandItem[];
	readonly 'romInspector.title': readonly WorkbenchMenuCommandItem[];
	readonly 'events.title': readonly WorkbenchMenuCommandItem[];
	readonly 'gte.title': readonly WorkbenchMenuCommandItem[];
	readonly 'gte.details.title': readonly WorkbenchMenuCommandItem[];
	readonly 'gpu.title': readonly WorkbenchMenuCommandItem[];
	readonly 'gpu.inspector.content': readonly WorkbenchMenuCommandItem[];
	readonly 'gte.inspector.content': readonly WorkbenchMenuCommandItem[];
	readonly 'workspaceEditReview.title': readonly WorkbenchMenuCommandItem[];
	readonly 'workspaceEditReview.evidence.title': readonly WorkbenchMenuCommandItem[];
	readonly 'menubar.file': readonly WorkbenchMenuItem[];
	readonly 'menubar.edit': readonly WorkbenchMenuItem[];
	readonly 'menubar.run': readonly WorkbenchMenuItem[];
	readonly 'menubar.view': readonly WorkbenchMenuItem[];
	readonly 'menubar.tools': readonly WorkbenchMenuItem[];
	readonly 'menubar.window': readonly WorkbenchMenuItem[];
	readonly 'behaviorLens.graph.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.stateGraph.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.properties.title': readonly WorkbenchMenuCommandItem[];
	readonly 'aem.title': readonly WorkbenchMenuCommandItem[];
	readonly 'gamePanel.title': readonly WorkbenchMenuCommandItem[];
	readonly 'runtime.title': readonly WorkbenchMenuCommandItem[];
	readonly 'editorTabs.title': readonly WorkbenchMenuCommandItem[];
	readonly 'animation.clients': readonly WorkbenchMenuCommandItem[];
};

const WINDOW_TITLE_ACTIONS: readonly WorkbenchMenuCommandItem[] = [
	{ type: 'command', command: 'window.maximize', icon: 'maximize', checkedIcon: 'restore' },
	{ type: 'command', command: 'window.hide', icon: 'close' },
];

const WINDOW_CONTEXT_ACTIONS: readonly WorkbenchMenuItem[] = [
	{ type: 'command', command: 'window.restore' },
	{ type: 'command', command: 'window.move' },
	{ type: 'command', command: 'window.resize' },
	{ type: 'command', command: 'window.maximize' },
	{ type: 'command', command: 'window.snapLeft' },
	{ type: 'command', command: 'window.snapRight' },
	{ type: 'separator' },
	{ type: 'command', command: 'window.hide' },
];

const GRAPH_VIEW_ACTIONS: readonly WorkbenchMenuCommandItem[] = [
	{ type: 'command', command: 'graph.fit' },
	{ type: 'command', command: 'graph.frameSelection' },
	{ type: 'command', command: 'graph.zoomOut' },
	{ type: 'command', command: 'graph.resetZoom' },
	{ type: 'command', command: 'graph.zoomIn' },
];


/** The same supported entrypoints feed Home cards and the Tools menu. */
const CONTENT_ACTIONS: readonly WorkbenchMenuCommandItem[] = [
	{ type: 'command', command: 'sceneEditor', icon: 'scene' },
	{ type: 'command', command: 'cartMap', icon: 'grid' },
	{ type: 'command', command: 'animation', icon: 'animation' },
	{ type: 'command', command: 'aem', icon: 'audio' },
];
const BEHAVIOR_ACTIONS: readonly WorkbenchMenuCommandItem[] = [
	{ type: 'command', command: 'behaviorLens.stateMachines', icon: 'stateMachine' },
	{ type: 'command', command: 'behaviorLens.behaviorTrees', icon: 'behaviorTree' },
	{ type: 'command', command: 'behaviorLens.actionEffects', icon: 'actionEffect' },
];
const GAMEPLAY_ACTIONS: readonly WorkbenchMenuCommandItem[] = [
	{ type: 'command', command: 'progression', icon: 'progression' },
	{ type: 'command', command: 'inputBindings', icon: 'inputBindings' },
];

/** Immutable built-in menu contributions; renderers only project these items. */
export const WORKBENCH_MENUS: WorkbenchMenuContributions = {
	'resourceViewer.context': [
		{ type: 'command', command: 'resourceViewer.preview' },
		{ type: 'command', command: 'resourceViewer.info' },
		{ type: 'separator' },
		{ type: 'command', command: 'image.fit' },
		{ type: 'command', command: 'image.actualSize' },
		{ type: 'command', command: 'image.zoomIn' },
		{ type: 'command', command: 'image.zoomOut' },
	],
	'editor.source.actions': [{ type: 'command', command: 'editor.source' }, { type: 'command', command: 'editor.sourceToSide' }],
	'resources.open.context': [{ type: 'command', command: 'resources.open' }, { type: 'command', command: 'resources.openToSide' },
		{ type: 'command', command: 'resources.source' }, { type: 'command', command: 'resources.sourceToSide' }],
	'resources.resource.context': [{ type: 'command', command: 'resources.open' }, { type: 'command', command: 'resources.openToSide' }],
	'resources.disclosure.context': [{ type: 'command', command: 'resources.disclosure' }],
	'resources.directory.context': [{ type: 'command', command: 'createResource' }, { type: 'command', command: 'resources.newFolder' },
		{ type: 'command', command: 'resources.refresh' }],
	'editorTabs.context': [
		{ type: 'command', command: 'save' },
		{ type: 'command', command: 'keepEditor' },
		{ type: 'separator' },
		{ type: 'command', command: 'window.moveEditor' },
		{ type: 'command', command: 'window.copyEditor' },
		{ type: 'separator' },
		{ type: 'command', command: 'tabs.close' },
		{ type: 'command', command: 'tabs.closeOthers' },
		{ type: 'command', command: 'tabs.closeAll' },
	],
	'editorGroup.context': [
		{ type: 'command', command: 'group.focusTabs' },
		{ type: 'command', command: 'group.splitRight' },
		{ type: 'command', command: 'group.splitDown' },
		{ type: 'command', command: 'group.move' },
		{ type: 'command', command: 'group.maximize' },
		{ type: 'separator' },
		{ type: 'command', command: 'tabs.closeAll' },
		{ type: 'command', command: 'group.close' },
	],
	'home.work': [
		{ type: 'command', command: 'sceneEditor.chooseMain', icon: 'scene' },
		{ type: 'command', command: 'resources.focus', icon: 'source' },
		{ type: 'command', command: 'resourceSearch', icon: 'filter' },
		{ type: 'command', command: 'createResource', icon: 'source' },
		{ type: 'command', command: 'commandPalette', icon: 'menu' },
	],
	'home.author': CONTENT_ACTIONS,
	'home.behavior': BEHAVIOR_ACTIONS,
	'home.gameplay': GAMEPLAY_ACTIONS,
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
		{ type: 'command', command: 'editor.source' },
		{ type: 'command', command: 'play.breakpoints' },
		{ type: 'separator' },
		{ type: 'command', command: 'play.continue' },
		{ type: 'command', command: 'play.stepInto' },
		{ type: 'command', command: 'play.stepOver' },
		{ type: 'command', command: 'play.stepOut' },
		{ type: 'separator' },
		{ type: 'command', command: 'play.details' },
	],
	'animation.clients': [
		{ type: 'command', command: 'animation.tracks' },
		{ type: 'command', command: 'animation.keys' },
		{ type: 'command', command: 'animation.details' },
	],
	'behaviorLens.graph.actions': [
		{ type: 'command', command: 'editor.sourceToSide' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.duplicateChild' },
		{ type: 'command', command: 'behaviorLens.removeChild' },
		{ type: 'separator' }, ...GRAPH_VIEW_ACTIONS,
	],
	'behaviorLens.stateGraph.actions': [
		{ type: 'command', command: 'editor.sourceToSide' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.setInitialState' },
		{ type: 'command', command: 'behaviorLens.inspectRegisteredDefinitions' },
		{ type: 'separator' }, ...GRAPH_VIEW_ACTIONS,
	],
	'behaviorLens.properties.actions': [
		{ type: 'command', command: 'editor.sourceToSide' },
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
	],
	'actorLab.stateGraph.context': [
		{ type: 'command', command: 'actorLab.find' },
		{ type: 'command', command: 'actorLab.revealActive' },
		{ type: 'command', command: 'actorLab.follow' },
		{ type: 'command', command: 'actorLab.outline' },
		{ type: 'command', command: 'actorLab.details' },
		{ type: 'command', command: 'actorLab.actions' },
		{ type: 'command', command: 'actorLab.call' },
		{ type: 'command', command: 'actorLab.spawn' },
		{ type: 'command', command: 'actorLab.emit' },
		{ type: 'separator' }, ...GRAPH_VIEW_ACTIONS,
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
	'window.status': [{ type: 'command', command: 'window.showAll', icon: 'restore', showLabel: true }],
	'window.context': WINDOW_CONTEXT_ACTIONS,
	'window.minimizable.context': [{ type: 'command', command: 'window.minimize' }, ...WINDOW_CONTEXT_ACTIONS],
	'activity.context': [{ type: 'command', command: 'workspace.activity.float' }, { type: 'command', command: 'workspace.activity.hide' }],
	'activity.window.context': [{ type: 'command', command: 'workspace.activity.dock' }, { type: 'separator' },
		{ type: 'command', command: 'window.minimize' }, ...WINDOW_CONTEXT_ACTIONS],
	'window.title': WINDOW_TITLE_ACTIONS,
	'window.minimizable.title': [{ type: 'command', command: 'window.minimize', icon: 'minimize' }, ...WINDOW_TITLE_ACTIONS],
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
		{ type: 'command', command: 'editor.source' },
		{ type: 'command', command: 'editor.sourceToSide' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeTree' },
		{ type: 'separator' },
		{ type: 'command', command: 'behaviorLens.duplicateChild' },
		{ type: 'command', command: 'behaviorLens.removeChild' },
		{ type: 'separator' },
		{ type: 'command', command: 'undo' },
		{ type: 'command', command: 'redo' },
		{ type: 'separator' }, ...GRAPH_VIEW_ACTIONS,
	],
	'behaviorLens.state.context': [
		{ type: 'command', command: 'editor.source' },
		{ type: 'command', command: 'editor.sourceToSide' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeStateMachine' },
		{ type: 'command', command: 'behaviorLens.inspectRegisteredDefinitions' },
		{ type: 'separator' },
		{ type: 'command', command: 'behaviorLens.setInitialState' },
		{ type: 'separator' },
		{ type: 'command', command: 'undo' },
		{ type: 'command', command: 'redo' },
		{ type: 'separator' }, ...GRAPH_VIEW_ACTIONS,
	],
	'behaviorLens.edge.context': [
		{ type: 'command', command: 'editor.source' },
		{ type: 'command', command: 'editor.sourceToSide' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'separator' }, ...GRAPH_VIEW_ACTIONS,
	],
	'behaviorLens.property.context': [
		{ type: 'command', command: 'behaviorLens.editProperty' },
		{ type: 'command', command: 'behaviorLens.addProperty' },
		{ type: 'command', command: 'behaviorLens.removeProperty' },
		{ type: 'command', command: 'editor.source' },
		{ type: 'command', command: 'editor.sourceToSide' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeEffect' },
		{ type: 'command', command: 'behaviorLens.inspectRegisteredDefinitions' },
	],
	'behaviorLens.canvas.context': [{ type: 'command', command: 'undo' }, { type: 'command', command: 'redo' }],
	'behaviorLens.graphCanvas.context': [
		...GRAPH_VIEW_ACTIONS, { type: 'separator' },
		{ type: 'command', command: 'undo' }, { type: 'command', command: 'redo' },
	],
	'romInspector.reader.title': [
		{ type: 'command', command: 'romInspector.hold', icon: 'pin', checkedIcon: 'unpin' },
		{ type: 'command', command: 'window.maximize', icon: 'maximize', checkedIcon: 'restore' },
		{ type: 'command', command: 'window.hide', icon: 'close' },
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
		{ type: 'command', command: 'saveAll' },
		{ type: 'command', command: 'keepEditor' },
		{ type: 'command', command: 'tabs.close' },
		{ type: 'command', command: 'editors.closeAll' },
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
		{ type: 'command', command: 'workspace.focusNextRegion' },
		{ type: 'command', command: 'workspace.focusPreviousRegion' },
		{ type: 'separator' },
		{ type: 'command', command: 'status.focus' },
		{ type: 'command', command: 'status.details' },
		{ type: 'command', command: 'home' },
		{ type: 'command', command: 'commandPalette' },
		{ type: 'command', command: 'openEditors' },
		{ type: 'separator' },
		{ type: 'command', command: 'resources' },
		{ type: 'command', command: 'problems' },
		{ type: 'command', command: 'builds.output' },
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
		{ type: 'command', command: 'workspace.focusPrimary' },
		{ type: 'command', command: 'sceneEditor.chooseMain' },
		{ type: 'command', command: 'workspace.clearPrimary' },
		{ type: 'command', command: 'workspace.hierarchy.focus' },
		{ type: 'command', command: 'workspace.details.focus' },
		{ type: 'command', command: 'workspace.hierarchy.toggle' },
		{ type: 'command', command: 'workspace.details.toggle' },
		{ type: 'command', command: 'workspace.hierarchy.float' },
		{ type: 'command', command: 'workspace.hierarchy.dock' },
		{ type: 'command', command: 'workspace.details.float' },
		{ type: 'command', command: 'workspace.details.dock' },
		{ type: 'command', command: 'window.showAll' },
		{ type: 'command', command: 'window.restoreMinimized' },
		{ type: 'separator' },
		{ type: 'command', command: 'window.newEditor' },
		{ type: 'command', command: 'window.copyEditor' },
		{ type: 'command', command: 'window.moveEditor' },
		{ type: 'separator' },
		{ type: 'command', command: 'group.splitRight' },
		{ type: 'command', command: 'group.splitDown' },
		{ type: 'command', command: 'group.focusNext' },
		{ type: 'command', command: 'group.focusTabs' },
		{ type: 'command', command: 'group.focusPrevious' },
		{ type: 'command', command: 'group.maximize' },
		{ type: 'command', command: 'group.move' },
		{ type: 'command', command: 'group.close' },
		{ type: 'separator' },
		{ type: 'command', command: 'window.move' },
		{ type: 'command', command: 'window.resize' },
		{ type: 'command', command: 'window.snapLeft' },
		{ type: 'command', command: 'window.snapRight' },
		{ type: 'command', command: 'window.maximize' },
		{ type: 'command', command: 'window.restore' },
		{ type: 'command', command: 'window.minimize' },
		{ type: 'command', command: 'window.hide' },
	],
	'menubar.tools': [
		...CONTENT_ACTIONS,
		{ type: 'separator' },
		...BEHAVIOR_ACTIONS,
		{ type: 'separator' },
		...GAMEPLAY_ACTIONS,
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

	'scenarioLab.context': [
		{ type: 'command', command: 'scenarioLab.runWithCompanion' },
		{ type: 'command', command: 'scenarioLab.debugWithCompanion' },
		{ type: 'command', command: 'scenarioLab.playWithCompanion' },
	],
	'behaviorLens.graph.title': [
		{ type: 'command', command: 'editor.source' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeTree' },
	],
	'behaviorLens.title': [
		{ type: 'command', command: 'editor.source' },
		{ type: 'command', command: 'behaviorLens.details' },
	],
	'behaviorLens.stateGraph.title': [
		{ type: 'command', command: 'editor.source' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeStateMachine' },
	],
	'aem.title': [
		{ type: 'command', command: 'aem.add' },
		{ type: 'command', command: 'aem.edit' },
		{ type: 'command', command: 'aem.remove' },
		{ type: 'command', command: 'editor.source' },
		{ type: 'command', command: 'aem.apply' },
		{ type: 'command', command: 'aem.testEvent' },
	],
	'gamePanel.title': [{ type: 'command', command: 'gameView.closePanel', icon: 'close' }],
	'runtime.title': [
		{ type: 'command', command: 'stepFrameBack', icon: 'stepBack' },
		{ type: 'command', command: 'runtime.playback', icon: 'play' },
		{ type: 'command', command: 'stepFrame', icon: 'stepForward' },
		{ type: 'command', command: 'runtime.resume', icon: 'accept' },
		{ type: 'command', command: 'runtime.present', icon: 'present' },
	],
	'status.context': [{ type: 'command', command: 'status.details', icon: 'more' }],
	'editorTabs.title': [{ type: 'command', command: 'group.openEditors', icon: 'chevronDown' }],
	'aem.context': [
		{ type: 'command', command: 'aem.add' },
		{ type: 'command', command: 'aem.edit' },
		{ type: 'command', command: 'aem.remove' },
		{ type: 'command', command: 'editor.source' },
		{ type: 'command', command: 'editor.sourceToSide' },
		{ type: 'command', command: 'aem.apply' },
		{ type: 'command', command: 'aem.testEvent' },
	],
	'behaviorLens.properties.title': [
		{ type: 'command', command: 'editor.source' },
		{ type: 'command', command: 'behaviorLens.inspectRuntimeEffect' },
	],
};
