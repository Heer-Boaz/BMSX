/**
 * Intersects an axis-aligned contact ellipse with a circular control, in CSS pixels.
 * dx/dy locate the circle center relative to the contact center. Zero contact axes
 * represent a line segment or point, not a filled bounding rectangle.
 *
 * Exterior closest-point equation follows Geometric Tools' monotone Lagrange
 * multiplier construction, specialized to a solid 2D ellipse and a boolean query:
 * https://github.com/davideberly/GeometricTools/blob/e09f5b39a33da6b4bfd0ff8dbb64ddcb7fdfc763/GTE/Mathematics/DistPointHyperellipsoid.h#L271-L359
 */
export function contactIntersectsCircle(dx: number, dy: number, halfWidth: number, halfHeight: number, radius: number): boolean {
	if (halfWidth === halfHeight) {
		const reach = radius + halfWidth;
		return dx * dx + dy * dy <= reach * reach;
	}
	dx = Math.abs(dx);
	dy = Math.abs(dy);
	const radiusSquared = radius * radius;
	if (halfWidth === 0) {
		const distanceY = Math.max(dy - halfHeight, 0);
		return dx * dx + distanceY * distanceY <= radiusSquared;
	}
	if (halfHeight === 0) {
		const distanceX = Math.max(dx - halfWidth, 0);
		return distanceX * distanceX + dy * dy <= radiusSquared;
	}
	if (dx > halfWidth + radius || dy > halfHeight + radius) return false;
	const normalizedX = dx / halfWidth;
	const normalizedY = dy / halfHeight;
	if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) return true;

	const widthSquared = halfWidth * halfWidth;
	const heightSquared = halfHeight * halfHeight;
	const numeratorX = halfWidth * dx;
	const numeratorY = halfHeight * dy;
	let lower = 0;
	let upper = Math.hypot(numeratorX, numeratorY);
	for (;;) {
		const multiplier = (lower + upper) * 0.5;
		const denominatorX = multiplier + widthSquared;
		const denominatorY = multiplier + heightSquared;
		const ratioX = numeratorX / denominatorX;
		const ratioY = numeratorY / denominatorY;
		const equation = ratioX * ratioX + ratioY * ratioY;
		// Computing p-q through the multiplier avoids cancellation near the ellipse.
		const distanceX = dx * (multiplier / denominatorX);
		const distanceY = dy * (multiplier / denominatorY);
		const distanceSquared = distanceX * distanceX + distanceY * distanceY;
		if (equation === 1 || multiplier === lower || multiplier === upper) {
			// Root equality in floating arithmetic, or adjacent representable endpoints.
			return distanceSquared <= radiusSquared;
		}
		if (equation > 1) {
			// Below the root: this distance bounds the true distance from below.
			if (distanceSquared > radiusSquared) return false;
			lower = multiplier;
		} else {
			// Above the root: this distance bounds the true distance from above.
			if (distanceSquared <= radiusSquared) return true;
			upper = multiplier;
		}
	}
}

/**
 * A finite circle arc offset by a round half-width. The layout producer supplies
 * unit radial endpoints, a positive-cross sweep below pi, and radius > halfWidth.
 * All positions and bounds are relative to the action's authored label point.
 * quarterTurns rotates the query axes so [startT,endT] = tan(angle/2) is finite;
 * a quarter-turn preserves an axis-aligned ellipse by exchanging its axes.
 */
export interface RoundedCircularArc {
	centerX: number;
	centerY: number;
	radius: number;
	halfWidth: number;
	startX: number;
	startY: number;
	endX: number;
	endY: number;
	quarterTurns: 0 | 1 | 2 | 3;
	startT: number;
	endT: number;
	left: number;
	top: number;
	right: number;
	bottom: number;
}

function directionIsOnArc(x: number, y: number, arc: RoundedCircularArc): boolean {
	return arc.startX * y - arc.startY * x >= 0 && x * arc.endY - y * arc.endX >= 0;
}

/** Distance to the actual curved band, including its finite rounded ends. */
export function pointDistanceToRoundedCircularArc(x: number, y: number, arc: RoundedCircularArc): number {
	x -= arc.centerX;
	y -= arc.centerY;
	const distance = directionIsOnArc(x, y, arc)
		? Math.abs(Math.hypot(x, y) - arc.radius)
		: Math.min(Math.hypot(x - arc.radius * arc.startX, y - arc.radius * arc.startY),
			Math.hypot(x - arc.radius * arc.endX, y - arc.radius * arc.endY));
	return Math.max(0, distance - arc.halfWidth);
}

function circlePointIsInEllipse(t: number, radius: number, x: number, y: number, a: number, b: number): boolean {
	const denominator = 1 + t * t;
	const dx = (radius * (1 - t * t) / denominator - x) / a;
	const dy = (radius * 2 * t / denominator - y) / b;
	return dx * dx + dy * dy <= 1;
}

/** A monotone quartic-derivative interval contains at most one numerator extremum. */
function stationaryArcPointIsInEllipse(
	lower: number, upper: number, d0: number, d1: number, d2: number, d3: number,
	radius: number, x: number, y: number, a: number, b: number,
): boolean {
	let lowerValue = ((d3 * lower + d2) * lower + d1) * lower + d0;
	const upperValue = ((d3 * upper + d2) * upper + d1) * upper + d0;
	if (lowerValue === 0) return circlePointIsInEllipse(lower, radius, x, y, a, b);
	if (upperValue === 0) return circlePointIsInEllipse(upper, radius, x, y, a, b);
	if ((lowerValue > 0) === (upperValue > 0)) return false;
	for (;;) {
		const middle = (lower + upper) * 0.5;
		if (middle === lower || middle === upper) {
			return circlePointIsInEllipse(lower, radius, x, y, a, b)
				|| circlePointIsInEllipse(upper, radius, x, y, a, b);
		}
		const value = ((d3 * middle + d2) * middle + d1) * middle + d0;
		if (value === 0) return circlePointIsInEllipse(middle, radius, x, y, a, b);
		if ((value > 0) === (lowerValue > 0)) {
			lower = middle;
			lowerValue = value;
		} else upper = middle;
	}
}

/**
 * The ellipse inside-test quadratic evaluated on a circle, with t = tan(angle/2),
 * has a quartic numerator and positive denominator. An inside point exists iff
 * the numerator's minimum is nonpositive: an endpoint or a root of its cubic
 * derivative supplies that minimum. The derivative's
 * quadratic critical points split it into monotone root intervals; bisect only
 * actual brackets, until adjacent representable endpoints, without an iteration
 * budget or contact-time arrays. This specializes Geometric Tools' root isolation:
 * https://github.com/davideberly/GeometricTools/blob/e09f5b39a33da6b4bfd0ff8dbb64ddcb7fdfc763/GTE/Mathematics/RootsCubic.h#L309-L346
 */
function circularArcIntersectsEllipse(
	lower: number, upper: number, radius: number, x: number, y: number, a: number, b: number,
): boolean {
	if (circlePointIsInEllipse(lower, radius, x, y, a, b)
		|| circlePointIsInEllipse(upper, radius, x, y, a, b)) return true;
	const rx = radius / a;
	const ry = radius / b;
	const px = x / a;
	const py = y / b;
	const d0 = -4 * ry * py;
	const d1 = 2 * (-2 * (rx * rx - px * px) + 4 * ry * ry + 2 * py * py - 2);
	const d2 = 3 * d0;
	const d3 = 4 * ((rx + px) * (rx + px) + py * py - 1);
	// Critical points of the cubic derivative. Stable quadratic roots avoid the
	// cancellation of (-B +/- sqrt(discriminant)) when one root is near zero.
	let first = upper;
	let second = upper;
	const qa = 3 * d3;
	const qb = 2 * d2;
	const qc = d1;
	if (qa === 0) {
		if (qb !== 0) first = Math.max(lower, Math.min(upper, -qc / qb));
	} else {
		const discriminant = qb * qb - 4 * qa * qc;
		if (discriminant > 0) {
			const q = -0.5 * (qb + (qb < 0 ? -1 : 1) * Math.sqrt(discriminant));
			const root0 = q / qa;
			const root1 = qc / q;
			first = Math.max(lower, Math.min(upper, Math.min(root0, root1)));
			second = Math.max(lower, Math.min(upper, Math.max(root0, root1)));
		}
	}
	if (first > lower && stationaryArcPointIsInEllipse(lower, first, d0, d1, d2, d3, radius, x, y, a, b)) return true;
	if (second > first && stationaryArcPointIsInEllipse(first, second, d0, d1, d2, d3, radius, x, y, a, b)) return true;
	return upper > second && stationaryArcPointIsInEllipse(second, upper, d0, d1, d2, d3, radius, x, y, a, b);
}

/** Zero-axis footprints are finite horizontal or vertical segments. */
function circularArcIntersectsSegment(
	x: number, y: number, a: number, b: number, radius: number, arc: RoundedCircularArc,
): boolean {
	if (a === 0) {
		const squared = radius * radius - x * x;
		if (squared < 0) return false;
		const crossing = Math.sqrt(squared);
		return (crossing >= y - b && crossing <= y + b && directionIsOnArc(x, crossing, arc))
			|| (-crossing >= y - b && -crossing <= y + b && directionIsOnArc(x, -crossing, arc));
	}
	const squared = radius * radius - y * y;
	if (squared < 0) return false;
	const crossing = Math.sqrt(squared);
	return (crossing >= x - a && crossing <= x + a && directionIsOnArc(crossing, y, arc))
		|| (-crossing >= x - a && -crossing <= x + a && directionIsOnArc(-crossing, y, arc));
}

/**
 * Exact ellipse contact with a round-ended annular arc, not an enclosing circle.
 * End disks, ellipse-center containment, and the two finite concentric boundary
 * arcs cover intersection and containment. Circular footprints use a cheap exact
 * dilation of the centerline; only anisotropic boundary contacts need root work.
 */
export function contactIntersectsRoundedCircularArc(
	x: number, y: number, a: number, b: number, arc: RoundedCircularArc,
): boolean {
	if (x + a < arc.left || x - a > arc.right || y + b < arc.top || y - b > arc.bottom) return false;
	if (a === b) return pointDistanceToRoundedCircularArc(x, y, arc) <= a;
	x -= arc.centerX;
	y -= arc.centerY;
	const inner = arc.radius - arc.halfWidth;
	const outer = arc.radius + arc.halfWidth;
	const squared = x * x + y * y;
	if (directionIsOnArc(x, y, arc) && squared >= inner * inner && squared <= outer * outer) return true;
	if (contactIntersectsCircle(x - arc.radius * arc.startX, y - arc.radius * arc.startY, a, b, arc.halfWidth)
		|| contactIntersectsCircle(x - arc.radius * arc.endX, y - arc.radius * arc.endY, a, b, arc.halfWidth)) return true;
	if (a === 0 || b === 0) {
		return circularArcIntersectsSegment(x, y, a, b, inner, arc)
			|| circularArcIntersectsSegment(x, y, a, b, outer, arc);
	}
	// Rotate by whole quarter-turns only: no trigonometry and no skewed ellipse.
	if (arc.quarterTurns === 2) {
		x = -x;
		y = -y;
	} else if (arc.quarterTurns !== 0) {
		const oldX = x;
		x = arc.quarterTurns === 1 ? y : -y;
		y = arc.quarterTurns === 1 ? -oldX : oldX;
		const oldA = a;
		a = b;
		b = oldA;
	}
	return circularArcIntersectsEllipse(arc.startT, arc.endT, outer, x, y, a, b)
		|| circularArcIntersectsEllipse(arc.startT, arc.endT, inner, x, y, a, b);
}
