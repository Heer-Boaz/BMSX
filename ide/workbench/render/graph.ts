import * as colors from '../../common/constants';
import { rects_intersect } from '../../../machine/ts/common/rect';
import { api } from '../../runtime/overlay_api';
import { GRAPH_LABEL_PADDING, GRAPH_NODE_PADDING, type WorkbenchGraphItem } from '../ui/graph/model';
import type { WorkbenchGraphViewport } from '../ui/graph/viewport';
import type { WorkbenchGraphDragFeedback } from '../ui/graph/drag';
import type { WorkbenchGraphConnectionHandles } from '../ui/graph/connection';
import { drawWorkbenchGraphNodeDrag, drawWorkbenchGraphConnectionHandles, drawWorkbenchGraphConnectionTarget } from './graph_feedback';

/** Draw the retained layout; partial primitives are clipped by the render owner. */
export function drawWorkbenchGraph(view: WorkbenchGraphViewport, hover: WorkbenchGraphItem | null, focused: boolean, drag?: WorkbenchGraphDragFeedback, handles?: WorkbenchGraphConnectionHandles): void {
	const bounds = view.bounds;
	const visible = view.visibleBounds;
	const strokeMargin = 1 / view.zoom;
	const model = view.model;
	const connection = drag?.kind === 'connection' ? drag : undefined;
	const replacedEdge = connection?.edge;
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	api.pushTransform(view.transform);
	// Parent-before-child bodies must not erase routes inside their containment.
	for (const node of model.containers) {
		const area = node.bounds;
		if (!rects_intersect(area, visible)) continue;
		api.fill_rect(area.left, area.top, area.right, area.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.blit_rect(area.left, area.top, area.right, area.bottom, 0,
			view.selection === node ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER : colors.COLOR_TAB_BORDER);
	}
	for (const edge of model.edges) {
		if (!rects_intersect(edge.bounds, visible, strokeMargin) || edge === replacedEdge) continue;
		const selected = view.selection === edge;
		const color = selected ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER
			: edge === hover ? colors.COLOR_RESOURCE_VIEWER_TEXT : colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
		api.polyline(edge.points, 0, 0, 0, selected ? 2 : 1, color);
		if (edge.arrow.length > 0) api.polyline(edge.arrow, 0, 0, 0, selected ? 2 : 1, color);
	}
	if (connection !== undefined) {
		const color = connection.accepted ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER : colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
		api.polyline(connection.points, 0, 0, 0, 2, color);
		if (connection.hasArrow) api.polyline(connection.arrow, 0, 0, 0, 2, color);
	}
	for (const edge of model.labelledEdges) {
		if (edge === replacedEdge) continue;
		for (const label of edge.labels) {
			if (!rects_intersect(label.bounds, visible)) continue;
			const area = label.bounds;
			const selected = view.selection === edge;
			api.fill_rect(area.left, area.top, area.right, area.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
			if (selected || edge === hover) api.fill_rect(area.left, area.top, area.right, area.bottom, 0,
				selected ? colors.SELECTION_OVERLAY : colors.HIGHLIGHT_OVERLAY);
			let y = area.top + GRAPH_LABEL_PADDING;
			for (const line of label.lines) {
				api.blit_text_inline_with_font(line, area.left + GRAPH_LABEL_PADDING, y, 0,
					selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, model.font);
				y += model.font.lineHeight;
			}
		}
	}
	for (const node of model.nodes) {
		if (node.bounds.top + node.headerHeight <= visible.top || !rects_intersect(node.bounds, visible)) continue;
		const area = node.bounds;
		const left = area.left;
		const top = area.top;
		const right = area.right;
		const bottom = top + node.headerHeight;
		const selected = view.selection === node;
		if (node.appearance === 'card') api.fill_rect(left, top, right, bottom, 0, colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
		if (selected) api.fill_rect(left, top, right, bottom, 0, colors.SELECTION_OVERLAY);
		if (node === hover && !selected) api.fill_rect(left, top, right, bottom, 0, colors.HIGHLIGHT_OVERLAY);
		if (node.appearance === 'card' || selected || node === hover) api.blit_rect(left, top, right, bottom, 0, selected ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER : colors.COLOR_TAB_BORDER);
		if (node.appearance === 'disc') {
			for (let row = 0; row < node.insets.length; row += 1) {
				const inset = node.insets[row];
				api.fill_rect(left + inset, top + row, right - inset, top + row + 1, 0,
					selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT);
			}
		}
		let y = top + GRAPH_NODE_PADDING;
		for (const line of node.lines) {
			api.blit_text_inline_with_font(line, left + GRAPH_NODE_PADDING, y, 0,
				selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, model.font);
			y += model.font.lineHeight;
		}
	}
	api.popTransform();
	if (drag?.kind === 'node-insertion') drawWorkbenchGraphNodeDrag(drag, model.font, view);
	if (connection !== undefined) {
		drawWorkbenchGraphConnectionTarget(connection, view);
	} else if (handles !== undefined) {
		drawWorkbenchGraphConnectionHandles(handles.edge.points, handles.ends, view, colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER);
	}
	if (focused) api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER);
	api.popClipRect();
	view.horizontalScrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	view.verticalScrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	api.fill_rect(bounds.right, bounds.bottom, view.canvas.right, view.canvas.bottom, 0, colors.SCROLLBAR_TRACK_COLOR);
}
