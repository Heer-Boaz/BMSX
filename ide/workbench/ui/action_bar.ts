import type { RectBounds } from '../../../machine/ts/common/rect';
import { create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import { EDITOR_COMMAND_PRESENTATION } from '../../commands/catalog';
import type { EditorCommandId } from '../../common/commands';
import { WORKBENCH_MENUS, type WorkbenchActionMenuId } from './menu/registry';

export const WORKBENCH_ACTION_BAR_ITEM_PADDING_X = 3;
export const WORKBENCH_ACTION_BAR_ITEM_SPACING = 2;

export type WorkbenchActionBarItem = {
	readonly command: EditorCommandId;
	readonly label: string;
	readonly bounds: RectBounds;
};

export type WorkbenchActionBarState = {
	readonly items: readonly WorkbenchActionBarItem[];
	hoveredCommand: EditorCommandId | null;
};

/** Materializes a named menu once into retained view-title action state. */
export function createWorkbenchActionBar(menuId: WorkbenchActionMenuId): WorkbenchActionBarState {
	const menu = WORKBENCH_MENUS[menuId];
	const items = new Array<WorkbenchActionBarItem>(menu.length);
	for (let index = 0; index < menu.length; index += 1) {
		const contribution = menu[index];
		items[index] = {
			command: contribution.command,
			label: EDITOR_COMMAND_PRESENTATION[contribution.command].title,
			bounds: create_rect_bounds(),
		};
	}
	return { items, hoveredCommand: null };
}

export function layoutWorkbenchActionBar(
	state: WorkbenchActionBarState,
	right: number,
	top: number,
	bottom: number,
	measure: (text: string) => number,
): void {
	let itemRight = right;
	for (let index = state.items.length - 1; index >= 0; index -= 1) {
		const item = state.items[index];
		const width = measure(item.label) + WORKBENCH_ACTION_BAR_ITEM_PADDING_X * 2;
		write_rect_bounds(item.bounds, itemRight - width, top, itemRight, bottom);
		itemRight -= width + WORKBENCH_ACTION_BAR_ITEM_SPACING;
	}
}
