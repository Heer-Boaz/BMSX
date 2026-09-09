/** Half-open bounds in the overlay lane's logical pixels. */
export type HostOverlayClipRect = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

/** Render-target scissor, independent of UI nesting and primitive kind. */
export class HostOverlayClipState {
	public left = 0;
	public top = 0;
	public right = 0;
	public bottom = 0;
	private width = 0;
	private height = 0;
	private logicalWidth = 0;
	private logicalHeight = 0;

	public reset(logicalWidth: number, logicalHeight: number, width: number, height: number): void {
		this.logicalWidth = logicalWidth;
		this.logicalHeight = logicalHeight;
		this.width = width;
		this.height = height;
		this.left = 0;
		this.top = 0;
		this.right = width;
		this.bottom = height;
	}

	public set(clip: HostOverlayClipRect): void {
		this.left = Math.max(0, Math.min(this.width, Math.trunc(clip.left * this.width / this.logicalWidth)));
		this.top = Math.max(0, Math.min(this.height, Math.trunc(clip.top * this.height / this.logicalHeight)));
		this.right = Math.max(this.left, Math.min(this.width, Math.trunc(clip.right * this.width / this.logicalWidth)));
		this.bottom = Math.max(this.top, Math.min(this.height, Math.trunc(clip.bottom * this.height / this.logicalHeight)));
	}
}
