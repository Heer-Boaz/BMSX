import * as colors from '../../common/constants';
import type { WorkbenchGraphViewport } from '../ui/graph/viewport';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import { api } from '../../runtime/overlay_api';
import { GRAPH_NODE_PADDING } from '../ui/graph/model';
import type { WorkbenchGraphNodeDragFeedback } from '../ui/graph/drag';
import { GRAPH_CONNECTION_HANDLE_RADIUS, type WorkbenchGraphConnectionEnds, type WorkbenchGraphConnectionPreview } from '../ui/graph/connection';

/** Drag decorations consume retained geometry; they never change layout or source. */
export function drawWorkbenchGraphNodeDrag(drag: WorkbenchGraphNodeDragFeedback, font: BFont, view: WorkbenchGraphViewport): void {
	const source = drag.source;
	const left = source.bounds.left + drag.offsetX;
	// Keep the payload above a valid insertion sector, so its marker cannot obscure the label.
	const top = (drag.accepted ? drag.marker.top : source.bounds.top + drag.offsetY) - source.headerHeight - 6;
	const right = left + source.bounds.right - source.bounds.left;
	const color = drag.accepted ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER : colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
	api.pushTransform(view.transform);
	api.fill_rect(left, top, right, top + source.headerHeight, 0, colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
	api.blit_rect(left, top, right, top + source.headerHeight, 0, color);
	let y = top + GRAPH_NODE_PADDING;
	for (const line of source.lines) {
		api.blit_text_inline_with_font(line, left + GRAPH_NODE_PADDING, y, 0, color, font);
		y += font.lineHeight;
	}
	api.popTransform();
	if (drag.accepted) {
		const marker = drag.marker;
		const x = view.graphToViewportX(marker.left);
		const top = view.graphToViewportY(marker.top), bottom = view.graphToViewportY(marker.bottom);
		api.fill_rect(x, top, x + 2, bottom, 0, color);
		api.fill_rect(x - 2, top, x + 4, top + 2, 0, color);
		api.fill_rect(x - 2, bottom - 2, x + 4, bottom, 0, color);
	}
}

/** Explicit affordances, above headers; these exact canvas centers are hit-tested. */
export function drawWorkbenchGraphConnectionHandles(points: readonly number[], ends: WorkbenchGraphConnectionEnds,
	view: WorkbenchGraphViewport, color: number): void {
	for (let end = 0; end < 2; end += 1) {
		if ((end === 0 && ends === 'target') || (end === 1 && ends === 'source')) continue;
		const index = end === 0 ? 0 : points.length - 2;
		const x = view.graphToViewportX(points[index]);
		const y = view.graphToViewportY(points[index + 1]);
		const radius = GRAPH_CONNECTION_HANDLE_RADIUS;
		api.fill_rect(x - radius, y - radius, x + radius + 1, y + radius + 1, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.blit_rect(x - radius, y - radius, x + radius + 1, y + radius + 1, 0, color);
	}
}

export function drawWorkbenchGraphConnectionTarget(drag: WorkbenchGraphConnectionPreview, view: WorkbenchGraphViewport): void {
	const color = drag.accepted ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER : colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
	if (drag.target !== undefined) {
		const target = drag.target;
		api.blit_rect(view.graphToViewportX(target.bounds.left), view.graphToViewportY(target.bounds.top),
			view.graphToViewportX(target.bounds.right), view.graphToViewportY(target.bounds.top + target.headerHeight), 0, color);
	}
	drawWorkbenchGraphConnectionHandles(drag.points, drag.end, view, color);
}
