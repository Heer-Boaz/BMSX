import { clamp } from '../../../../machine/ts/common/clamp';
import { copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';

export const WINDOW_RESIZE_MARGIN = 3;

export const enum WindowResizeEdge { None = 0, Left = 1, Top = 2, Right = 4, Bottom = 8 }

/** Normal requested placement survives work-area constraints, maximize and minimize. */
export class WorkbenchWindowModel {
	public readonly requestedBounds = create_rect_bounds();
	public readonly bounds = create_rect_bounds();
	public readonly header = create_rect_bounds();
	public readonly client = create_rect_bounds();
	public open = false;
	public maximized = false;
	public minimized = false;
	public font: BFont | undefined;
	public displayTitle = '';
	public revision = 0;
	private titleValue = '';
	private placementRevision = 0;
	private placementListeners: Set<() => void> | undefined;
	private arrangedRevision = -1;
	private headerHeight = 0;
	private readonly workArea = create_rect_bounds();

	public constructor(requestedBounds: Readonly<RectBounds>, public minimumWidth: number, public minimumHeight: number) {
		copy_rect_bounds(this.requestedBounds, requestedBounds);
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

	public setRequestedBounds(bounds: Readonly<RectBounds>): void {
		const requested = this.requestedBounds;
		if (requested.left === bounds.left && requested.top === bounds.top
			&& requested.right === bounds.right && requested.bottom === bounds.bottom) return;
		copy_rect_bounds(this.requestedBounds, bounds);
		this.revision += 1;
		this.placementRevision += 1;
		this.publishPlacement();
	}

	public setMinimized(minimized: boolean): void {
		if (this.minimized === minimized) return;
		this.minimized = minimized;
		this.revision += 1;
		this.placementRevision += 1;
		this.publishPlacement();
	}

	public setMaximized(maximized: boolean): void {
		if (this.maximized === maximized) return;
		this.maximized = maximized;
		this.revision += 1;
		this.placementRevision += 1;
		this.publishPlacement();
	}

	private publishPlacement(): void {
		if (this.placementListeners !== undefined) for (const listener of this.placementListeners) listener();
	}

	public setMinimumSize(width: number, height: number): void {
		if (this.minimumWidth === width && this.minimumHeight === height) return;
		this.minimumWidth = width; this.minimumHeight = height;
		this.revision += 1;
		this.placementRevision += 1;
	}

	/** Source-owned action changes explicitly invalidate retained chrome. */
	public invalidate(): void { this.revision += 1; }

	public arrange(workArea: Readonly<RectBounds>, headerHeight: number): boolean {
		if (this.arrangedRevision === this.placementRevision && this.headerHeight === headerHeight
			&& this.workArea.left === workArea.left && this.workArea.top === workArea.top
			&& this.workArea.right === workArea.right && this.workArea.bottom === workArea.bottom) return false;
		copy_rect_bounds(this.workArea, workArea);
		this.arrangedRevision = this.placementRevision;
		this.headerHeight = headerHeight;
		const requested = this.requestedBounds;
		const areaWidth = workArea.right - workArea.left, areaHeight = workArea.bottom - workArea.top;
		const maximized = this.maximized;
		const width = maximized ? areaWidth : clamp(requested.right - requested.left, Math.min(this.minimumWidth, areaWidth), areaWidth);
		const height = maximized ? areaHeight : clamp(requested.bottom - requested.top, Math.min(this.minimumHeight, areaHeight), areaHeight);
		const left = maximized ? workArea.left : clamp(requested.left, workArea.left, workArea.right - width);
		const top = maximized ? workArea.top : clamp(requested.top, workArea.top, workArea.bottom - height);
		write_rect_bounds(this.bounds, left, top, left + width, top + height);
		write_rect_bounds(this.header, left, top, left + width, Math.min(top + headerHeight, top + height));
		const clientLeft = Math.min(left + WINDOW_RESIZE_MARGIN, left + width);
		const clientTop = this.header.bottom;
		write_rect_bounds(this.client, clientLeft, clientTop, Math.max(clientLeft, left + width - WINDOW_RESIZE_MARGIN),
			Math.max(clientTop, top + height - WINDOW_RESIZE_MARGIN));
		return true;
	}

	public resizeEdgeAt(x: number, y: number): WindowResizeEdge {
		if (this.maximized) return WindowResizeEdge.None;
		const bounds = this.bounds;
		let edge = WindowResizeEdge.None;
		if (x < bounds.left + WINDOW_RESIZE_MARGIN) edge |= WindowResizeEdge.Left;
		else if (x >= bounds.right - WINDOW_RESIZE_MARGIN) edge |= WindowResizeEdge.Right;
		if (y < bounds.top + WINDOW_RESIZE_MARGIN) edge |= WindowResizeEdge.Top;
		else if (y >= bounds.bottom - WINDOW_RESIZE_MARGIN) edge |= WindowResizeEdge.Bottom;
		return edge;
	}
}
