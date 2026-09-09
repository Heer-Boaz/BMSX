import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { WorkbenchGraphItem, WorkbenchGraphModel } from './model';

export const GRAPH_EDGE_HIT_RADIUS = 3;
const REVEAL_MARGIN = 6;

type GraphItem<Model extends WorkbenchGraphModel> = Model['nodes'][number] | Model['edges'][number];

/** Input-owned view state; no gesture, source recognizer or layout algorithm. */
export class WorkbenchGraphViewport<Model extends WorkbenchGraphModel = WorkbenchGraphModel> {
	public readonly bounds = create_rect_bounds();
	public scrollX = 0;
	public scrollY = 0;
	public selection: GraphItem<Model> | null = null;

	public constructor(public model: Model) {
	}

	/** The domain owner supplies the proven correspondence, or no selection. */
	public setModel(model: Model, selection: GraphItem<Model> | null): void {
		this.model = model;
		this.selection = selection;
	}

	public layout(left: number, top: number, right: number, bottom: number): void {
		write_rect_bounds(this.bounds, left, top, right, bottom);
	}

	public pan(deltaX: number, deltaY: number): void {
		this.scrollX += deltaX;
		this.scrollY += deltaY;
	}

	public reveal(item: WorkbenchGraphItem): void {
		const bounds = item.bounds;
		this.scrollX = revealAxis(this.scrollX, this.bounds.right - this.bounds.left, bounds.left, bounds.right);
		this.scrollY = revealAxis(this.scrollY, this.bounds.bottom - this.bounds.top, bounds.top,
			item.kind === 'node' ? bounds.top + item.headerHeight : bounds.bottom);
	}

	public hitTest(viewportX: number, viewportY: number): GraphItem<Model> | null {
		if (!point_in_rect(viewportX, viewportY, this.bounds)) return null;
		const x = viewportX - this.bounds.left + this.scrollX;
		const y = viewportY - this.bounds.top + this.scrollY;
		const model = this.model;
		for (let index = model.nodes.length - 1; index >= 0; index -= 1) {
			const node = model.nodes[index];
			if (x >= node.bounds.left && x < node.bounds.right && y >= node.bounds.top && y < node.bounds.top + node.headerHeight) return node;
		}
		// Labels paint over routes, but under node headers/cards.
		for (let index = model.labelledEdges.length - 1; index >= 0; index -= 1) {
			const edge = model.labelledEdges[index];
			for (const label of edge.labels) if (point_in_rect(x, y, label.bounds)) return edge;
		}
		let closest: GraphItem<Model> | null = null;
		let distance = GRAPH_EDGE_HIT_RADIUS * GRAPH_EDGE_HIT_RADIUS;
		for (let index = model.edges.length - 1; index >= 0; index -= 1) {
			const edge = model.edges[index];
			const bounds = edge.bounds;
			if (x < bounds.left - GRAPH_EDGE_HIT_RADIUS || x > bounds.right + GRAPH_EDGE_HIT_RADIUS
				|| y < bounds.top - GRAPH_EDGE_HIT_RADIUS || y > bounds.bottom + GRAPH_EDGE_HIT_RADIUS) continue;
			for (let path = 0; path < 2; path += 1) {
				const points = path === 0 ? edge.points : edge.arrow;
				for (let offset = 0; offset + 3 < points.length; offset += 2) {
					const candidate = segmentDistanceSquared(x, y, points[offset], points[offset + 1], points[offset + 2], points[offset + 3]);
					if (candidate < distance || (closest === null && candidate === distance)) {
						closest = edge;
						distance = candidate;
					}
				}
			}
		}
		return closest;
	}

	public intersects(bounds: RectBounds, margin: number): boolean {
		return bounds.right + margin >= this.scrollX
			&& bounds.bottom + margin >= this.scrollY
			&& bounds.left - margin < this.scrollX + this.bounds.right - this.bounds.left
			&& bounds.top - margin < this.scrollY + this.bounds.bottom - this.bounds.top;
	}
}

function revealAxis(scroll: number, extent: number, start: number, end: number): number {
	if (end - start > extent - REVEAL_MARGIN * 2 || start < scroll + REVEAL_MARGIN) return start - REVEAL_MARGIN;
	if (end > scroll + extent - REVEAL_MARGIN) return end - extent + REVEAL_MARGIN;
	return scroll;
}

function segmentDistanceSquared(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
	const dx = x1 - x0;
	const dy = y1 - y0;
	const lengthSquared = dx * dx + dy * dy;
	const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / lengthSquared));
	const distanceX = x - x0 - t * dx;
	const distanceY = y - y0 - t * dy;
	return distanceX * distanceX + distanceY * distanceY;
}
