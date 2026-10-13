import type { RoundedCircularArc } from '../../hosts/browser/touch_geometry';

/** Independent test geometry: angle-clamped finite arcs, never the browser's
 * contact/acquisition implementation or its rational polynomial query. */
export interface ControlShapeOracle {
	x: number;
	y: number;
	radius: number;
	outline?: RoundedCircularArc;
}

const TAU = Math.PI * 2;

function angleIsOnArc(angle: number, arc: RoundedCircularArc): boolean {
	const start = Math.atan2(arc.startY, arc.startX);
	const sweep = (Math.atan2(arc.endY, arc.endX) - start + TAU) % TAU;
	return (angle - start + TAU) % TAU <= sweep;
}

function corePointDistance(shape: ControlShapeOracle, x: number, y: number): number {
	const arc = shape.outline;
	if (!arc) return Math.hypot(x - shape.x, y - shape.y);
	const dx = x - shape.x - arc.centerX;
	const dy = y - shape.y - arc.centerY;
	if (angleIsOnArc(Math.atan2(dy, dx), arc)) return Math.abs(Math.hypot(dx, dy) - arc.radius);
	return Math.min(Math.hypot(dx - arc.radius * arc.startX, dy - arc.radius * arc.startY),
		Math.hypot(dx - arc.radius * arc.endX, dy - arc.radius * arc.endY));
}

export function distanceToControl(shape: ControlShapeOracle, x: number, y: number): number {
	return Math.max(0, corePointDistance(shape, x, y) - (shape.outline?.halfWidth ?? shape.radius));
}

export function controlContainsPoint(shape: ControlShapeOracle, x: number, y: number): boolean {
	return corePointDistance(shape, x, y) <= (shape.outline?.halfWidth ?? shape.radius);
}

/** Finite arc-pair distance candidates are endpoint projections, stationary
 * radial points on the centre-to-centre line, and actual circle intersections.
 * Concentric arcs have the radial distance wherever their angular spans meet. */
export function controlSeparation(first: ControlShapeOracle, second: ControlShapeOracle): number {
	const a = first.outline;
	const b = second.outline;
	if (!a) return corePointDistance(second, first.x, first.y) - first.radius - (b?.halfWidth ?? second.radius);
	if (!b) return corePointDistance(first, second.x, second.y) - a.halfWidth - second.radius;
	const ax = first.x + a.centerX;
	const ay = first.y + a.centerY;
	const bx = second.x + b.centerX;
	const by = second.y + b.centerY;
	let minimum = Math.min(
		corePointDistance(second, ax + a.radius * a.startX, ay + a.radius * a.startY),
		corePointDistance(second, ax + a.radius * a.endX, ay + a.radius * a.endY),
		corePointDistance(first, bx + b.radius * b.startX, by + b.radius * b.startY),
		corePointDistance(first, bx + b.radius * b.endX, by + b.radius * b.endY));
	const distance = Math.hypot(bx - ax, by - ay);
	if (distance === 0) return minimum - a.halfWidth - b.halfWidth;
	const ux = (bx - ax) / distance;
	const uy = (by - ay) / distance;
	for (const signA of [-1, 1]) {
		for (const signB of [-1, 1]) {
			if (angleIsOnArc(Math.atan2(signA * uy, signA * ux), a)
				&& angleIsOnArc(Math.atan2(signB * uy, signB * ux), b)) {
				minimum = Math.min(minimum, Math.abs(distance + signB * b.radius - signA * a.radius));
			}
		}
	}
	if (distance <= a.radius + b.radius && distance >= Math.abs(a.radius - b.radius)) {
		const along = (a.radius * a.radius - b.radius * b.radius + distance * distance) / (2 * distance);
		const offset = Math.sqrt(Math.max(0, a.radius * a.radius - along * along));
		for (const sign of [-1, 1]) {
			const x = ax + along * ux - sign * offset * uy;
			const y = ay + along * uy + sign * offset * ux;
			if (angleIsOnArc(Math.atan2(y - ay, x - ax), a) && angleIsOnArc(Math.atan2(y - by, x - bx), b)) minimum = 0;
		}
	}
	return minimum - a.halfWidth - b.halfWidth;
}

/** Test sample selection only: first radial exit from the actual curved band. */
export function outsideControlPoint(shape: ControlShapeOracle, angle: number, offset: number): { x: number; y: number } {
	const dx = Math.cos(angle);
	const dy = Math.sin(angle);
	let inside = 0;
	let outside = shape.radius + offset;
	for (let step = 0; step < 52; step += 1) {
		const middle = (inside + outside) / 2;
		if (controlContainsPoint(shape, shape.x + dx * middle, shape.y + dy * middle)) inside = middle;
		else outside = middle;
	}
	return { x: shape.x + dx * (outside + offset), y: shape.y + dy * (outside + offset) };
}
