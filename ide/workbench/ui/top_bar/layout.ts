import { clear_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import * as constants from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import type { WorkbenchChromeLayout } from '../../common/layout';
import { editorChromeState } from '../chrome_state';
import { TOP_BAR_MENU_ENTRIES } from './menu';

let labelFont: BFont | undefined;
const labelWidths = new Float64Array(TOP_BAR_MENU_ENTRIES.length);

/** Header geometry is independent of popup layout and command presentation. */
export function layoutTopBar(context: WorkbenchChromeLayout): void {
	const font = editorViewState.font.renderFont();
	write_rect_bounds(editorChromeState.topBarBounds, 0, 0, context.viewportWidth, context.headerHeight);
	const buttonHeight = context.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	const paddingX = constants.HEADER_BUTTON_PADDING_X;
	let buttonX = 4;
	for (let index = 0; index < TOP_BAR_MENU_ENTRIES.length; index++) {
		const entry = TOP_BAR_MENU_ENTRIES[index];
		if (labelFont !== font) labelWidths[index] = context.measureText(entry.label);
		const right = buttonX + labelWidths[index] + paddingX * 2;
		const bounds = editorChromeState.menuEntryBounds[entry.id];
		if (right > context.viewportWidth - 4) { clear_rect_bounds(bounds); continue; }
		write_rect_bounds(bounds, buttonX, 1, right, 1 + buttonHeight);
		buttonX = right + constants.HEADER_BUTTON_SPACING;
	}
	labelFont = font;
}
