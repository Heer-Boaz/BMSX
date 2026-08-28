import type { LuaSyntaxError } from '../errors';
import type { ParsedLuaChunk } from './parse';
import { parseLuaChunkWithRecovery } from './parse';

export type LuaAnalysisEntry = {
	path: string;
	source: string;
	parsed: ParsedLuaChunk;
	syntaxError?: LuaSyntaxError | null;
	lastAccessMs: number;
};

const MAX_ANALYSIS_CACHE_ENTRIES = 24;
const analysisCache: Map<string, LuaAnalysisEntry> = new Map();

export function getCachedLuaParse(options: {
	path: string;
	source: string;
	parsed?: ParsedLuaChunk;
}): LuaAnalysisEntry {
	const cacheKey = options.path;
	const cached = analysisCache.get(cacheKey);
	if (cached && cached.source === options.source) {
		cached.lastAccessMs = Date.now();
		return cached;
	}
	const parsed = options.parsed ?? parseLuaChunkWithRecovery(options.source, options.path);
	const syntaxError = parsed.syntaxError;
	const entry: LuaAnalysisEntry = {
		path: options.path,
		source: options.source,
		parsed,
		syntaxError,
		lastAccessMs: Date.now(),
	};
	analysisCache.set(cacheKey, entry);
	evictIfNeeded();
	return entry;
}

function evictIfNeeded(): void {
	if (analysisCache.size <= MAX_ANALYSIS_CACHE_ENTRIES) {
		return;
	}
	const firstEntry = analysisCache.entries().next().value!;
	let oldestKey = firstEntry[0];
	let oldestAccess = firstEntry[1].lastAccessMs;
	for (const [key, entry] of analysisCache) {
		if (entry.lastAccessMs < oldestAccess) {
			oldestKey = key;
			oldestAccess = entry.lastAccessMs;
		}
	}
	analysisCache.delete(oldestKey);
}
