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
	if (normalizedPath === normalizedRoot) {
		return '';
	}
	if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
		return normalizedPath.slice(normalizedRoot.length + 1);
	}
	return normalizedPath;
}

export function resolveWorkspacePath(path: string, projectRootPath: string | null): string {
	const normalizedPath = path.replace(/^\.?\//, '');
	if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
		return path;
	}
	if (!projectRootPath) {
		return normalizedPath;
	}
	const normalizedRoot = projectRootPath.replace(/^\.?\//, '');
	if (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)) {
		return normalizedPath;
	}
	return joinWorkspacePaths(projectRootPath, path);
}

/** User-entered path relative to a workspace folder, never outside that folder. */
export function normalizeRelativeWorkspacePath(input: string): string {
	const path = input.replace(/\\/g, '/');
	if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
		throw new Error('Enter a path relative to the project folder.');
	}
	if (path.length === 0 || path.endsWith('/')) throw new Error('Enter a file name.');
	const segments: string[] = [];
	for (const segment of path.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			if (segments.length === 0) throw new Error('The file must be inside the project folder.');
			segments.pop();
		} else {
			if (/[<>:"|?*\x00-\x1f]/.test(segment)) throw new Error(`Invalid file name: ${segment}`);
			segments.push(segment);
		}
	}
	if (segments.length === 0) throw new Error('Enter a file name.');
	return segments.join('/');
}
