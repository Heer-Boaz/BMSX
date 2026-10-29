import type { RectBounds } from '../../../machine/ts/common/rect';
import { create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import { editorCommandTitle } from '../../commands/catalog';
import type { EditorCommandId } from '../../common/commands';
import { WORKBENCH_MENUS, type WorkbenchActionMenuId, type WorkbenchMenuCommandItem, type WorkbenchMenuItem } from './menu/registry';
import type { WorkbenchMenuEntry, WorkbenchMenuPresentation, WorkbenchMenuProjection } from './menu/model';
import { WorkbenchActionBarPresentation } from './action_bar_presentation';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import { WORKBENCH_ICON_SIZE, type WorkbenchIcon } from './icon';

export const WORKBENCH_ACTION_BAR_ITEM_PADDING_X = 3;
export const WORKBENCH_ACTION_BAR_ITEM_SPACING = 2;
export const WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH = WORKBENCH_ICON_SIZE + WORKBENCH_ACTION_BAR_ITEM_PADDING_X * 2;

export const WORKBENCH_ACTION_BAR_OVERFLOW = Symbol('actionbar overflow');
export type WorkbenchActionBarAction = EditorCommandId | typeof WORKBENCH_ACTION_BAR_OVERFLOW;

export type WorkbenchActionBarItem<Command = EditorCommandId> = {
	readonly command: Command;
	readonly menuItem?: WorkbenchMenuCommandItem;
	readonly menuEntry?: WorkbenchMenuEntry;
	label: string;
	tooltip: string;
	icon?: WorkbenchIcon;
	checkedIcon?: WorkbenchIcon;
	readonly showLabel?: boolean;
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
	readonly menu: WorkbenchMenuProjection | undefined;
	readonly presentation: WorkbenchActionBarPresentation;
	readonly bounds: RectBounds;
	readonly overflow?: {
		readonly button: WorkbenchActionBarItem<typeof WORKBENCH_ACTION_BAR_OVERFLOW>;
		readonly items: WorkbenchMenuItem[];
		readonly secondary: readonly WorkbenchMenuItem[] | undefined;
		readonly secondaryMenu: WorkbenchMenuPresentation | undefined;
	};
	layoutRevision: number;
	alignment: 'start' | 'end';
	hoveredCommand: WorkbenchActionBarAction | null;
	pressedCommand: WorkbenchActionBarAction | null;
	focusedIndex: number;
	hasFocus: boolean;
	measuredFont: BFont | null;
	measuredBy: ((text: string) => number) | undefined;
	measurementDirty: boolean;
};

/** Materializes static or context-bound placements once into retained action state. */
export function createWorkbenchActionBar(source: WorkbenchActionMenuId | WorkbenchMenuProjection, responsive = false,
	secondary?: readonly WorkbenchMenuItem[] | WorkbenchMenuPresentation): WorkbenchActionBarState {
	const menu = typeof source === 'string' ? undefined : source;
	const named = typeof source === 'string' ? WORKBENCH_MENUS[source] : undefined;
	const count = menu === undefined ? named!.length : menu.entries.length;
	const items: WorkbenchActionBarItem[] = [];
	for (let index = 0; index < count; index += 1) {
		const entry = menu?.entries[index];
		const contribution = entry === undefined ? named![index] : entry.item;
		if (contribution.type === 'separator') continue;
		items.push({
			command: contribution.command,
			menuItem: contribution,
			menuEntry: entry,
			label: editorCommandTitle(contribution.command, false, true),
			tooltip: editorCommandTitle(contribution.command, false),
			icon: contribution.icon,
			checkedIcon: contribution.checkedIcon,
			showLabel: contribution.showLabel,
			bounds: create_rect_bounds(),
			visible: entry === undefined || entry.visible,
			overflowed: false,
			enabled: false,
			checked: false,
			width: 0,
			measuredLabel: '',
		});
	}
	let secondaryItems: readonly WorkbenchMenuItem[] | undefined;
	let secondaryMenu: WorkbenchMenuPresentation | undefined;
	if (secondary !== undefined) {
		if ('visibleItems' in secondary) { secondaryMenu = secondary; secondaryItems = secondary.visibleItems; }
		else secondaryItems = secondary;
	}
	const button: WorkbenchActionBarItem<typeof WORKBENCH_ACTION_BAR_OVERFLOW> | undefined = responsive ? {
		command: WORKBENCH_ACTION_BAR_OVERFLOW, label: 'More Actions', tooltip: 'More Actions', icon: 'more', bounds: create_rect_bounds(),
		visible: false, overflowed: false, enabled: true, checked: false, width: 0, measuredLabel: '',
	} : undefined;
	const presentation = new WorkbenchActionBarPresentation(items, menu, secondaryItems, secondaryMenu, button);
	return { items, menu, presentation, bounds: create_rect_bounds(), overflow: button === undefined ? undefined : {
		button, items: presentation.visibleItems, secondary: secondaryItems, secondaryMenu,
	}, layoutRevision: 0, alignment: 'end', hoveredCommand: null, pressedCommand: null, focusedIndex: -1, hasFocus: false, measuredFont: null, measuredBy: undefined, measurementDirty: false };
}

export function layoutWorkbenchActionBar(
	state: WorkbenchActionBarState,
	right: number,
	top: number,
	bottom: number,
	measure: (text: string) => number,
	font: BFont | null,
	left: number,
	alignment: 'start' | 'end' = 'end',
): void {
	measureWorkbenchActionBar(state, bottom - top, measure, font);
	let changed = state.measurementDirty || state.alignment !== alignment;
	state.measurementDirty = false;
	state.alignment = alignment;
	const overflow = state.overflow;
	let firstOverflow = state.items.length;
	if (overflow !== undefined) {
		const hasSecondary = state.presentation.hasSecondaryActions();
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
		for (let index = 0; index < state.items.length; index++) {
			const item = state.items[index], overflowed = item.visible && index >= firstOverflow;
			if (item.overflowed !== overflowed) { item.overflowed = overflowed; changed = true; }
		}
		const revision = state.presentation.revision;
		state.presentation.updateOverflow();
		if (revision !== state.presentation.revision) changed = true;
		const visible = overflow.items.length !== 0;
		if (overflow.button.visible !== visible) { overflow.button.visible = visible; changed = true; }
	}
	const leading = alignment === 'start', direction = leading ? 1 : -1;
	let position = leading ? left : right;
	if (!leading && overflow?.button.visible) position -= overflow.button.width + WORKBENCH_ACTION_BAR_ITEM_SPACING;
	let presented = false;
	for (let index = leading ? 0 : state.items.length - 1; index >= 0 && index < state.items.length; index += direction) {
		const item = state.items[index];
		if (!item.visible || item.overflowed) continue;
		const itemLeft = leading ? position : position - item.width, itemRight = itemLeft + item.width;
		if (item.bounds.left !== itemLeft || item.bounds.top !== top || item.bounds.right !== itemRight || item.bounds.bottom !== bottom) changed = true;
		write_rect_bounds(item.bounds, itemLeft, top, itemRight, bottom);
		position += direction * (item.width + WORKBENCH_ACTION_BAR_ITEM_SPACING);
		presented = true;
	}
	if (overflow !== undefined) {
		const button = overflow.button;
		const buttonLeft = leading ? position : right - button.width, buttonRight = buttonLeft + button.width;
		if (button.bounds.left !== buttonLeft || button.bounds.top !== top || button.bounds.right !== buttonRight || button.bounds.bottom !== bottom) changed = true;
		write_rect_bounds(button.bounds, buttonLeft, top, buttonRight, bottom);
		if (button.visible) {
			if (leading) position = buttonRight + WORKBENCH_ACTION_BAR_ITEM_SPACING;
			presented = true;
		}
	}
	const paintedLeft = leading ? left : presented ? position + WORKBENCH_ACTION_BAR_ITEM_SPACING : right;
	const paintedRight = leading ? presented ? position - WORKBENCH_ACTION_BAR_ITEM_SPACING : left : right;
	if (state.bounds.left !== paintedLeft || state.bounds.top !== top || state.bounds.right !== paintedRight || state.bounds.bottom !== bottom) changed = true;
	write_rect_bounds(state.bounds, paintedLeft, top, paintedRight, bottom);
	if (changed) state.layoutRevision++;
}

/** Intrinsic width keeps every action directly reachable or in its real overflow menu. */
export function measureWorkbenchActionBarMinimumWidth(state: WorkbenchActionBarState, height: number,
	measure: (text: string) => number, font: BFont | null): number {
	measureWorkbenchActionBar(state, height, measure, font);
	let width = 0, count = 0;
	for (const item of state.items) if (item.visible) { width += item.width; count++; }
	width += Math.max(0, count - 1) * WORKBENCH_ACTION_BAR_ITEM_SPACING;
	if (state.overflow === undefined) return width;
	const overflowWidth = Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, height);
	return state.presentation.hasSecondaryActions() ? overflowWidth : Math.min(width, overflowWidth);
}

function measureWorkbenchActionBar(state: WorkbenchActionBarState, height: number, measure: (text: string) => number,
	font: BFont | null): void {
	state.presentation.refresh();
	let changed = false;
	const remeasure = state.measuredFont !== font || state.measuredBy !== measure;
	for (const item of state.items) {
		if (item.menuEntry !== undefined && item.visible !== item.menuEntry.visible) { item.visible = item.menuEntry.visible; changed = true; }
		if (item.icon !== undefined && !item.showLabel) {
			item.width = Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, height);
		} else if (remeasure || item.measuredLabel !== item.label) {
			item.width = measure(item.label) + WORKBENCH_ACTION_BAR_ITEM_PADDING_X * 2
				+ (item.icon === undefined ? 0 : WORKBENCH_ICON_SIZE + WORKBENCH_ACTION_BAR_ITEM_SPACING);
			item.measuredLabel = item.label;
		}
	}
	state.measuredFont = font;
	state.measuredBy = measure;
	state.measurementDirty ||= changed;
}
