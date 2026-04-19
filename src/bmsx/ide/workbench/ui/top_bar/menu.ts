import { resourcePanel } from '../../contrib/resources/panel/controller';
import { problemsPanel } from '../../contrib/problems/panel/controller';
import { editorDebuggerState } from '../../contrib/debugger/state';
import { editorDocumentState } from '../../../editor/editing/document_state';
import { editorViewState } from '../../../editor/ui/view/state';

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

const saveMenuItem: TopBarMenuItem = { type: 'command', command: 'save', label: 'Save', active: false, disabled: true };
const resourcesMenuItem: TopBarMenuItem = { type: 'command', command: 'resources', label: 'Show Files', active: false, disabled: false };
const hotResumeMenuItem: TopBarMenuItem = { type: 'command', command: 'hot-resume', label: 'Hot Resume', active: false, disabled: false };
const rebootMenuItem: TopBarMenuItem = { type: 'command', command: 'reboot', label: 'Reboot', active: false, disabled: false };
const problemsMenuItem: TopBarMenuItem = { type: 'command', command: 'problems', label: 'Problems Panel', active: false, disabled: false };
const wrapMenuItem: TopBarMenuItem = { type: 'command', command: 'wrap', label: 'Word Wrap', active: false, disabled: false };
const filterMenuItem: TopBarMenuItem = { type: 'command', command: 'filter', label: 'All Resources', active: false, disabled: true };
const debugContinueMenuItem: TopBarMenuItem = { type: 'command', command: 'debugContinue', label: 'Continue', active: false, disabled: true };
const debugStepOverMenuItem: TopBarMenuItem = { type: 'command', command: 'debugStepOver', label: 'Step Over', active: false, disabled: true };
const debugStepIntoMenuItem: TopBarMenuItem = { type: 'command', command: 'debugStepInto', label: 'Step Into', active: false, disabled: true };
const debugStepOutMenuItem: TopBarMenuItem = { type: 'command', command: 'debugStepOut', label: 'Step Out', active: false, disabled: true };

const topBarMenuEntries: TopBarMenuEntry[] = [
	{
		id: 'file',
		label: 'FILE',
		items: [saveMenuItem, resourcesMenuItem],
	},
	{
		id: 'run',
		label: 'RUN',
		items: [hotResumeMenuItem, rebootMenuItem],
	},
	{
		id: 'view',
		label: 'VIEW',
		items: [problemsMenuItem, wrapMenuItem, filterMenuItem],
	},
	{
		id: 'debug',
		label: 'DEBUG',
		items: [debugContinueMenuItem, debugStepOverMenuItem, debugStepIntoMenuItem, debugStepOutMenuItem],
	},
];

export function buildTopBarMenuEntries(): TopBarMenuEntry[] {
	const resourcePanelActive = resourcePanel.isVisible();
	const resourcePanelMode = resourcePanel.getMode();
	const resourceFilesMode = resourcePanelMode === 'resources';
	const filterMode = resourcePanel.getFilterMode();
	const debuggerPaused = editorDebuggerState.controls.executionState === 'paused';
	const problemsActive = problemsPanel.isVisible;
	const filterActive = filterMode === 'lua_only';
	saveMenuItem.disabled = !editorDocumentState.dirty;
	resourcesMenuItem.label = resourcePanelActive ? 'Hide Files' : 'Show Files';
	resourcesMenuItem.active = resourcePanelActive;
	problemsMenuItem.active = problemsActive;
	wrapMenuItem.active = editorViewState.wordWrapEnabled;
	filterMenuItem.label = filterActive ? 'Lua Files Only' : 'All Resources';
	filterMenuItem.active = filterActive;
	filterMenuItem.disabled = !resourcePanelActive || !resourceFilesMode;
	debugContinueMenuItem.disabled = !debuggerPaused;
	debugStepOverMenuItem.disabled = !debuggerPaused;
	debugStepIntoMenuItem.disabled = !debuggerPaused;
	debugStepOutMenuItem.disabled = !debuggerPaused;
	return topBarMenuEntries;
}

export function isTopBarCommandEnabled(command: TopBarButtonId): boolean {
	if (command === 'save') {
		return editorDocumentState.dirty;
	}
	if (command === 'filter') {
		return resourcePanel.isVisible() && resourcePanel.getMode() === 'resources';
	}
	if (command === 'debugContinue' || command === 'debugStepOver' || command === 'debugStepInto' || command === 'debugStepOut') {
		return editorDebuggerState.controls.executionState === 'paused';
	}
	return true;
}
