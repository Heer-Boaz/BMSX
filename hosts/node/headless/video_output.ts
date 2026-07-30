import type { VideoOutput } from '../../../machine/ts/render/video_output';

export class HeadlessVideoOutput implements VideoOutput {
	private readonly displayBounds: { width: number; height: number; left: number; top: number; };

	public constructor(width: number, height: number) {
		this.displayBounds = { width, height, left: 0, top: 0 };
	}

	public setDisplaySize(width: number, height: number): void {
		this.displayBounds.width = width;
		this.displayBounds.height = height;
	}

	public measureDisplay(): { width: number; height: number; left: number; top: number; } {
		return this.displayBounds;
	}
}
