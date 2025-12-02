import type { BmsxCartridge, RomLuaAsset } from '../rompack/rompack';

export type LuaRequireModuleRecord = {
	packageKey: string;
	canonicalKey: string;
	asset_id: string;
	chunkName: string;
	path?: string;
};

function stripLuaExtension(candidate: string): string {
	const lower = candidate.toLowerCase();
	if (lower.endsWith('.lua')) {
		return candidate.slice(0, candidate.length - 4);
	}
	return candidate;
}

function baseModuleName(path: string): string {
	const index = path.lastIndexOf('/');
	const name = index >= 0 ? path.slice(index + 1) : path;
	return stripLuaExtension(name);
}

function registerLuaModuleAliases(
	aliases: Map<string, LuaRequireModuleRecord>,
	record: LuaRequireModuleRecord,
	assetId: string,
	sourcePath: string | undefined,
	chunkName: string,
	canonicalPath: string,
): void {
	const register = (candidate: string): void => {
		if (!candidate || candidate.length === 0) {
			return;
		}
		if (!aliases.has(candidate)) {
			aliases.set(candidate, record);
		}
	};

	register(canonicalPath);
	register(`${canonicalPath}.lua`);

	if (sourcePath && sourcePath.length > 0) {
		register(sourcePath);
		register(`${sourcePath}.lua`);
		const dottedSource = sourcePath.replace(/\//g, '.');
		register(dottedSource);
		register(`${dottedSource}.lua`);
	}

	register(assetId);
	register(`${assetId}.lua`);
	const assetDots = assetId.replace(/[\\/]/g, '.');
	register(assetDots);
	register(`${assetDots}.lua`);

	register(chunkName);
	const canonicalDots = canonicalPath.replace(/\//g, '.');
	register(canonicalDots);
	register(`${canonicalDots}.lua`);

	const baseName = baseModuleName(canonicalPath);
	register(baseName);
	register(`${baseName}.lua`);
	const baseDots = baseName.replace(/\//g, '.');
	register(baseDots);
	register(`${baseDots}.lua`);
}

export function buildLuaModuleAliases(cart: BmsxCartridge): Map<string, LuaRequireModuleRecord> {
	const aliases = new Map<string, LuaRequireModuleRecord>();
	const luaAssets = cart.lua as Record<string, RomLuaAsset>;
	for (const assetId of Object.keys(luaAssets)) {
		const asset = luaAssets[assetId];
		if (!asset || asset.type !== 'lua') {
			continue;
		}
		const chunkName = asset.chunk_name && asset.chunk_name.length > 0 ? asset.chunk_name : `@lua/${asset.resid}`;
		const normalizedPath = asset.normalized_source_path && asset.normalized_source_path.length > 0
			? asset.normalized_source_path
			: asset.resid;
		const canonicalPath = stripLuaExtension(normalizedPath);
		const packageKey = asset.chunk_name;
		let path: string | undefined;
		if (asset.normalized_source_path && asset.normalized_source_path.length > 0) {
			path = asset.normalized_source_path;
		} else if (asset.source_path && asset.source_path.length > 0) {
			path = asset.source_path;
		} else {
			path = undefined;
		}
		const record: LuaRequireModuleRecord = {
			packageKey,
			canonicalKey: canonicalPath,
			asset_id: asset.resid,
			chunkName,
			path,
		};
		registerLuaModuleAliases(aliases, record, asset.resid, path, chunkName, canonicalPath);
	}
	return aliases;
}
