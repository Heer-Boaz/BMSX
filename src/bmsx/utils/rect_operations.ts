import type { RectBounds, vec2, vec3 } from '../rompack/rompack';

export function is_area(v: unknown): v is RectBounds {
	return !!v && typeof v === 'object'
		&& 'left' in v
		&& 'top' in v
		&& 'right' in v
		&& 'bottom' in v
}

/**
 * Moves an area by adding the specified vector to its start and end points.
 * @param a - The area to be moved.
 * @param p - The vector representing the amount to move the area by.
 * @returns The moved area.
 */
export function moveArea(a: RectBounds, p: vec3): RectBounds {
	a.top += p.y;
	a.bottom += p.y;
	a.left += p.x;
	a.right += p.x;
	return a;
}

/**
 * Sets the values of the given `Area` object in place with the values from another `Area` object.
 *
 * @param a - The target `Area` object to be modified.
 * @param n - The source `Area` object containing the new values.
 */
export function set_inplace_area(a: RectBounds, n: RectBounds): void {
	a.bottom = n.bottom;
	a.left = n.left;
	a.right = n.right;
	a.top = n.top;
}

/**
 * Creates a new area with the specified coordinates.
 * @param sx The x-coordinate of the start point.
 * @param sy The y-coordinate of the start point.
 * @param ex The x-coordinate of the end point.
 * @param ey The y-coordinate of the end point.
 * @returns The newly created area.
 */
export function new_area(sx: number, sy: number, ex: number, ey: number): RectBounds {
	return new_area3d(sx, sy, undefined, ex, ey);
}

export function new_area3d(sx: number, sy: number, z: number, ex: number, ey: number): RectBounds {
	[sx, sy, ex, ey] = correctAreaStartEnd(sx, sy, ex, ey);
	return { left: sx, top: sy, right: ex, bottom: ey, z: z };
}
function correctAreaStartEnd(x: number, y: number, ex: number, ey: number) {
	if (ex < x) {
		[x, ex] = [ex, x];
	}
	// Reverse y and ey if ey < y
	if (ey < y) {
		[y, ey] = [ey, y];
	}

	return [x, y, ex, ey];
}

export function middlepoint_area(a: RectBounds): vec2 {
	return { x: ~~((a.left + a.right) / 2), y: ~~((a.top + a.bottom) / 2) };
}

/**
 * Calculates the overlap area between two areas.
 * @param a The first area.
 * @param b The second area.
 * @returns The overlap area between the two areas.
 */
export function get_overlap_area(a: RectBounds, b: RectBounds): RectBounds {
	const startX = Math.max(a.left, b.left);
	const startY = Math.max(a.top, b.top);
	const endX = Math.min(a.right, b.right);
	const endY = Math.min(a.bottom, b.bottom);
	return new_area(startX, startY, endX, endY);
}
export function pointInRect(x: number, y: number, rect: RectBounds): boolean {
	return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}
export function point_in_rect(x: number, y: number, rect: RectBounds): boolean {
	if (!rect) {
		return false;
	}
	return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

