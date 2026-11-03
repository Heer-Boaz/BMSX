import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** The caller grants access explicitly. A rooted grant carries its canonical root. */
export type FileAccess = { readonly kind: 'rooted'; readonly root: string } | { readonly kind: 'filesystem' };

/** Admit an existing input before reading it or enumerating its children.
 * Symlinks may resolve within a rooted grant. This is not an OS sandbox against
 * a concurrent local process replacing a parent directory after admission. */
export function resolveReadPath(access: FileAccess, input: string): string {
	const path = isAbsolute(input) ? input : resolve(input);
	if (access.kind === 'filesystem') return path;
	const logical = relative(access.root, path);
	if (logical === '..' || logical.startsWith(`..${sep}`) || isAbsolute(logical)) {
		throw new Error('Build input is outside the workspace.');
	}
	const canonical = realpathSync(path);
	const target = relative(access.root, canonical);
	if (target === '..' || target.startsWith(`..${sep}`) || isAbsolute(target)) {
		throw new Error('Build input resolves outside the workspace.');
	}
	return canonical;
}
