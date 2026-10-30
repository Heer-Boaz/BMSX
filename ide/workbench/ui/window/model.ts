import { clamp } from '../../../../machine/ts/common/clamp';
import { copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';

export const WINDOW_RESIZE_MARGIN = 3;
export const WINDOW_HEADER_VERTICAL_PADDING = 8;

export const enum WindowResizeEdge { None = 0, Left = 1, Top = 2, Right = 4, Bottom = 8 }

export type WindowPlacement = 'normal' | 'maximized' | 'left' | 'right';

export type WorkbenchWindowPlacementState = {
	readonly requestedBounds: Readonly<RectBounds>;
	readonly placement: WindowPlacement;
	readonly minimized: boolean;
};

/** Normal requested placement survives work-area constraints, snapping, maximize and minimize. */
export class WorkbenchWindowModel {
	public readonly requestedBounds = create_rect_bounds();
	public readonly bounds = create_rect_bounds();
	public readonly header = create_rect_bounds();
	public readonly client = create_rect_bounds();
	public open = false;
	public placement: WindowPlacement = 'normal';
	public arrangedPlacement: WindowPlacement = 'normal';
	public minimized = false;
	public font: BFont | undefined;
	public displayTitle = '';
	/** Full native window identity for discovery, independently of its compact title. */
	public description = '';
	public revision = 0;
	private titleValue = '';
	private placementRevision = 0;
	private placementInitializedValue: boolean;
	private placementListeners: Set<() => void> | undefined;
	private arrangedRevision = -1;
	private headerHeight = 0;
	private chromeMinimumWidth = 0;
	private readonly workArea = create_rect_bounds();
	private readonly arrangedRequest = create_rect_bounds();

	public constructor(requestedBounds: Readonly<RectBounds> | undefined, private contributionMinimumWidth: number, public minimumHeight: number) {
		this.placementInitializedValue = requestedBounds !== undefined;
		if (requestedBounds !== undefined) copy_rect_bounds(this.requestedBounds, requestedBounds);
	}

	public get minimumWidth(): number { return Math.max(this.contributionMinimumWidth, this.chromeMinimumWidth); }
	public get placementInitialized(): boolean { return this.placementInitializedValue; }
	/** Placement authority is independent of title and derived minimum-size changes. */
	public get placementGeneration(): number { return this.placementRevision; }

	/** The owning content produces current default geometry before its next presentation. */
	public requestDefaultPlacement(): number {
		if (!this.placementInitializedValue && this.placement === 'normal' && !this.minimized) return this.placementRevision;
		this.placementInitializedValue = false;
		this.placement = 'normal'; this.minimized = false;
		this.revision += 1; this.placementRevision += 1;
		const generation = this.placementRevision;
		this.publishPlacement(); return generation;
	}

	public get title(): string { return this.titleValue; }
	public set title(value: string) {
		if (this.titleValue === value) return;
		this.titleValue = value;
		this.revision += 1;
	}

	public onDidChangePlacement(listener: () => void): () => void {
		const listeners = this.placementListeners ??= new Set();
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	public setRequestedBounds(bounds: Readonly<RectBounds>, placement = this.placement): number {
		const requested = this.requestedBounds;
		if (this.placementInitializedValue && this.placement === placement && requested.left === bounds.left && requested.top === bounds.top
			&& requested.right === bounds.right && requested.bottom === bounds.bottom) return this.placementRevision;
		this.placementInitializedValue = true;
		copy_rect_bounds(this.requestedBounds, bounds);
		this.placement = placement;
		this.revision += 1;
		this.placementRevision += 1;
		const generation = this.placementRevision;
		this.publishPlacement(); return generation;
	}

	public setMinimized(minimized: boolean): void {
		if (this.minimized === minimized) return;
		this.minimized = minimized;
		this.revision += 1;
		this.placementRevision += 1;
		this.publishPlacement();
	}

	/** Restore one persisted placement before observers arrange or publish its presentation. */
	public setState(state: WorkbenchWindowPlacementState): number {
		const requested = this.requestedBounds, bounds = state.requestedBounds;
		if (this.placementInitializedValue && this.placement === state.placement && this.minimized === state.minimized
			&& requested.left === bounds.left && requested.top === bounds.top
			&& requested.right === bounds.right && requested.bottom === bounds.bottom) return this.placementRevision;
		this.placementInitializedValue = true;
		copy_rect_bounds(requested, bounds);
		this.placement = state.placement;
		this.minimized = state.minimized;
		this.revision += 1;
		this.placementRevision += 1;
		const generation = this.placementRevision;
		this.publishPlacement(); return generation;
	}

	public setPlacement(placement: WindowPlacement): void {
		if (this.placement === placement) return;
		this.placement = placement;
		this.revision += 1;
		this.placementRevision += 1;
		this.publishPlacement();
	}

	public canPlace(placement: WindowPlacement, workArea: Readonly<RectBounds>): boolean {
		if (placement === 'normal' || placement === 'maximized') return true;
		const areaWidth = workArea.right - workArea.left;
		const leftWidth = areaWidth >> 1;
		return this.minimumWidth <= (placement === 'left' ? leftWidth : areaWidth - leftWidth)
			&& this.minimumHeight <= workArea.bottom - workArea.top;
	}

	/** Prospective and committed placement use the same live work-area geometry. */
	public writePlacementBounds(placement: WindowPlacement, workArea: Readonly<RectBounds>, target: RectBounds,
		normalRequest: Readonly<RectBounds> = this.requestedBounds): void {
		const areaWidth = workArea.right - workArea.left, areaHeight = workArea.bottom - workArea.top;
		if (placement === 'normal') {
			const width = clamp(normalRequest.right - normalRequest.left, Math.min(this.minimumWidth, areaWidth), areaWidth);
			const height = clamp(normalRequest.bottom - normalRequest.top, Math.min(this.minimumHeight, areaHeight), areaHeight);
			const left = clamp(normalRequest.left, workArea.left, workArea.right - width);
			const top = clamp(normalRequest.top, workArea.top, workArea.bottom - height);
			write_rect_bounds(target, left, top, left + width, top + height);
		} else {
			const midpoint = workArea.left + (areaWidth >> 1);
			write_rect_bounds(target, placement === 'right' ? midpoint : workArea.left, workArea.top,
				placement === 'left' ? midpoint : workArea.right, workArea.bottom);
		}
	}

	private publishPlacement(): void {
		if (this.placementListeners !== undefined) for (const listener of this.placementListeners) listener();
	}

	/** Both pointer edges and keyboard sizing consume the same displayed anchor and live constraints. */
	public writeResizeBounds(start: Readonly<RectBounds>, requested: Readonly<RectBounds>, workArea: Readonly<RectBounds>,
		edge: WindowResizeEdge, dx: number, dy: number, target: RectBounds): void {
		copy_rect_bounds(target, requested);
		const minWidth = Math.min(this.minimumWidth, workArea.right - workArea.left);
		const minHeight = Math.min(this.minimumHeight, workArea.bottom - workArea.top);
		if ((edge & WindowResizeEdge.Left) !== 0) {
			target.left = clamp(start.left + dx, workArea.left, start.right - minWidth); target.right = start.right;
		} else if ((edge & WindowResizeEdge.Right) !== 0) {
			target.left = start.left; target.right = clamp(start.right + dx, start.left + minWidth, workArea.right);
		}
		if ((edge & WindowResizeEdge.Top) !== 0) {
			target.top = clamp(start.top + dy, workArea.top, start.bottom - minHeight); target.bottom = start.bottom;
		} else if ((edge & WindowResizeEdge.Bottom) !== 0) {
			target.top = start.top; target.bottom = clamp(start.bottom + dy, start.top + minHeight, workArea.bottom);
		}
	}

	public setMinimumSize(width: number, height: number): void {
		if (this.contributionMinimumWidth === width && this.minimumHeight === height) return;
		this.contributionMinimumWidth = width; this.minimumHeight = height;
		this.revision += 1;
		this.arrangedRevision = -1;
	}

	/** Source-owned action changes explicitly invalidate retained chrome. */
	public invalidate(): void { this.revision += 1; }

	public arrange(workArea: Readonly<RectBounds>, headerHeight: number, normalPreview?: Readonly<RectBounds>,
		chromeMinimumWidth = this.chromeMinimumWidth): boolean {
		const placement = normalPreview === undefined ? this.placement : 'normal';
		const requested = normalPreview === undefined ? this.requestedBounds : normalPreview;
		if (this.arrangedRevision === this.placementRevision && this.arrangedPlacement === placement && this.headerHeight === headerHeight
			&& this.chromeMinimumWidth === chromeMinimumWidth
			&& this.arrangedRequest.left === requested.left && this.arrangedRequest.top === requested.top
			&& this.arrangedRequest.right === requested.right && this.arrangedRequest.bottom === requested.bottom
			&& this.workArea.left === workArea.left && this.workArea.top === workArea.top
			&& this.workArea.right === workArea.right && this.workArea.bottom === workArea.bottom) return false;
		copy_rect_bounds(this.workArea, workArea);
		copy_rect_bounds(this.arrangedRequest, requested);
		this.arrangedPlacement = placement;
		this.arrangedRevision = this.placementRevision;
		this.headerHeight = headerHeight;
		this.chromeMinimumWidth = chromeMinimumWidth;
		this.writePlacementBounds(placement, workArea, this.bounds, requested);
		const { left, top, right, bottom } = this.bounds;
		write_rect_bounds(this.header, left, top, right, Math.min(top + headerHeight, bottom));
		const clientLeft = Math.min(left + WINDOW_RESIZE_MARGIN, right);
		const clientTop = this.header.bottom;
		write_rect_bounds(this.client, clientLeft, clientTop, Math.max(clientLeft, right - WINDOW_RESIZE_MARGIN),
			Math.max(clientTop, bottom - WINDOW_RESIZE_MARGIN));
		return true;
	}

	public resizeEdgeAt(x: number, y: number): WindowResizeEdge {
		if (this.arrangedPlacement === 'maximized') return WindowResizeEdge.None;
		const bounds = this.bounds;
		let edge = WindowResizeEdge.None;
		if (x < bounds.left + WINDOW_RESIZE_MARGIN) edge |= WindowResizeEdge.Left;
		else if (x >= bounds.right - WINDOW_RESIZE_MARGIN) edge |= WindowResizeEdge.Right;
		if (y < bounds.top + WINDOW_RESIZE_MARGIN) edge |= WindowResizeEdge.Top;
		else if (y >= bounds.bottom - WINDOW_RESIZE_MARGIN) edge |= WindowResizeEdge.Bottom;
		return edge;
	}
}
