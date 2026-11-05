import type { VideoOutputBounds } from '../../machine/ts/render/video_output';

/** Published mapping from a host's presentation target to client coordinates.
 * The output owns measurement; input consumers share this retained geometry. */
export class DisplayGeometry {
	private readonly clientBounds: VideoOutputBounds = { left: 0, top: 0, width: 0, height: 0 };
	private width = 0;
	private height = 0;
	private readonly listeners = new Set<() => void>();

	public get bounds(): Readonly<VideoOutputBounds> { return this.clientBounds; }
	public get targetWidth(): number { return this.width; }
	public get targetHeight(): number { return this.height; }

	public update(left: number, top: number, width: number, height: number, targetWidth: number, targetHeight: number): void {
		const bounds = this.clientBounds;
		if (bounds.left === left && bounds.top === top && bounds.width === width && bounds.height === height
			&& this.width === targetWidth && this.height === targetHeight) return;
		bounds.left = left; bounds.top = top; bounds.width = width; bounds.height = height;
		this.width = targetWidth; this.height = targetHeight;
		for (const listener of this.listeners) listener();
	}

	public onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	public dispose(): void { this.listeners.clear(); }
}
