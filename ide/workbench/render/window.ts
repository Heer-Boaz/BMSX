import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import type { WorkbenchActionBarState } from '../ui/action_bar';
import type { WorkbenchWindowModel } from '../ui/window/model';
import { renderWorkbenchActionBar } from './action_bar';

/** Opaque window chrome consumes retained geometry and the existing theme/font. */
export function drawWorkbenchWindow(model: WorkbenchWindowModel, actions: WorkbenchActionBarState, active: boolean): void {
	const bounds = model.bounds, header = model.header, font = model.font!;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	api.fill_rect(header.left, header.top, header.right, header.bottom, 0,
		active ? colors.COLOR_TAB_ACTIVE_BACKGROUND : colors.COLOR_TAB_INACTIVE_BACKGROUND);
	api.pushClipRect(header.left, header.top, header.right, header.bottom);
	api.blit_text_inline_with_font(model.displayTitle, header.left + 4, header.top + 4, 0,
		active ? colors.COLOR_TAB_ACTIVE_TEXT : colors.COLOR_TAB_INACTIVE_TEXT, font);
	renderWorkbenchActionBar(actions, font);
	api.popClipRect();
	api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, active ? colors.COLOR_FOCUS_BORDER : colors.COLOR_TAB_BORDER);
	if (!model.collapsed) {
		api.fill_rect(bounds.right - 5, bounds.bottom - 2, bounds.right - 2, bounds.bottom - 1, 0, colors.COLOR_TAB_BORDER);
		api.fill_rect(bounds.right - 3, bounds.bottom - 4, bounds.right - 2, bounds.bottom - 2, 0, colors.COLOR_TAB_BORDER);
	}
}
