import type { Area, RectBounds, vec2, vec3 } from '../rompack/rompack';
import { set_inplace_vec2 } from './vector_operations';

/**
 * Moves an area by adding the specified vector to its start and end points.
 * @param a - The area to be moved.
 * @param p - The vector representing the amount to move the area by.
 * @returns The moved area.
 */
export function moveArea(a: Area, p: vec3): Area {
	return {
		start: { x: a.start.x + p.x, y: a.start.y + p.y },
		end: { x: a.end.x + p.x, y: a.end.y + p.y },
	};
}

/**
 * Sets the values of the given `Area` object in place with the values from another `Area` object.
 *
 * @param a - The target `Area` object to be modified.
 * @param n - The source `Area` object containing the new values.
 */
export function set_inplace_area(a: Area, n: Area): void {
	set_inplace_vec2(a.start, n.start);
	set_inplace_vec2(a.end, n.end);
}

/**
 * Creates a new area with the specified coordinates.
 * @param sx The x-coordinate of the start point.
 * @param sy The y-coordinate of the start point.
 * @param ex The x-coordinate of the end point.
 * @param ey The y-coordinate of the end point.
 * @returns The newly created area.
 */
export function new_area(sx: number, sy: number, ex: number, ey: number): Area {
	return new_area3d(sx, sy, undefined, ex, ey, undefined);
}

export function new_area3d(sx: number, sy: number, sz: number, ex: number, ey: number, ez?: number): Area {
	[sx, sy, ex, ey] = correctAreaStartEnd(sx, sy, ex, ey);
	return { start: { x: sx, y: sy, z: sz }, end: { x: ex, y: ey, z: ez } };
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

export function middlepoint_area(a: Area): vec2 {
	return { x: ~~((a.start.x + a.end.x) / 2), y: ~~((a.start.y + a.end.y) / 2) };
}

/**
 * Calculates the overlap area between two areas.
 * @param a The first area.
 * @param b The second area.
 * @returns The overlap area between the two areas.
 */
export function get_overlap_area(a: Area, b: Area): Area {
	const startX = Math.max(a.start.x, b.start.x);
	const startY = Math.max(a.start.y, b.start.y);
	const endX = Math.min(a.end.x, b.end.x);
	const endY = Math.min(a.end.y, b.end.y);
	return new_area(startX, startY, endX, endY);
}
export function pointInRect(x: number, y: number, rect: RectBounds): boolean {
	return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

