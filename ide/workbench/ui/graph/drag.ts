import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { WorkbenchGraphNode } from './model';

/** Transient, retained geometry. Never changes the graph model or document. */
export type WorkbenchGraphDragFeedback = {
	readonly source: WorkbenchGraphNode;
	readonly marker: RectBounds;
	offsetX: number;
	offsetY: number;
	accepted: boolean;
};

/** The contribution owns target semantics and the single document edit on drop. */
export interface WorkbenchGraphDragSession {
	readonly feedback: WorkbenchGraphDragFeedback;
	isCurrent(): boolean;
	dragOver(viewportX: number, viewportY: number): void;
	drop(): void;
}

export type WorkbenchGraphDragSource = () => WorkbenchGraphDragSession | undefined;
