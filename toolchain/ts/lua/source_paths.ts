/** Project Lua source membership shared by ROM packing and workspace discovery. */
export const CART_LIBRARY_ROOT = 'cartlib';

export function isCartLibrarySource(path: string): boolean {
	return path.startsWith(`${CART_LIBRARY_ROOT}/`);
}

export const LUA_SOURCE_EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
	'.bmsx', '.git', '_ignore', 'node_modules', 'test',
]);

/** Canonical project-relative file or directory membership, shared by source discovery and creation. */
export function isProjectSourcePath(path: string): boolean {
	let start = 0;
	for (;;) {
		const end = path.indexOf('/', start);
		if (LUA_SOURCE_EXCLUDED_DIRECTORIES.has(end === -1 ? path.slice(start) : path.slice(start, end))) return false;
		if (end === -1) return true;
		start = end + 1;
	}
}

export function isRuntimeLuaSourcePath(path: string): boolean {
	const normalized = path.replace(/\\/g, '/');
	return normalized.endsWith('.lua') && isProjectSourcePath(normalized);
}
