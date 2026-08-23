export type VideoOutputBounds = {
	width: number;
	height: number;
	left: number;
	top: number;
};

export const enum DisplayPointMappingResult {
	Invalid,
	Outside,
	Inside,
}

export function mapDisplayPointToViewport(
	bounds: VideoOutputBounds,
	viewportWidth: number,
	viewportHeight: number,
	screenX: number,
	screenY: number,
	target: { x: number; y: number },
): DisplayPointMappingResult {
	if (bounds.width <= 0 || bounds.height <= 0) {
		return DisplayPointMappingResult.Invalid;
	}
	const relativeX = screenX - bounds.left;
	const relativeY = screenY - bounds.top;
	target.x = ((relativeX / bounds.width) * viewportWidth) | 0;
	target.y = ((relativeY / bounds.height) * viewportHeight) | 0;
	return relativeX >= 0
		&& relativeX < bounds.width
		&& relativeY >= 0
		&& relativeY < bounds.height
		? DisplayPointMappingResult.Inside
		: DisplayPointMappingResult.Outside;
}

export interface VideoOutput {
	setDisplaySize(width: number, height: number): void;
	measureDisplay(): VideoOutputBounds;
}
