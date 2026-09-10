const DRAG_SCROLL_MARGIN = 12;
const DRAG_SCROLL_SPEED = 120; // Viewport pixels per host second, not emulated frames.

/** Shared edge auto-scroll for captured workbench drags. */
export function dragScrollSpeed(position: number, start: number, end: number): number {
	if (position < start + DRAG_SCROLL_MARGIN) return -DRAG_SCROLL_SPEED * (start + DRAG_SCROLL_MARGIN - position) / DRAG_SCROLL_MARGIN;
	if (position > end - DRAG_SCROLL_MARGIN) return DRAG_SCROLL_SPEED * (position - end + DRAG_SCROLL_MARGIN) / DRAG_SCROLL_MARGIN;
	return 0;
}
