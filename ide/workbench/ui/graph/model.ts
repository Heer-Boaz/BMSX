import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { writeWorkbenchGraphArrow } from './geometry';

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
	readonly directed: boolean;
	readonly bounds: RectBounds;
	readonly points: readonly number[];
	readonly arrow: readonly number[];
	readonly labels: readonly WorkbenchGraphLabel[];
};

export type WorkbenchGraphItem = WorkbenchGraphNode | WorkbenchGraphEdge;

/** One layout generation. Array order within each paint layer is never inferred domain order. */
export type WorkbenchGraphModel<Node extends WorkbenchGraphNode = WorkbenchGraphNode, Edge extends WorkbenchGraphEdge = WorkbenchGraphEdge> = {
	/** Complete geometry including origin, container bodies, routed edges and labels. */
	readonly bounds: RectBounds;
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
	const bounds = create_rect_bounds();
	const containers: Node[] = [];
	const labelledEdges: Edge[] = [];
	for (const node of nodes) {
		if (node.bounds.bottom !== node.bounds.top + node.headerHeight) containers.push(node);
		bounds.left = Math.min(bounds.left, node.bounds.left);
		bounds.top = Math.min(bounds.top, node.bounds.top);
		bounds.right = Math.max(bounds.right, node.bounds.right);
		bounds.bottom = Math.max(bounds.bottom, node.bounds.bottom);
	}
	for (const edge of edges) {
		if (edge.labels.length > 0) labelledEdges.push(edge);
		bounds.left = Math.min(bounds.left, edge.bounds.left);
		bounds.top = Math.min(bounds.top, edge.bounds.top);
		bounds.right = Math.max(bounds.right, edge.bounds.right);
		bounds.bottom = Math.max(bounds.bottom, edge.bounds.bottom);
	}
	return { font, nodes, edges, bounds, containers, labelledEdges };
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
		const directedArrow: number[] = [];
		writeWorkbenchGraphArrow(points, directedArrow);
		arrow = directedArrow;
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
	return { kind: 'edge', directed, bounds, points, arrow, labels };
}
