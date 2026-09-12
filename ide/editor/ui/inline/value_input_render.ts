import type { RectBounds } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { drawSingleLineField } from './single_line_render';
import type { ValueInput } from './value_input';

export function drawValueInput<Value>(input: ValueInput<Value>, bounds: RectBounds): void {
	const invalid = input.error.length > 0;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_CODE_BACKGROUND);
	api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0,
		invalid ? constants.COLOR_STATUS_ERROR : input.field.focusTarget.hasFocus
			? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_BORDER);
	input.layout(bounds.right - bounds.left);
	drawSingleLineField(input.field, input.viewport, bounds, invalid ? constants.COLOR_STATUS_ERROR : constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT);
}
