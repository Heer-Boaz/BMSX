const HASH_SELF_TEST_VECTORS = [
	{ id: '', lo: 0x84222325, hi: 0xcbf29ce4 },
	{ id: 'a', lo: 0x8601ec8c, hi: 0xaf63dc4c },
	{ id: './Foo\\Bar', lo: 0x4a2a0873, hi: 0x4dc5355f },
];

let hashSelfTested = false;
const assetIdEncoder = new TextEncoder();

export type AssetToken = { lo: number; hi: number };

function ensureHashSelfTest(): void {
	if (hashSelfTested) {
		return;
	}
	for (let index = 0; index < HASH_SELF_TEST_VECTORS.length; index += 1) {
		const vector = HASH_SELF_TEST_VECTORS[index];
		const actual = hashAssetIdInternal(vector.id);
		if (actual.lo !== vector.lo || actual.hi !== vector.hi) {
			throw new Error(`[AssetTokens] Asset hash self-test failed for '${vector.id}' (${tokenKey(actual.lo, actual.hi)}).`);
		}
	}
	hashSelfTested = true;
}

export function hashAssetId(id: string): AssetToken {
	ensureHashSelfTest();
	return hashAssetIdInternal(id);
}

function hashAssetIdInternal(id: string): AssetToken {
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

export function tokenKeyFromAsset(asset: { id_token_lo?: number; id_token_hi?: number; resid: string }): string {
	if (typeof asset.id_token_lo === 'number' && typeof asset.id_token_hi === 'number') {
		return tokenKey(asset.id_token_lo, asset.id_token_hi);
	}
	return tokenKeyFromId(asset.resid);
}
