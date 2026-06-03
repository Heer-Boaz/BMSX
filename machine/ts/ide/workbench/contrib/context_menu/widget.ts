import { clamp } from '../../../../common/clamp';
import { create_rect_bounds, point_in_rect } from '../../../../common/rect';
import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { EditorContextMenuEntry, EditorContextToken } from '../../../common/models';
import { editorContextMenuState, resetEditorContextMenuState } from './state';
import type { RectBounds } from '../../../../rompack/format';

export type CodeAreaViewportBounds = {
	codeLeft: number;
	codeTop: number;
	codeRight: number;
	codeBottom: number;
};

export const CONTEXT_MENU_PADDING_X = 6;
export const CONTEXT_MENU_PADDING_Y = 1;

let contextMenuLayoutEntries: readonly EditorContextMenuEntry[] = null;
let contextMenuLayoutAnchorX = -1;
let contextMenuLayoutAnchorY = -1;
let contextMenuLayoutCodeLeft = -1;
let contextMenuLayoutCodeTop = -1;
let contextMenuLayoutCodeRight = -1;
let contextMenuLayoutCodeBottom = -1;
let contextMenuLayoutLineHeight = -1;
let contextMenuLayoutFontVariant: unknown = null;

function getContextMenuItemBounds(index: number): RectBounds {
	let bounds = editorContextMenuState.itemBounds[index];
	if (!bounds) {
		bounds = create_rect_bounds();
		editorContextMenuState.itemBounds[index] = bounds;
	}
	return bounds;
}

function isContextMenuLayoutCurrent(codeBounds: CodeAreaViewportBounds): boolean {
	const menu = editorContextMenuState;
	return contextMenuLayoutEntries === menu.entries
		&& contextMenuLayoutAnchorX === menu.anchorX
		&& contextMenuLayoutAnchorY === menu.anchorY
		&& contextMenuLayoutCodeLeft === codeBounds.codeLeft
		&& contextMenuLayoutCodeTop === codeBounds.codeTop
		&& contextMenuLayoutCodeRight === codeBounds.codeRight
		&& contextMenuLayoutCodeBottom === codeBounds.codeBottom
		&& contextMenuLayoutLineHeight === editorViewState.lineHeight
		&& contextMenuLayoutFontVariant === editorViewState.fontVariant;
}

function markContextMenuLayoutCurrent(codeBounds: CodeAreaViewportBounds): void {
	const menu = editorContextMenuState;
	contextMenuLayoutEntries = menu.entries;
	contextMenuLayoutAnchorX = menu.anchorX;
	contextMenuLayoutAnchorY = menu.anchorY;
	contextMenuLayoutCodeLeft = codeBounds.codeLeft;
	contextMenuLayoutCodeTop = codeBounds.codeTop;
	contextMenuLayoutCodeRight = codeBounds.codeRight;
	contextMenuLayoutCodeBottom = codeBounds.codeBottom;
	contextMenuLayoutLineHeight = editorViewState.lineHeight;
	contextMenuLayoutFontVariant = editorViewState.fontVariant;
}

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
	menu.itemCount = entries.length;
	contextMenuLayoutEntries = null;
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
	if (isContextMenuLayoutCurrent(codeBounds)) {
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
	bounds.left = left;
	bounds.top = top;
	bounds.right = right;
	bounds.bottom = bottom;
	menu.itemCount = menu.entries.length;
	for (let index = 0; index < menu.entries.length; index += 1) {
		const itemTop = top + index * rowHeight;
		const itemBounds = getContextMenuItemBounds(index);
		itemBounds.left = left;
		itemBounds.top = itemTop;
		itemBounds.right = right;
		itemBounds.bottom = itemTop + rowHeight;
	}
	markContextMenuLayoutCurrent(codeBounds);
}

export function findEditorContextMenuEntryAt(x: number, y: number): number {
	const menu = editorContextMenuState;
	const bounds = menu.bounds;
	if (!menu.visible || !point_in_rect(x, y, bounds)) {
		return -1;
	}
	for (let index = 0; index < menu.itemCount; index += 1) {
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
