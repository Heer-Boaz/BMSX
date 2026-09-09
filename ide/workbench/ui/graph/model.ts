import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';

export const GRAPH_NODE_PADDING = 4;

export type WorkbenchGraphNode = {
	readonly kind: 'node';
	readonly bounds: RectBounds;
	readonly lines: readonly string[];
};

export type WorkbenchGraphEdge = {
	readonly kind: 'edge';
	readonly bounds: RectBounds;
	readonly points: readonly number[];
};

export type WorkbenchGraphItem = WorkbenchGraphNode | WorkbenchGraphEdge;

/** One layout generation. Array order is paint order, never inferred domain order. */
export type WorkbenchGraphModel = {
	readonly font: BFont;
	readonly nodes: readonly WorkbenchGraphNode[];
	readonly edges: readonly WorkbenchGraphEdge[];
};

/** Measure once while building a layout, using the font that will draw it. */
export function createWorkbenchGraphNode(font: BFont, text: string, left: number, top: number): WorkbenchGraphNode {
	const lines = text.split('\n');
	let width = 0;
	for (const line of lines) width = Math.max(width, font.measure(line));
	return {
		kind: 'node', lines,
		bounds: { left, top, right: left + width + GRAPH_NODE_PADDING * 2,
			bottom: top + lines.length * font.lineHeight + GRAPH_NODE_PADDING * 2 },
	};
}

/** The route is supplied by layout; draw and hit testing retain the same points. */
export function createWorkbenchGraphEdge(points: readonly number[]): WorkbenchGraphEdge {
	const bounds = create_rect_bounds();
	bounds.left = bounds.right = points[0];
	bounds.top = bounds.bottom = points[1];
	for (let index = 2; index < points.length; index += 2) {
		bounds.left = Math.min(bounds.left, points[index]);
		bounds.top = Math.min(bounds.top, points[index + 1]);
		bounds.right = Math.max(bounds.right, points[index]);
		bounds.bottom = Math.max(bounds.bottom, points[index + 1]);
	}
	return { kind: 'edge', bounds, points };
}
