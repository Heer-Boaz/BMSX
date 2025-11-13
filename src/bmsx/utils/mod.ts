/**
 * Calculates the modulus of a number.
 * @param n The dividend.
 * @param p The divisor.
 * @returns The modulus of the division.
 */
export function mod(n: number, p: number): number {
	let r = n % p;
	return r < 0 ? r + p : r;
}
