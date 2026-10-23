import * as colors from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { GpuDebuggerInput } from './editor_input';

export type GpuOperationRow = { sequence: number; top: number; label: string };

/** Full-width history. Observation diagrams and words have one owner in the inspector window. */
export function drawGpuDebugger(input: GpuDebuggerInput, rows: readonly GpuOperationRow[], emptyLines: readonly string[]): void {
	const { layout, list } = input, font = layout.font!.renderFont();
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
	renderWorkbenchActionBar(input.actions, font, colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
	api.pushClipRect(list.bounds.left, list.bounds.top, list.bounds.right, list.bounds.bottom);
	for (const row of rows) {
		const selected = row.sequence === input.selected.sequence;
		if (selected) api.fill_rect(list.bounds.left, row.top, list.bounds.right, row.top + layout.rowHeight, 0, colors.SELECTION_OVERLAY);
		api.blit_text_inline_with_font(row.label, list.bounds.left + 2, row.top, 0, selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
	}
	if (input.projection.rows.length === 0) for (let index = 0; index < emptyLines.length; index++)
		api.blit_text_inline_with_font(emptyLines[index], list.bounds.left + 2, list.bounds.top + 4 + index * font.lineHeight,
			0, colors.COLOR_DESCRIPTION_TEXT, font);
	api.popClipRect(); list.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
}
