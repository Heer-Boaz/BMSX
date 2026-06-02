export function joinWorkspacePaths(...segments: string[]): string {
	return segments
		.filter(segment => segment.length > 0)
		.join('/')
		.replace(/\/+/g, '/');
}

export function stripProjectRootPrefix(resourcePath: string, projectRootPath: string | null): string {
	const normalizedRoot = projectRootPath ? projectRootPath.replace(/^\.?\//, '') : '';
	const normalizedPath = resourcePath.replace(/^\.?\//, '');
	if (normalizedRoot.length === 0) {
		return normalizedPath;
	}
	if (normalizedPath.startsWith(normalizedRoot)) {
		const sliced = normalizedPath.slice(normalizedRoot.length);
		return sliced.startsWith('/') ? sliced.slice(1) : sliced;
	}
	return normalizedPath;
}

export function resolveWorkspacePath(path: string, projectRootPath: string | null): string {
	const normalizedPath = path.replace(/^\.?\//, '');
	if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
		return path;
	}
	if (normalizedPath.startsWith('src/')) {
		return normalizedPath;
	}
	if (!projectRootPath) {
		return normalizedPath;
	}
	const normalizedRoot = projectRootPath.replace(/^\.?\//, '');
	if (normalizedPath.startsWith(normalizedRoot)) {
		return normalizedPath;
	}
	return joinWorkspacePaths(projectRootPath, path);
}
