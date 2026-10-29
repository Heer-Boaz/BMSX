import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { SceneEditorViewState } from './view_state';

/** Shared composition chrome; each client paints through its own renderer and clip. */
export function drawSceneEditor(input: SceneEditorViewState): void {
	const { layout } = input, font = editorViewState.font.renderFont(), rowHeight = layout.rowHeight + 4;
	const color = colors.COLOR_RESOURCE_VIEWER_TEXT;
	api.pushClipRect(layout.left, layout.top, layout.right, layout.bottom);
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	api.blit_text_inline_with_font(input.sourceText, layout.left + 4, layout.top + 2, 0, color, font);
	renderWorkbenchActionBar(input.actionBar, font, color, colors.COLOR_DESCRIPTION_TEXT);
	if (layout.mode !== 'details') api.blit_text_inline_with_font(layout.outlineTitle, layout.left + 4, layout.top + rowHeight + 2, 0, color, font);
	if (layout.mode === 'split') api.fill_rect(layout.detailsLeft - 1, layout.top + rowHeight, layout.detailsLeft, layout.bottom, 0, colors.COLOR_HEADER_BUTTON_BORDER);
	if (layout.mode !== 'outline') api.blit_text_inline_with_font(layout.detailsTitle, layout.detailsLeft + 4, layout.top + rowHeight + 2, 0, color, font);
	api.popClipRect();
}
