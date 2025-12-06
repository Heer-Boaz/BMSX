import type { vec2arr } from '../rompack/rompack';
import { clamp } from './clamp';
import { new_area3d } from './rect_operations';

/**
 * Compute a 3D area representing the filled portion of a horizontal bar.
 * - bar: rectangle bounds for the full bar
 * - value: current value to represent (e.g. hp, mana, progress)
 * - maxValue: maximum value for full bar
 * - z: Z coordinate used for both start and end z
 * - reversed: when true the fill expands leftwards from bar.endX
 *
 * The function clamps value to [0, maxValue] internally.
 */

export function compute_bar_area(
	bar: BarRect,
	value: number,
	maxValue: number,
	z: number,
	reversed = false
): ReturnType<typeof new_area3d> {
	const clamped = clamp(value, 0, maxValue);
	const length = bar.endX - bar.startX;
	const filled = (length * clamped) / (maxValue === 0 ? 1 : maxValue);

	if (!reversed) {
		const endX = bar.startX + filled;
		return new_area3d(bar.startX, bar.startY, z, endX, bar.endY);
	} else {
		const startX = bar.endX - filled;
		return new_area3d(startX, bar.startY, z, bar.endX, bar.endY);
	}
}
/**
 * Compute the filled portion of a 1-dimensional horizontal bar and return it as a 2-element array.
 *
 * The input `bar` is expected to be a vec2arr containing the start and end X coordinates
 * of the full bar: [startX, endX]. The function clamps `value` to the range [0, maxValue],
 * computes the proportion of the bar that should be filled and returns the resulting
 * start and end X coordinates for the filled region as [filledStartX, filledEndX].
 *
 * When `reversed` is false (default) the fill grows from bar[0] (left) towards bar[1] (right).
 * When `reversed` is true the fill grows from bar[1] (right) towards bar[0] (left).
 *
 * Notes:
 * - If `maxValue` is 0, the function treats the denominator as 1 to avoid division by zero.
 * - The returned array is in the same coordinate space as the input `bar`.
 *
 * @param bar - A two-element array [startX, endX] representing the horizontal bar bounds.
 * @param value - Current value to represent (will be clamped to [0, maxValue]).
 * @param maxValue - Maximum value corresponding to a fully filled bar.
 * @param reversed - If true the filled portion is computed from the right edge inward.
 * @returns A two-element array [filledStartX, filledEndX] describing the filled region.
 */

export function compute_bar_area2d(
	bar: vec2arr,
	value: number,
	maxValue: number,
	reversed = false
): vec2arr {
	const clamped = clamp(value, 0, maxValue);
	const length = bar[1] - bar[0];
	const filled = (length * clamped) / (maxValue === 0 ? 1 : maxValue);

	if (!reversed) {
		const endX = bar[0] + filled;
		return [bar[0], endX];
	} else {
		const startX = bar[1] - filled;
		return [startX, bar[1]];
	}
}export interface BarRect {
	startX: number;
	endX: number;
	startY: number;
	endY: number;
}

