import { resolveContextMenuToken } from '../../../editor/contrib/intellisense/engine';
import { getCodeAreaBounds, resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { PointerSnapshot } from '../../../common/models';
import { buildEditorContextMenuEntries } from '../../../workbench/contrib/context_menu/entries';
import { editorContextMenuState } from '../../../workbench/contrib/context_menu/state';
import { closeEditorContextMenu, findEditorContextMenuEntryAt, layoutEditorContextMenu, openEditorContextMenu, updateEditorContextMenuHover } from '../../../workbench/contrib/context_menu/widget';
import { executeEditorContextMenuAction } from '../../../workbench/contrib/context_menu/actions';
import { isEditableCodeTab } from '../../../workbench/ui/code_tab/contexts';
import type { Runtime } from '../../../../machine/runtime/runtime';

export const CONTEXT_MENU_POINTER_IGNORED = 0;
export const CONTEXT_MENU_POINTER_HANDLED = 1;
export const CONTEXT_MENU_POINTER_CONSUME_PRIMARY = 2;
export const CONTEXT_MENU_POINTER_CONSUME_SECONDARY = 3;

export function handleEditorContextMenuPointerSession(runtime: Runtime, snapshot: PointerSnapshot, justPressed: boolean, secondaryJustPressed: boolean): number {
	const menu = editorContextMenuState;
	if (!menu.visible) {
		return CONTEXT_MENU_POINTER_IGNORED;
	}
	layoutEditorContextMenu(getCodeAreaBounds());
	if (!snapshot.valid || !snapshot.insideViewport) {
		menu.hoverIndex = -1;
		return CONTEXT_MENU_POINTER_IGNORED;
	}
	updateEditorContextMenuHover(snapshot.viewportX, snapshot.viewportY);
	if (!justPressed && !secondaryJustPressed) {
		return CONTEXT_MENU_POINTER_IGNORED;
	}
	const hitIndex = findEditorContextMenuEntryAt(snapshot.viewportX, snapshot.viewportY);
	if (hitIndex < 0) {
		closeEditorContextMenu();
		return CONTEXT_MENU_POINTER_IGNORED;
	}
	const entry = menu.entries[hitIndex];
	const token = menu.token!;
	closeEditorContextMenu();
	if (secondaryJustPressed) {
		return CONTEXT_MENU_POINTER_CONSUME_SECONDARY;
	}
	if (!entry.enabled) {
		return CONTEXT_MENU_POINTER_HANDLED;
	}
	executeEditorContextMenuAction(runtime, entry.action, token);
	return CONTEXT_MENU_POINTER_CONSUME_PRIMARY;
}

export function openEditorContextMenuAtPointer(runtime: Runtime, snapshot: PointerSnapshot): boolean {
	const bounds = getCodeAreaBounds();
	const target = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
	const token = resolveContextMenuToken(target.row, target.column);
	if (!token) {
		return false;
	}
	const entries = buildEditorContextMenuEntries(runtime, token, isEditableCodeTab());
	if (entries.length === 0) {
		return false;
	}
	openEditorContextMenu(
		snapshot.viewportX,
		snapshot.viewportY,
		token,
		entries,
		bounds
	);
	updateEditorContextMenuHover(snapshot.viewportX, snapshot.viewportY);
	return true;
}
