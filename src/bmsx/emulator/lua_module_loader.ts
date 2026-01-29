import type { LuaSourceRegistry } from './lua_sources';

export type LuaRequireModuleRecord = {
	packageKey: string;
	canonicalKey: string;
	path: string;
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
	sourcePath: string | undefined,
	path: string,
): void {
	const register = (candidate: string): void => {
		if (!candidate || candidate.length === 0) {
			return;
		}
		if (!aliases.has(candidate)) {
			aliases.set(candidate, record);
		}
	};

	if (sourcePath && sourcePath.length > 0) {
		register(sourcePath);
		register(`${sourcePath}.lua`);
		const dottedSource = sourcePath.replace(/\//g, '.');
		register(dottedSource);
		register(`${dottedSource}.lua`);
	}

	register(path);
	const baseName = baseModuleName(sourcePath);
	register(baseName);
	register(`${baseName}.lua`);
	const baseDots = baseName.replace(/\//g, '.');
	register(baseDots);
	register(`${baseDots}.lua`);
}

export function buildLuaModuleAliases(sources: LuaSourceRegistry): Map<string, LuaRequireModuleRecord> {
	const aliases = new Map<string, LuaRequireModuleRecord>();
	const luaAssets = sources.path2lua;
	for (const assetId of Object.keys(luaAssets)) {
		const asset = luaAssets[assetId];
		if (!asset || asset.type !== 'lua') {
			continue;
		}
		const normalizedPath = asset.normalized_source_path;
		const canonicalPath = stripLuaExtension(normalizedPath);
		const packageKey = asset.source_path;
		const path = asset.normalized_source_path;
		const record: LuaRequireModuleRecord = {
			packageKey,
			canonicalKey: canonicalPath,
			path,
		};
		registerLuaModuleAliases(aliases, record, path, path);
	}
	return aliases;
}
