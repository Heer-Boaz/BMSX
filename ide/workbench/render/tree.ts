import * as colors from '../../common/constants';
import type { EditorFont } from '../../editor/ui/view/font';
import { api } from '../../runtime/overlay_api';
import type { ScrollableWorkbenchTree } from '../ui/scrollable_tree';
import { drawWorkbenchIcon } from './icon';
import { WORKBENCH_ICON_SIZE } from '../ui/icon';

export function drawWorkbenchTree<Element extends { readonly label: string }>(tree: ScrollableWorkbenchTree<Element>, font: EditorFont, focused: boolean): void {
	const layout = tree.layout, first = tree.scroll | 0, end = Math.min(tree.rows.length, first + layout.visibleRowCount);
	api.pushClipRect(layout.contentLeft, layout.contentTop, layout.contentRight, layout.contentBottom);
	for (let index = first; index < end; index++) {
		const node = tree.rows[index], top = layout.contentTop + (index - first) * layout.rowHeight;
		const selected = index === tree.selectionIndex;
		if (selected || index === tree.hoverIndex) api.fill_rect(layout.contentLeft, top, layout.contentRight, top + layout.rowHeight, 0,
			selected ? focused ? colors.SELECTION_OVERLAY : colors.INACTIVE_SELECTION_OVERLAY : colors.HIGHLIGHT_OVERLAY);
		const color = selected ? focused ? colors.COLOR_SELECTION_TEXT : colors.COLOR_INACTIVE_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT;
		let x = tree.rowLeft + node.depth * layout.indentWidth;
		if (node.expandable) {
			drawWorkbenchIcon(node.collapsed ? 'chevronRight' : 'chevronDown', x + (layout.twistieWidth - WORKBENCH_ICON_SIZE) / 2, top + (layout.rowHeight - WORKBENCH_ICON_SIZE) / 2, color);
			x += layout.twistieWidth;
		}
		api.blit_text_inline_with_font(node.element.label, x + 4, top + (layout.rowHeight - font.lineHeight) / 2, 0, color, font.renderFont());
	}
	api.popClipRect();
	tree.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	tree.horizontalScrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
}
