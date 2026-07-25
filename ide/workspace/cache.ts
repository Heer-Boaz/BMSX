import type { LuaSourceRegistry } from '../../machine/ts/lua/source_registry';

export const workspaceFileCache = new Map<string, string>();

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
	registry.revision += 1;
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
	registry.revision += 1;
	if (overrides.size === 0) {
		luaSourceOverrides.delete(registry);
	}
}

export function clearWorkspaceSourceCaches(): void {
	workspaceFileCache.clear();
	for (const registry of luaSourceOverrides.keys()) {
		registry.revision += 1;
	}
	luaSourceOverrides.clear();
}
