import * as constants from '../../common/constants';
import { editorChromeState } from '../ui/chrome_state';
import { api } from '../../runtime/overlay_api';
import { TOP_BAR_MENU_ENTRIES } from '../ui/top_bar/menu';
import type { ChromeRenderContext } from './chrome_context';
import type { MenubarController } from '../ui/top_bar/controller';

const Z_TOP_BAR_BACKGROUND = 10;
const Z_MENU_BUTTON = 14;
const Z_MENU_BUTTON_TEXT = 15;
/** Chrome painting consumes layout and command presentation, without republishing either. */
export function renderTopBar(context: ChromeRenderContext, menubar: MenubarController): void {
	const bounds = editorChromeState.topBarBounds;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_TOP_BAR_BACKGROUND, constants.COLOR_TOP_BAR);
	for (const entry of TOP_BAR_MENU_ENTRIES) {
		const bounds = editorChromeState.menuEntryBounds[entry.id];
		if (bounds.right === 0) continue;
		const isOpen = menubar.activeMenu === entry.id;
		const fillColor = isOpen ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND;
		const textColor = isOpen ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_BUTTON, fillColor);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, Z_MENU_BUTTON, constants.COLOR_HEADER_BUTTON_BORDER);
		context.drawText(entry.label, bounds.left + constants.HEADER_BUTTON_PADDING_X, bounds.top + constants.HEADER_BUTTON_PADDING_Y, Z_MENU_BUTTON_TEXT, textColor);
	}
}
