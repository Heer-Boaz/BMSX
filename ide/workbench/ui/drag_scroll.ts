const DRAG_SCROLL_MARGIN = 12;
const DRAG_SCROLL_SPEED = 120; // Viewport pixels per host second, not emulated frames.

/** Shared edge auto-scroll for captured workbench drags. */
export function dragScrollSpeed(position: number, start: number, end: number): number {
	const margin = Math.min(DRAG_SCROLL_MARGIN, (end - start) / 2);
	if (position < start + margin) return -DRAG_SCROLL_SPEED * (start + margin - position) / DRAG_SCROLL_MARGIN;
	if (position > end - margin) return DRAG_SCROLL_SPEED * (position - end + margin) / DRAG_SCROLL_MARGIN;
	return 0;
}
