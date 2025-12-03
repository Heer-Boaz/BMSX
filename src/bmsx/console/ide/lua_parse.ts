import type { LuaChunk } from '../../lua/ast';
import { LuaSyntaxError } from '../../lua/errors';
import { LuaLexer } from '../../lua/lexer';
import { LuaParser } from '../../lua/parser';
import type { LuaToken } from '../../lua/token';
import { ide_state } from './ide_state';

export type ParsedLuaChunk = {
	chunk: LuaChunk;
	tokens: LuaToken[];
	parsedSource: string;
	normalizedSource: string;
};

export function normalizeLuaSource(source: string): string {
	return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function parseLuaChunk(source: string, chunkName: string): ParsedLuaChunk {
	const normalized = normalizeLuaSource(source);
	const parsed = parseInternal(normalized, chunkName);
	return {
		...parsed,
		parsedSource: normalized,
		normalizedSource: normalized,
	};
}

export function parseLuaChunkWithRecovery(source: string, chunkName: string): ParsedLuaChunk {
	const normalized = normalizeLuaSource(source);
	try {
		const parsed = parseInternal(normalized, chunkName);
		return {
			...parsed,
			parsedSource: normalized,
			normalizedSource: normalized,
		};
	} catch (error) {
		if (!(error instanceof LuaSyntaxError)) {
			throw error;
		}
		const truncated = truncateSourceAtSyntaxError(normalized, error);
		if (truncated === null) {
			throw error;
		}
		const parsed = parseInternal(truncated, chunkName);
		return {
			...parsed,
			parsedSource: truncated,
			normalizedSource: normalized,
		};
	}
}

function parseInternal(source: string, chunkName: string): { chunk: LuaChunk; tokens: LuaToken[] } {
	const lexer = new LuaLexer(source, chunkName, { canonicalizeIdentifiers: ide_state.caseInsensitive ? ide_state.canonicalization : 'none' });
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, chunkName, source);
	const chunk = parser.parseChunk();
	return { chunk, tokens };
}

function truncateSourceAtSyntaxError(source: string, error: LuaSyntaxError): string {
	if (!Number.isFinite(error.line)) {
		return null;
	}
	const lines = source.split('\n');
	const lineIndex = error.line - 1;
	if (lineIndex < 0 || lineIndex >= lines.length) {
		return null;
	}
	const truncated: string[] = [];
	for (let index = 0; index < lineIndex; index += 1) {
		truncated.push(lines[index]);
	}
	if (lineIndex < lines.length) {
		const column = Number.isFinite(error.column) ? Math.max(0, error.column - 1) : lines[lineIndex].length;
		const prefix = lines[lineIndex].slice(0, column);
		if (prefix.trim().length > 0) {
			truncated.push(prefix);
		}
	}
	return truncated.join('\n');
}
