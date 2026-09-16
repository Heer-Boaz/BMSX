import type { RectBounds } from '../../../machine/ts/common/rect';
import { GX_GPU_DISPLAY_ASPECT_WIDTH, GX_GPU_DISPLAY_ASPECT_HEIGHT } from '../../../machine/ts/spec/bmsx/model';

/** Fit native scanout with the same pixel aspect as the ordinary host display. */
export function layoutGameFrame(bounds: RectBounds, left: number, top: number, right: number, bottom: number): void {
	const width = Math.max(0, right - left), height = Math.max(0, bottom - top);
	const scale = Math.trunc(Math.min(width / GX_GPU_DISPLAY_ASPECT_WIDTH, height / GX_GPU_DISPLAY_ASPECT_HEIGHT));
	const frameWidth = GX_GPU_DISPLAY_ASPECT_WIDTH * scale, frameHeight = GX_GPU_DISPLAY_ASPECT_HEIGHT * scale;
	bounds.left = left + Math.trunc((width - frameWidth) / 2);
	bounds.top = top + Math.trunc((height - frameHeight) / 2);
	bounds.right = bounds.left + frameWidth;
	bounds.bottom = bounds.top + frameHeight;
}
