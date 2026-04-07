import { point_in_rect } from '../../../utils/rect_operations';
import { ide_state } from '../ide_state';
import type { MenuId, PointerSnapshot, TopBarButtonId } from '../types';
import { beginTabDrag, closeTab, endTabDrag, setActiveTab } from '../editor_tabs';
import { getTabBarTotalHeight } from '../editor_view';
import { executeTopBarCommand, MENU_COMMANDS, MENU_IDS } from './editor_commands';
import * as constants from '../constants';

export function handleTopBarPointer(snapshot: PointerSnapshot): boolean {
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	const menuOpen = ide_state.openMenuId !== null;
	const inHeader = y >= 0 && y < ide_state.headerHeight;
	const inDropdown = menuOpen && point_in_rect(x, y, ide_state.menuDropdownBounds);
	if (!inHeader && !inDropdown) {
		if (menuOpen) {
			ide_state.openMenuId = null;
			ide_state.menuDropdownBounds = null;
		}
		return false;
	}
	if (inHeader) {
		const menuId = findTopMenuAtPoint(x, y);
		if (menuId) {
			ide_state.openMenuId = ide_state.openMenuId === menuId ? null : menuId;
			return true;
		}
		if (menuOpen) {
			ide_state.openMenuId = null;
			ide_state.menuDropdownBounds = null;
			return true;
		}
		return false;
	}
	const command = findMenuCommandAtPoint(x, y);
	if (!command) {
		return true;
	}
	if (isMenuCommandEnabled(command)) {
		executeTopBarCommand(command);
		ide_state.openMenuId = null;
		ide_state.menuDropdownBounds = null;
		return true;
	}
	return true;
}

export function handleTabBarPointer(snapshot: PointerSnapshot): boolean {
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		return false;
	}
	const x = snapshot.viewportX;
	for (let index = 0; index < ide_state.tabs.length; index += 1) {
		const tab = ide_state.tabs[index];
		const closeBounds = ide_state.tabCloseButtonBounds.get(tab.id);
		if (closeBounds && point_in_rect(x, y, closeBounds)) {
			endTabDrag();
			closeTab(tab.id);
			ide_state.tabHoverId = null;
			return true;
		}
		const tabBounds = ide_state.tabButtonBounds.get(tab.id);
		if (tabBounds && point_in_rect(x, y, tabBounds)) {
			beginTabDrag(tab.id, x);
			setActiveTab(tab.id);
			return true;
		}
	}
	return false;
}

export function handleTabBarMiddleClick(snapshot: PointerSnapshot): boolean {
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		return false;
	}
	const x = snapshot.viewportX;
	for (let index = 0; index < ide_state.tabs.length; index += 1) {
		const tab = ide_state.tabs[index];
		if (!tab.closable) {
			continue;
		}
		const bounds = ide_state.tabButtonBounds.get(tab.id);
		if (!bounds) {
			continue;
		}
		if (point_in_rect(x, y, bounds)) {
			closeTab(tab.id);
			return true;
		}
	}
	return false;
}

export function updateTabHoverState(snapshot: PointerSnapshot): void {
	if (!snapshot.valid || !snapshot.insideViewport) {
		ide_state.tabHoverId = null;
		return;
	}
	const tabTop = ide_state.headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		ide_state.tabHoverId = null;
		return;
	}
	const x = snapshot.viewportX;
	let hovered: string = null;
	for (const [tabId, bounds] of ide_state.tabButtonBounds) {
		if (point_in_rect(x, y, bounds)) {
			hovered = tabId;
			break;
		}
	}
	ide_state.tabHoverId = hovered;
}

export function isPointerOverResourcePanelDivider(x: number, y: number): boolean {
	if (!ide_state.resourcePanelVisible) {
		return false;
	}
	const bounds = ide_state.resourcePanel.getBounds();
	if (!bounds) {
		return false;
	}
	const margin = constants.RESOURCE_PANEL_DIVIDER_DRAG_MARGIN;
	const left = bounds.right - margin;
	const right = bounds.right + margin;
	return y >= bounds.top && y <= bounds.bottom && x >= left && x <= right;
}

function findTopMenuAtPoint(x: number, y: number): MenuId {
	for (let index = 0; index < MENU_IDS.length; index += 1) {
		const id = MENU_IDS[index];
		if (point_in_rect(x, y, ide_state.menuEntryBounds[id])) {
			return id;
		}
	}
	return null;
}

function findMenuCommandAtPoint(x: number, y: number): TopBarButtonId {
	for (let index = 0; index < MENU_COMMANDS.length; index += 1) {
		const command = MENU_COMMANDS[index];
		if (point_in_rect(x, y, ide_state.topBarButtonBounds[command])) {
			return command;
		}
	}
	return null;
}

function isMenuCommandEnabled(command: TopBarButtonId): boolean {
	if (command === 'save') {
		return ide_state.dirty;
	}
	if (command === 'filter') {
		return ide_state.resourcePanelVisible;
	}
	if (command === 'debugContinue' || command === 'debugStepOver' || command === 'debugStepInto' || command === 'debugStepOut') {
		return ide_state.debuggerControls.executionState === 'paused';
	}
	return true;
}
