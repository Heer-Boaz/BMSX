import type { EditorCommandId } from '../../../common/commands';

export type WorkbenchDropdownMenuId =
	| 'menubar.file'
	| 'menubar.edit'
	| 'menubar.run'
	| 'menubar.view';

export type WorkbenchActionMenuId = 'scenarioLab.title' | 'sceneEditor.title' | 'behaviorLens.title' | 'behaviorLens.graph.title';

export type WorkbenchMenuCommandItem = {
	readonly type: 'command';
	readonly command: EditorCommandId;
};

export type WorkbenchMenuSeparator = {
	readonly type: 'separator';
};

export type WorkbenchMenuItem = WorkbenchMenuCommandItem | WorkbenchMenuSeparator;

type WorkbenchMenuContributions = {
	readonly 'menubar.file': readonly WorkbenchMenuItem[];
	readonly 'menubar.edit': readonly WorkbenchMenuItem[];
	readonly 'menubar.run': readonly WorkbenchMenuItem[];
	readonly 'menubar.view': readonly WorkbenchMenuItem[];
	readonly 'scenarioLab.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.graph.title': readonly WorkbenchMenuCommandItem[];
	readonly 'behaviorLens.title': readonly WorkbenchMenuCommandItem[];
	readonly 'sceneEditor.title': readonly WorkbenchMenuCommandItem[];
};

/** Immutable built-in menu contributions; renderers only project these items. */
export const WORKBENCH_MENUS: WorkbenchMenuContributions = {
	'menubar.file': [
		{ type: 'command', command: 'save' },
		{ type: 'command', command: 'resources' },
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
	],
	'behaviorLens.graph.title': [
		{ type: 'command', command: 'behaviorLens.source' },
		{ type: 'command', command: 'behaviorLens.details' },
		{ type: 'command', command: 'behaviorLens.toggleBranch' },
	],
	'behaviorLens.title': [
		{ type: 'command', command: 'behaviorLens.source' },
	],
	'sceneEditor.title': [
		{ type: 'command', command: 'sceneEditor.source' },
		{ type: 'command', command: 'sceneEditor.moveMemberUp' },
		{ type: 'command', command: 'sceneEditor.moveMemberDown' },
		{ type: 'command', command: 'sceneEditor.removeMember' },
	],
};
