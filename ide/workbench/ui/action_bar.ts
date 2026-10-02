import type { RectBounds } from '../../../machine/ts/common/rect';
import { create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import { editorCommandTitle } from '../../commands/catalog';
import type { EditorCommandId } from '../../common/commands';
import { WORKBENCH_MENUS, type WorkbenchActionMenuId } from './menu/registry';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';

export const WORKBENCH_ACTION_BAR_ITEM_PADDING_X = 3;
export const WORKBENCH_ACTION_BAR_ITEM_SPACING = 2;

export type WorkbenchActionBarItem = {
	readonly command: EditorCommandId;
	label: string;
	readonly bounds: RectBounds;
	visible: boolean;
	width: number;
	measuredLabel: string;
};

export type WorkbenchActionBarState = {
	readonly items: readonly WorkbenchActionBarItem[];
	hoveredCommand: EditorCommandId | null;
	pressedCommand: EditorCommandId | null;
	focusedIndex: number;
	hasFocus: boolean;
	measuredFont: BFont | null;
	measuredBy: ((text: string) => number) | undefined;
};

/** Materializes a named menu once into retained view-title action state. */
export function createWorkbenchActionBar(menuId: WorkbenchActionMenuId): WorkbenchActionBarState {
	const menu = WORKBENCH_MENUS[menuId];
	const items = new Array<WorkbenchActionBarItem>(menu.length);
	for (let index = 0; index < menu.length; index += 1) {
		const contribution = menu[index];
		items[index] = {
			command: contribution.command,
			label: editorCommandTitle(contribution.command, false, true),
			bounds: create_rect_bounds(),
			visible: true,
			width: 0,
			measuredLabel: '',
		};
	}
	return { items, hoveredCommand: null, pressedCommand: null, focusedIndex: -1, hasFocus: false, measuredFont: null, measuredBy: undefined };
}

export function layoutWorkbenchActionBar(
	state: WorkbenchActionBarState,
	right: number,
	top: number,
	bottom: number,
	measure: (text: string) => number,
	font: BFont | null,
): void {
	const remeasure = state.measuredFont !== font || state.measuredBy !== measure;
	for (const item of state.items) {
		if (remeasure || item.measuredLabel !== item.label) {
			item.width = measure(item.label) + WORKBENCH_ACTION_BAR_ITEM_PADDING_X * 2;
			item.measuredLabel = item.label;
		}
	}
	state.measuredFont = font;
	state.measuredBy = measure;
	let itemRight = right;
	for (let index = state.items.length - 1; index >= 0; index -= 1) {
		const item = state.items[index];
		if (!item.visible) continue;
		const width = item.width;
		write_rect_bounds(item.bounds, itemRight - width, top, itemRight, bottom);
		itemRight -= width + WORKBENCH_ACTION_BAR_ITEM_SPACING;
	}
}
