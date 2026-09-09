import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';

export const GRAPH_NODE_PADDING = 4;
export const GRAPH_LABEL_PADDING = 2;

export type WorkbenchGraphNode = {
	readonly kind: 'node';
	readonly bounds: RectBounds;
	readonly lines: readonly string[];
	/** Measured title area. A compound layout extends the body below it. */
	readonly headerHeight: number;
};

export type WorkbenchGraphLabel = {
	readonly bounds: RectBounds;
	readonly lines: readonly string[];
};

const EMPTY_GRAPH_POINTS: readonly number[] = [];
const EMPTY_GRAPH_LABELS: readonly WorkbenchGraphLabel[] = [];

export type WorkbenchGraphEdge = {
	readonly kind: 'edge';
	readonly bounds: RectBounds;
	readonly points: readonly number[];
	readonly arrow: readonly number[];
	readonly labels: readonly WorkbenchGraphLabel[];
};

export type WorkbenchGraphItem = WorkbenchGraphNode | WorkbenchGraphEdge;

/** One layout generation. Array order within each paint layer is never inferred domain order. */
export type WorkbenchGraphModel<Node extends WorkbenchGraphNode = WorkbenchGraphNode, Edge extends WorkbenchGraphEdge = WorkbenchGraphEdge> = {
	readonly font: BFont;
	readonly nodes: readonly Node[];
	readonly edges: readonly Edge[];
	readonly containers: readonly Node[];
	readonly labelledEdges: readonly Edge[];
};

/** Index paint/hit layers once, after geometry is complete and before publication. */
export function createWorkbenchGraphModel<Node extends WorkbenchGraphNode, Edge extends WorkbenchGraphEdge>(
	font: BFont, nodes: readonly Node[], edges: readonly Edge[],
): WorkbenchGraphModel<Node, Edge> {
	return { font, nodes, edges, containers: nodes.filter(node => node.bounds.bottom !== node.bounds.top + node.headerHeight),
		labelledEdges: edges.filter(edge => edge.labels.length > 0) };
}

/** Measure once while building a layout, using the font that will draw it. */
export function createWorkbenchGraphNode(font: BFont, text: string, left: number, top: number): WorkbenchGraphNode {
	const lines = text.split('\n');
	let width = 0;
	for (const line of lines) width = Math.max(width, font.measure(line));
	return {
		kind: 'node', lines, headerHeight: lines.length * font.lineHeight + GRAPH_NODE_PADDING * 2,
		bounds: { left, top, right: left + width + GRAPH_NODE_PADDING * 2,
			bottom: top + lines.length * font.lineHeight + GRAPH_NODE_PADDING * 2 },
	};
}

export function createWorkbenchGraphLabel(font: BFont, text: string): WorkbenchGraphLabel {
	const lines = text.split('\n');
	let width = 0;
	for (const line of lines) width = Math.max(width, font.measure(line));
	return { lines, bounds: { left: 0, top: 0, right: width + GRAPH_LABEL_PADDING * 2,
		bottom: lines.length * font.lineHeight + GRAPH_LABEL_PADDING * 2 } };
}

/** The route is supplied by layout; draw and hit testing retain the same points. */
export function createWorkbenchGraphEdge(points: readonly number[], labels: readonly WorkbenchGraphLabel[] = EMPTY_GRAPH_LABELS, directed = false): WorkbenchGraphEdge {
	const bounds = create_rect_bounds();
	bounds.left = bounds.right = points[0];
	bounds.top = bounds.bottom = points[1];
	for (let index = 2; index < points.length; index += 2) {
		bounds.left = Math.min(bounds.left, points[index]);
		bounds.top = Math.min(bounds.top, points[index + 1]);
		bounds.right = Math.max(bounds.right, points[index]);
		bounds.bottom = Math.max(bounds.bottom, points[index + 1]);
	}
	let arrow = EMPTY_GRAPH_POINTS;
	if (directed) {
		const x = points[points.length - 2];
		const y = points[points.length - 1];
		// Repeated terminal points do not change a route's final direction.
		for (let offset = points.length - 4; offset >= 0; offset -= 2) {
			const dx = x - points[offset];
			const dy = y - points[offset + 1];
			if (dx === 0 && dy === 0) continue;
			const scale = 4 / Math.hypot(dx, dy);
			arrow = [x - dx * scale + dy * scale, y - dy * scale - dx * scale, x, y,
				x - dx * scale - dy * scale, y - dy * scale + dx * scale];
			break;
		}
		for (let index = 0; index < arrow.length; index += 2) {
			bounds.left = Math.min(bounds.left, arrow[index]);
			bounds.top = Math.min(bounds.top, arrow[index + 1]);
			bounds.right = Math.max(bounds.right, arrow[index]);
			bounds.bottom = Math.max(bounds.bottom, arrow[index + 1]);
		}
	}
	for (const label of labels) {
		bounds.left = Math.min(bounds.left, label.bounds.left);
		bounds.top = Math.min(bounds.top, label.bounds.top);
		bounds.right = Math.max(bounds.right, label.bounds.right);
		bounds.bottom = Math.max(bounds.bottom, label.bounds.bottom);
	}
	return { kind: 'edge', bounds, points, arrow, labels };
}
