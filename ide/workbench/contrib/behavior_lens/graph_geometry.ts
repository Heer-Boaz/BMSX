import { createWorkbenchTreeEdge, createWorkbenchGraphModel } from '../../ui/graph/model';
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
		const edge: BehaviorGraphEdge = { ...createWorkbenchTreeEdge(parent, child), child, source, range };
		edges.push(edge);
		edgesBySource.set(source.rowKey, edge);
	}
	return { ...createWorkbenchGraphModel(font, nodes, edges), nodesBySource, edgesBySource };
}
