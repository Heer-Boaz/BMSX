export function fmix32(h: number): number {
	h >>>= 0;
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
}

export function xorshift32(x: number): number {
	x >>>= 0;
	x ^= (x << 13) >>> 0;
	x ^= x >>> 17;
	x ^= (x << 5) >>> 0;
	return x >>> 0;
}

export function scramble32(x: number): number {
	return Math.imul(x >>> 0, 0x9e3779bb) >>> 0;
}

export function signed8FromHash(h: number): number {
	return ((h >>> 24) & 0xff) - 128;
}
