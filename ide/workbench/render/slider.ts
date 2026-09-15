import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import type { WorkbenchSlider } from '../ui/slider';

export function drawWorkbenchSlider(slider: WorkbenchSlider, focused: boolean): void {
	const { bounds } = slider;
	const middle = Math.round((bounds.top + bounds.bottom) / 2);
	const color = slider.interactive ? colors.COLOR_STATUS_TEXT : colors.SCROLLBAR_THUMB_COLOR;
	api.fill_rect(bounds.left + 3, middle, bounds.right - 3, middle + 1, 0, color);
	const x = slider.valueX;
	api.fill_rect(x - 2, middle - 4, x + 3, middle + 5, 0, focused ? colors.COLOR_RESOURCE_PANEL_HIGHLIGHT : color);
	api.fill_rect(x, middle - 3, x + 1, middle + 4, 0, colors.COLOR_CODE_BACKGROUND);
}
