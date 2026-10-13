import type { VideoOutput } from '../../machine/ts/render/video_output';
import type { RectBounds } from '../../machine/ts/common/rect';

export class OffscreenVideoOutput implements VideoOutput {
	public readonly visibleViewportBounds: RectBounds;
	private readonly displayBounds: { width: number; height: number; left: number; top: number; };

	public constructor(width: number, height: number) {
		this.displayBounds = { width, height, left: 0, top: 0 };
		this.visibleViewportBounds = { left: 0, top: 0, right: width, bottom: height };
	}

	public setDisplaySize(width: number, height: number): void {
		this.displayBounds.width = width;
		this.displayBounds.height = height;
		this.visibleViewportBounds.left = 0;
		this.visibleViewportBounds.top = 0;
		this.visibleViewportBounds.right = width;
		this.visibleViewportBounds.bottom = height;
	}

	public measureDisplay(): { width: number; height: number; left: number; top: number; } {
		return this.displayBounds;
	}
}
