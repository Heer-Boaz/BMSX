export function safeclamp(value: number, min: number, max: number, fallback: number | null): number {
	if (!Number.isFinite(value)) return fallback;
	const v = Math.floor(value);
	if (min > max) { const t = min; min = max; max = t; }
	if (v < min) return min;
	if (v > max) return max;
	return v;
}
