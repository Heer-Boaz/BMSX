import { write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import * as constants from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import type { WorkbenchChromeLayout } from '../../common/layout';
import { editorChromeState } from '../chrome_state';
import { TOP_BAR_MENU_ENTRIES } from './menu';
import { WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH } from '../action_bar';

let labelFont: BFont | undefined;
const labelWidths = new Float64Array(TOP_BAR_MENU_ENTRIES.length);

/** Header geometry is independent of popup layout and command presentation. */
export function layoutTopBar(context: WorkbenchChromeLayout, expanded: boolean): void {
	const font = editorViewState.font.renderFont();
	const rowHeight = context.tabBarHeight;
	const buttonHeight = rowHeight - 2;
	const paddingX = constants.HEADER_BUTTON_PADDING_X;
	const menuWidth = Math.min(context.viewportWidth, Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, rowHeight));
	write_rect_bounds(editorChromeState.menuButtonBounds, 0, 0, menuWidth, rowHeight);
	let buttonX = menuWidth + constants.HEADER_BUTTON_SPACING, top = 1;
	for (let index = 0; index < TOP_BAR_MENU_ENTRIES.length; index++) {
		const entry = TOP_BAR_MENU_ENTRIES[index];
		if (labelFont !== font) labelWidths[index] = context.measureText(entry.label);
		const width = labelWidths[index] + paddingX * 2;
		if (buttonX + width > context.viewportWidth - 4 && buttonX > 4) {
			buttonX = 4; top += rowHeight;
		}
		const right = Math.max(buttonX, Math.min(context.viewportWidth - 4, buttonX + width));
		const bounds = editorChromeState.menuEntryBounds[entry.id];
		write_rect_bounds(bounds, buttonX, top, right, top + buttonHeight);
		buttonX = right + constants.HEADER_BUTTON_SPACING;
	}
	labelFont = font;
	editorChromeState.menuBarHeight = expanded ? top + rowHeight - 1 : 0;
	write_rect_bounds(editorChromeState.topBarBounds, 0, 0, context.viewportWidth, editorChromeState.menuBarHeight);
}
