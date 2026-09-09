import type { ElkNode } from 'elkjs/lib/elk-api';

/** Geometry-only boundary. Domain objects stay with the unpublished generation. */
export interface GraphLayoutEngine {
	layout(graph: ElkNode): Promise<ElkNode>;
}
