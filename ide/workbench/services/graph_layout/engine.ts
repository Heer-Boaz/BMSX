import type { ElkNode } from 'elkjs/lib/elk-api';
import type { IDisposable } from '../../../common/lifecycle';

/** Geometry-only boundary. Domain objects stay with the unpublished generation. */
export interface GraphLayoutEngine {
	layout(graph: ElkNode): Promise<ElkNode>;
}

export type GraphLayoutEngineFactory = () => GraphLayoutEngine & IDisposable;
