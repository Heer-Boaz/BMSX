import type { HorizontalCapsule } from './touch_geometry';

/** Numerical hit geometry and SVG use the same sized capsule, not a circumbound. */
export function layoutShoulderOutline(outline: HorizontalCapsule, width: number, height: number): string {
	const radius = height / 2;
	const halfLine = (width - height) / 2;
	outline.halfLength = halfLine;
	outline.radius = radius;
	const left = width / 2 - halfLine;
	const right = width / 2 + halfLine;
	return `M ${left} 0 H ${right} A ${radius} ${radius} 0 0 1 ${right} ${height} H ${left} A ${radius} ${radius} 0 0 1 ${left} 0 Z`;
}
