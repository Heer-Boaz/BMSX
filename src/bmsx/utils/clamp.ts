
export function clamp(value: number, min: number, max: number): number {
	// Fast, branch-based clamp for primitive numbers (avoids Math.min/Math.max calls).
	// If you need to handle min > max, add a swap here; that will cost an extra branch.
	if (min > max) { const t = min; min = max; max = t; }
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

export function clamp01(x: number): number {
	if (x < 0) return 0;
	if (x > 1) return 1;
	return x;
}
