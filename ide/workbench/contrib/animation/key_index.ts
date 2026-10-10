import type { AnimationKeySource, AnimationKeyUnit } from './model';

/** Chronological presentation index; never reorders the authored key array. */
export type AnimationKeyIndex = {
	readonly positions: readonly (number | null)[];
	readonly order: readonly number[];
};

export const EMPTY_ANIMATION_KEY_INDEX: AnimationKeyIndex = { positions: [], order: [] };

export function indexAnimationKeys(keys: readonly AnimationKeySource[], unit: AnimationKeyUnit | undefined): AnimationKeyIndex {
	const positions: (number | null)[] = [], order: number[] = [];
	for (let index = 0; index < keys.length; index++) {
		const position = unit === undefined ? null : keys[index].coordinate!.value;
		positions.push(position);
		if (position !== null) order.push(index);
	}
	order.sort((left, right) => positions[left]! - positions[right]! || left - right);
	return { positions, order };
}

/** Lower/upper bound, including the selected key's transient gesture position. */
export function animationKeyTimeIndex(positions: readonly (number | null)[], order: readonly number[], position: number,
	afterEquals = false, previewIndex = -1, previewPosition?: number): number {
	let left = 0, right = order.length;
	while (left < right) {
		const middle = (left + right) >>> 1, index = order[middle];
		const value = index === previewIndex && previewPosition !== undefined ? previewPosition : positions[index]!;
		if (value < position || afterEquals && value === position) left = middle + 1; else right = middle;
	}
	return left;
}
