import { api } from '../../editor/ui/view/overlay_api';
import * as constants from '../../common/constants';
import { drawEditorText } from '../../editor/render/text_renderer';
import { editorContextMenuState } from '../contrib/context_menu/state';
import {
	type CodeAreaViewportBounds,
	CONTEXT_MENU_PADDING_X,
	CONTEXT_MENU_PADDING_Y,
	layoutEditorContextMenu,
} from '../contrib/context_menu/widget';
import { editorViewState } from '../../editor/ui/view/state';
const CONTEXT_MENU_SHADOW_OFFSET = 2;
const Z_CONTEXT_MENU_SHADOW = 2199;
const Z_CONTEXT_MENU_BACKGROUND = 2200;
const Z_CONTEXT_MENU_TEXT = 2201;

export function renderEditorContextMenu(codeBounds: CodeAreaViewportBounds): void {
	const menu = editorContextMenuState;
	if (!menu.visible) {
		return;
	}
	layoutEditorContextMenu(codeBounds);
	const bounds = menu.bounds;
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
