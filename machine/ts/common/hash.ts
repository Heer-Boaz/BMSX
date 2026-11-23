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

// FNV-1a over code units. For machine byte strings each unit is one octet.
export function hashText(text: string): number {
	let hash = 2166136261;
	for (let index = 0; index < text.length; ++index) {
		hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
	}
	return hash >>> 0;
}

// FNV-1a over a complete byte range, optionally split at a storage seam.
export function hashBytes(bytes: Uint8Array, offset: number, count: number, wrapped = 0): number {
	let hash = 2166136261;
	const end = offset + count - wrapped;
	for (; offset < end; ++offset) {
		hash = Math.imul(hash ^ bytes[offset], 16777619);
	}
	for (let index = 0; index < wrapped; ++index) hash = Math.imul(hash ^ bytes[index], 16777619);
	return hash >>> 0;
}
