import * as constants from '../../common/constants';
import type { RectBounds } from '../../../rompack/format';
import { clear_rect_bounds, create_rect_bounds, write_rect_bounds } from '../../../common/rect';
import { editorChromeState } from '../ui/chrome_state';
import { measureText } from '../../editor/common/text/layout';
import { drawEditorText } from '../../editor/render/text_renderer';
import { api } from '../../editor/ui/view/overlay_api';
import { buildTopBarMenuEntries, MENU_COMMANDS, MENU_IDS, TopBarMenuEntry } from '../ui/top_bar/menu';
import { editorViewState } from '../../editor/ui/view/state';

const Z_TOP_BAR_BACKGROUND = 10;
const Z_MENU_BUTTON = 14;
const Z_MENU_BUTTON_TEXT = 15;
const Z_MENU_DROPDOWN_BASE = 1000;
const Z_MENU_SHADOW = Z_MENU_DROPDOWN_BASE - 1;
const Z_MENU_DROPDOWN = Z_MENU_DROPDOWN_BASE;
const Z_MENU_DROPDOWN_TEXT = Z_MENU_DROPDOWN_BASE + 1;
const Z_MENU_MARKER = Z_MENU_DROPDOWN_BASE + 2;
const menuDropdownBoundsScratch: RectBounds = create_rect_bounds();

export function renderTopBar(): void {
	clearMenuBounds();
	const primaryBarHeight = editorViewState.headerHeight;
	api.fill_rect(0, 0, editorViewState.viewportWidth, primaryBarHeight, Z_TOP_BAR_BACKGROUND, constants.COLOR_TOP_BAR);

	const menuEntries = buildTopBarMenuEntries();
	renderMenuRow(menuEntries);
}

export function renderTopBarDropdown(): void {
	const menuEntries = buildTopBarMenuEntries();
	const menuButtonHeight = editorViewState.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	renderOpenMenuDropdown(menuEntries, menuButtonHeight);
}

function renderMenuRow(menuEntries: TopBarMenuEntry[]): number {
	const buttonTop = 1;
	const buttonHeight = editorViewState.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	let buttonX = 4;
	const availableRight = editorViewState.viewportWidth - 4;
	for (let i = 0; i < menuEntries.length; i += 1) {
		const entry = menuEntries[i];
		const textWidth = measureText(entry.label);
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
		drawEditorText(editorViewState.font, entry.label, bounds.left + constants.HEADER_BUTTON_PADDING_X, bounds.top + constants.HEADER_BUTTON_PADDING_Y, Z_MENU_BUTTON_TEXT, textColor);
		buttonX = right + constants.HEADER_BUTTON_SPACING;
	}
	editorChromeState.menuDropdownBounds = null;
	return buttonHeight;
}

function renderOpenMenuDropdown(menuEntries: TopBarMenuEntry[], buttonHeight: number): void {
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
	renderMenuDropdown(openMenu, anchor, buttonHeight);
}

function renderMenuDropdown(menu: TopBarMenuEntry, anchor: RectBounds, itemHeight: number): void {
	const halfLineHeight = editorViewState.lineHeight >> 1;
	const markerSize = halfLineHeight > 2 ? halfLineHeight : 2;
	const paddingX = constants.HEADER_BUTTON_PADDING_X;
	const dropdownWidth = computeDropdownWidth(menu, markerSize, paddingX, anchor.right - anchor.left);
	const separatorHeightBase = constants.HEADER_BUTTON_PADDING_Y + 1;
	const separatorHeight = separatorHeightBase > 2 ? separatorHeightBase : 2;
	const dropdownLeft = anchor.left;
	const dropdownTop = editorViewState.headerHeight;
	const dropdownRight = dropdownLeft + dropdownWidth;
	const totalHeight = computeDropdownHeight(menu, itemHeight, separatorHeight);
	const shadowOffset = 2;

	api.fill_rect(dropdownLeft + shadowOffset, dropdownTop + shadowOffset, dropdownRight + shadowOffset, dropdownTop + totalHeight + shadowOffset, Z_MENU_SHADOW, constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND);
	api.fill_rect(dropdownLeft, dropdownTop, dropdownRight, dropdownTop + totalHeight, Z_MENU_DROPDOWN, constants.COLOR_HEADER_BUTTON_BACKGROUND);
	api.blit_rect(dropdownLeft, dropdownTop, dropdownRight, dropdownTop + totalHeight, Z_MENU_DROPDOWN, constants.COLOR_HEADER_BUTTON_BORDER);

	let currentTop = dropdownTop;
	for (let index = 0; index < menu.items.length; index += 1) {
		const item = menu.items[index];
		if (item.type === 'separator') {
			const halfSeparatorHeight = separatorHeight >> 1;
			const separatorTop = currentTop + (halfSeparatorHeight > 1 ? halfSeparatorHeight : 1);
			api.fill_rect(dropdownLeft + paddingX, separatorTop, dropdownRight - paddingX, separatorTop + 1, Z_MENU_DROPDOWN, constants.COLOR_HEADER_BUTTON_BORDER);
			currentTop += separatorHeight;
			continue;
		}
		const bounds = editorChromeState.topBarButtonBounds[item.command];
		write_rect_bounds(bounds, dropdownLeft, currentTop, dropdownRight, currentTop + itemHeight);
		const fillColor = item.active
			? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND
			: (item.disabled ? constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND);
		const textColor = item.disabled
			? constants.COLOR_HEADER_BUTTON_TEXT_DISABLED
			: (item.active ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT);
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_DROPDOWN, fillColor);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_DROPDOWN, constants.COLOR_HEADER_BUTTON_BORDER);
		if (item.active) {
			const markerOffset = (itemHeight - markerSize) >> 1;
			const markerTop = bounds.top + (markerOffset > 1 ? markerOffset : 1);
			const markerLeft = bounds.left + paddingX;
			api.fill_rect(markerLeft, markerTop, markerLeft + markerSize, markerTop + markerSize, Z_MENU_MARKER, constants.COLOR_HEADER_BUTTON_BORDER);
		}
		const textX = bounds.left + paddingX * 2 + markerSize;
		const textY = bounds.top + constants.HEADER_BUTTON_PADDING_Y;
		drawEditorText(editorViewState.font, item.label, textX, textY, Z_MENU_DROPDOWN_TEXT, textColor);
		currentTop = bounds.bottom;
	}
	write_rect_bounds(menuDropdownBoundsScratch, dropdownLeft, dropdownTop, dropdownRight, dropdownTop + totalHeight);
	editorChromeState.menuDropdownBounds = menuDropdownBoundsScratch;
}

function computeDropdownWidth(menu: TopBarMenuEntry, markerSize: number, paddingX: number, anchorWidth: number): number {
	let maxLabelWidth = 0;
	for (let index = 0; index < menu.items.length; index += 1) {
		const item = menu.items[index];
		if (item.type === 'separator') {
			continue;
		}
		const width = measureText(item.label);
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
