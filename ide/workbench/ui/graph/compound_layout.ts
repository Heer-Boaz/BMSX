import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { GraphLayoutEngine } from '../../services/graph_layout/engine';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { createWorkbenchGraphEdge, createWorkbenchGraphLabel, createWorkbenchGraphModel, type WorkbenchGraphEdge,
	type WorkbenchGraphLabel, type WorkbenchGraphModel, type WorkbenchGraphNode } from './model';

export type WorkbenchCompoundNode<Node> = WorkbenchGraphNode & { readonly children: readonly Node[] };
export type WorkbenchCompoundLink<Node> = {
	readonly source: Node;
	readonly target: Node;
	readonly label: string;
};
export type WorkbenchCompoundModel<Node extends WorkbenchGraphNode, Link> = WorkbenchGraphModel<Node, WorkbenchGraphEdge & { readonly link: Link }>;

const LAYOUT_OPTIONS = {
	'elk.algorithm': 'layered',
	'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
	'elk.direction': 'RIGHT',
	'elk.edgeRouting': 'ORTHOGONAL',
	'elk.layered.mergeEdges': 'false',
	'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
	'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
	'elk.spacing.edgeEdge': '12',
	'elk.spacing.nodeNode': '16',
	'elk.layered.spacing.nodeNodeBetweenLayers': '32',
	'elk.randomSeed': '1',
};

/**
 * One unpublished layout generation. The caller owns engine lifetime and publication.
 * Only dimensions, containment and endpoint ids cross the worker boundary. Node/link
 * identity and domain metadata stay here. See docs/behavior_graph_design.md.
 */
export async function layoutWorkbenchCompoundGraph<
	Node extends WorkbenchCompoundNode<Node>, Link extends WorkbenchCompoundLink<Node>,
>(font: BFont, roots: readonly Node[], links: readonly Link[], engine: GraphLayoutEngine): Promise<WorkbenchCompoundModel<Node, Link>> {
	const nodes: Node[] = [];
	const boundsById = new Map<string, RectBounds>();
	boundsById.set('layout', create_rect_bounds());
	const idsByNode = new Map<Node, string>();
	const linksById = new Map<string, { link: Link; labels: WorkbenchGraphLabel[] }>();
	function nodeInput(node: Node): ElkNode {
		const id = `n${nodes.length}`;
		nodes.push(node);
		boundsById.set(id, node.bounds);
		idsByNode.set(node, id);
		const width = node.bounds.right - node.bounds.left;
		return { id, width, height: node.headerHeight, children: node.children.map(nodeInput), edges: [],
			layoutOptions: {
				'elk.padding': `[top=${node.headerHeight + 12},left=12,bottom=12,right=12]`,
				'elk.nodeSize.constraints': 'MINIMUM_SIZE',
				'elk.nodeSize.minimum': `(${width},${node.headerHeight})`,
			} };
	}
	// A real root may itself be an endpoint, including a self-loop.
	const children = roots.map(nodeInput);
	const edges: ElkExtendedEdge[] = links.map((link, index) => {
		const id = `e${index}`;
		const labels = link.label.length === 0 ? [] : [createWorkbenchGraphLabel(font, link.label)];
		linksById.set(id, { link, labels });
		return { id, sources: [idsByNode.get(link.source)!], targets: [idsByNode.get(link.target)!],
			labels: labels.map(label => ({ text: link.label,
				width: label.bounds.right, height: label.bounds.bottom })),
			layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } };
	});
	const result = await engine.layout({ id: 'layout', children, edges, layoutOptions: LAYOUT_OPTIONS });
	// ELK may center routes/labels on half pixels. Publish pixel-grid geometry once;
	// bitmap glyphs, hit bounds and retained pan/reveal must consume that same grid.
	function placeNodes(parent: ElkNode): void {
		const origin = boundsById.get(parent.id)!;
		for (const child of parent.children!) {
			const x = Math.round(origin.left + child.x!);
			const y = Math.round(origin.top + child.y!);
			write_rect_bounds(boundsById.get(child.id)!, x, y, x + Math.round(child.width!), y + Math.round(child.height!));
			placeNodes(child);
		}
	}
	placeNodes(result);
	const output: (WorkbenchGraphEdge & { readonly link: Link })[] = [];
	for (let index = 0; index < result.edges!.length; index += 1) {
		const edge = result.edges![index];
		// ELK stores these edges at the request root, but assigns their actual
		// coordinate container after hierarchical routing. It is not the array owner.
		const origin = boundsById.get(edge.container!)!;
		// Binary Layered edges have one connected section after compound postprocess.
		const section = edge.sections![0];
		const points = [Math.round(origin.left + section.startPoint.x), Math.round(origin.top + section.startPoint.y)];
		if (section.bendPoints !== undefined) {
			for (const point of section.bendPoints) points.push(Math.round(origin.left + point.x), Math.round(origin.top + point.y));
		}
		points.push(Math.round(origin.left + section.endPoint.x), Math.round(origin.top + section.endPoint.y));
		const { link, labels: edgeLabels } = linksById.get(edge.id)!;
		for (let labelIndex = 0; labelIndex < edgeLabels.length; labelIndex += 1) {
			const label = edge.labels![labelIndex];
			const x = Math.round(origin.left + label.x!);
			const y = Math.round(origin.top + label.y!);
			write_rect_bounds(edgeLabels[labelIndex].bounds, x, y, x + label.width!, y + label.height!);
		}
		output.push({ ...createWorkbenchGraphEdge(points, edgeLabels, true), link });
	}
	return createWorkbenchGraphModel(font, nodes, output);
}
