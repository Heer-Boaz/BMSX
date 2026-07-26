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
	'filter',
	'wrap',
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
const rebootMenuItem: TopBarMenuItem = { type: 'command', command: 'reboot', label: 'Reboot', active: false, disabled: false };
const problemsMenuItem: TopBarMenuItem = { type: 'command', command: 'problems', label: 'Problems Panel', active: false, disabled: false };
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
		items: [hotResumeMenuItem, rebootMenuItem],
	},
	{
		id: 'view',
		label: 'VIEW',
		items: [problemsMenuItem, wrapMenuItem, filterMenuItem],
	},
];

export function buildTopBarMenuEntries(commands: IdeCommandController): TopBarMenuEntry[] {
	const resourcePanelActive = commands.isActive('resources');
	const filterActive = commands.isActive('filter');
	saveMenuItem.disabled = !commands.isEnabled('save');
	resourcesMenuItem.label = resourcePanelActive ? 'Hide Files' : 'Show Files';
	resourcesMenuItem.active = resourcePanelActive;
	problemsMenuItem.active = commands.isActive('problems');
	wrapMenuItem.active = commands.isActive('wrap');
	filterMenuItem.label = filterActive ? 'Lua Files Only' : 'All Resources';
	filterMenuItem.active = filterActive;
	filterMenuItem.disabled = !commands.isEnabled('filter');
	return topBarMenuEntries;
}
