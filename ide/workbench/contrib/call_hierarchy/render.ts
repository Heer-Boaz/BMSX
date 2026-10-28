import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { drawWorkbenchIcon } from '../../render/icon';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import type { CallHierarchyInput } from './editor_input';

export function drawCallHierarchy(input: CallHierarchyInput, bounds: Readonly<RectBounds>, focused: boolean): void {
	const tree = input.tree, layout = tree.layout, font = editorViewState.font.renderFont();
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	renderWorkbenchActionBar(input.actions, font, colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
	api.pushClipRect(layout.contentLeft, layout.contentTop, layout.contentRight, layout.contentBottom);
	const first = tree.scroll | 0, end = Math.min(tree.rows.length, first + layout.visibleRowCount);
	for (let index = first; index < end; index++) {
		const node = tree.rows[index], selected = index === tree.selectionIndex;
		const y = layout.contentTop + (index - first) * layout.rowHeight, x = layout.contentLeft + node.depth * layout.indentWidth;
		const ink = selected ? focused ? colors.COLOR_SELECTION_TEXT : colors.COLOR_INACTIVE_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT;
		if (selected) api.fill_rect(layout.contentLeft, y, layout.contentRight, y + layout.rowHeight, 0, focused ? colors.SELECTION_OVERLAY : colors.INACTIVE_SELECTION_OVERLAY);
		else if (index === tree.hoverIndex) api.fill_rect(layout.contentLeft, y, layout.contentRight, y + layout.rowHeight, 0, colors.HIGHLIGHT_OVERLAY);
		if (node.expandable) drawWorkbenchIcon(node.collapsed ? 'chevronRight' : 'chevronDown',
			x + ((layout.twistieWidth - WORKBENCH_ICON_SIZE) >> 1), y + ((layout.rowHeight - WORKBENCH_ICON_SIZE) >> 1), ink);
		api.blit_text_inline_with_font(node.element.displayText, x + layout.twistieWidth, y + 2, 0, ink, font);
	}
	api.popClipRect();
	tree.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	api.popClipRect();
}
