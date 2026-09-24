import * as constants from '../../common/constants';
import { editorChromeState } from '../ui/chrome_state';
import { api } from '../../runtime/overlay_api';
import { TOP_BAR_MENU_ENTRIES, TOP_BAR_MENUS } from '../ui/top_bar/menu';
import type { ChromeRenderContext } from './chrome_context';

const Z_TOP_BAR_BACKGROUND = 10;
const Z_MENU_BUTTON = 14;
const Z_MENU_BUTTON_TEXT = 15;
const Z_MENU_DROPDOWN_BASE = 1000;
const Z_MENU_SHADOW = Z_MENU_DROPDOWN_BASE - 1;
const Z_MENU_DROPDOWN = Z_MENU_DROPDOWN_BASE;
const Z_MENU_DROPDOWN_TEXT = Z_MENU_DROPDOWN_BASE + 1;
const Z_MENU_MARKER = Z_MENU_DROPDOWN_BASE + 2;

/** Chrome painting consumes layout and command presentation, without republishing either. */
export function renderTopBar(context: ChromeRenderContext): void {
	const bounds = editorChromeState.topBarBounds;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_TOP_BAR_BACKGROUND, constants.COLOR_TOP_BAR);
	for (const entry of TOP_BAR_MENU_ENTRIES) {
		const bounds = editorChromeState.menuEntryBounds[entry.id];
		if (bounds.right === 0) continue;
		const isOpen = editorChromeState.openMenuId === entry.id;
		const fillColor = isOpen ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND;
		const textColor = isOpen ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_BUTTON, fillColor);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_BUTTON, constants.COLOR_HEADER_BUTTON_BORDER);
		context.drawText(entry.label, bounds.left + constants.HEADER_BUTTON_PADDING_X, bounds.top + constants.HEADER_BUTTON_PADDING_Y, Z_MENU_BUTTON_TEXT, textColor);
	}
}

export function renderTopBarDropdown(context: ChromeRenderContext): void {
	const dropdown = editorChromeState.menuDropdownBounds;
	if (dropdown === null) return;
	const menu = TOP_BAR_MENUS[editorChromeState.openMenuId!];
	const markerSize = Math.max(context.lineHeight >> 1, 2);
	const paddingX = constants.HEADER_BUTTON_PADDING_X;
	const borderColor = constants.COLOR_MENU_BORDER;
	api.fill_rect(dropdown.left + 2, dropdown.top + 2, dropdown.right + 2, dropdown.bottom + 2, Z_MENU_SHADOW, constants.COLOR_MENU_SHADOW);
	api.fill_rect(dropdown.left, dropdown.top, dropdown.right, dropdown.bottom, Z_MENU_DROPDOWN, constants.COLOR_MENU_BACKGROUND);
	api.blit_rect(dropdown.left, dropdown.top, dropdown.right, dropdown.bottom, Z_MENU_DROPDOWN, borderColor);
	for (const item of menu.items) {
		const bounds = item.bounds;
		if (item.type === 'separator') {
			const separatorTop = bounds.top + Math.max((bounds.bottom - bounds.top) >> 1, 1);
			api.fill_rect(bounds.left + paddingX, separatorTop, bounds.right - paddingX, separatorTop + 1, Z_MENU_DROPDOWN, borderColor);
			continue;
		}
		const fillColor = item.active ? constants.COLOR_MENU_SELECTION_BACKGROUND : constants.COLOR_MENU_BACKGROUND;
		const textColor = item.disabled ? constants.COLOR_MENU_DISABLED_TEXT
			: item.active ? constants.COLOR_MENU_SELECTION_TEXT : constants.COLOR_MENU_TEXT;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_DROPDOWN, fillColor);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_DROPDOWN, borderColor);
		if (item.active) {
			const markerTop = bounds.top + Math.max((bounds.bottom - bounds.top - markerSize) >> 1, 1);
			const markerLeft = bounds.left + paddingX;
			api.fill_rect(markerLeft, markerTop, markerLeft + markerSize, markerTop + markerSize, Z_MENU_MARKER, borderColor);
		}
		const textY = bounds.top + constants.HEADER_BUTTON_PADDING_Y;
		context.drawText(item.label, bounds.left + paddingX * 2 + markerSize, textY, Z_MENU_DROPDOWN_TEXT, textColor);
		if (item.keybinding !== undefined) {
			context.drawText(item.keybinding, bounds.right - paddingX - item.keybindingWidth, textY, Z_MENU_DROPDOWN_TEXT, textColor);
		}
	}
}
