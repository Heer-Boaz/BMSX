
export function lower_bound(values: number[], target: number, lo: number = 0, hi: number = values.length): number {
	let left = lo;
	let right = hi;
	while (left < right) {
		const mid = (left + right) >>> 1;
		if (values[mid] < target) {
			left = mid + 1;
		} else {
			right = mid;
		}
	}
	return left;
}
