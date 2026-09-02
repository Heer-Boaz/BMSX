import type { TopBarButtonId } from '../../../common/commands';
import type { IdeCommandController } from '../../../commands/controller';

export const MENU_IDS = ['file', 'run', 'view'] as const;
export type MenuId = typeof MENU_IDS[number];
export const MENU_COMMANDS = [
	'hot-resume',
	'reboot',
	'save',
	'resources',
	'problems',
	'behaviorLens',
	'filter',
	'wrap',
	'debugContinue',
	'debugStepInto',
	'debugStepOut',
	'debugStepOver',
] as const satisfies readonly TopBarButtonId[];

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
const continueMenuItem: TopBarMenuItem = { type: 'command', command: 'debugContinue', label: 'Continue    F5', active: false, disabled: true };
const stepOverMenuItem: TopBarMenuItem = { type: 'command', command: 'debugStepOver', label: 'Step Over   F10', active: false, disabled: true };
const stepIntoMenuItem: TopBarMenuItem = { type: 'command', command: 'debugStepInto', label: 'Step Into   F11', active: false, disabled: true };
const stepOutMenuItem: TopBarMenuItem = { type: 'command', command: 'debugStepOut', label: 'Step Out    Shift+F11', active: false, disabled: true };
const rebootMenuItem: TopBarMenuItem = { type: 'command', command: 'reboot', label: 'Reboot', active: false, disabled: false };
const problemsMenuItem: TopBarMenuItem = { type: 'command', command: 'problems', label: 'Problems Panel', active: false, disabled: false };
const behaviorLensMenuItem: TopBarMenuItem = { type: 'command', command: 'behaviorLens', label: 'Behavior Lens', active: false, disabled: true };
const wrapMenuItem: TopBarMenuItem = { type: 'command', command: 'wrap', label: 'Word Wrap', active: false, disabled: false };
const filterMenuItem: TopBarMenuItem = { type: 'command', command: 'filter', label: 'All Resources', active: false, disabled: true };

const topBarMenuEntries: TopBarMenuEntry[] = [
	{
		id: 'file',
		label: 'FILE',
		items: [saveMenuItem, resourcesMenuItem],
	},
	{
		id: 'run',
		label: 'RUN',
		items: [
			continueMenuItem,
			stepOverMenuItem,
			stepIntoMenuItem,
			stepOutMenuItem,
			hotResumeMenuItem,
			rebootMenuItem,
		],
	},
	{
		id: 'view',
		label: 'VIEW',
		items: [behaviorLensMenuItem, problemsMenuItem, wrapMenuItem, filterMenuItem],
	},
];

export function buildTopBarMenuEntries(commands: IdeCommandController): TopBarMenuEntry[] {
	const resourcePanelActive = commands.isActive('resources');
	const filterActive = commands.isActive('filter');
	saveMenuItem.disabled = !commands.isEnabled('save');
	continueMenuItem.disabled = !commands.isEnabled('debugContinue');
	stepOverMenuItem.disabled = !commands.isEnabled('debugStepOver');
	stepIntoMenuItem.disabled = !commands.isEnabled('debugStepInto');
	stepOutMenuItem.disabled = !commands.isEnabled('debugStepOut');
	resourcesMenuItem.label = resourcePanelActive ? 'Hide Files' : 'Show Files';
	resourcesMenuItem.active = resourcePanelActive;
	problemsMenuItem.active = commands.isActive('problems');
	behaviorLensMenuItem.active = commands.isActive('behaviorLens');
	behaviorLensMenuItem.disabled = !commands.isEnabled('behaviorLens');
	wrapMenuItem.active = commands.isActive('wrap');
	filterMenuItem.label = filterActive ? 'Lua Files Only' : 'All Resources';
	filterMenuItem.active = filterActive;
	filterMenuItem.disabled = !commands.isEnabled('filter');
	return topBarMenuEntries;
}
