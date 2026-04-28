import * as constants from '../../common/constants';
import type { RectBounds } from '../../../rompack/format';
import { clear_rect_bounds, create_rect_bounds, write_rect_bounds } from '../../../common/rect';
import { editorChromeState } from '../ui/chrome_state';
import { api } from '../../runtime/overlay_api';
import { buildTopBarMenuEntries, MENU_COMMANDS, MENU_IDS, TopBarMenuEntry } from '../ui/top_bar/menu';
import type { IdeCommandController } from '../../commands/controller';
import type { ChromeRenderContext } from './chrome_context';

const Z_TOP_BAR_BACKGROUND = 10;
const Z_MENU_BUTTON = 14;
const Z_MENU_BUTTON_TEXT = 15;
const Z_MENU_DROPDOWN_BASE = 1000;
const Z_MENU_SHADOW = Z_MENU_DROPDOWN_BASE - 1;
const Z_MENU_DROPDOWN = Z_MENU_DROPDOWN_BASE;
const Z_MENU_DROPDOWN_TEXT = Z_MENU_DROPDOWN_BASE + 1;
const Z_MENU_MARKER = Z_MENU_DROPDOWN_BASE + 2;
const menuDropdownBoundsScratch: RectBounds = create_rect_bounds();

export function renderTopBar(commands: IdeCommandController, context: ChromeRenderContext): void {
	clearMenuBounds();
	const primaryBarHeight = context.headerHeight;
	const viewportWidth = context.viewportWidth;
	write_rect_bounds(editorChromeState.topBarBounds, 0, 0, viewportWidth, primaryBarHeight);
	api.fill_rect(0, 0, viewportWidth, primaryBarHeight, Z_TOP_BAR_BACKGROUND, constants.COLOR_TOP_BAR);

	const menuEntries = buildTopBarMenuEntries(commands);
	renderMenuRow(menuEntries, context);
}

export function renderTopBarDropdown(commands: IdeCommandController, context: ChromeRenderContext): void {
	const menuEntries = buildTopBarMenuEntries(commands);
	const menuButtonHeight = context.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	renderOpenMenuDropdown(menuEntries, menuButtonHeight, context);
}

function renderMenuRow(menuEntries: TopBarMenuEntry[], context: ChromeRenderContext): number {
	const buttonTop = 1;
	const buttonHeight = context.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	let buttonX = 4;
	const availableRight = context.viewportWidth - 4;
	for (let i = 0; i < menuEntries.length; i += 1) {
		const entry = menuEntries[i];
		const textWidth = context.measureText(entry.label);
		const buttonWidth = textWidth + constants.HEADER_BUTTON_PADDING_X * 2;
		const right = buttonX + buttonWidth;
		const bounds = editorChromeState.menuEntryBounds[entry.id];
		if (right > availableRight) {
			clear_rect_bounds(bounds);
			continue;
		}
		const bottom = buttonTop + buttonHeight;
		write_rect_bounds(bounds, buttonX, buttonTop, right, bottom);
		const isOpen = editorChromeState.openMenuId === entry.id;
		const fillColor = isOpen ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND;
		const textColor = isOpen ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_BUTTON, fillColor);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_BUTTON, constants.COLOR_HEADER_BUTTON_BORDER);
		context.drawText(entry.label, bounds.left + constants.HEADER_BUTTON_PADDING_X, bounds.top + constants.HEADER_BUTTON_PADDING_Y, Z_MENU_BUTTON_TEXT, textColor);
		buttonX = right + constants.HEADER_BUTTON_SPACING;
	}
	editorChromeState.menuDropdownBounds = null;
	return buttonHeight;
}

function renderOpenMenuDropdown(menuEntries: TopBarMenuEntry[], buttonHeight: number, context: ChromeRenderContext): void {
	let openMenu: TopBarMenuEntry = null;
	for (let index = 0; index < menuEntries.length; index += 1) {
		const entry = menuEntries[index];
		if (entry.id === editorChromeState.openMenuId) {
			openMenu = entry;
			break;
		}
	}
	if (!openMenu) {
		editorChromeState.menuDropdownBounds = null;
		return;
	}
	const anchor = editorChromeState.menuEntryBounds[openMenu.id];
	if (anchor.right === 0 && anchor.bottom === 0) {
		editorChromeState.menuDropdownBounds = null;
		return;
	}
	renderMenuDropdown(openMenu, anchor, buttonHeight, context);
}

function renderMenuDropdown(menu: TopBarMenuEntry, anchor: RectBounds, itemHeight: number, context: ChromeRenderContext): void {
	const halfLineHeight = context.lineHeight >> 1;
	const markerSize = halfLineHeight > 2 ? halfLineHeight : 2;
	const paddingX = constants.HEADER_BUTTON_PADDING_X;
	const dropdownWidth = computeDropdownWidth(menu, markerSize, paddingX, anchor.right - anchor.left, context);
	const separatorHeightBase = constants.HEADER_BUTTON_PADDING_Y + 1;
	const separatorHeight = separatorHeightBase > 2 ? separatorHeightBase : 2;
	const dropdownLeft = anchor.left;
	const dropdownTop = context.headerHeight;
	const dropdownRight = dropdownLeft + dropdownWidth;
	const totalHeight = computeDropdownHeight(menu, itemHeight, separatorHeight);
	const dropdownBottom = dropdownTop + totalHeight;
	const shadowOffset = 2;
	const borderColor = constants.COLOR_HEADER_BUTTON_BORDER;
	const disabledBackground = constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND;

	api.fill_rect(dropdownLeft + shadowOffset, dropdownTop + shadowOffset, dropdownRight + shadowOffset, dropdownBottom + shadowOffset, Z_MENU_SHADOW, disabledBackground);
	api.fill_rect(dropdownLeft, dropdownTop, dropdownRight, dropdownBottom, Z_MENU_DROPDOWN, constants.COLOR_HEADER_BUTTON_BACKGROUND);
	api.blit_rect(dropdownLeft, dropdownTop, dropdownRight, dropdownBottom, Z_MENU_DROPDOWN, borderColor);

	let currentTop = dropdownTop;
	for (let index = 0; index < menu.items.length; index += 1) {
		const item = menu.items[index];
		if (item.type === 'separator') {
			const halfSeparatorHeight = separatorHeight >> 1;
			const separatorTop = currentTop + (halfSeparatorHeight > 1 ? halfSeparatorHeight : 1);
			api.fill_rect(dropdownLeft + paddingX, separatorTop, dropdownRight - paddingX, separatorTop + 1, Z_MENU_DROPDOWN, borderColor);
			currentTop += separatorHeight;
			continue;
		}
		const bounds = editorChromeState.topBarButtonBounds[item.command];
		write_rect_bounds(bounds, dropdownLeft, currentTop, dropdownRight, currentTop + itemHeight);
		const fillColor = item.active
			? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND
			: (item.disabled ? disabledBackground : constants.COLOR_HEADER_BUTTON_BACKGROUND);
		const textColor = item.disabled
			? constants.COLOR_HEADER_BUTTON_TEXT_DISABLED
			: (item.active ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT);
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_DROPDOWN, fillColor);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_DROPDOWN, borderColor);
		if (item.active) {
			const markerOffset = (itemHeight - markerSize) >> 1;
			const markerTop = bounds.top + (markerOffset > 1 ? markerOffset : 1);
			const markerLeft = bounds.left + paddingX;
			api.fill_rect(markerLeft, markerTop, markerLeft + markerSize, markerTop + markerSize, Z_MENU_MARKER, borderColor);
		}
		const textX = bounds.left + paddingX * 2 + markerSize;
		const textY = bounds.top + constants.HEADER_BUTTON_PADDING_Y;
		context.drawText(item.label, textX, textY, Z_MENU_DROPDOWN_TEXT, textColor);
		currentTop = bounds.bottom;
	}
	write_rect_bounds(menuDropdownBoundsScratch, dropdownLeft, dropdownTop, dropdownRight, dropdownBottom);
	editorChromeState.menuDropdownBounds = menuDropdownBoundsScratch;
}

function computeDropdownWidth(menu: TopBarMenuEntry, markerSize: number, paddingX: number, anchorWidth: number, context: ChromeRenderContext): number {
	let maxLabelWidth = 0;
	for (let index = 0; index < menu.items.length; index += 1) {
		const item = menu.items[index];
		if (item.type === 'separator') {
			continue;
		}
		const width = context.measureText(item.label);
		if (width > maxLabelWidth) {
			maxLabelWidth = width;
		}
	}
	const labelWidth = markerSize + paddingX * 3 + maxLabelWidth;
	const anchorButtonWidth = anchorWidth + paddingX * 2;
	return labelWidth > anchorButtonWidth ? labelWidth : anchorButtonWidth;
}

function computeDropdownHeight(menu: TopBarMenuEntry, itemHeight: number, separatorHeight: number): number {
	let total = 0;
	for (let index = 0; index < menu.items.length; index += 1) {
		const item = menu.items[index];
		total += item.type === 'separator' ? separatorHeight : itemHeight;
	}
	return total;
}

function clearMenuBounds(): void {
	for (let i = 0; i < MENU_IDS.length; i += 1) {
		const id = MENU_IDS[i];
		clear_rect_bounds(editorChromeState.menuEntryBounds[id]);
	}
	for (let i = 0; i < MENU_COMMANDS.length; i += 1) {
		const command = MENU_COMMANDS[i];
		clear_rect_bounds(editorChromeState.topBarButtonBounds[command]);
	}
	editorChromeState.menuDropdownBounds = null;
}
