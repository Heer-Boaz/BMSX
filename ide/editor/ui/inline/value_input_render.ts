import type { RectBounds } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { drawSingleLineField } from './single_line_render';
import type { ValueInput } from './value_input';

/** An optional reading presentation never replaces the exact editable draft. */
export function drawValueInput<Value>(input: ValueInput<Value>, bounds: RectBounds, displayText?: string): void {
	const invalid = input.error.length > 0;
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_INPUT_BACKGROUND);
	api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0,
		invalid ? constants.COLOR_CONTENT_ERROR_TEXT : input.field.focusTarget.hasFocus
			? constants.COLOR_FOCUS_BORDER : constants.COLOR_INPUT_OUTLINE);
	const color = invalid ? constants.COLOR_CONTENT_ERROR_TEXT : constants.COLOR_INPUT_TEXT;
	if (displayText !== undefined && !input.field.focusTarget.hasFocus) {
		const view = input.viewport, clip = view.clipBounds;
		api.pushClipRect(clip.left, clip.top, clip.right, clip.bottom);
		api.blit_text_inline_with_font(displayText, view.textLeft, view.textTop, 0, color, view.renderFont.renderFont());
		api.popClipRect();
	} else drawSingleLineField(input.field, input.viewport, color);
}
