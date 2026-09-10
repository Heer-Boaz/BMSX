/** Returns whether the route has an arrow direction; never shrinks retained storage. */
export function writeWorkbenchGraphArrow(points: readonly number[], arrow: number[]): boolean {
	const x = points[points.length - 2];
	const y = points[points.length - 1];
	// Repeated terminal points do not change a route's final direction.
	for (let offset = points.length - 4; offset >= 0; offset -= 2) {
		const dx = x - points[offset];
		const dy = y - points[offset + 1];
		if (dx === 0 && dy === 0) continue;
		const scale = 4 / Math.hypot(dx, dy);
		arrow[0] = x - dx * scale + dy * scale;
		arrow[1] = y - dy * scale - dx * scale;
		arrow[2] = x;
		arrow[3] = y;
		arrow[4] = x - dx * scale - dy * scale;
		arrow[5] = y - dy * scale + dx * scale;
		return true;
	}
	return false;
}
