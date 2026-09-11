import { point_in_rect } from '../../../../../machine/ts/common/rect';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../../common/commands';
import {
	MENU_IDS,
	TOP_BAR_MENUS,
	type MenuId,
} from '../../../ui/top_bar/menu';
import { editorChromeState } from '../../../ui/chrome_state';
import type { PointerSnapshot } from '../../../../common/models';
import { consumeChromePointerPress } from '../../../../input/pointer/chrome_press';
import type { IdeCommandController } from '../../../../commands/controller';

export function handleTopBarPointer(commands: IdeCommandController, snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (!snapshot.valid || !snapshot.insideViewport) return false;
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	const menuOpen = editorChromeState.openMenuId !== null;
	if (!justPressed) return menuOpen || point_in_rect(x, y, editorChromeState.topBarBounds);
	const inHeader = point_in_rect(x, y, editorChromeState.topBarBounds);
	const inDropdown = menuOpen && point_in_rect(x, y, editorChromeState.menuDropdownBounds);
	if (!inHeader && !inDropdown) {
		if (menuOpen) {
			editorChromeState.openMenuId = null;
			editorChromeState.menuDropdownBounds = null;
		}
		return false;
	}
	if (inHeader) {
		const menuId = findBoundedIdAtPoint(MENU_IDS, editorChromeState.menuEntryBounds, x, y);
		if (menuId) {
			editorChromeState.openMenuId = editorChromeState.openMenuId === menuId ? null : menuId;
			consumeChromePointerPress();
			return true;
		}
		if (menuOpen) {
			editorChromeState.openMenuId = null;
			editorChromeState.menuDropdownBounds = null;
			consumeChromePointerPress();
			return true;
		}
		return false;
	}
	const command = findTopBarCommandAtPoint(editorChromeState.openMenuId!, x, y);
	if (command === null) {
		consumeChromePointerPress();
		return true;
	}
	if (commands.isEnabled(command)) {
		commands.execute(command);
		editorChromeState.openMenuId = null;
		editorChromeState.menuDropdownBounds = null;
	}
	consumeChromePointerPress();
	return true;
}

function findTopBarCommandAtPoint(menuId: MenuId, x: number, y: number): EditorCommandId | null {
	const items = TOP_BAR_MENUS[menuId].items;
	for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
		const item = items[itemIndex];
		if (item.type === 'command' && point_in_rect(x, y, item.bounds)) {
			return item.command;
		}
	}
	return null;
}

function findBoundedIdAtPoint<T extends string>(ids: readonly T[], bounds: Record<T, RectBounds>, x: number, y: number): T | null {
	for (let index = 0; index < ids.length; index += 1) {
		const id = ids[index];
		if (point_in_rect(x, y, bounds[id])) {
			return id;
		}
	}
	return null;
}
