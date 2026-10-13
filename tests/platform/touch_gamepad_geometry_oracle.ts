import type { RoundedCircularArc } from '../../hosts/browser/touch_geometry';

/** Independent test geometry: angle-clamped finite arcs, never the browser's
 * contact/acquisition implementation or its rational polynomial query. */
export interface ControlShapeOracle {
	x: number;
	y: number;
	radius: number;
	outline?: RoundedCircularArc;
}

export interface BankedControlShapeOracle extends ControlShapeOracle {
	bank: number;
	buttons: number;
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

/** Independent round-contact eligibility: closest true surface chooses a bank,
 * and every touched surface in that bank contributes its hardware bits. */
export function roundContactBankWord(shapes: readonly BankedControlShapeOracle[], x: number, y: number, radius: number): number {
	let nearest = Infinity;
	let bank = -1;
	for (const shape of shapes) {
		const distance = distanceToControl(shape, x, y);
		if (distance <= radius && distance < nearest) {
			nearest = distance;
			bank = shape.bank;
		}
	}
	let word = 0;
	for (const shape of shapes) {
		if (shape.bank === bank && distanceToControl(shape, x, y) <= radius) word |= shape.buttons;
	}
	return word;
}

/** Independent positive-axis ellipse oracle for non-grazing browser probes.
 * Circles are exact. Otherwise containment and 4096 true perimeter samples prove
 * an intersection; a miss requires separation exceeding the largest possible
 * distance between an ellipse point and its closest sampled point. This bound
 * is 2*maxAxis*sin(pi/(2*N)), below 0.019px for the 24x4 acceptance ellipses.
 * Ambiguous grazing probes fail explicitly rather than treating sampling as an
 * exact collision solver. Dedicated runtime geometry tests cover tangencies. */
export function ellipseContactWord(shapes: readonly BankedControlShapeOracle[], x: number, y: number,
	halfWidth: number, halfHeight: number): number {
	let word = 0;
	for (const shape of shapes) {
		if (halfWidth === halfHeight) {
			if (distanceToControl(shape, x, y) <= halfWidth) word |= shape.buttons;
			continue;
		}
		const labelX = (shape.x - x) / halfWidth;
		const labelY = (shape.y - y) / halfHeight;
		if (controlContainsPoint(shape, x, y) || labelX * labelX + labelY * labelY <= 1) {
			word |= shape.buttons;
			continue;
		}
		const samples = 4096;
		let minimum = Infinity;
		for (let sample = 0; sample < samples; sample += 1) {
			const angle = sample * TAU / samples;
			minimum = Math.min(minimum, distanceToControl(shape, x + halfWidth * Math.cos(angle), y + halfHeight * Math.sin(angle)));
			if (minimum === 0) break;
		}
		if (minimum === 0) word |= shape.buttons;
		else if (minimum <= 2 * Math.max(halfWidth, halfHeight) * Math.sin(Math.PI / (2 * samples))) {
			throw new Error('this browser acceptance probe has a grazing ellipse/solid ambiguity');
		}
	}
	return word;
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
