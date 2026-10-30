import * as constants from '../../../common/constants';
import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import type { ContextMenuController } from './controller';
import { CONTEXT_MENU_PADDING } from './model';
import { drawWorkbenchSurfaceShadow } from '../../render/surface';

export function layoutContextMenu(menu: ContextMenuController): void {
	if (!menu.visible) return;
	const view = editorViewState;
	menu.model.layout(menu.presentationBounds, view.lineHeight, view.font, measureText);
}

export function drawContextMenu(menu: ContextMenuController): void {
	if (!menu.visible) return;
	const model = menu.model;
	const bounds = model.bounds;
	drawWorkbenchSurfaceShadow(bounds);
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_MENU_BACKGROUND);
	api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_MENU_BORDER);
	const view = model.viewport;
	const font = editorViewState.font.renderFont();
	api.pushClipRect(view.bounds.left, view.bounds.top, view.bounds.right, view.bounds.bottom);
	for (let index = 0; index < model.rows.length; index += 1) {
		const row = model.rows[index];
		const top = view.offsetTop + row.top;
		const bottom = view.offsetTop + row.bottom;
		if (bottom <= view.bounds.top || top >= view.bounds.bottom) continue;
		if (row.command === undefined) {
			api.fill_rect(view.bounds.left + CONTEXT_MENU_PADDING, top + 2, view.bounds.right - CONTEXT_MENU_PADDING, top + 3, 0, constants.COLOR_MENU_BORDER);
			continue;
		}
		const selected = index === model.selectedIndex && row.enabled;
		if (selected) api.fill_rect(view.bounds.left, top, view.bounds.right, bottom, 0, constants.COLOR_MENU_SELECTION_BACKGROUND);
		const markerSize = Math.max(editorViewState.lineHeight >> 1, 2);
		if (row.active) api.fill_rect(view.bounds.left + CONTEXT_MENU_PADDING, top + ((model.rowHeight - markerSize) >> 1),
			view.bounds.left + CONTEXT_MENU_PADDING + markerSize, top + ((model.rowHeight - markerSize) >> 1) + markerSize, 0,
			!row.enabled ? constants.COLOR_DISABLED_TEXT : selected ? constants.COLOR_MENU_SELECTION_TEXT : constants.COLOR_MENU_TEXT);
		api.blit_text_inline_with_font(row.label, view.bounds.left + CONTEXT_MENU_PADDING * 2 + markerSize, top + 2, 0,
			!row.enabled ? constants.COLOR_DISABLED_TEXT : selected ? constants.COLOR_MENU_SELECTION_TEXT : constants.COLOR_MENU_TEXT, font);
		if (row.keybinding !== undefined) api.blit_text_inline_with_font(row.keybinding,
			view.bounds.right - CONTEXT_MENU_PADDING - row.keybindingWidth, top + 2, 0,
			!row.enabled ? constants.COLOR_DISABLED_TEXT : selected ? constants.COLOR_MENU_SELECTION_TEXT : constants.COLOR_MENU_TEXT, font);
	}
	api.popClipRect();
	if (view.scrollbar.isVisible()) view.scrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
}
