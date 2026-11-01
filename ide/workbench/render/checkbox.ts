import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import type { WorkbenchCheckboxControl, WorkbenchCheckboxInput } from '../ui/checkbox_control';
import { WORKBENCH_ICON_SIZE } from '../ui/icon';
import { drawWorkbenchIcon } from './icon';

/** Paint consumes retained geometry and producer state; it never edits a boolean. */
export function drawWorkbenchCheckbox<Input extends WorkbenchCheckboxInput>(control: WorkbenchCheckboxControl<Input>): void {
	const input = control.input; if (input === undefined || control.font === undefined) return;
	const { clip, box, bounds } = control;
	const ink = input.enabled ? colors.COLOR_INPUT_TEXT : colors.COLOR_HEADER_BUTTON_TEXT_DISABLED;
	api.pushClipRect(clip.left, clip.top, clip.right, clip.bottom);
	api.fill_rect(box.left, box.top, box.right, box.bottom, 0, !input.enabled ? colors.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND
		: control.pressed ? colors.COLOR_HEADER_BUTTON_PRESSED_BACKGROUND : colors.COLOR_INPUT_BACKGROUND);
	api.blit_rect(box.left, box.top, box.right, box.bottom, 0, input.enabled && control.hovered ? colors.COLOR_FOCUS_BORDER : colors.COLOR_INPUT_OUTLINE);
	if (input.checked) drawWorkbenchIcon('accept', box.left + Math.trunc((box.right - box.left - WORKBENCH_ICON_SIZE) / 2),
		box.top + Math.trunc((box.bottom - box.top - WORKBENCH_ICON_SIZE) / 2), ink);
	api.blit_text_inline_with_font(control.label, control.labelX, control.labelY, 0, ink, control.font.renderFont());
	if (control.focusTarget.hasFocus) api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_FOCUS_BORDER);
	api.popClipRect();
}
