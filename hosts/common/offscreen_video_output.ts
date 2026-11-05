import type { VideoOutput, VideoOutputBounds } from '../../machine/ts/render/video_output';
import type { RectBounds } from '../../machine/ts/common/rect';
import { WorkspaceDisplay } from './workspace_display';
import type { PointerCursor } from './input/pointer_event';
import { DisplayGeometry } from './display_geometry';

export class OffscreenVideoOutput implements VideoOutput {
	public readonly geometry = new DisplayGeometry();
	/** Virtual host window, independent of the emulated scanout dimensions. */
	public readonly workspace = new WorkspaceDisplay(1152, 864, () => {});
	public pointerCursor: PointerCursor = 'default';
	public setPointerCursor(cursor: PointerCursor): void { this.pointerCursor = cursor; }
	public readonly visibleViewportBounds: RectBounds;

	public constructor(width: number, height: number) {
		this.visibleViewportBounds = { left: 0, top: 0, right: width, bottom: height };
		this.geometry.update(0, 0, width, height, width, height);
	}

	public setDisplaySize(width: number, height: number): void {
		this.visibleViewportBounds.left = 0;
		this.visibleViewportBounds.top = 0;
		this.visibleViewportBounds.right = width;
		this.visibleViewportBounds.bottom = height;
		this.geometry.update(0, 0, width, height, width, height);
	}

	public measureDisplay(): Readonly<VideoOutputBounds> {
		return this.geometry.bounds;
	}
}
