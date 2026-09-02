import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import type { IdeCommandController } from '../../../commands/controller';
import {
	WORKBENCH_MENUS,
	type WorkbenchDropdownMenuId,
} from '../menu/registry';

export const MENU_IDS = ['file', 'run', 'view'] as const;
export type MenuId = typeof MENU_IDS[number];

export type TopBarMenuSeparator = { readonly type: 'separator' };
export type TopBarMenuItem = {
	readonly type: 'command';
	readonly command: EditorCommandId;
	readonly bounds: RectBounds;
	active: boolean;
	disabled: boolean;
};
export type TopBarMenuEntry = {
	readonly id: MenuId;
	readonly label: string;
	readonly items: Array<TopBarMenuItem | TopBarMenuSeparator>;
};

function projectTopBarMenu(menuId: WorkbenchDropdownMenuId): Array<TopBarMenuItem | TopBarMenuSeparator> {
	const contributions = WORKBENCH_MENUS[menuId];
	const items: Array<TopBarMenuItem | TopBarMenuSeparator> = [];
	for (let index = 0; index < contributions.length; index += 1) {
		const contribution = contributions[index];
		items.push(contribution.type === 'separator'
			? { type: 'separator' }
			: {
				type: 'command',
				command: contribution.command,
				bounds: create_rect_bounds(),
				active: false,
				disabled: false,
			});
	}
	return items;
}

const fileMenu: TopBarMenuEntry = {
	id: 'file',
	label: 'FILE',
	items: projectTopBarMenu('menubar.file'),
};
const runMenu: TopBarMenuEntry = {
	id: 'run',
	label: 'RUN',
	items: projectTopBarMenu('menubar.run'),
};
const viewMenu: TopBarMenuEntry = {
	id: 'view',
	label: 'VIEW',
	items: projectTopBarMenu('menubar.view'),
};

export const TOP_BAR_MENUS: Readonly<Record<MenuId, TopBarMenuEntry>> = {
	file: fileMenu,
	run: runMenu,
	view: viewMenu,
};

export const TOP_BAR_MENU_ENTRIES: readonly TopBarMenuEntry[] = [
	fileMenu,
	runMenu,
	viewMenu,
];

export function updateTopBarMenuEntries(commands: IdeCommandController): void {
	for (let menuIndex = 0; menuIndex < TOP_BAR_MENU_ENTRIES.length; menuIndex += 1) {
		const items = TOP_BAR_MENU_ENTRIES[menuIndex].items;
		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			const item = items[itemIndex];
			if (item.type === 'command') {
				item.active = commands.isActive(item.command);
				item.disabled = !commands.isEnabled(item.command);
			}
		}
	}
}
