import type { BmsxCartridge, RomLuaAsset } from './rompack';

function normalizeLuaAsset(cart: BmsxCartridge, asset: RomLuaAsset): void {
	const sourcePath = asset.source_path && asset.source_path.length > 0 ? asset.source_path : asset.resid;
	const chunkName = asset.chunk_name && asset.chunk_name.length > 0
		? asset.chunk_name
		: asset.source_path && asset.source_path.length > 0
			? `@${asset.source_path}`
			: `@lua/${asset.resid}`;
	const normalizedChunkName = chunkName.startsWith('@') ? chunkName : `@${chunkName}`;
	asset.chunk_name = normalizedChunkName;
	asset.normalized_source_path = sourcePath;
	cart.chunk2lua[normalizedChunkName] = asset;
	cart.source2lua[sourcePath] = asset;
}

export function normalizeCartLua(cart: BmsxCartridge): void {
	if (!cart.chunk2lua) {
		cart.chunk2lua = {};
	} else {
		for (const key of Object.keys(cart.chunk2lua)) {
			delete cart.chunk2lua[key];
		}
	}
	if (!cart.source2lua) {
		cart.source2lua = {};
	} else {
		for (const key of Object.keys(cart.source2lua)) {
			delete cart.source2lua[key];
		}
	}
	for (const asset of Object.values(cart.lua)) {
		normalizeLuaAsset(cart, asset);
	}
}

export function normalizeNewLuaAsset(cart: BmsxCartridge, asset: RomLuaAsset): void {
	if (!cart.chunk2lua) {
		cart.chunk2lua = {};
	}
	if (!cart.source2lua) {
		cart.source2lua = {};
	}
	normalizeLuaAsset(cart, asset);
}
