import type { RectBounds } from '../../../machine/ts/common/rect';
import { create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import { editorCommandTitle } from '../../commands/catalog';
import type { EditorCommandId } from '../../common/commands';
import { WORKBENCH_MENUS, type WorkbenchActionMenuId, type WorkbenchMenuCommandItem, type WorkbenchMenuItem } from './menu/registry';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import { WORKBENCH_ICON_SIZE, type WorkbenchIcon } from './icon';

export const WORKBENCH_ACTION_BAR_ITEM_PADDING_X = 3;
export const WORKBENCH_ACTION_BAR_ITEM_SPACING = 2;
export const WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH = WORKBENCH_ICON_SIZE + WORKBENCH_ACTION_BAR_ITEM_PADDING_X * 2;
const SECONDARY_GROUP: WorkbenchMenuItem = { type: 'separator' };

export const WORKBENCH_ACTION_BAR_OVERFLOW = Symbol('actionbar overflow');
export type WorkbenchActionBarAction = EditorCommandId | typeof WORKBENCH_ACTION_BAR_OVERFLOW;

export type WorkbenchActionBarItem<Command = EditorCommandId> = {
	readonly command: Command;
	readonly menuItem?: WorkbenchMenuCommandItem;
	label: string;
	tooltip: string;
	icon?: WorkbenchIcon;
	checkedIcon?: WorkbenchIcon;
	readonly bounds: RectBounds;
	visible: boolean;
	overflowed: boolean;
	enabled: boolean;
	checked: boolean;
	width: number;
	measuredLabel: string;
};

export type WorkbenchActionBarState = {
	readonly items: readonly WorkbenchActionBarItem[];
	readonly bounds: RectBounds;
	readonly overflow?: {
		readonly button: WorkbenchActionBarItem<typeof WORKBENCH_ACTION_BAR_OVERFLOW>;
		readonly items: WorkbenchMenuItem[];
		readonly secondary: readonly WorkbenchMenuItem[] | undefined;
	};
	layoutRevision: number;
	hoveredCommand: WorkbenchActionBarAction | null;
	pressedCommand: WorkbenchActionBarAction | null;
	focusedIndex: number;
	hasFocus: boolean;
	measuredFont: BFont | null;
	measuredBy: ((text: string) => number) | undefined;
};

/** Materializes a named menu once into retained view-title action state. */
export function createWorkbenchActionBar(menuId: WorkbenchActionMenuId, responsive = false, secondary?: readonly WorkbenchMenuItem[]): WorkbenchActionBarState {
	const menu = WORKBENCH_MENUS[menuId];
	const items = new Array<WorkbenchActionBarItem>(menu.length);
	for (let index = 0; index < menu.length; index += 1) {
		const contribution = menu[index];
		items[index] = {
			command: contribution.command,
			menuItem: contribution,
			label: editorCommandTitle(contribution.command, false, true),
			tooltip: editorCommandTitle(contribution.command, false),
			icon: contribution.icon,
			checkedIcon: contribution.checkedIcon,
			bounds: create_rect_bounds(),
			visible: true,
			overflowed: false,
			enabled: false,
			checked: false,
			width: 0,
			measuredLabel: '',
		};
	}
	return { items, bounds: create_rect_bounds(), overflow: responsive ? {
		button: { command: WORKBENCH_ACTION_BAR_OVERFLOW, label: 'More Actions', tooltip: 'More Actions', icon: 'more', bounds: create_rect_bounds(),
			visible: false, overflowed: false, enabled: true, checked: false, width: 0, measuredLabel: '' }, items: [], secondary,
	} : undefined, layoutRevision: 0, hoveredCommand: null, pressedCommand: null, focusedIndex: -1, hasFocus: false, measuredFont: null, measuredBy: undefined };
}

export function layoutWorkbenchActionBar(
	state: WorkbenchActionBarState,
	right: number,
	top: number,
	bottom: number,
	measure: (text: string) => number,
	font: BFont | null,
	left: number,
): void {
	const remeasure = state.measuredFont !== font || state.measuredBy !== measure;
	for (const item of state.items) {
		if (item.icon !== undefined) {
			item.width = Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, bottom - top);
		} else if (remeasure || item.measuredLabel !== item.label) {
			item.width = measure(item.label) + WORKBENCH_ACTION_BAR_ITEM_PADDING_X * 2;
			item.measuredLabel = item.label;
		}
	}
	state.measuredFont = font;
	state.measuredBy = measure;
	const overflow = state.overflow;
	let changed = false, firstOverflow = state.items.length;
	if (overflow !== undefined) {
		let hasSecondary = false;
		if (overflow.secondary !== undefined) for (const entry of overflow.secondary) {
			if (entry.type === 'separator') continue;
			let primary = false;
			for (const item of state.items) if (item.visible && item.command === entry.command) { primary = true; break; }
			if (!primary) { hasSecondary = true; break; }
		}
		let width = 0, count = 0;
		for (const item of state.items) if (item.visible) { width += item.width; count++; }
		width += Math.max(0, count - 1) * WORKBENCH_ACTION_BAR_ITEM_SPACING;
		const available = Math.max(0, right - left);
		overflow.button.width = Math.min(available, Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, bottom - top));
		if (width + (hasSecondary ? overflow.button.width + (count === 0 ? 0 : WORKBENCH_ACTION_BAR_ITEM_SPACING) : 0) > available) {
			let remaining = available - overflow.button.width;
			for (let index = 0; index < state.items.length; index++) {
				const item = state.items[index];
				if (!item.visible) continue;
				remaining -= item.width + WORKBENCH_ACTION_BAR_ITEM_SPACING;
				if (remaining < 0) { firstOverflow = index; break; }
			}
		}
		let secondary = 0;
		for (let index = 0; index < state.items.length; index++) {
			const item = state.items[index], overflowed = item.visible && index >= firstOverflow;
			if (item.overflowed !== overflowed) { item.overflowed = overflowed; changed = true; }
			if (overflowed) {
				if (overflow.items[secondary] !== item.menuItem) { overflow.items[secondary] = item.menuItem!; changed = true; }
				secondary++;
			}
		}
		let separator: WorkbenchMenuItem | undefined = secondary === 0 ? undefined : SECONDARY_GROUP;
		if (overflow.secondary !== undefined) for (const entry of overflow.secondary) {
			if (entry.type === 'separator') { if (secondary !== 0) separator = entry; continue; }
			let primary = false;
			for (const item of state.items) if (item.visible && item.command === entry.command) { primary = true; break; }
			if (primary) continue;
			if (separator !== undefined) {
				if (overflow.items[secondary] !== separator) { overflow.items[secondary] = separator; changed = true; }
				secondary++; separator = undefined;
			}
			if (overflow.items[secondary] !== entry) { overflow.items[secondary] = entry; changed = true; }
			secondary++;
		}
		if (overflow.items.length !== secondary) { overflow.items.length = secondary; changed = true; }
		const visible = secondary !== 0;
		if (overflow.button.visible !== visible) { overflow.button.visible = visible; changed = true; }
		const button = overflow.button;
		if (button.bounds.left !== right - button.width || button.bounds.top !== top || button.bounds.right !== right || button.bounds.bottom !== bottom) changed = true;
		write_rect_bounds(button.bounds, right - button.width, top, right, bottom);
	}
	let itemRight = right;
	if (overflow?.button.visible) itemRight -= overflow.button.width + WORKBENCH_ACTION_BAR_ITEM_SPACING;
	for (let index = state.items.length - 1; index >= 0; index -= 1) {
		const item = state.items[index];
		if (!item.visible || item.overflowed) continue;
		const width = item.width;
		if (item.bounds.left !== itemRight - width || item.bounds.top !== top || item.bounds.right !== itemRight || item.bounds.bottom !== bottom) changed = true;
		write_rect_bounds(item.bounds, itemRight - width, top, itemRight, bottom);
		itemRight -= width + WORKBENCH_ACTION_BAR_ITEM_SPACING;
	}
	const paintedLeft = itemRight === right ? right : itemRight + WORKBENCH_ACTION_BAR_ITEM_SPACING;
	if (state.bounds.left !== paintedLeft || state.bounds.top !== top || state.bounds.right !== right || state.bounds.bottom !== bottom) changed = true;
	write_rect_bounds(state.bounds, paintedLeft, top, right, bottom);
	if (changed) state.layoutRevision++;
}
