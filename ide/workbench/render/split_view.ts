import { api } from '../../runtime/overlay_api';
import { COLOR_RESOURCE_PANEL_HIGHLIGHT, SCROLLBAR_THUMB_COLOR } from '../../common/constants';
import type { WorkbenchSplitView } from '../ui/split_view';

export function drawWorkbenchSplit(input: WorkbenchSplitView, active: boolean): void {
	const x = input.position;
	api.fill_rect(x - 1, input.bounds.top, x + 2, input.bounds.bottom, 0,
		active ? COLOR_RESOURCE_PANEL_HIGHLIGHT : SCROLLBAR_THUMB_COLOR);
}
