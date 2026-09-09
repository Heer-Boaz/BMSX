import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import { GRAPH_LABEL_PADDING, GRAPH_NODE_PADDING, type WorkbenchGraphItem } from '../ui/graph/model';
import type { WorkbenchGraphViewport } from '../ui/graph/viewport';

/** Draw the retained layout; partial primitives are clipped by the render owner. */
export function drawWorkbenchGraph(view: WorkbenchGraphViewport, hover: WorkbenchGraphItem | null, focused: boolean): void {
	const bounds = view.bounds;
	const offsetX = bounds.left - view.scrollX;
	const offsetY = bounds.top - view.scrollY;
	const model = view.model;
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	// Parent-before-child bodies must not erase routes inside their containment.
	for (const node of model.containers) {
		const area = node.bounds;
		if (!view.intersects(area, 0)) continue;
		api.fill_rect(area.left + offsetX, area.top + offsetY, area.right + offsetX, area.bottom + offsetY, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.blit_rect(area.left + offsetX, area.top + offsetY, area.right + offsetX, area.bottom + offsetY, 0,
			view.selection === node ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER : colors.COLOR_TAB_BORDER);
	}
	for (const edge of model.edges) {
		if (!view.intersects(edge.bounds, 1)) continue;
		const selected = view.selection === edge;
		const color = selected ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER
			: edge === hover ? colors.COLOR_RESOURCE_VIEWER_TEXT : colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
		api.polyline(edge.points, offsetX, offsetY, 0, selected ? 2 : 1, color);
		if (edge.arrow.length > 0) api.polyline(edge.arrow, offsetX, offsetY, 0, selected ? 2 : 1, color);
	}
	for (const edge of model.labelledEdges) {
		for (const label of edge.labels) {
			if (!view.intersects(label.bounds, 0)) continue;
			const area = label.bounds;
			const selected = view.selection === edge;
			api.fill_rect(area.left + offsetX, area.top + offsetY, area.right + offsetX, area.bottom + offsetY, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
			if (selected || edge === hover) api.fill_rect(area.left + offsetX, area.top + offsetY, area.right + offsetX, area.bottom + offsetY, 0,
				selected ? colors.SELECTION_OVERLAY : colors.HIGHLIGHT_OVERLAY);
			let y = area.top + offsetY + GRAPH_LABEL_PADDING;
			for (const line of label.lines) {
				api.blit_text_inline_with_font(line, area.left + offsetX + GRAPH_LABEL_PADDING, y, 0,
					selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, model.font);
				y += model.font.lineHeight;
			}
		}
	}
	for (const node of model.nodes) {
		if (node.bounds.top + node.headerHeight < view.scrollY || !view.intersects(node.bounds, 0)) continue;
		const area = node.bounds;
		const left = area.left + offsetX;
		const top = area.top + offsetY;
		const right = area.right + offsetX;
		const bottom = top + node.headerHeight;
		const selected = view.selection === node;
		api.fill_rect(left, top, right, bottom, 0, colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
		if (selected) api.fill_rect(left, top, right, bottom, 0, colors.SELECTION_OVERLAY);
		if (node === hover && !selected) api.fill_rect(left, top, right, bottom, 0, colors.HIGHLIGHT_OVERLAY);
		api.blit_rect(left, top, right, bottom, 0, selected ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER : colors.COLOR_TAB_BORDER);
		let y = top + GRAPH_NODE_PADDING;
		for (const line of node.lines) {
			api.blit_text_inline_with_font(line, left + GRAPH_NODE_PADDING, y, 0,
				selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, model.font);
			y += model.font.lineHeight;
		}
	}
	if (focused) api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER);
	api.popClipRect();
}
