import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { WorkbenchActionBarState } from '../action_bar';
import type { WorkbenchViewPanelLayout } from './layout';

export function drawWorkbenchViewPanel(layout: WorkbenchViewPanelLayout, actions: WorkbenchActionBarState, active: boolean): void {
	const font = editorViewState.font.renderFont();
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	api.blit_text_inline_with_font(layout.title, layout.titleBounds.left, layout.titleBounds.top + 2, 0,
		active ? colors.COLOR_RESOURCE_VIEWER_TEXT : colors.COLOR_DESCRIPTION_TEXT, font);
	renderWorkbenchActionBar(actions, font, colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
	api.fill_rect(layout.header.left, layout.header.bottom - 1, layout.header.right, layout.header.bottom, 0, colors.COLOR_HEADER_BUTTON_BORDER);
}
