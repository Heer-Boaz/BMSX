import type { vec2, Direction, Facing } from '../rompack/rompack';

/**
 * Calculates the direction from a subject position to a target position.
 * @param subjectpos The position of the subject.
 * @param targetpos The position of the target.
 * @returns The direction from the subject position to the target position.
 */
export function get_direction_towards_target(subjectpos: vec2, targetpos: vec2): Direction {
	const delta: vec2 = { x: targetpos.x - subjectpos.x, y: targetpos.y - subjectpos.y };
	if (Math.abs(delta.x) >= Math.abs(delta.y)) {
		return delta.x < 0 ? 'left' : 'right';
	} else {
		return delta.y < 0 ? 'up' : 'down';
	}
}

export function get_facing_towards_target(subjectpos: vec2, targetpos: vec2): Facing {
	const delta: vec2 = { x: targetpos.x - subjectpos.x, y: targetpos.y - subjectpos.y };
	const absoluteX = Math.abs(delta.x);
	const absoluteY = Math.abs(delta.y);
	if (absoluteX >= absoluteY) {
		if (absoluteY * 2 >= absoluteX) {
			return delta.x < 0 ? (delta.y < 0 ? 'up-left' : 'down-left') : (delta.y < 0 ? 'up-right' : 'down-right');
		} else {
			return delta.x < 0 ? 'left' : 'right';
		}
	} else {
		if (absoluteX * 2 >= absoluteY) {
			return delta.y < 0 ? (delta.x < 0 ? 'up-left' : 'up-right') : (delta.x < 0 ? 'down-left' : 'down-right');
		} else {
			return delta.y < 0 ? 'up' : 'down';
		}
	}
}

/**
 * Returns the opposite direction of the given direction.
 * @param dir The direction to get the opposite of.
 * @returns The opposite direction of the given direction.
 */
export function invert_direction(dir: Direction): Direction {
	switch (dir) {
		case 'up':
			return 'down';
		case 'right':
			return 'left';
		case 'down':
			return 'up';
		case 'left':
			return 'right';
		default:
			return 'none';
	}
}

export function invert_facing(facing: Facing): Facing {
	switch (facing) {
		case 'up':
			return 'down';
		case 'up-right':
			return 'down-left';
		case 'right':
			return 'left';
		case 'down-right':
			return 'up-left';
		case 'down':
			return 'up';
		case 'down-left':
			return 'up-right';
		case 'left':
			return 'right';
		case 'up-left':
			return 'down-right';
		default:
			return 'none';
	}
}
