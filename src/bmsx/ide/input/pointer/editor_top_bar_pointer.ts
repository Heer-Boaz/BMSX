import { point_in_rect } from '../../../utils/rect_operations';
import { isTopBarCommandEnabled, MENU_COMMANDS, MENU_IDS, type MenuId, type TopBarButtonId } from '../../ui/editor_top_bar_menu';
import { ide_state } from '../../core/ide_state';
import { editorChromeState } from '../../ui/editor_chrome_state';
import type { PointerSnapshot } from '../../core/types';
import { executeTopBarCommand } from '../commands/editor_commands';
import { consumeChromePointerPress } from './editor_chrome_pointer_press';

export function handleTopBarPointer(snapshot: PointerSnapshot): boolean {
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	const menuOpen = editorChromeState.openMenuId !== null;
	const inHeader = y >= 0 && y < ide_state.headerHeight;
	const inDropdown = menuOpen && point_in_rect(x, y, editorChromeState.menuDropdownBounds);
	if (!inHeader && !inDropdown) {
		if (menuOpen) {
			editorChromeState.openMenuId = null;
			editorChromeState.menuDropdownBounds = null;
		}
		return false;
	}
	if (inHeader) {
		const menuId = findTopMenuAtPoint(x, y);
		if (menuId) {
			editorChromeState.openMenuId = editorChromeState.openMenuId === menuId ? null : menuId;
			consumeChromePointerPress(snapshot);
			return true;
		}
		if (menuOpen) {
			editorChromeState.openMenuId = null;
			editorChromeState.menuDropdownBounds = null;
			consumeChromePointerPress(snapshot);
			return true;
		}
		return false;
	}
	const command = findMenuCommandAtPoint(x, y);
	if (!command) {
		consumeChromePointerPress(snapshot);
		return true;
	}
	if (isTopBarCommandEnabled(command)) {
		executeTopBarCommand(command);
		editorChromeState.openMenuId = null;
		editorChromeState.menuDropdownBounds = null;
	}
	consumeChromePointerPress(snapshot);
	return true;
}

function findTopMenuAtPoint(x: number, y: number): MenuId {
	for (let index = 0; index < MENU_IDS.length; index += 1) {
		const id = MENU_IDS[index];
		if (point_in_rect(x, y, editorChromeState.menuEntryBounds[id])) {
			return id;
		}
	}
	return null;
}

function findMenuCommandAtPoint(x: number, y: number): TopBarButtonId {
	for (let index = 0; index < MENU_COMMANDS.length; index += 1) {
		const command = MENU_COMMANDS[index];
		if (point_in_rect(x, y, editorChromeState.topBarButtonBounds[command])) {
			return command;
		}
	}
	return null;
}
