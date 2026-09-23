import { advanceLuaSourceRevision, type LuaSourceRegistry } from '../runtime/source_registry';

export const workspaceCanonicalSourceCache = new Map<string, string>();

const luaSourceOverrides = new Map<LuaSourceRegistry, Map<string, string>>();

export function getWorkspaceLuaSourceOverride(
	registry: LuaSourceRegistry,
	path: string,
): string | undefined {
	return luaSourceOverrides.get(registry)?.get(path);
}

export function setWorkspaceLuaSourceOverride(
	registry: LuaSourceRegistry,
	path: string,
	source: string,
): void {
	let overrides = luaSourceOverrides.get(registry);
	if (!overrides) {
		overrides = new Map();
		luaSourceOverrides.set(registry, overrides);
	}
	if (overrides.get(path) === source) {
		return;
	}
	overrides.set(path, source);
	advanceLuaSourceRevision(registry, path);
}

export function deleteWorkspaceLuaSourceOverride(
	registry: LuaSourceRegistry,
	path: string,
): void {
	const overrides = luaSourceOverrides.get(registry);
	if (!overrides) {
		return;
	}
	if (!overrides.delete(path)) {
		return;
	}
	advanceLuaSourceRevision(registry, path);
	if (overrides.size === 0) {
		luaSourceOverrides.delete(registry);
	}
}

/** Release a build-owned source registry without invalidating authoring documents. */
export function releaseWorkspaceSourceOverrides(registry: LuaSourceRegistry): void {
	luaSourceOverrides.delete(registry);
}

export function clearWorkspaceSourceCaches(): void {
	workspaceCanonicalSourceCache.clear();
	for (const registry of luaSourceOverrides.keys()) {
		luaSourceOverrides.delete(registry);
		advanceLuaSourceRevision(registry);
	}
}
