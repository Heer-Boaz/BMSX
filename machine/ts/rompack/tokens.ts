const assetIdEncoder = new TextEncoder();

export type AssetToken = { lo: number; hi: number };

export function hashAssetId(id: string): AssetToken {
	const bytes = assetIdEncoder.encode(id);
	let lo = 0x84222325;
	let hi = 0xcbf29ce4;
	for (let i = 0; i < bytes.length; i += 1) {
		lo = (lo ^ bytes[i]) >>> 0;
		const loMul = lo * 0x1b3;
		const loLow = loMul >>> 0;
		const carry = (loMul / 0x100000000) >>> 0;
		const hiMul = hi * 0x1b3 + carry;
		let hiLow = hiMul >>> 0;
		hiLow = (hiLow + ((lo << 8) >>> 0)) >>> 0;
		lo = loLow;
		hi = hiLow;
	}
	return { lo, hi };
}

export function tokenKey(lo: number, hi: number): string {
	return `${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
}

export function tokenKeyFromId(id: string): string {
	const token = hashAssetId(id);
	return tokenKey(token.lo, token.hi);
}
