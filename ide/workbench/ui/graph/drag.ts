import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { WorkbenchGraphEdge, WorkbenchGraphItem, WorkbenchGraphNode } from './model';
import type { WorkbenchGraphConnectionEnd, WorkbenchGraphConnectionEnds, WorkbenchGraphConnectionPreview } from './connection';

/** Transient, retained geometry. Never changes the graph model or document. */
export type WorkbenchGraphNodeDragFeedback = {
	readonly kind: 'node-insertion';
	readonly source: WorkbenchGraphNode;
	readonly marker: RectBounds;
	placement: 'between' | 'inside';
	offsetX: number;
	offsetY: number;
	accepted: boolean;
};

export type WorkbenchGraphDragFeedback = WorkbenchGraphNodeDragFeedback | WorkbenchGraphConnectionPreview;

export type WorkbenchGraphConnectionDragStart = {
	readonly kind: 'connection';
	readonly edge: WorkbenchGraphEdge;
	readonly end: WorkbenchGraphConnectionEnd;
};

export type WorkbenchGraphDragStart = { readonly kind: 'item'; readonly item: WorkbenchGraphItem } | WorkbenchGraphConnectionDragStart;

/** The contribution owns target semantics and the single document edit on drop. */
export interface WorkbenchGraphDragSession {
	readonly feedback: WorkbenchGraphDragFeedback;
	isCurrent(): boolean;
	dragOver(viewportX: number, viewportY: number): void;
	drop(): void;
}

export interface WorkbenchGraphDragSource {
	begin(start: WorkbenchGraphDragStart): WorkbenchGraphDragSession | undefined;
	/** Current, constant-time capability. Omitted by node-only contributions. */
	connectionEnds?(edge: WorkbenchGraphEdge): WorkbenchGraphConnectionEnds | undefined;
}
