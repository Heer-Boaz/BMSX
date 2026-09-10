import * as colors from '../../common/constants';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import { api } from '../../runtime/overlay_api';
import { GRAPH_NODE_PADDING } from '../ui/graph/model';
import type { WorkbenchGraphNodeDragFeedback } from '../ui/graph/drag';
import { GRAPH_CONNECTION_HANDLE_RADIUS, type WorkbenchGraphConnectionEnds, type WorkbenchGraphConnectionPreview } from '../ui/graph/connection';

/** Drag decorations consume retained geometry; they never change layout or source. */
export function drawWorkbenchGraphNodeDrag(drag: WorkbenchGraphNodeDragFeedback, font: BFont, offsetX: number, offsetY: number): void {
	const source = drag.source;
	const left = Math.round(source.bounds.left + drag.offsetX + offsetX);
	// Keep the payload above a valid insertion sector, so its marker cannot obscure the label.
	const top = Math.round((drag.accepted ? drag.marker.top : source.bounds.top + drag.offsetY) + offsetY - source.headerHeight - 6);
	const right = left + source.bounds.right - source.bounds.left;
	const color = drag.accepted ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER : colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
	api.fill_rect(left, top, right, top + source.headerHeight, 0, colors.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
	api.blit_rect(left, top, right, top + source.headerHeight, 0, color);
	let y = top + GRAPH_NODE_PADDING;
	for (const line of source.lines) {
		api.blit_text_inline_with_font(line, left + GRAPH_NODE_PADDING, y, 0, color, font);
		y += font.lineHeight;
	}
	if (drag.accepted) {
		const marker = drag.marker;
		api.fill_rect(marker.left + offsetX, marker.top + offsetY, marker.right + offsetX, marker.bottom + offsetY, 0, color);
		api.fill_rect(marker.left - 2 + offsetX, marker.top + offsetY, marker.right + 2 + offsetX, marker.top + 2 + offsetY, 0, color);
		api.fill_rect(marker.left - 2 + offsetX, marker.bottom - 2 + offsetY, marker.right + 2 + offsetX, marker.bottom + offsetY, 0, color);
	}
}

/** Explicit affordances, above headers; these exact canvas centers are hit-tested. */
export function drawWorkbenchGraphConnectionHandles(points: readonly number[], ends: WorkbenchGraphConnectionEnds,
	offsetX: number, offsetY: number, color: number): void {
	for (let end = 0; end < 2; end += 1) {
		if ((end === 0 && ends === 'target') || (end === 1 && ends === 'source')) continue;
		const index = end === 0 ? 0 : points.length - 2;
		const x = Math.round(points[index]) + offsetX;
		const y = Math.round(points[index + 1]) + offsetY;
		const radius = GRAPH_CONNECTION_HANDLE_RADIUS;
		api.fill_rect(x - radius, y - radius, x + radius + 1, y + radius + 1, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.blit_rect(x - radius, y - radius, x + radius + 1, y + radius + 1, 0, color);
	}
}

export function drawWorkbenchGraphConnectionTarget(drag: WorkbenchGraphConnectionPreview, offsetX: number, offsetY: number): void {
	const color = drag.accepted ? colors.COLOR_PROBLEMS_PANEL_SELECTION_BORDER : colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
	if (drag.target !== undefined) {
		const target = drag.target;
		api.blit_rect(target.bounds.left + offsetX, target.bounds.top + offsetY,
			target.bounds.right + offsetX, target.bounds.top + target.headerHeight + offsetY, 0, color);
	}
	drawWorkbenchGraphConnectionHandles(drag.points, drag.end, offsetX, offsetY, color);
}
