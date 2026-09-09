import { createWorkbenchGraphEdge } from '../../ui/graph/model';
import { layoutWorkbenchTree } from '../../ui/graph/tree_layout';
import type { BehaviorSourceRowKey } from './model';
import type { BehaviorGraphEdge, BehaviorGraphModel, BehaviorGraphProjection } from './graph_model';

/** Ordered, measured tree placement followed by routes through the inter-level gaps. */
export function layoutBehaviorTreeGraph(projection: BehaviorGraphProjection): BehaviorGraphModel {
	const { font, nodes, nodesBySource, links } = projection;
	const edges: BehaviorGraphEdge[] = [];
	const edgesBySource = new Map<BehaviorSourceRowKey, BehaviorGraphEdge>();
	if (nodes.length > 0) layoutWorkbenchTree(nodes[0], 16, 24);
	for (const { child, source, range } of links) {
		const parent = child.parent!;
		const x0 = Math.round((parent.bounds.left + parent.bounds.right) / 2);
		const x1 = Math.round((child.bounds.left + child.bounds.right) / 2);
		const y0 = parent.bounds.bottom;
		const y1 = child.bounds.top;
		const points = x0 === x1 ? [x0, y0, x1, y1] : [x0, y0, x0, y1 - 12, x1, y1 - 12, x1, y1];
		const edge: BehaviorGraphEdge = { ...createWorkbenchGraphEdge(points), child, source, range };
		edges.push(edge);
		edgesBySource.set(source.rowKey, edge);
	}
	return { font, nodes, edges, nodesBySource, edgesBySource };
}
