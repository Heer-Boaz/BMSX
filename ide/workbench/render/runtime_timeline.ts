import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import type { WorkbenchActionBarState } from '../ui/action_bar';
import type { RuntimeTimelineLayout } from '../ui/runtime_timeline';
import type { WorkbenchSlider } from '../ui/slider';
import { renderWorkbenchActionBar } from './action_bar';
import { drawWorkbenchSlider } from './slider';

export function drawRuntimeTimeline(layout: RuntimeTimelineLayout, actions: WorkbenchActionBarState,
	range: WorkbenchSlider, focused: boolean, font: BFont): void {
	const bounds = layout.bounds;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_STATUS_BACKGROUND);
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.top + 1, 0, colors.COLOR_TAB_BORDER);
	renderWorkbenchActionBar(actions, font);
	drawWorkbenchSlider(range, focused);
	if (layout.positionLabel !== '') api.blit_text_inline_with_font(layout.positionLabel, layout.positionLeft,
		bounds.top + ((bounds.bottom - bounds.top - font.lineHeight) >> 1), 0, colors.COLOR_STATUS_TEXT, font);
}
