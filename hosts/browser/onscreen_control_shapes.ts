import type { RoundedCircularArc } from './touch_geometry';

/** The same finite circular tube supplies SVG arcs and numerical contact geometry. */
export function layoutShoulderOutline(outline: RoundedCircularArc, radius: number, halfWidth: number, halfAngle: number): string {
	const sine = Math.sin(halfAngle);
	const cosine = Math.cos(halfAngle);
	outline.centerX = 0;
	outline.centerY = radius;
	outline.radius = radius;
	outline.halfWidth = halfWidth;
	outline.startX = -sine;
	outline.startY = -cosine;
	outline.endX = sine;
	outline.endY = -cosine;
	outline.quarterTurns = 0;
	outline.startT = Math.tan((-Math.PI / 2 - halfAngle) / 2);
	outline.endT = Math.tan((-Math.PI / 2 + halfAngle) / 2);
	outline.left = -radius * sine - halfWidth;
	outline.right = radius * sine + halfWidth;
	outline.top = -halfWidth;
	outline.bottom = radius * (1 - cosine) + halfWidth;
	const centerX = -outline.left;
	const centerY = radius - outline.top;
	const outer = radius + halfWidth;
	const inner = radius - halfWidth;
	return `M ${centerX - outer * sine} ${centerY - outer * cosine}`
		+ ` A ${outer} ${outer} 0 0 1 ${centerX + outer * sine} ${centerY - outer * cosine}`
		+ ` A ${halfWidth} ${halfWidth} 0 0 1 ${centerX + inner * sine} ${centerY - inner * cosine}`
		+ ` A ${inner} ${inner} 0 0 0 ${centerX - inner * sine} ${centerY - inner * cosine}`
		+ ` A ${halfWidth} ${halfWidth} 0 0 1 ${centerX - outer * sine} ${centerY - outer * cosine} Z`;
}
