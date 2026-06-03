import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export function ensureRelativePath(candidate: string): string {
	if (!candidate) return candidate;
	if (isAbsolute(candidate)) return candidate;
	if (candidate.startsWith('./') || candidate.startsWith('../')) return candidate;
	return `./${candidate}`;
}

export function normalizePathKey(candidate: string): string {
	return ensureRelativePath(candidate).replace(/\\/g, '/');
}

export function isDirectoryPath(candidate: string): boolean {
	try {
		return statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

export function findExistingDirectory(candidates: Array<string>): string {
	const visited = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate) continue;
		const normalized = normalizePathKey(candidate);
		if (visited.has(normalized)) continue;
		visited.add(normalized);
		if (existsSync(normalized) && isDirectoryPath(normalized)) {
			return normalized;
		}
	}
	return undefined;
}

export function parseArgsVector(argv: string[], flagsWithValues: ReadonlySet<string>): Set<string> {
	const seen = new Set<string>();
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('-')) continue;
		seen.add(token);
		if (flagsWithValues.has(token)) {
			i += 1;
		}
	}
	return seen;
}

export function getParamOrEnv(
	args: string[],
	flag: string,
	envVar: string,
	fallback: string,
	knownFlags?: ReadonlySet<string>,
): string {
	const idx = args.indexOf(flag);
	if (idx !== -1) {
		const valueIdx = idx + 1;
		if (valueIdx >= args.length) {
			throw new Error(`Flag "${flag}" expects a value.`);
		}
		const candidate = args[valueIdx];
		if (knownFlags && knownFlags.has(candidate)) {
			throw new Error(`Flag "${flag}" expects a value, but received another flag "${candidate}".`);
		}
		return candidate;
	}
	const envValue = process.env[envVar];
	if (envValue && envValue.length > 0) return envValue;
	return fallback;
}
