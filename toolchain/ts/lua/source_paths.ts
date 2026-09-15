/** Project Lua source membership shared by ROM packing and workspace discovery. */
export const LUA_SOURCE_EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
	'.bmsx', '.git', '_ignore', 'node_modules', 'test',
]);

export function isRuntimeLuaSourcePath(path: string): boolean {
	const normalized = path.replace(/\\/g, '/');
	if (!normalized.endsWith('.lua')) return false;
	for (const segment of normalized.split('/')) {
		if (LUA_SOURCE_EXCLUDED_DIRECTORIES.has(segment)) return false;
	}
	return true;
}
