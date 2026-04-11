import { clamp } from '../../utils/clamp';
import { point_in_rect } from '../../utils/rect_operations';
import { api } from '../ui/view/overlay_api';
import * as constants from '../core/constants';
import { ide_state } from '../core/ide_state';
import { drawEditorText } from './text_renderer';
import { measureText } from '../core/text_utils';
import type { EditorContextMenuEntry, EditorContextToken } from '../core/types';

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
	const menu = ide_state.contextMenu;
	menu.visible = true;
	menu.anchorX = anchorX;
	menu.anchorY = anchorY;
	menu.token = token;
	menu.entries = entries.slice();
	menu.hoverIndex = -1;
	layoutEditorContextMenu(codeBounds);
}

export function closeEditorContextMenu(): void {
	const menu = ide_state.contextMenu;
	menu.visible = false;
	menu.token = null;
	menu.entries = [];
	menu.hoverIndex = -1;
	menu.bounds = null;
	menu.itemBounds = [];
}

export function layoutEditorContextMenu(codeBounds: CodeAreaViewportBounds): void {
	const menu = ide_state.contextMenu;
	if (!menu.visible || menu.entries.length === 0) {
		closeEditorContextMenu();
		return;
	}
	const rowHeight = ide_state.lineHeight + CONTEXT_MENU_PADDING_Y * 2;
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
	const menu = ide_state.contextMenu;
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
	ide_state.contextMenu.hoverIndex = index;
	return index;
}

export function renderEditorContextMenu(codeBounds: CodeAreaViewportBounds): void {
	const menu = ide_state.contextMenu;
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
			ide_state.font,
			entry.label,
			itemBounds.left + CONTEXT_MENU_PADDING_X,
			itemBounds.top + CONTEXT_MENU_PADDING_Y,
			Z_CONTEXT_MENU_TEXT,
			textColor
		);
	}
}
