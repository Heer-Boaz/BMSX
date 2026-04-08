import * as constants from '../core/constants';
import type { RectBounds } from '../../rompack/rompack';
import { ide_state } from '../core/ide_state';
import { measureText } from '../core/text_utils';
import { drawEditorText } from './text_renderer';
import { api } from '../browser/view/overlay_api';
import { buildTopBarMenuEntries, MENU_COMMANDS, MENU_IDS, TopBarMenuEntry } from '../browser/editor_top_bar_menu';

const Z_TOP_BAR_BACKGROUND = 10;
const Z_MENU_BUTTON = 14;
const Z_MENU_BUTTON_TEXT = 15;
const Z_MENU_DROPDOWN_BASE = 1000;
const Z_MENU_SHADOW = Z_MENU_DROPDOWN_BASE - 1;
const Z_MENU_DROPDOWN = Z_MENU_DROPDOWN_BASE;
const Z_MENU_DROPDOWN_TEXT = Z_MENU_DROPDOWN_BASE + 1;
const Z_MENU_MARKER = Z_MENU_DROPDOWN_BASE + 2;

export function renderTopBar(): void {
	clearMenuBounds();
	const primaryBarHeight = ide_state.headerHeight;
	api.fill_rect(0, 0, ide_state.viewportWidth, primaryBarHeight, Z_TOP_BAR_BACKGROUND, constants.COLOR_TOP_BAR);

	const menuEntries = buildTopBarMenuEntries();
	renderMenuRow(menuEntries);
}

export function renderTopBarDropdown(): void {
	const menuEntries = buildTopBarMenuEntries();
	const menuButtonHeight = ide_state.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	renderOpenMenuDropdown(menuEntries, menuButtonHeight);
}

function renderMenuRow(menuEntries: TopBarMenuEntry[]): number {
	const buttonTop = 1;
	const buttonHeight = ide_state.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	let buttonX = 4;
	const availableRight = ide_state.viewportWidth - 4;
	for (let i = 0; i < menuEntries.length; i += 1) {
		const entry = menuEntries[i];
		const textWidth = measureText(entry.label);
		const buttonWidth = textWidth + constants.HEADER_BUTTON_PADDING_X * 2;
		const right = buttonX + buttonWidth;
		if (right > availableRight) {
			ide_state.menuEntryBounds[entry.id] = { left: 0, top: 0, right: 0, bottom: 0 };
			continue;
		}
		const bottom = buttonTop + buttonHeight;
		const bounds: RectBounds = { left: buttonX, top: buttonTop, right, bottom };
		ide_state.menuEntryBounds[entry.id] = bounds;
		const isOpen = ide_state.openMenuId === entry.id;
		const fillColor = isOpen ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND;
		const textColor = isOpen ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_BUTTON, fillColor);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_BUTTON, constants.COLOR_HEADER_BUTTON_BORDER);
		drawEditorText(ide_state.font, entry.label, bounds.left + constants.HEADER_BUTTON_PADDING_X, bounds.top + constants.HEADER_BUTTON_PADDING_Y, Z_MENU_BUTTON_TEXT, textColor);
		buttonX = right + constants.HEADER_BUTTON_SPACING;
	}
	ide_state.menuDropdownBounds = null;
	return buttonHeight;
}

function renderOpenMenuDropdown(menuEntries: TopBarMenuEntry[], buttonHeight: number): void {
	const openMenu = menuEntries.find((entry) => entry.id === ide_state.openMenuId);
	if (!openMenu) {
		ide_state.menuDropdownBounds = null;
		return;
	}
	const anchor = ide_state.menuEntryBounds[openMenu.id];
	if (anchor.right === 0 && anchor.bottom === 0) {
		ide_state.menuDropdownBounds = null;
		return;
	}
	renderMenuDropdown(openMenu, anchor, buttonHeight);
}

function renderMenuDropdown(menu: TopBarMenuEntry, anchor: RectBounds, itemHeight: number): void {
	const markerSize = Math.max(2, Math.floor(ide_state.lineHeight / 2));
	const paddingX = constants.HEADER_BUTTON_PADDING_X;
	const dropdownWidth = computeDropdownWidth(menu, markerSize, paddingX, anchor.right - anchor.left);
	const separatorHeight = Math.max(2, constants.HEADER_BUTTON_PADDING_Y + 1);
	const dropdownLeft = anchor.left;
	const dropdownTop = ide_state.headerHeight;
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
			const separatorTop = currentTop + Math.max(1, Math.floor(separatorHeight / 2));
			api.fill_rect(dropdownLeft + paddingX, separatorTop, dropdownRight - paddingX, separatorTop + 1, Z_MENU_DROPDOWN, constants.COLOR_HEADER_BUTTON_BORDER);
			currentTop += separatorHeight;
			continue;
		}
		const bounds: RectBounds = {
			left: dropdownLeft,
			top: currentTop,
			right: dropdownRight,
			bottom: currentTop + itemHeight,
		};
		ide_state.topBarButtonBounds[item.command] = bounds;
		const fillColor = item.active
			? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND
			: (item.disabled ? constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND);
		const textColor = item.disabled
			? constants.COLOR_HEADER_BUTTON_TEXT_DISABLED
			: (item.active ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT);
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_DROPDOWN, fillColor);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_DROPDOWN, constants.COLOR_HEADER_BUTTON_BORDER);
		if (item.active) {
			const markerTop = bounds.top + Math.max(1, Math.floor((itemHeight - markerSize) / 2));
			const markerLeft = bounds.left + paddingX;
			api.fill_rect(markerLeft, markerTop, markerLeft + markerSize, markerTop + markerSize, Z_MENU_MARKER, constants.COLOR_HEADER_BUTTON_BORDER);
		}
		const textX = bounds.left + paddingX * 2 + markerSize;
		const textY = bounds.top + constants.HEADER_BUTTON_PADDING_Y;
		drawEditorText(ide_state.font, item.label, textX, textY, Z_MENU_DROPDOWN_TEXT, textColor);
		currentTop = bounds.bottom;
	}
	ide_state.menuDropdownBounds = { left: dropdownLeft, top: dropdownTop, right: dropdownRight, bottom: dropdownTop + totalHeight };
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
	return Math.max(labelWidth, anchorWidth + paddingX * 2);
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
		ide_state.menuEntryBounds[id] = { left: 0, top: 0, right: 0, bottom: 0 };
	}
	for (let i = 0; i < MENU_COMMANDS.length; i += 1) {
		const command = MENU_COMMANDS[i];
		ide_state.topBarButtonBounds[command] = { left: 0, top: 0, right: 0, bottom: 0 };
	}
	ide_state.menuDropdownBounds = null;
}
