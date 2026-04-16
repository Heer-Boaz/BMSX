export const workspaceSourceCache = new Map<string, string>();

export function getWorkspaceCachedSource(path: string): string | null {
	const value = workspaceSourceCache.get(path);
	return typeof value === 'string' ? value : null;
}

export function listWorkspaceCachedPaths(): Iterable<string> {
	return workspaceSourceCache.keys();
}

export function setWorkspaceCachedSources(paths: Iterable<string>, source: string): void {
	for (const path of paths) {
		if (!path) continue;
		workspaceSourceCache.set(path, source);
	}
}

export function deleteWorkspaceCachedSources(paths: Iterable<string>): void {
	for (const path of paths) {
		if (!path) continue;
		workspaceSourceCache.delete(path);
	}
}

export function clearWorkspaceCachedSources(): void {
	workspaceSourceCache.clear();
}
