import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import type { EditorCommandEnablement } from '../../common/commands';
import * as constants from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import {
	WORKBENCH_ACTION_BAR_ITEM_PADDING_X,
	type WorkbenchActionBarState,
} from '../ui/action_bar';

export function renderWorkbenchActionBar(
	state: WorkbenchActionBarState,
	commands: EditorCommandEnablement,
	font: BFont,
): void {
	for (let index = 0; index < state.items.length; index += 1) {
		const item = state.items[index];
		const enabled = commands.isEnabled(item.command);
		const hovered = state.hoveredCommand === item.command;
		const pressed = state.pressedCommand === item.command;
		const focused = state.hasFocus && state.focusedIndex === index;
		const background = !enabled
			? constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND
			: pressed ? constants.COLOR_HEADER_BUTTON_PRESSED_BACKGROUND
			: (hovered
				? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND
				: constants.COLOR_HEADER_BUTTON_BACKGROUND);
		const textColor = !enabled
			? constants.COLOR_HEADER_BUTTON_TEXT_DISABLED
			: pressed ? constants.COLOR_HEADER_BUTTON_PRESSED_TEXT
			: (hovered
				? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT
				: constants.COLOR_HEADER_BUTTON_TEXT);
		api.fill_rect(
			item.bounds.left,
			item.bounds.top,
			item.bounds.right,
			item.bounds.bottom,
			0,
			background,
		);
		api.blit_rect(
			item.bounds.left,
			item.bounds.top,
			item.bounds.right,
			item.bounds.bottom,
			0,
			constants.COLOR_HEADER_BUTTON_BORDER,
		);
		api.blit_text_inline_span_with_font(
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
