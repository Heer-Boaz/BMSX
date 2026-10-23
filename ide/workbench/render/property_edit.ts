import type { RectBounds } from '../../../machine/ts/common/rect';
import type { ValueInput } from '../../editor/ui/inline/value_input';
import { drawValueInput } from '../../editor/ui/inline/value_input_render';
import { editorViewState } from '../../editor/ui/view/state';
import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import { drawWorkbenchSurfaceShadow } from './surface';

/** A source-bound value editor is an opaque transient, not a clipped property-cell overpaint. */
export function drawWorkbenchPropertyEdit<Value>(control: ValueInput<Value>, bounds: Readonly<RectBounds>, field: RectBounds, caption: string): void {
	drawWorkbenchSurfaceShadow(bounds);
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_WINDOW_BACKGROUND);
	api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_FOCUS_BORDER);
	api.pushClipRect(bounds.left + 1, bounds.top + 1, bounds.right - 1, bounds.bottom - 1);
	api.blit_text_inline_with_font(caption, bounds.left + 4, bounds.top + 3, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, editorViewState.font.renderFont());
	drawValueInput(control, field);
	api.popClipRect();
}
