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
