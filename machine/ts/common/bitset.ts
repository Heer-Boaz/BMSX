// First set bit in [first, end), or end. Read the live bitmap on each
// search: the caller may have added or removed members since its last visit.
export function nextSetBit(words: Uint32Array, first: number, end: number): number {
	if (first >= end) return end;
	let group = first >>> 5;
	let bits = words[group] & (-1 << (first & 31));
	while (bits === 0) {
		if (++group * 32 >= end) return end;
		bits = words[group];
	}
	return Math.min(end, group * 32 + 31 - Math.clz32(bits & -bits));
}
