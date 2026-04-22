import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';

export function resolveInputPath(candidate: string): string {
	return isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
}

function splitNullDelimited(buffer: Buffer): string[] {
	return buffer.toString('utf8').split('\0').filter(Boolean);
}

let gitFilesCache: string[] | undefined;

function requestedRootKeys(roots: readonly string[]): string[] {
	const keys: string[] = [];
	for (let index = 0; index < roots.length; index += 1) {
		const absolute = resolveInputPath(roots[index]);
		const relativePath = relative(process.cwd(), absolute).replace(/\\/g, '/').replace(/\/$/, '');
		if (relativePath.length === 0) {
			keys.push('.');
		} else if (!relativePath.startsWith('../') && relativePath !== '..') {
			keys.push(relativePath);
		}
	}
	return keys;
}

function pathIsUnderRequestedRoot(path: string, roots: readonly string[]): boolean {
	for (let index = 0; index < roots.length; index += 1) {
		const root = roots[index];
		if (root === '.' || path === root || path.startsWith(`${root}/`)) {
			return true;
		}
	}
	return false;
}

function gitTrackedAndUntrackedFiles(): string[] {
	if (gitFilesCache !== undefined) {
		return gitFilesCache;
	}
	const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: process.cwd(), encoding: 'buffer' });
	if (tracked.status !== 0) {
		throw new Error('git ls-files failed; source scanning requires a Git worktree.');
	}
	const untracked = spawnSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: process.cwd(), encoding: 'buffer' });
	if (untracked.status !== 0) {
		throw new Error('git ls-files --others --exclude-standard failed; source scanning requires Git exclude support.');
	}
	const files = new Set([...splitNullDelimited(tracked.stdout), ...splitNullDelimited(untracked.stdout)]);
	gitFilesCache = Array.from(files);
	return gitFilesCache;
}

export function collectSourceFiles(roots: readonly string[], extensions: ReadonlySet<string>): string[] {
	const candidates = gitTrackedAndUntrackedFiles();
	const rootKeys = requestedRootKeys(roots);
	const files: string[] = [];
	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index].replace(/\\/g, '/');
		if (!pathIsUnderRequestedRoot(candidate, rootKeys)) {
			continue;
		}
		if (extensions.has(extname(candidate))) {
			const absolute = resolve(process.cwd(), candidate);
			if (existsSync(absolute)) {
				files.push(absolute);
			}
		}
	}
	return files;
}
