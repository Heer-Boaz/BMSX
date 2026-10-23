import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import * as constants from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import {
	WORKBENCH_ACTION_BAR_ITEM_PADDING_X,
	type WorkbenchActionBarState,
} from '../ui/action_bar';
import { WORKBENCH_ICON_SIZE } from '../ui/icon';
import { drawWorkbenchIcon } from './icon';

export function renderWorkbenchActionBar(
	state: WorkbenchActionBarState,
	font: BFont,
	foreground = constants.COLOR_HEADER_BUTTON_TEXT,
): void {
	for (let index = 0; index < state.items.length; index += 1) {
		const item = state.items[index];
		if (!item.visible) continue;
		const enabled = item.enabled;
		const hovered = state.hoveredCommand === item.command;
		const pressed = state.pressedCommand === item.command || item.checked;
		const focused = state.hasFocus && state.focusedIndex === index;
		const highlighted = hovered || focused;
		const background = !enabled
			? constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND
			: pressed ? constants.COLOR_HEADER_BUTTON_PRESSED_BACKGROUND
			: (highlighted
				? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND
				: constants.COLOR_HEADER_BUTTON_BACKGROUND);
		const textColor = !enabled
			? constants.COLOR_HEADER_BUTTON_TEXT_DISABLED
			: pressed ? constants.COLOR_HEADER_BUTTON_PRESSED_TEXT
			: (highlighted
				? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT
				: foreground);
		if (item.icon === undefined || hovered || pressed || focused) api.fill_rect(
			item.bounds.left,
			item.bounds.top,
			item.bounds.right,
			item.bounds.bottom,
			0,
			background,
		);
		if (item.icon === undefined) api.blit_rect(
			item.bounds.left,
			item.bounds.top,
			item.bounds.right,
			item.bounds.bottom,
			0,
			constants.COLOR_HEADER_BUTTON_BORDER,
		);
		if (item.icon !== undefined) drawWorkbenchIcon(item.checked && item.checkedIcon !== undefined ? item.checkedIcon : item.icon,
			item.bounds.left + ((item.bounds.right - item.bounds.left - WORKBENCH_ICON_SIZE) >> 1),
			item.bounds.top + ((item.bounds.bottom - item.bounds.top - WORKBENCH_ICON_SIZE) >> 1), textColor);
		else api.blit_text_inline_span_with_font(
			item.label,
			0,
			item.label.length,
			item.bounds.left + WORKBENCH_ACTION_BAR_ITEM_PADDING_X,
			item.bounds.top + 1,
			0,
			textColor,
			font,
		);
		if (focused) api.fill_rect(item.bounds.left + 2, item.bounds.bottom - 2,
			item.bounds.right - 2, item.bounds.bottom - 1, 0, textColor);
	}
}
