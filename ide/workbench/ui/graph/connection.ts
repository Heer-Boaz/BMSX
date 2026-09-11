import { writeWorkbenchGraphArrow } from './geometry';
import type { WorkbenchGraphEdge, WorkbenchGraphNode } from './model';

export type WorkbenchGraphConnectionEnd = 'source' | 'target';
export type WorkbenchGraphConnectionEnds = WorkbenchGraphConnectionEnd | 'both';
export type WorkbenchGraphConnectionHandles = {
	readonly edge: WorkbenchGraphEdge;
	readonly ends: WorkbenchGraphConnectionEnds;
};

export const GRAPH_CONNECTION_HANDLE_RADIUS = 3;
export const GRAPH_CONNECTION_HIT_RADIUS = 5;

/** Target paints last and wins when the selected edge's endpoints coincide. */
export function hitWorkbenchGraphConnectionHandle(handles: WorkbenchGraphConnectionHandles, x: number, y: number, zoom: number): WorkbenchGraphConnectionEnd | undefined {
	const points = handles.edge.points;
	const end = points.length - 2;
	const radius = GRAPH_CONNECTION_HIT_RADIUS / zoom;
	if (handles.ends !== 'source' && Math.abs(x - points[end]) <= radius
		&& Math.abs(y - points[end + 1]) <= radius) return 'target';
	if (handles.ends !== 'target' && Math.abs(x - points[0]) <= radius
		&& Math.abs(y - points[1]) <= radius) return 'source';
	return undefined;
}

/** Transient geometry, not topology. Only a contribution-admitted node snaps. */
export class WorkbenchGraphConnectionPreview {
	public readonly kind = 'connection';
	public readonly points: number[];
	public readonly arrow = [0, 0, 0, 0, 0, 0];
	public hasArrow: boolean;
	public target: WorkbenchGraphNode | undefined;

	public constructor(public readonly edge: WorkbenchGraphEdge, public readonly end: WorkbenchGraphConnectionEnd) {
		const points = edge.points;
		this.points = [points[0], points[1], points[points.length - 2], points[points.length - 1]];
		this.hasArrow = edge.directed && writeWorkbenchGraphArrow(this.points, this.arrow);
	}

	public get accepted(): boolean { return this.target !== undefined; }

	public moveTo(x: number, y: number): void {
		const moving = this.end === 'source' ? 0 : 2;
		if (this.target !== undefined) {
			const bounds = this.target.bounds;
			const halfWidth = (bounds.right - bounds.left) / 2;
			const halfHeight = this.target.headerHeight / 2;
			const centerX = bounds.left + halfWidth;
			const centerY = bounds.top + halfHeight;
			const fixed = 2 - moving;
			const dx = this.points[fixed] - centerX;
			const dy = this.points[fixed + 1] - centerY;
			// A center-coincident endpoint has no ray direction and remains a point.
			const scale = dx === 0 && dy === 0 ? 0 : 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
			x = centerX + dx * scale;
			y = centerY + dy * scale;
		}
		this.points[moving] = x;
		this.points[moving + 1] = y;
		this.hasArrow = this.edge.directed && writeWorkbenchGraphArrow(this.points, this.arrow);
	}
}
