import { clamp } from '../../../../common/clamp';
import { point_in_rect } from '../../../../common/rect_operations';
import { measureText } from '../../../editor/common/text_layout';
import { editorViewState } from '../../../editor/ui/editor_view_state';
import type { EditorContextMenuEntry, EditorContextToken } from '../../../common/types';
import { editorContextMenuState, resetEditorContextMenuState } from './context_menu_state';

export type CodeAreaViewportBounds = {
	codeLeft: number;
	codeTop: number;
	codeRight: number;
	codeBottom: number;
};

export const CONTEXT_MENU_PADDING_X = 6;
export const CONTEXT_MENU_PADDING_Y = 1;

export function openEditorContextMenu(
	anchorX: number,
	anchorY: number,
	token: EditorContextToken,
	entries: readonly EditorContextMenuEntry[],
	codeBounds: CodeAreaViewportBounds,
): void {
	const menu = editorContextMenuState;
	menu.visible = true;
	menu.anchorX = anchorX;
	menu.anchorY = anchorY;
	menu.token = token;
	menu.entries = entries;
	menu.hoverIndex = -1;
	layoutEditorContextMenu(codeBounds);
}

export function closeEditorContextMenu(): void {
	resetEditorContextMenuState();
}

export function layoutEditorContextMenu(codeBounds: CodeAreaViewportBounds): void {
	const menu = editorContextMenuState;
	if (!menu.visible || menu.entries.length === 0) {
		closeEditorContextMenu();
		return;
	}
	const rowHeight = editorViewState.lineHeight + CONTEXT_MENU_PADDING_Y * 2;
	let menuWidth = 0;
	for (let index = 0; index < menu.entries.length; index += 1) {
		const width = measureText(menu.entries[index].label);
		if (width > menuWidth) {
			menuWidth = width;
		}
	}
	menuWidth += CONTEXT_MENU_PADDING_X * 2;
	const menuHeight = rowHeight * menu.entries.length;
	const left = clamp(menu.anchorX, codeBounds.codeLeft, Math.max(codeBounds.codeLeft, codeBounds.codeRight - menuWidth));
	const top = clamp(menu.anchorY, codeBounds.codeTop, Math.max(codeBounds.codeTop, codeBounds.codeBottom - menuHeight));
	const right = left + menuWidth;
	const bottom = top + menuHeight;
	const bounds = menu.bounds;
	if (bounds) {
		bounds.left = left;
		bounds.top = top;
		bounds.right = right;
		bounds.bottom = bottom;
	} else {
		menu.bounds = { left, top, right, bottom };
	}
	menu.itemBounds.length = menu.entries.length;
	for (let index = 0; index < menu.entries.length; index += 1) {
		const itemTop = top + index * rowHeight;
		const itemBounds = menu.itemBounds[index];
		if (itemBounds) {
			itemBounds.left = left;
			itemBounds.top = itemTop;
			itemBounds.right = right;
			itemBounds.bottom = itemTop + rowHeight;
		} else {
			menu.itemBounds[index] = {
				left,
				top: itemTop,
				right,
				bottom: itemTop + rowHeight,
			};
		}
	}
}

export function findEditorContextMenuEntryAt(x: number, y: number): number {
	const menu = editorContextMenuState;
	const bounds = menu.bounds;
	if (!menu.visible || !bounds || !point_in_rect(x, y, bounds)) {
		return -1;
	}
	for (let index = 0; index < menu.itemBounds.length; index += 1) {
		if (point_in_rect(x, y, menu.itemBounds[index])) {
			return index;
		}
	}
	return -1;
}

export function updateEditorContextMenuHover(x: number, y: number): number {
	const index = findEditorContextMenuEntryAt(x, y);
	editorContextMenuState.hoverIndex = index;
	return index;
}
