import type { RoundedCircularArc } from './touch_geometry';

/** The same finite circular tube supplies SVG arcs and numerical contact geometry. */
export function layoutShoulderOutline(
	outline: RoundedCircularArc, radius: number, halfWidth: number, startAngle: number, endAngle: number,
): string {
	const middleAngle = (startAngle + endAngle) / 2;
	const middleX = Math.cos(middleAngle);
	const middleY = Math.sin(middleAngle);
	const startX = Math.cos(startAngle);
	const startY = Math.sin(startAngle);
	const endX = Math.cos(endAngle);
	const endY = Math.sin(endAngle);
	// The authored label lies on the middle of the finite centerline. Keeping
	// each segment relative to this point preserves both drawing and input.
	outline.centerX = -radius * middleX;
	outline.centerY = -radius * middleY;
	outline.radius = radius;
	outline.halfWidth = halfWidth;
	outline.startX = startX;
	outline.startY = startY;
	outline.endX = endX;
	outline.endY = endY;
	// Rotate the midpoint towards +X, keeping the whole (<pi) sweep away from
	// the half-angle singularity without skewing the contact ellipse.
	const turns = Math.abs(middleX) >= Math.abs(middleY)
		? (middleX >= 0 ? 0 : 2) : (middleY >= 0 ? 1 : 3);
	outline.quarterTurns = turns;
	const queryMiddle = turns === 0 ? Math.atan2(middleY, middleX)
		: turns === 1 ? Math.atan2(-middleX, middleY)
			: turns === 2 ? Math.atan2(-middleY, -middleX) : Math.atan2(middleX, -middleY);
	const halfSweep = (endAngle - startAngle) / 2;
	outline.startT = Math.tan((queryMiddle - halfSweep) / 2);
	outline.endT = Math.tan((queryMiddle + halfSweep) / 2);
	let left = radius * Math.min(startX, endX);
	let right = radius * Math.max(startX, endX);
	let top = radius * Math.min(startY, endY);
	let bottom = radius * Math.max(startY, endY);
	// A tight centerline bound also includes every cardinal inside the sweep.
	if (startY <= 0 && endY >= 0) right = radius;
	if (startY >= 0 && endY <= 0) left = -radius;
	if (startX >= 0 && endX <= 0) bottom = radius;
	if (startX <= 0 && endX >= 0) top = -radius;
	outline.left = outline.centerX + left - halfWidth;
	outline.right = outline.centerX + right + halfWidth;
	outline.top = outline.centerY + top - halfWidth;
	outline.bottom = outline.centerY + bottom + halfWidth;
	const centerX = outline.centerX - outline.left;
	const centerY = outline.centerY - outline.top;
	const outer = radius + halfWidth;
	const inner = radius - halfWidth;
	return `M ${centerX + outer * startX} ${centerY + outer * startY}`
		+ ` A ${outer} ${outer} 0 0 1 ${centerX + outer * endX} ${centerY + outer * endY}`
		+ ` A ${halfWidth} ${halfWidth} 0 0 1 ${centerX + inner * endX} ${centerY + inner * endY}`
		+ ` A ${inner} ${inner} 0 0 0 ${centerX + inner * startX} ${centerY + inner * startY}`
		+ ` A ${halfWidth} ${halfWidth} 0 0 1 ${centerX + outer * startX} ${centerY + outer * startY} Z`;
}
