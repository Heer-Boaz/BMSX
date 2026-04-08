import { ide_state } from '../../core/ide_state';
import { isEditableCodeTab } from '../../ui/editor_tabs';
import { resolveContextMenuToken } from '../../contrib/intellisense/intellisense';
import { buildEditorContextMenuEntries } from '../../contrib/context_menu/editor_context_menu_entries';
import { getCodeAreaBounds, resolvePointerColumn, resolvePointerRow } from '../../ui/editor_view';
import { closeEditorContextMenu, findEditorContextMenuEntryAt, layoutEditorContextMenu, openEditorContextMenu, updateEditorContextMenuHover } from '../../render/render_context_menu';
import { executeEditorContextMenuAction } from '../../contrib/context_menu/editor_context_menu_actions';
import type { PointerSnapshot } from '../../core/types';

export const CONTEXT_MENU_POINTER_IGNORED = 0;
export const CONTEXT_MENU_POINTER_HANDLED = 1;
export const CONTEXT_MENU_POINTER_CONSUME_PRIMARY = 2;
export const CONTEXT_MENU_POINTER_CONSUME_SECONDARY = 3;

export function handleEditorContextMenuPointerSession(snapshot: PointerSnapshot, justPressed: boolean, secondaryJustPressed: boolean): number {
	const menu = ide_state.contextMenu;
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
	executeEditorContextMenuAction(entry.action, token);
	return CONTEXT_MENU_POINTER_CONSUME_PRIMARY;
}

export function openEditorContextMenuAtPointer(snapshot: PointerSnapshot): boolean {
	const targetRow = resolvePointerRow(snapshot.viewportY);
	const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
	const token = resolveContextMenuToken(targetRow, targetColumn);
	if (!token) {
		return false;
	}
	const entries = buildEditorContextMenuEntries(token, isEditableCodeTab());
	if (entries.length === 0) {
		return false;
	}
	openEditorContextMenu(
		snapshot.viewportX,
		snapshot.viewportY,
		token,
		entries,
		getCodeAreaBounds()
	);
	updateEditorContextMenuHover(snapshot.viewportX, snapshot.viewportY);
	return true;
}
