export function computeSourceLabel(path: string): string {
	const lastSlash = path.lastIndexOf('/');
	return lastSlash !== -1 && lastSlash + 1 < path.length ? path.slice(lastSlash + 1) : path;
}
