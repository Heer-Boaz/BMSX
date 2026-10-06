import { api } from '../../runtime/overlay_api';
import { COLOR_RESOURCE_PANEL_HIGHLIGHT, SCROLLBAR_THUMB_COLOR } from '../../common/constants';
import type { WorkbenchSplitView } from '../ui/split_view';

export function drawWorkbenchSplit(input: WorkbenchSplitView, active: boolean): void {
	const position = input.position, color = active ? COLOR_RESOURCE_PANEL_HIGHLIGHT : SCROLLBAR_THUMB_COLOR;
	if (input.orientation === 'horizontal') api.fill_rect(position - 1, input.bounds.top, position + 2, input.bounds.bottom, 0, color);
	else api.fill_rect(input.bounds.left, position - 1, input.bounds.right, position + 2, 0, color);
}
