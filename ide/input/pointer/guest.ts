import {
	DisplayPointMappingResult, mapDisplayPointToViewport,
	type VideoOutputBounds,
} from '../../../machine/ts/render/video_output';
import type { GuestInputBinding } from '../focus';
import { clamp } from '../../../machine/ts/common/clamp';

const imageBounds: VideoOutputBounds = { left: 0, top: 0, width: 0, height: 0 };

/** Project Studio coordinates into the image actually painted by this viewport. */
export function projectGuestPointer(binding: GuestInputBinding, x: number, y: number,
	target: { x: number; y: number }): DisplayPointMappingResult {
	const { bounds, presentation } = binding;
	let width: number, height: number;
	if (presentation.kind === 'direct') {
		const size = presentation.presenter.offscreenCanvasSize;
		width = size.x; height = size.y;
	} else {
		const image = presentation.frames.bitmap!.image;
		width = image.width; height = image.height;
	}
	imageBounds.left = bounds.left;
	imageBounds.top = bounds.top;
	imageBounds.width = bounds.right - bounds.left;
	imageBounds.height = bounds.bottom - bounds.top;
	const result = mapDisplayPointToViewport(imageBounds, width, height, x, y, target);
	if (result === DisplayPointMappingResult.Invalid) return result;
	// Capture may continue outside the image; attachment coordinates stop at its edge.
	target.x = clamp(target.x, 0, width - 1);
	target.y = clamp(target.y, 0, height - 1);
	return result;
}
