import { SCROLLBAR_WIDTH } from '../../../common/constants';
import { Scrollbar } from '../scrollbar';
import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { clamp } from '../../../../machine/ts/common/clamp';
import type { WorkbenchGraphItem, WorkbenchGraphModel } from './model';
import type { HostOverlayTransform } from '../../../../machine/ts/render/host_overlay/transform';

export const GRAPH_EDGE_HIT_RADIUS = 3;
// Aseprite/Godot pixel-art scales: exact integer magnification and reciprocal overviews.
const GRAPH_ZOOM_LEVELS = [1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4] as const;
export const GRAPH_ZOOM_MIN = GRAPH_ZOOM_LEVELS[0];
export const GRAPH_ZOOM_MAX = GRAPH_ZOOM_LEVELS[GRAPH_ZOOM_LEVELS.length - 1];
const REVEAL_MARGIN = 6;
export const GRAPH_FRAME_MARGIN = 8;

/** Graph-space reading center, independent of the containing pane's position and size. */
export type WorkbenchGraphViewState = {
	readonly scale: 'fit' | number;
	readonly centerX: number;
	readonly centerY: number;
};

type GraphItem<Model extends WorkbenchGraphModel> = Model['nodes'][number] | Model['edges'][number];

/** Input-owned view state; no gesture, source recognizer or layout algorithm. */
export class WorkbenchGraphViewport<Model extends WorkbenchGraphModel = WorkbenchGraphModel> {
	/** Outer canvas; content bounds exclude the scrollbar gutters. */
	public readonly canvas = create_rect_bounds();
	public readonly bounds = create_rect_bounds();
	/** Native gesture anchors belong to one physical canvas allocation. */
	public allocationRevision = 0;
	/** Legal scroll offsets, including one viewport of padding around the graph. */
	public readonly scrollBounds = create_rect_bounds();
	public readonly horizontalScrollbar = new Scrollbar('horizontal');
	public readonly verticalScrollbar = new Scrollbar('vertical');
	private readonly horizontalTrack = create_rect_bounds();
	private readonly verticalTrack = create_rect_bounds();
	public selection: GraphItem<Model> | null = null;
	private zoomValue = 1;
	private modeValue: 'fit' | 'manual' = 'fit';
	private centerX = 0;
	private centerY = 0;
	private projectingCamera = false;
	/** Last admitted layout extent; pending geometry is explicitly non-interactive. */
	private readonly layoutExtent = create_rect_bounds();
	private readonly drawTransform: HostOverlayTransform = { scale: 1, offsetX: 0, offsetY: 0 };
	private readonly visibleGraphBounds = create_rect_bounds();

	public constructor(public model: Model) {
		write_rect_bounds(this.layoutExtent, model.bounds.left, model.bounds.top, model.bounds.right, model.bounds.bottom);
		this.horizontalScrollbar.onDidScroll(() => {
			if (this.projectingCamera) return;
			this.centerX = (this.scrollX + (this.bounds.right - this.bounds.left) / 2) / this.zoomValue;
		});
		this.verticalScrollbar.onDidScroll(() => {
			if (this.projectingCamera) return;
			this.centerY = (this.scrollY + (this.bounds.bottom - this.bounds.top) / 2) / this.zoomValue;
		});
		this.updateScrollBounds();
	}

	public get scrollX(): number { return this.horizontalScrollbar.getScroll(); }
	public set scrollX(value: number) { this.beginManualNavigation(); this.horizontalScrollbar.setScroll(value); }
	public get scrollY(): number { return this.verticalScrollbar.getScroll(); }
	public set scrollY(value: number) { this.beginManualNavigation(); this.verticalScrollbar.setScroll(value); }
	public get zoom(): number { return this.zoomValue; }
	public get cameraMode(): 'fit' | 'manual' { return this.modeValue; }

	/** Native scrollbar controls write their retained scrollbars directly. */
	public beginManualNavigation(): void { this.modeValue = 'manual'; }

	public captureViewState(): WorkbenchGraphViewState {
		return { scale: this.modeValue === 'fit' ? 'fit' : this.zoomValue, centerX: this.centerX, centerY: this.centerY };
	}

	public restoreViewState(state: WorkbenchGraphViewState): void {
		this.modeValue = state.scale === 'fit' ? 'fit' : 'manual';
		if (state.scale !== 'fit') this.zoomValue = state.scale;
		this.centerX = state.centerX;
		this.centerY = state.centerY;
		if (this.modeValue === 'fit') this.frameGeometry(this.layoutExtent);
		this.updateScrollBounds();
	}

	/** Fit remains an intent: later pane sizes and admitted layouts frame the complete extent. */
	public frameAll(): void {
		this.modeValue = 'fit';
		this.frameGeometry(this.layoutExtent);
		this.updateScrollBounds();
	}

	/** An explicit local frame is a reading position, not a request to keep fitting the whole graph. */
	public frameBounds(bounds: RectBounds): void {
		this.modeValue = 'manual';
		this.frameGeometry(bounds);
		this.updateScrollBounds();
	}

	private frameGeometry(bounds: RectBounds): void {
		const width = this.bounds.right - this.bounds.left;
		const height = this.bounds.bottom - this.bounds.top;
		if (width === 0 || height === 0) return;
		const graphWidth = bounds.right - bounds.left;
		const graphHeight = bounds.bottom - bounds.top;
		this.zoomValue = clamp(Math.min(1,
			graphWidth === 0 ? 1 : Math.max(0, width - GRAPH_FRAME_MARGIN * 2) / graphWidth,
			graphHeight === 0 ? 1 : Math.max(0, height - GRAPH_FRAME_MARGIN * 2) / graphHeight), GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX);
		this.centerX = (bounds.left + bounds.right) / 2;
		this.centerY = (bounds.top + bounds.bottom) / 2;
	}

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

	/** Godot GraphEdit's inverse-anchor -> scale -> scroll sequence; never relayout. */
	public setZoom(value: number, anchorX = (this.bounds.left + this.bounds.right) / 2, anchorY = (this.bounds.top + this.bounds.bottom) / 2): void {
		this.beginManualNavigation();
		const zoom = clamp(value, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX);
		if (zoom === this.zoomValue) return;
		const x = this.viewportToGraphX(anchorX);
		const y = this.viewportToGraphY(anchorY);
		this.zoomValue = zoom;
		this.centerX = x + ((this.bounds.left + this.bounds.right) / 2 - anchorX) / zoom;
		this.centerY = y + ((this.bounds.top + this.bounds.bottom) / 2 - anchorY) / zoom;
		this.updateScrollBounds();
	}

	/** Discrete commands retain exact pixel-scale presets, including after endpoint saturation. */
	public zoomBySteps(steps: number, anchorX?: number, anchorY?: number): void {
		if (steps === 0) return;
		const last = GRAPH_ZOOM_LEVELS.length - 1;
		let index: number;
		if (steps > 0) {
			index = 0;
			while (index < last && GRAPH_ZOOM_LEVELS[index] <= this.zoomValue) index += 1;
			index += steps - 1;
		} else {
			index = last;
			while (index > 0 && GRAPH_ZOOM_LEVELS[index] >= this.zoomValue) index -= 1;
			index += steps + 1;
		}
		this.setZoom(GRAPH_ZOOM_LEVELS[clamp(index, 0, last)], anchorX, anchorY);
	}

	/** Smooth wheel distance never indexes the discrete command-preset sequence. */
	public zoomByWheel(steps: number, anchorX: number, anchorY: number): void {
		if (steps === 0) return;
		this.setZoom(this.zoomValue * 2 ** steps, anchorX, anchorY);
	}

	/** The domain owner supplies correspondence; only an explicit selection anchor follows changed geometry. */
	public setModel(model: Model, selection: GraphItem<Model> | null, anchor: 'center' | 'selection' = 'center'): void {
		if (this.modeValue === 'manual' && anchor === 'selection' && this.selection !== null && selection !== null) {
			this.centerX += selection.bounds.left - this.selection.bounds.left;
			this.centerY += selection.bounds.top - this.selection.bounds.top;
		}
		this.model = model;
		this.selection = selection;
		write_rect_bounds(this.layoutExtent, model.bounds.left, model.bounds.top, model.bounds.right, model.bounds.bottom);
		if (this.modeValue === 'fit') this.frameGeometry(this.layoutExtent);
		this.updateScrollBounds();
	}

	/** Revoke obsolete hit/draw geometry without publishing a different camera extent. */
	public setPendingModel(model: Model): void {
		this.model = model;
		this.selection = null;
	}

	public layout(left: number, top: number, right: number, bottom: number): void {
		if (this.canvas.left === left && this.canvas.top === top && this.canvas.right === right && this.canvas.bottom === bottom) return;
		this.allocationRevision += 1;
		write_rect_bounds(this.canvas, left, top, right, bottom);
		const contentRight = Math.max(left, right - SCROLLBAR_WIDTH);
		const contentBottom = Math.max(top, bottom - SCROLLBAR_WIDTH);
		write_rect_bounds(this.bounds, left, top, contentRight, contentBottom);
		write_rect_bounds(this.horizontalTrack, left, contentBottom, contentRight, bottom);
		write_rect_bounds(this.verticalTrack, contentRight, top, right, contentBottom);
		if (this.modeValue === 'fit') this.frameGeometry(this.layoutExtent);
		this.updateScrollBounds();
	}

	private updateScrollBounds(): void {
		const width = this.bounds.right - this.bounds.left;
		const height = this.bounds.bottom - this.bounds.top;
		const graph = this.layoutExtent;
		const zoom = this.zoomValue;
		const x = this.centerX * zoom - width / 2;
		const y = this.centerY * zoom - height / 2;
		// Resizing or publishing a smaller graph must not clamp away the retained reading center.
		write_rect_bounds(this.scrollBounds, Math.min(graph.left * zoom - width, x), Math.min(graph.top * zoom - height, y),
			Math.max(graph.right * zoom, x), Math.max(graph.bottom * zoom, y));
		this.projectingCamera = true;
		this.horizontalScrollbar.layout(this.horizontalTrack, this.scrollBounds.right - this.scrollBounds.left + width, width, x, this.scrollBounds.left);
		this.verticalScrollbar.layout(this.verticalTrack, this.scrollBounds.bottom - this.scrollBounds.top + height, height, y, this.scrollBounds.top);
		this.projectingCamera = false;
	}

	public pan(deltaX: number, deltaY: number): void {
		if (deltaX === 0 && deltaY === 0) return;
		this.beginManualNavigation();
		this.horizontalScrollbar.setScroll(this.scrollX + deltaX);
		this.verticalScrollbar.setScroll(this.scrollY + deltaY);
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
		const x = this.scrollX, y = this.scrollY;
		const bounds = item.bounds;
		this.horizontalScrollbar.reveal(bounds.left * this.zoomValue, bounds.right * this.zoomValue, REVEAL_MARGIN);
		this.verticalScrollbar.reveal(bounds.top * this.zoomValue,
			(item.kind === 'node' ? bounds.top + item.headerHeight : bounds.bottom) * this.zoomValue, REVEAL_MARGIN);
		if (this.scrollX !== x || this.scrollY !== y) this.beginManualNavigation();
	}

	/** Reveal a region without zooming or choosing an item. Oversized ranges keep existing overlap. */
	public revealBounds(bounds: RectBounds): void {
		const x = this.scrollX, y = this.scrollY;
		this.horizontalScrollbar.revealRange(bounds.left * this.zoomValue, bounds.right * this.zoomValue, REVEAL_MARGIN);
		this.verticalScrollbar.revealRange(bounds.top * this.zoomValue, bounds.bottom * this.zoomValue, REVEAL_MARGIN);
		if (this.scrollX !== x || this.scrollY !== y) this.beginManualNavigation();
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
