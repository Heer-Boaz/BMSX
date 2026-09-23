import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http_security.mjs';

/** HTTP path admission shared by static files and workspace records. Root is canonical. */
export async function resolveRootedPath(root, relativePath, createParents = false) {
	if (typeof relativePath !== 'string' || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
		throw new HttpError(400, 'Expected a workspace-relative path.');
	}
	const target = path.resolve(root, relativePath);
	const relative = path.relative(root, target);
	if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new HttpError(403, 'Path is outside the served root.');
	}
	if (relative === '') return target;
	const segments = relative.split(path.sep);
	let current = root;
	for (let index = 0; index < segments.length; index++) {
		current = path.join(current, segments[index]);
		let stats;
		try { stats = await lstat(current); }
		catch (error) {
			if (error.code !== 'ENOENT') throw error;
			if (createParents && index < segments.length - 1) await mkdir(current, { recursive: true });
			else if (index < segments.length - 1) throw error;
			continue;
		}
		if (stats.isSymbolicLink()) throw new HttpError(403, 'Symbolic links are not served.');
	}
	return target;
}
