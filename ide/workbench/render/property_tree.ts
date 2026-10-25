import * as colors from '../../common/constants';
import { drawWorkbenchIcon } from './icon';
import { WORKBENCH_ICON_SIZE } from '../ui/icon';
import { api } from '../../runtime/overlay_api';
import type { WorkbenchPropertyElement, WorkbenchPropertyTree } from '../ui/property_tree';

/** The same retained column geometry is used for rows, hit testing and clipping. */
export function drawWorkbenchPropertyTree<Element extends WorkbenchPropertyElement>(state: WorkbenchPropertyTree<Element>): void {
	const layout = state.layout;
	if (layout.contentLeft === layout.contentRight || layout.contentTop === layout.bottom) return;
	const font = layout.font!;
	api.fill_rect(layout.contentLeft, layout.contentTop, layout.contentRight, layout.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	api.pushClipRect(layout.contentLeft, layout.contentTop, layout.contentRight, layout.contentBottom);
	const firstRow = state.scroll | 0;
	const end = Math.min(state.rows.length, firstRow + layout.visibleRowCount);
	for (let index = firstRow; index < end; index += 1) {
		const node = state.rows[index];
		const element = node.element;
		const y = layout.contentTop + (index - firstRow) * layout.rowHeight;
		const x = layout.contentLeft + node.depth * layout.indentWidth;
		const selected = index === state.selectionIndex, hovered = index === state.hoverIndex;
		const group = element.kind === 'group', header = group && !hovered;
		if (group) api.fill_rect(layout.contentLeft, y, layout.contentRight, y + layout.rowHeight, 0, colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
		else api.fill_rect(element.displayValueLeft - 4, y, layout.contentRight, y + layout.rowHeight, 0, colors.COLOR_CODE_BACKGROUND);
		if (hovered) api.fill_rect(layout.contentLeft, y, layout.contentRight, y + layout.rowHeight, 0, colors.HIGHLIGHT_OVERLAY);
		if (selected) api.fill_rect(layout.contentLeft, y, layout.contentRight, y + layout.rowHeight, 0, colors.SELECTION_OVERLAY);
		const color = selected ? colors.COLOR_SELECTION_TEXT : element.warning
			? header ? colors.COLOR_PROBLEMS_PANEL_WARNING : colors.COLOR_INSPECTOR_WARNING_TEXT
			: header ? colors.COLOR_PROBLEMS_PANEL_HEADER_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT;
		if (node.expandable) drawWorkbenchIcon(node.collapsed ? 'chevronRight' : 'chevronDown',
			x + ((layout.twistieWidth - WORKBENCH_ICON_SIZE) >> 1), y + ((layout.rowHeight - WORKBENCH_ICON_SIZE) >> 1), color);
		api.blit_text_inline_with_font(element.displayLabel, x + layout.twistieWidth + 2, y + 2, 0, color, font);
		api.blit_text_inline_with_font(element.displayValue, element.displayValueLeft, y + 2, 0, color, font);
	}
	api.popClipRect();
	api.fill_rect(layout.contentLeft, layout.contentBottom, layout.contentRight, layout.contentBottom + 1, 0, colors.COLOR_TAB_BORDER);
	api.pushClipRect(layout.contentLeft, layout.contentBottom + 1, layout.contentRight, layout.bottom);
	for (let index = 0; index < state.descriptionLines.length; index += 1) {
		api.blit_text_inline_with_font(state.descriptionLines[index], layout.contentLeft + 4,
			layout.contentBottom + 4 + index * font.lineHeight, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
	}
	api.popClipRect();
}
