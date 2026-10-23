import { drawWorkbenchIcon } from '../../render/icon';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import type { ValueInput } from '../../../editor/ui/inline/value_input';
import { drawValueInput } from '../../../editor/ui/inline/value_input_render';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { CartMapInput } from './editor_input';
import type { CartMapCoordinateEdit } from './editor_pane';

export function drawCartMap(input: CartMapInput, controls: readonly ValueInput<CartMapCoordinateEdit>[], gridFocused: boolean): void {
	const { layout, tree } = input, font = editorViewState.font.renderFont(), color = colors.COLOR_RESOURCE_VIEWER_TEXT;
	const rowHeight = layout.rowHeight + 4;
	api.pushClipRect(layout.left, layout.top, layout.right, layout.bottom);
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
	api.blit_text_inline_with_font(layout.sourceTitle, layout.left + 4, layout.top + 2, 0, color, font);
	renderWorkbenchActionBar(input.actionBar, font);
	api.blit_text_inline_with_font(input.mapKind === 'pietious' ? 'ROOMS / OBJECTS' : 'STAGE / MARKERS', layout.left + 4, layout.top + rowHeight + 2, 0, color, font);
	api.blit_text_inline_with_font(layout.selectionTitle, layout.gridLeft + 4, layout.top + rowHeight + 2, 0, color, font);
	api.pushClipRect(tree.layout.contentLeft, tree.layout.contentTop, tree.layout.contentRight, tree.layout.contentBottom);
	const firstRow = tree.scroll | 0;
	const end = Math.min(tree.rows.length, firstRow + tree.layout.visibleRowCount);
	for (let index = firstRow; index < end; index++) {
		const node = tree.rows[index], y = tree.layout.contentTop + (index - firstRow) * rowHeight;
		const x = tree.layout.contentLeft + node.depth * tree.layout.indentWidth;
		const selected = index === tree.selectionIndex;
		const textColor = selected ? colors.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT : node.element.diagnostic === null ? color : colors.COLOR_STATUS_WARNING;
		if (selected) api.fill_rect(tree.layout.contentLeft, y, tree.layout.contentRight, y + rowHeight, 0, colors.COLOR_RESOURCE_PANEL_HIGHLIGHT);
		if (node.expandable) drawWorkbenchIcon(node.collapsed ? 'chevronRight' : 'chevronDown',
			x + ((tree.layout.twistieWidth - WORKBENCH_ICON_SIZE) >> 1), y + ((rowHeight - WORKBENCH_ICON_SIZE) >> 1), textColor);
		api.blit_text_inline_with_font(node.element.displayLabel, x + tree.layout.twistieWidth, y + 2, 0,
			textColor, font);
	}
	api.popClipRect();
	tree.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	api.fill_rect(layout.gridLeft - 1, layout.top + rowHeight, layout.gridLeft, layout.bottom, 0, colors.COLOR_HEADER_BUTTON_BORDER);
	if (input.selected !== undefined) for (let axis = 0; axis < controls.length; axis++) {
		const bounds = input.fieldBounds[axis];
		api.blit_text_inline_with_font(axis === 0 ? 'X' : 'Y', bounds.left - 12, bounds.top + 2, 0, color, font);
		drawValueInput(controls[axis], bounds);
	}
	input.grid.draw(gridFocused);
	api.popClipRect();
}
