import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import { editorCommandTitle } from '../../../commands/catalog';
import { EDITOR_COMMAND_KEYBINDING_LABELS } from '../../../input/keyboard/command_keybindings';
import {
	WORKBENCH_MENUS,
	type WorkbenchDropdownMenuId,
} from '../menu/registry';

export const MENU_IDS = ['file', 'edit', 'run', 'view'] as const;
export type MenuId = typeof MENU_IDS[number];

export type TopBarMenuSeparator = { readonly type: 'separator'; readonly bounds: RectBounds };
export type TopBarMenuItem = {
	readonly type: 'command';
	readonly command: EditorCommandId;
	readonly bounds: RectBounds;
	readonly keybinding: string | undefined;
	label: string;
	keybindingWidth: number;
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
			? { type: 'separator', bounds: create_rect_bounds() }
			: {
				type: 'command',
				command: contribution.command,
				bounds: create_rect_bounds(),
				keybinding: EDITOR_COMMAND_KEYBINDING_LABELS.get(contribution.command),
				label: editorCommandTitle(contribution.command, false, true),
				keybindingWidth: 0,
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
const editMenu: TopBarMenuEntry = {
	id: 'edit',
	label: 'EDIT',
	items: projectTopBarMenu('menubar.edit'),
};
const viewMenu: TopBarMenuEntry = {
	id: 'view',
	label: 'VIEW',
	items: projectTopBarMenu('menubar.view'),
};

export const TOP_BAR_MENUS: Readonly<Record<MenuId, TopBarMenuEntry>> = {
	file: fileMenu,
	edit: editMenu,
	run: runMenu,
	view: viewMenu,
};

export const TOP_BAR_MENU_ENTRIES: readonly TopBarMenuEntry[] = [
	fileMenu,
	editMenu,
	runMenu,
	viewMenu,
];
