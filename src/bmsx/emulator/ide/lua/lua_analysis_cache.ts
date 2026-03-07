import type { LuaSyntaxError } from '../../../lua/luaerrors';
import type { ParsedLuaChunk } from './lua_parse';
import { parseLuaChunkWithRecovery } from './lua_parse';
import { splitText } from '../text/source_text';

export type LuaAnalysisEntry = {
	path: string;
	source: string;
	version?: number;
	lines: readonly string[];
	parsed: ParsedLuaChunk;
	syntaxError?: LuaSyntaxError | null;
	lastAccessMs: number;
};

const MAX_ANALYSIS_CACHE_ENTRIES = 24;
const analysisCache: Map<string, LuaAnalysisEntry> = new Map();

export function getCachedLuaParse(options: {
	path: string;
	source: string;
	lines?: readonly string[];
	version?: number;
	parsed?: ParsedLuaChunk;
	withSyntaxError?: boolean;
}): LuaAnalysisEntry {
	const cacheKey = options.path;
	const version = options.version;
	const cached = analysisCache.get(cacheKey);
	if (cached) {
		const versionMatches = version !== undefined && cached.version === version;
		if (versionMatches || cached.source === options.source) {
			cached.lastAccessMs = Date.now();
			return cached;
		}
	}
	const resolvedLines = options.lines ?? splitText(options.source);
	const parsed = options.parsed ?? parseLuaChunkWithRecovery(options.source, options.path, resolvedLines);
	const syntaxError = parsed.syntaxError;
	const entry: LuaAnalysisEntry = {
		path: options.path,
		source: options.source,
		version,
		lines: resolvedLines,
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
