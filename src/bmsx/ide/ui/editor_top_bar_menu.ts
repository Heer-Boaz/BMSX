import { ide_state } from '../core/ide_state';
import { editorDocumentState } from '../editing/editor_document_state';

export const MENU_IDS = ['file', 'run', 'view', 'debug'] as const;
export type MenuId = typeof MENU_IDS[number];
export const MENU_COMMANDS = [
	'hot-resume',
	'reboot',
	'save',
	'resources',
	'problems',
	'filter',
	'wrap',
	'debugContinue',
	'debugStepOver',
	'debugStepInto',
	'debugStepOut',
] as const;
export type TopBarButtonId = typeof MENU_COMMANDS[number];

export type TopBarMenuSeparator = { type: 'separator' };
export type TopBarMenuItem = {
	type: 'command';
	command: TopBarButtonId;
	label: string;
	active: boolean;
	disabled: boolean;
};
export type TopBarMenuEntry = {
	id: MenuId;
	label: string;
	items: Array<TopBarMenuItem | TopBarMenuSeparator>;
};

export function buildTopBarMenuEntries(): TopBarMenuEntry[] {
	const resourcePanelActive = ide_state.resourcePanel.isVisible();
	const resourcePanelMode = ide_state.resourcePanel.getMode();
	const resourceFilesMode = resourcePanelMode === 'resources';
	const filterMode = ide_state.resourcePanel.getFilterMode();
	const debuggerPaused = ide_state.debuggerControls.executionState === 'paused';
	const problemsActive = ide_state.problemsPanel.isVisible;
	const filterActive = filterMode === 'lua_only';
	return [
		{
			id: 'file',
			label: 'FILE',
			items: [
				{ type: 'command', command: 'save', label: 'Save', active: false, disabled: !editorDocumentState.dirty },
				{
					type: 'command',
					command: 'resources',
					label: resourcePanelActive ? 'Hide Files' : 'Show Files',
					active: resourcePanelActive,
					disabled: false,
				},
			],
		},
		{
			id: 'run',
			label: 'RUN',
			items: [
				{ type: 'command', command: 'hot-resume', label: 'Hot Resume', active: false, disabled: false },
				{ type: 'command', command: 'reboot', label: 'Reboot', active: false, disabled: false },
			],
		},
		{
			id: 'view',
			label: 'VIEW',
			items: [
				{ type: 'command', command: 'problems', label: 'Problems Panel', active: problemsActive, disabled: false },
				{ type: 'command', command: 'wrap', label: 'Word Wrap', active: ide_state.wordWrapEnabled, disabled: false },
				{
					type: 'command',
					command: 'filter',
					label: filterActive ? 'Lua Files Only' : 'All Resources',
					active: filterActive,
					disabled: !resourcePanelActive || !resourceFilesMode,
				},
			],
		},
		{
			id: 'debug',
			label: 'DEBUG',
			items: [
				{ type: 'command', command: 'debugContinue', label: 'Continue', active: false, disabled: !debuggerPaused },
				{ type: 'command', command: 'debugStepOver', label: 'Step Over', active: false, disabled: !debuggerPaused },
				{ type: 'command', command: 'debugStepInto', label: 'Step Into', active: false, disabled: !debuggerPaused },
				{ type: 'command', command: 'debugStepOut', label: 'Step Out', active: false, disabled: !debuggerPaused },
			],
		},
	];
}

export function isTopBarCommandEnabled(command: TopBarButtonId): boolean {
	if (command === 'save') {
		return editorDocumentState.dirty;
	}
	if (command === 'filter') {
		return ide_state.resourcePanel.isVisible() && ide_state.resourcePanel.getMode() === 'resources';
	}
	if (command === 'debugContinue' || command === 'debugStepOver' || command === 'debugStepInto' || command === 'debugStepOut') {
		return ide_state.debuggerControls.executionState === 'paused';
	}
	return true;
}
