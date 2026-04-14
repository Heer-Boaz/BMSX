import { clamp } from '../../../utils/clamp';
import { point_in_rect } from '../../../utils/rect_operations';
import { api } from '../../editor/ui/view/overlay_api';
import * as constants from '../../common/constants';
import { drawEditorText } from '../../editor/render/text_renderer';
import { measureText } from '../../common/text_utils';
import type { EditorContextMenuEntry, EditorContextToken } from '../../common/types';
import { editorContextMenuState, resetEditorContextMenuState } from '../contrib/context_menu/context_menu_state';
import { editorViewState } from '../../editor/ui/editor_view_state';

export type CodeAreaViewportBounds = {
	codeLeft: number;
	codeTop: number;
	codeRight: number;
	codeBottom: number;
};

const CONTEXT_MENU_PADDING_X = 6;
const CONTEXT_MENU_PADDING_Y = 1;
const CONTEXT_MENU_SHADOW_OFFSET = 2;
const Z_CONTEXT_MENU_SHADOW = 2199;
const Z_CONTEXT_MENU_BACKGROUND = 2200;
const Z_CONTEXT_MENU_TEXT = 2201;

export function openEditorContextMenu(
	anchorX: number,
	anchorY: number,
	token: EditorContextToken,
	entries: readonly EditorContextMenuEntry[],
	codeBounds: CodeAreaViewportBounds
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
	const left = clamp(
		menu.anchorX,
		codeBounds.codeLeft,
		Math.max(codeBounds.codeLeft, codeBounds.codeRight - menuWidth)
	);
	const top = clamp(
		menu.anchorY,
		codeBounds.codeTop,
		Math.max(codeBounds.codeTop, codeBounds.codeBottom - menuHeight)
	);
	const right = left + menuWidth;
	const bottom = top + menuHeight;
	menu.bounds = { left, top, right, bottom };
	menu.itemBounds.length = menu.entries.length;
	for (let index = 0; index < menu.entries.length; index += 1) {
		const itemTop = top + index * rowHeight;
		menu.itemBounds[index] = {
			left,
			top: itemTop,
			right,
			bottom: itemTop + rowHeight,
		};
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

export function renderEditorContextMenu(codeBounds: CodeAreaViewportBounds): void {
	const menu = editorContextMenuState;
	if (!menu.visible) {
		return;
	}
	layoutEditorContextMenu(codeBounds);
	const bounds = menu.bounds;
	if (!bounds) {
		return;
	}
	api.fill_rect(
		bounds.left + CONTEXT_MENU_SHADOW_OFFSET,
		bounds.top + CONTEXT_MENU_SHADOW_OFFSET,
		bounds.right + CONTEXT_MENU_SHADOW_OFFSET,
		bounds.bottom + CONTEXT_MENU_SHADOW_OFFSET,
		Z_CONTEXT_MENU_SHADOW,
		constants.COLOR_COMPLETION_DETAIL
	);
	api.fill_rect(
		bounds.left,
		bounds.top,
		bounds.right,
		bounds.bottom,
		Z_CONTEXT_MENU_BACKGROUND,
		constants.COLOR_COMPLETION_BACKGROUND
	);
	api.blit_rect(
		bounds.left,
		bounds.top,
		bounds.right,
		bounds.bottom,
		Z_CONTEXT_MENU_BACKGROUND,
		constants.COLOR_COMPLETION_BORDER
	);
	for (let index = 0; index < menu.entries.length; index += 1) {
		const entry = menu.entries[index];
		const itemBounds = menu.itemBounds[index];
		const hovered = index === menu.hoverIndex && entry.enabled;
		if (hovered) {
			api.fill_rect(
				itemBounds.left + 1,
				itemBounds.top + 1,
				itemBounds.right - 1,
				itemBounds.bottom - 1,
				Z_CONTEXT_MENU_BACKGROUND,
				constants.COLOR_COMPLETION_HIGHLIGHT
			);
		}
		const textColor = entry.enabled
			? (hovered ? constants.COLOR_COMPLETION_HIGHLIGHT_TEXT : constants.COLOR_COMPLETION_TEXT)
			: constants.COLOR_COMPLETION_DETAIL;
		drawEditorText(
			editorViewState.font,
			entry.label,
			itemBounds.left + CONTEXT_MENU_PADDING_X,
			itemBounds.top + CONTEXT_MENU_PADDING_Y,
			Z_CONTEXT_MENU_TEXT,
			textColor
		);
	}
}
