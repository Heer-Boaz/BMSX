import { WORKBENCH_MENUS, type WorkbenchMenuItem } from '../menu/registry';

export const MENU_IDS = ['file', 'edit', 'view', 'run', 'tools', 'window'] as const;
export type MenuId = typeof MENU_IDS[number];
export type TopBarMenuEntry = {
	readonly id: MenuId;
	readonly label: string;
	readonly items: readonly WorkbenchMenuItem[];
};

export const TOP_BAR_MENU_ENTRIES: readonly TopBarMenuEntry[] = MENU_IDS.map(id => ({
	id, label: id.toUpperCase(), items: WORKBENCH_MENUS[`menubar.${id}`],
}));
