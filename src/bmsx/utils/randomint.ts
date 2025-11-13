/**
 * Generates a random integer between the specified minimum and maximum values (inclusive).
 * @param min The minimum value.
 * @param max The maximum value.
 * @returns A random integer between the minimum and maximum values (inclusive).
 */
export function randomInt(min: number, max: number): number {
	// Normalize to integers and handle swapped bounds
	min = Math.trunc(min);
	max = Math.trunc(max);
	if (min > max) { const t = min; min = max; max = t; }

	const range = max - min + 1;
	// Fast path: Math.random is the fastest approach in JS engines and
	// perfectly acceptable for game randomness. Avoid bitwise hacks (|0)
	// because they truncate to 32-bit signed ints.
	return Math.floor(Math.random() * range) + min;
}

/**
 * Secure / unbiased random integer in [min, max] using crypto.getRandomValues.
 * Uses rejection sampling to avoid modulo bias. Slightly slower — use only when
 * uniformity / cryptographic quality is required.
 */
export function randomIntSecure(min: number, max: number): number {
	// Normalize to integers and handle swapped bounds
	min = Math.trunc(min);
	max = Math.trunc(max);
	if (min > max) { const t = min; min = max; max = t; }

	const range = max - min + 1;
	if (range <= 0) return min; // empty range fallback


	// If crypto isn't available, fall back to Math.random
	const cryptoObj = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto as Crypto : null;
	if (!cryptoObj) return randomInt(min, max);

	// Use 32-bit unsigned randoms and rejection sampling
	const maxUint32 = 0xFFFFFFFF;
	const bucketSize = Math.floor((maxUint32 + 1) / range);
	const limit = bucketSize * range;

	const u32 = new Uint32Array(1);
	while (true) {
		cryptoObj.getRandomValues(u32);
		const r = u32[0];
		if (r < limit) {
			return min + Math.floor(r / bucketSize);
		}
		// otherwise retry (rejection sampling)
	}
}

