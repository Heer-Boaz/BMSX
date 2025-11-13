import type { vec2 } from '../rompack/rompack';

/**
 * Calculates the delta vector from a source point to a target point.
 * @param source The source point.
 * @param target The target point.
 * @returns The delta vector from the source point to the target point.
 */
export function compute_movement_vector(source: vec2, target: vec2): vec2 {
	let delta = { x: 0, y: 0 };
	const dx = target.x - source.x;
	const dy = target.y - source.y;

	if (target.x === source.x) {
		delta.x = 0;
		delta.y = dy > 0 ? 1 : -1;
	}
	else if (target.y === source.y) {
		delta.x = dx > 0 ? 1 : -1;
		delta.y = 0;
	}
	else {
		const adx = Math.abs(dx);
		const ady = Math.abs(dy);
		if (adx > ady) {
			delta.x = dx > 0 ? 1 : -1;
			delta.y = dy / adx;
		}
		else {
			delta.x = dx / ady;
			delta.y = dy > 0 ? 1 : -1;
		}
	}

	return delta;
}
