import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/');
}

function resolveInputPath(candidate: string): string {
	return isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
}

function splitNullDelimited(buffer: Buffer): string[] {
	return buffer.toString('utf8').split('\0').filter(Boolean);
}

let gitFilesCache: string[] | null | undefined;

function requestedRootKeys(roots: readonly string[]): string[] {
	const keys: string[] = [];
	for (let index = 0; index < roots.length; index += 1) {
		const absolute = resolveInputPath(roots[index]);
		const relativePath = normalizePath(relative(process.cwd(), absolute)).replace(/\/$/, '');
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

function gitTrackedAndUntrackedFiles(): string[] | null {
	if (gitFilesCache !== undefined) {
		return gitFilesCache;
	}
	const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: process.cwd(), encoding: 'buffer' });
	if (tracked.status !== 0) {
		gitFilesCache = null;
		return null;
	}
	const untracked = spawnSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: process.cwd(), encoding: 'buffer' });
	if (untracked.status !== 0) {
		gitFilesCache = null;
		return null;
	}
	const files = new Set([...splitNullDelimited(tracked.stdout), ...splitNullDelimited(untracked.stdout)]);
	gitFilesCache = Array.from(files);
	return gitFilesCache;
}

function collectGitFiles(roots: readonly string[], extensions: ReadonlySet<string>): string[] | null {
	const candidates = gitTrackedAndUntrackedFiles();
	if (candidates === null) {
		return null;
	}
	const rootKeys = requestedRootKeys(roots);
	const files: string[] = [];
	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = normalizePath(candidates[index]);
		if (!pathIsUnderRequestedRoot(candidate, rootKeys)) {
			continue;
		}
		if (extensions.has(extname(candidate))) {
			files.push(resolve(process.cwd(), candidate));
		}
	}
	return files;
}

function collectFallbackFiles(roots: readonly string[], extensions: ReadonlySet<string>): string[] {
	const files: string[] = [];
	const stack = roots.map(resolveInputPath);
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined || !existsSync(current)) {
			continue;
		}
		const stats = statSync(current);
		if (stats.isFile()) {
			if (extensions.has(extname(current))) {
				files.push(current);
			}
			continue;
		}
		if (!stats.isDirectory()) {
			continue;
		}
		const entries = readdirSync(current, { withFileTypes: true });
		for (let index = 0; index < entries.length; index += 1) {
			stack.push(join(current, entries[index].name));
		}
	}
	return files;
}

export function collectSourceFiles(roots: readonly string[], extensions: ReadonlySet<string>): string[] {
	return collectGitFiles(roots, extensions) ?? collectFallbackFiles(roots, extensions);
}
