import { clear_rect_bounds, create_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { IdeCommandController } from '../../../commands/controller';
import { editorCommandTitle } from '../../../commands/catalog';
import * as constants from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import type { WorkbenchChromeLayout } from '../../common/layout';
import { editorChromeState } from '../chrome_state';
import { TOP_BAR_MENU_ENTRIES, TOP_BAR_MENUS, type TopBarMenuEntry, type TopBarMenuItem } from './menu';

const dropdownBounds = create_rect_bounds();
let publishedMenu: TopBarMenuEntry | null = null;
let labelFont: BFont | undefined;
const labelWidths = new Float64Array(TOP_BAR_MENU_ENTRIES.length);
const measuredItems = new WeakMap<TopBarMenuItem, { font: BFont; label: string; width: number }>();

/** Command state and all header/dropdown hits are published before painting. */
export function layoutTopBar(commands: Pick<IdeCommandController, 'isActive' | 'isEnabled'>, context: WorkbenchChromeLayout): void {
	const font = editorViewState.font.renderFont();
	write_rect_bounds(editorChromeState.topBarBounds, 0, 0, context.viewportWidth, context.headerHeight);
	const buttonHeight = context.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	const paddingX = constants.HEADER_BUTTON_PADDING_X;
	let buttonX = 4;
	for (let index = 0; index < TOP_BAR_MENU_ENTRIES.length; index++) {
		const entry = TOP_BAR_MENU_ENTRIES[index];
		if (labelFont !== font) labelWidths[index] = context.measureText(entry.label);
		const right = buttonX + labelWidths[index] + paddingX * 2;
		const bounds = editorChromeState.menuEntryBounds[entry.id];
		if (right > context.viewportWidth - 4) { clear_rect_bounds(bounds); continue; }
		write_rect_bounds(bounds, buttonX, 1, right, 1 + buttonHeight);
		buttonX = right + constants.HEADER_BUTTON_SPACING;
	}
	labelFont = font;
	const open = editorChromeState.openMenuId;
	let menu = open === null ? null : TOP_BAR_MENUS[open];
	if (menu !== null && editorChromeState.menuEntryBounds[menu.id].right === 0) menu = null;
	if (publishedMenu !== menu) {
		if (publishedMenu !== null) for (const item of publishedMenu.items) clear_rect_bounds(item.bounds);
		publishedMenu = menu;
	}
	editorChromeState.menuDropdownBounds = null;
	if (menu === null) return;
	const anchor = editorChromeState.menuEntryBounds[menu.id];
	const markerSize = Math.max(context.lineHeight >> 1, 2);
	const separatorHeight = Math.max(constants.HEADER_BUTTON_PADDING_Y + 1, 2);
	let maxLabelWidth = 0;
	for (const item of menu.items) {
		if (item.type === 'separator') continue;
		item.active = commands.isActive(item.command);
		item.disabled = !commands.isEnabled(item.command);
		item.label = editorCommandTitle(item.command, item.active, true);
		let measured = measuredItems.get(item);
		if (measured === undefined || measured.font !== font || measured.label !== item.label) {
			item.keybindingWidth = item.keybinding === undefined ? 0 : context.measureText(item.keybinding);
			measured = { font, label: item.label, width: context.measureText(item.label)
				+ (item.keybinding === undefined ? 0 : paddingX * 2 + item.keybindingWidth) };
			measuredItems.set(item, measured);
		}
		if (measured.width > maxLabelWidth) maxLabelWidth = measured.width;
	}
	const width = Math.max(markerSize + paddingX * 3 + maxLabelWidth, anchor.right - anchor.left + paddingX * 2);
	const right = anchor.left + width;
	let top = context.headerHeight;
	for (const item of menu.items) {
		const bottom = top + (item.type === 'separator' ? separatorHeight : buttonHeight);
		write_rect_bounds(item.bounds, anchor.left, top, right, bottom);
		top = bottom;
	}
	write_rect_bounds(dropdownBounds, anchor.left, context.headerHeight, right, top);
	editorChromeState.menuDropdownBounds = dropdownBounds;
}
