
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

export function fallbackclamp(value: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return clamp(value, min, max);
}

export function safeclamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return clamp(value, min, max);
}

export function wrapClamp(value: number, min: number, max: number): number {
	const range = max - min + 1;
	if (range <= 0) return min; // degenerate case
	let v = value;
	while (v < min) v += range;
	while (v > max) v -= range;
	return v;
}

export function wrapClamp01(x: number): number {
	let v = x;
	while (v < 0) v += 1;
	while (v > 1) v -= 1;
	return v;
}
