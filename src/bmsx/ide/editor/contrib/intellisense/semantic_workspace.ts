import { buildLuaSemanticFrontend, type LuaSemanticFrontend } from './lua_frontend';
import type { LuaBuiltinDescriptor, LuaSymbolEntry } from '../../../../machine/runtime/contracts';
import type { LuaSemanticWorkspaceSnapshot } from './semantic_model';

export { LuaSemanticWorkspace } from './semantic_model';

export type LuaSemanticWorkspaceFrontendOptions = {
	builtinDescriptors?: readonly LuaBuiltinDescriptor[];
	extraGlobalNames?: readonly string[];
	externalGlobalSymbols?: readonly LuaSymbolEntry[];
};

type LuaSemanticWorkspaceFrontendCache = {
	frontendsByKey: Map<string, LuaSemanticFrontend>;
};

const workspaceSnapshotCache = new WeakMap<LuaSemanticWorkspaceSnapshot, LuaSemanticWorkspaceFrontendCache>();

export function createLuaSemanticFrontendFromSnapshot(
	snapshot: LuaSemanticWorkspaceSnapshot,
	options: LuaSemanticWorkspaceFrontendOptions = {},
): LuaSemanticFrontend {
	const cache = getOrCreateWorkspaceSnapshotCache(snapshot);
	const cacheKey = buildFrontendCacheKey(options);
	const cached = cache.frontendsByKey.get(cacheKey);
	if (cached) {
		return cached;
	}
	const frontend = buildLuaSemanticFrontend(snapshot.sources, {
		builtinDescriptors: options.builtinDescriptors,
		extraGlobalNames: options.extraGlobalNames,
		externalGlobalSymbols: options.externalGlobalSymbols,
	});
	cache.frontendsByKey.set(cacheKey, frontend);
	return frontend;
}

function getOrCreateWorkspaceSnapshotCache(snapshot: LuaSemanticWorkspaceSnapshot): LuaSemanticWorkspaceFrontendCache {
	const cached = workspaceSnapshotCache.get(snapshot);
	if (cached) {
		return cached;
	}
	const cache = {
		frontendsByKey: new Map<string, LuaSemanticFrontend>(),
	};
	workspaceSnapshotCache.set(snapshot, cache);
	return cache;
}

function buildFrontendCacheKey(options: LuaSemanticWorkspaceFrontendOptions): string {
	return [
		buildBuiltinDescriptorKey(options.builtinDescriptors),
		buildStringListKey(options.extraGlobalNames),
		buildExternalSymbolKey(options.externalGlobalSymbols),
	].join('\x1f');
}

function buildBuiltinDescriptorKey(descriptors?: readonly LuaBuiltinDescriptor[]): string {
	if (!descriptors || descriptors.length === 0) {
		return '';
	}
	const parts = new Array(descriptors.length);
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		parts[index] = descriptor.name;
	}
	return parts.join('\x1e');
}

function buildStringListKey(values?: readonly string[]): string {
	if (!values || values.length === 0) {
		return '';
	}
	return values.join('\x1e');
}

function buildExternalSymbolKey(symbols?: readonly LuaSymbolEntry[]): string {
	if (!symbols || symbols.length === 0) {
		return '';
	}
	const parts = new Array(symbols.length);
	for (let index = 0; index < symbols.length; index += 1) {
		const symbol = symbols[index];
		parts[index] = `${symbol.path}|${symbol.name}|${symbol.location.path}|${symbol.location.range.startLine}|${symbol.location.range.startColumn}`;
	}
	return parts.join('\x1e');
}
