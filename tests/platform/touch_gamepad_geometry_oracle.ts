/** Independent test geometry using projection onto a finite centre-line.
 * Deliberately does not call the browser's contact/acquisition implementation. */
export interface ControlShapeOracle {
	x: number;
	y: number;
	radius: number;
	outline?: { halfLength: number; radius: number };
}

function segmentDistanceSquared(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax;
	const dy = by - ay;
	const lengthSquared = dx * dx + dy * dy;
	const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
	const offsetX = x - ax - amount * dx;
	const offsetY = y - ay - amount * dy;
	return offsetX * offsetX + offsetY * offsetY;
}

function corePointDistanceSquared(shape: ControlShapeOracle, x: number, y: number): number {
	const halfLength = shape.outline?.halfLength ?? 0;
	return segmentDistanceSquared(x, y, shape.x - halfLength, shape.y, shape.x + halfLength, shape.y);
}

export function distanceToControl(shape: ControlShapeOracle, x: number, y: number): number {
	return Math.max(0, Math.sqrt(corePointDistanceSquared(shape, x, y)) - (shape.outline?.radius ?? shape.radius));
}

export function controlContainsPoint(shape: ControlShapeOracle, x: number, y: number): boolean {
	const radius = shape.outline?.radius ?? shape.radius;
	return corePointDistanceSquared(shape, x, y) <= radius * radius;
}

/** Horizontal finite cores are parallel: one endpoint's closest segment
 * projection attains the minimum, also for degenerate circle point cores. */
export function controlSeparation(first: ControlShapeOracle, second: ControlShapeOracle): number {
	const firstHalfLength = first.outline?.halfLength ?? 0;
	const secondHalfLength = second.outline?.halfLength ?? 0;
	const squared = Math.min(
		corePointDistanceSquared(second, first.x - firstHalfLength, first.y),
		corePointDistanceSquared(second, first.x + firstHalfLength, first.y),
		corePointDistanceSquared(first, second.x - secondHalfLength, second.y),
		corePointDistanceSquared(first, second.x + secondHalfLength, second.y));
	return Math.sqrt(squared) - (first.outline?.radius ?? first.radius) - (second.outline?.radius ?? second.radius);
}

/** Test sample selection only: a radial point just outside the actual surface. */
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
