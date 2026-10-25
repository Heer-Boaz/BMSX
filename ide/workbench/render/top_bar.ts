import * as constants from '../../common/constants';
import { editorChromeState } from '../ui/chrome_state';
import { api } from '../../runtime/overlay_api';
import { TOP_BAR_MENU_ENTRIES } from '../ui/top_bar/menu';
import type { ChromeRenderContext } from './chrome_context';
import type { MenubarController } from '../ui/top_bar/controller';
import { drawWorkbenchIcon } from './icon';
import { WORKBENCH_ICON_SIZE } from '../ui/icon';

/** Chrome painting consumes layout and command presentation, without republishing either. */
export function renderTopBar(context: ChromeRenderContext, menubar: MenubarController): void {
	const bounds = editorChromeState.topBarBounds;
	if (menubar.expanded) api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_TOP_BAR);
	const button = editorChromeState.menuButtonBounds;
	const active = menubar.expanded || menubar.hovered;
	api.fill_rect(button.left, button.top, button.right, button.bottom, 0,
		active ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND);
	api.blit_rect(button.left, button.top, button.right, button.bottom, 0, constants.COLOR_HEADER_BUTTON_BORDER);
	drawWorkbenchIcon('menu', button.left + ((button.right - button.left - WORKBENCH_ICON_SIZE) >> 1),
		button.top + ((button.bottom - button.top - WORKBENCH_ICON_SIZE) >> 1),
		active ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT);
	if (!menubar.expanded) return;
	for (const entry of TOP_BAR_MENU_ENTRIES) {
		const bounds = editorChromeState.menuEntryBounds[entry.id];
		const isOpen = menubar.activeMenu === entry.id;
		const fillColor = isOpen ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.COLOR_TOP_BAR;
		const textColor = isOpen ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, fillColor);
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		context.drawText(entry.label, bounds.left + constants.HEADER_BUTTON_PADDING_X, bounds.top + constants.HEADER_BUTTON_PADDING_Y, 0, textColor);
		api.popClipRect();
	}
}
