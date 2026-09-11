import { SCROLLBAR_WIDTH } from '../../../common/constants';
import { Scrollbar } from '../scrollbar';
import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { clamp } from '../../../../machine/ts/common/clamp';
import type { WorkbenchGraphItem, WorkbenchGraphModel } from './model';
import type { HostOverlayTransform } from '../../../../machine/ts/render/host_overlay/transform';

export const GRAPH_EDGE_HIT_RADIUS = 3;
export const GRAPH_ZOOM_MIN = 0.25;
export const GRAPH_ZOOM_MAX = 4;
export const GRAPH_ZOOM_STEP = 1.2;
const REVEAL_MARGIN = 6;

type GraphItem<Model extends WorkbenchGraphModel> = Model['nodes'][number] | Model['edges'][number];

/** Input-owned view state; no gesture, source recognizer or layout algorithm. */
export class WorkbenchGraphViewport<Model extends WorkbenchGraphModel = WorkbenchGraphModel> {
	/** Outer canvas; content bounds exclude the scrollbar gutters. */
	public readonly canvas = create_rect_bounds();
	public readonly bounds = create_rect_bounds();
	/** Legal scroll offsets, including one viewport of padding around the graph. */
	public readonly scrollBounds = create_rect_bounds();
	public readonly horizontalScrollbar = new Scrollbar('horizontal');
	public readonly verticalScrollbar = new Scrollbar('vertical');
	private readonly horizontalTrack = create_rect_bounds();
	private readonly verticalTrack = create_rect_bounds();
	public selection: GraphItem<Model> | null = null;
	private zoomValue = 1;
	private readonly drawTransform: HostOverlayTransform = { scale: 1, offsetX: 0, offsetY: 0 };
	private readonly visibleGraphBounds = create_rect_bounds();

	public constructor(public model: Model) {
		this.updateScrollBounds();
	}

	public get scrollX(): number { return this.horizontalScrollbar.getScroll(); }
	public set scrollX(value: number) { this.horizontalScrollbar.setScroll(value); }
	public get scrollY(): number { return this.verticalScrollbar.getScroll(); }
	public set scrollY(value: number) { this.verticalScrollbar.setScroll(value); }
	public get zoom(): number { return this.zoomValue; }

	/** Scrollbars own pixel offsets; the graph, its labels and its routes stay in layout coordinates. */
	public get transform(): Readonly<HostOverlayTransform> {
		this.drawTransform.scale = this.zoomValue;
		this.drawTransform.offsetX = this.bounds.left - this.scrollX;
		this.drawTransform.offsetY = this.bounds.top - this.scrollY;
		return this.drawTransform;
	}

	public graphToViewportX(x: number): number { return x * this.zoomValue + this.bounds.left - this.scrollX; }
	public graphToViewportY(y: number): number { return y * this.zoomValue + this.bounds.top - this.scrollY; }
	public viewportToGraphX(x: number): number { return (x - this.bounds.left + this.scrollX) / this.zoomValue; }
	public viewportToGraphY(y: number): number { return (y - this.bounds.top + this.scrollY) / this.zoomValue; }

	/** Capture once for a draw/traversal, rather than repeating inverse transforms for every item. */
	public get visibleBounds(): RectBounds {
		const x = this.scrollX / this.zoomValue, y = this.scrollY / this.zoomValue;
		write_rect_bounds(this.visibleGraphBounds, x, y,
			x + (this.bounds.right - this.bounds.left) / this.zoomValue,
			y + (this.bounds.bottom - this.bounds.top) / this.zoomValue);
		return this.visibleGraphBounds;
	}

	/** Godot GraphEdit's inverse-anchor -> scale -> scroll sequence; never relayout or auto-fit. */
	public setZoom(value: number, anchorX = (this.bounds.left + this.bounds.right) / 2, anchorY = (this.bounds.top + this.bounds.bottom) / 2): void {
		const zoom = clamp(value, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX);
		if (zoom === this.zoomValue) return;
		const x = this.viewportToGraphX(anchorX);
		const y = this.viewportToGraphY(anchorY);
		this.zoomValue = zoom;
		this.updateScrollBounds();
		this.scrollX = x * zoom - anchorX + this.bounds.left;
		this.scrollY = y * zoom - anchorY + this.bounds.top;
	}

	/** The domain owner supplies the proven correspondence, or no selection. */
	public setModel(model: Model, selection: GraphItem<Model> | null): void {
		this.model = model;
		this.selection = selection;
		this.updateScrollBounds();
	}

	public layout(left: number, top: number, right: number, bottom: number): void {
		if (this.canvas.left === left && this.canvas.top === top && this.canvas.right === right && this.canvas.bottom === bottom) return;
		write_rect_bounds(this.canvas, left, top, right, bottom);
		const contentRight = Math.max(left, right - SCROLLBAR_WIDTH);
		const contentBottom = Math.max(top, bottom - SCROLLBAR_WIDTH);
		write_rect_bounds(this.bounds, left, top, contentRight, contentBottom);
		write_rect_bounds(this.horizontalTrack, left, contentBottom, contentRight, bottom);
		write_rect_bounds(this.verticalTrack, contentRight, top, right, contentBottom);
		this.updateScrollBounds();
	}

	private updateScrollBounds(): void {
		const x = this.scrollX;
		const y = this.scrollY;
		const width = this.bounds.right - this.bounds.left;
		const height = this.bounds.bottom - this.bounds.top;
		const graph = this.model.bounds;
		const zoom = this.zoomValue;
		write_rect_bounds(this.scrollBounds, graph.left * zoom - width, graph.top * zoom - height, graph.right * zoom, graph.bottom * zoom);
		this.horizontalScrollbar.layout(this.horizontalTrack, (graph.right - graph.left) * zoom + width * 2, width, x, this.scrollBounds.left);
		this.verticalScrollbar.layout(this.verticalTrack, (graph.bottom - graph.top) * zoom + height * 2, height, y, this.scrollBounds.top);
	}

	public pan(deltaX: number, deltaY: number): void {
		this.scrollX += deltaX;
		this.scrollY += deltaY;
	}

	/** Roving diagram selection follows retained node/edge order, independent of topology. */
	public selectRelative(direction: 1 | -1): void {
		const { nodes, edges } = this.model;
		const count = nodes.length + edges.length;
		if (count === 0) return;
		const selected = this.selection;
		const index = selected === null ? (direction === 1 ? -1 : count)
			: selected.kind === 'node' ? nodes.indexOf(selected) : nodes.length + edges.indexOf(selected);
		const next = clamp(index + direction, 0, count - 1);
		this.selection = next < nodes.length ? nodes[next] : edges[next - nodes.length];
	}

	public reveal(item: WorkbenchGraphItem): void {
		const bounds = item.bounds;
		this.horizontalScrollbar.reveal(bounds.left * this.zoomValue, bounds.right * this.zoomValue, REVEAL_MARGIN);
		this.verticalScrollbar.reveal(bounds.top * this.zoomValue,
			(item.kind === 'node' ? bounds.top + item.headerHeight : bounds.bottom) * this.zoomValue, REVEAL_MARGIN);
	}

	public hitTest(viewportX: number, viewportY: number): GraphItem<Model> | null {
		if (!point_in_rect(viewportX, viewportY, this.bounds)) return null;
		const x = this.viewportToGraphX(viewportX);
		const y = this.viewportToGraphY(viewportY);
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
		const radius = GRAPH_EDGE_HIT_RADIUS / this.zoomValue;
		let distance = radius * radius;
		for (let index = model.edges.length - 1; index >= 0; index -= 1) {
			const edge = model.edges[index];
			const bounds = edge.bounds;
			if (x < bounds.left - radius || x > bounds.right + radius
				|| y < bounds.top - radius || y > bounds.bottom + radius) continue;
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
