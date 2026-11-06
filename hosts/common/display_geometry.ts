import type { VideoOutputBounds } from '../../machine/ts/render/video_output';

/** Published mapping of raster pixels and logical composition to client units.
 * The output owns measurement; input/IME consume the logical viewport, never
 * the backing-buffer density. Both spaces change with the displayed frame. */
export class DisplayGeometry {
	private readonly clientBounds: VideoOutputBounds = { left: 0, top: 0, width: 0, height: 0 };
	private width = 0;
	private height = 0;
	private logicalWidth = 0;
	private logicalHeight = 0;
	private readonly listeners = new Set<() => void>();

	public get bounds(): Readonly<VideoOutputBounds> { return this.clientBounds; }
	public get targetWidth(): number { return this.width; }
	public get targetHeight(): number { return this.height; }
	public get viewportWidth(): number { return this.logicalWidth; }
	public get viewportHeight(): number { return this.logicalHeight; }

	public update(left: number, top: number, width: number, height: number, targetWidth: number, targetHeight: number,
		viewportWidth: number, viewportHeight: number): void {
		const bounds = this.clientBounds;
		if (bounds.left === left && bounds.top === top && bounds.width === width && bounds.height === height
			&& this.width === targetWidth && this.height === targetHeight
			&& this.logicalWidth === viewportWidth && this.logicalHeight === viewportHeight) return;
		bounds.left = left; bounds.top = top; bounds.width = width; bounds.height = height;
		this.width = targetWidth; this.height = targetHeight;
		this.logicalWidth = viewportWidth; this.logicalHeight = viewportHeight;
		for (const listener of this.listeners) listener();
	}

	public onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	public dispose(): void { this.listeners.clear(); }
}
