import * as constants from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import type { ValueInput } from '../../../editor/ui/inline/value_input';
import { drawValueInput } from '../../../editor/ui/inline/value_input_render';
import { api } from '../../../runtime/overlay_api';
import type { SceneDetailsViewState } from './details_view';
import type { ScenePositionInputValue } from './details_control';
import type { SceneOptionInputValue } from './option_editor';

const POSITION_LABELS = { x: 'X', y: 'Y', z: 'Z' } as const;

export function drawSceneDetails(view: SceneDetailsViewState, controls: readonly ValueInput<ScenePositionInputValue>[],
	optionControls: readonly ValueInput<SceneOptionInputValue>[], focused: boolean): void {
	const { viewport, layout } = view, bounds = viewport.bounds;
	const font = editorViewState.font.renderFont(), color = constants.COLOR_RESOURCE_VIEWER_TEXT;
	api.pushClipRect(layout.left, layout.top, layout.right, layout.bottom);
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, constants.COLOR_RESOURCE_VIEWER_BACKGROUND);
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	for (const line of view.detailsText) {
		const top = viewport.offsetTop + line.top;
		if (top + font.lineHeight <= bounds.top || top >= bounds.bottom) continue;
		api.blit_text_inline_with_font(line.text, bounds.left + 4, top, 0, line.warning ? constants.COLOR_CONTENT_WARNING_TEXT : color, font);
	}
	for (let index = 0; index < view.properties.length; index++) {
		const property = view.properties[index];
		if (property.bounds.bottom <= bounds.top || property.bounds.top >= bounds.bottom) continue;
		api.blit_text_inline_with_font(POSITION_LABELS[property.descriptor.axis], bounds.left + 4, property.bounds.top + 2, 0, color, font);
		if (!controls[index].field.readOnly) drawValueInput(controls[index], property.bounds);
		else api.blit_text_inline_with_font(property.text, property.bounds.left + 3, property.bounds.top + 2, 0, constants.COLOR_DESCRIPTION_TEXT, font);
	}
	for (let index = 0; index < view.optionProperties.length; index++) {
		const property = view.optionProperties[index];
		if (property.bounds.bottom <= bounds.top || property.bounds.top >= bounds.bottom) continue;
		if (!optionControls[index].field.readOnly) drawValueInput(optionControls[index], property.bounds);
		else api.blit_text_inline_with_font(property.text, property.bounds.left + 3, property.bounds.top + 2, 0, constants.COLOR_DESCRIPTION_TEXT, font);
	}
	api.popClipRect();
	viewport.scrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	if (focused) api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_PROBLEMS_PANEL_SELECTION_BORDER);
	api.popClipRect();
}
