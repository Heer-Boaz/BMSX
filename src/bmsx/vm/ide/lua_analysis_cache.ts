import type { ParsedLuaChunk } from './lua_parse';
import { parseLuaChunkWithRecovery } from './lua_parse';

export type LuaAnalysisEntry = {
	chunkName: string;
	source: string;
	version: number | null;
	lines: readonly string[];
	parsed: ParsedLuaChunk;
	lastAccessMs: number;
};

const MAX_ANALYSIS_CACHE_ENTRIES = 24;
const analysisCache: Map<string, LuaAnalysisEntry> = new Map();

export function getCachedLuaParse(options: {
	chunkName: string;
	source: string;
	lines?: readonly string[];
	version?: number;
	parsed?: ParsedLuaChunk;
}): LuaAnalysisEntry {
	const resolvedLines = options.lines ?? options.source.split('\n');
	const cacheKey = options.chunkName ?? '';
	const version = options.version ?? null;
	const cached = analysisCache.get(cacheKey);
	if (cached) {
		const versionMatches = version !== null && cached.version === version;
		if (versionMatches || cached.source === options.source) {
			cached.lastAccessMs = Date.now();
			if (!cached.lines) {
				cached.lines = resolvedLines;
			}
			return cached;
		}
	}
	const parsed = options.parsed ?? parseLuaChunkWithRecovery(options.source, options.chunkName, resolvedLines);
	const entry: LuaAnalysisEntry = {
		chunkName: options.chunkName,
		source: options.source,
		version,
		lines: resolvedLines,
		parsed,
		lastAccessMs: Date.now(),
	};
	analysisCache.set(cacheKey, entry);
	evictIfNeeded();
	return entry;
}

export function invalidateLuaAnalysis(chunkName: string): void {
	const cacheKey = chunkName ?? '';
	analysisCache.delete(cacheKey);
}

function evictIfNeeded(): void {
	if (analysisCache.size <= MAX_ANALYSIS_CACHE_ENTRIES) {
		return;
	}
	let oldestKey: string = null;
	let oldestAccess = Number.POSITIVE_INFINITY;
	for (const [key, entry] of analysisCache) {
		if (entry.lastAccessMs < oldestAccess) {
			oldestKey = key;
			oldestAccess = entry.lastAccessMs;
		}
	}
	if (oldestKey !== null) {
		analysisCache.delete(oldestKey);
	}
}
