import type { BmsxCartridge, RomLuaAsset } from './rompack';

export function rebuildCartPathIndex(cart: BmsxCartridge): void {
	const path2lua: Record<string, RomLuaAsset> = {};
	for (const asset of Object.values(cart.chunk2lua)) {
		path2lua[asset.normalized_source_path] = asset;
	}
	cart.path2lua = path2lua;
}

