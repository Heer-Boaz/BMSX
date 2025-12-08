import type { LuaChunk } from '../../lua/lua_ast';
import { LuaSyntaxError } from '../../lua/luaerrors';
import { LuaLexer } from '../../lua/lualexer';
import { LuaParser } from '../../lua/luaparser';
import type { LuaToken } from '../../lua/luatoken';
import { clamp } from '../../utils/clamp';
import { ide_state } from './ide_state';

export type ParsedLuaChunk = {
	chunk: LuaChunk;
	tokens: LuaToken[];
};

export function parseLuaChunk(source: string, chunkName: string, lines?: readonly string[]): ParsedLuaChunk {
	const lexer = new LuaLexer(source, chunkName, { canonicalizeIdentifiers: ide_state.caseInsensitive ? ide_state.canonicalization : 'none' });
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, chunkName, source, lines);
	const chunk = parser.parseChunk();
	return { chunk, tokens };
}

export function parseLuaChunkWithRecovery(source: string, chunkName: string, lines?: readonly string[]): ParsedLuaChunk {
	let currentSource = source;
	let currentLines: readonly string[] = lines ?? source.split('\n');
	while (true) {
		try {
			return parseLuaChunk(currentSource, chunkName, currentLines);
		} catch (error) {
			if (!(error instanceof LuaSyntaxError)) {
				throw error;
			}
			const truncated = truncateSourceAtSyntaxError(currentSource, currentLines, error);
			if (truncated === null) {
				return null;
			}
			currentSource = truncated.source;
			currentLines = truncated.lines;
		}
	}
}

function truncateSourceAtSyntaxError(
	source: string,
	lines: readonly string[],
	error: LuaSyntaxError,
): { source: string; lines: readonly string[] } {
	if (!Number.isFinite(error.line)) {
		return null;
	}
	const lineIndex = error.line - 1;
	if (lineIndex < 0 || lineIndex >= lines.length) {
		return null;
	}
	const truncatedLines: string[] = [];
	for (let index = 0; index < lineIndex; index += 1) {
		truncatedLines.push(lines[index] ?? '');
	}
	const line = lines[lineIndex];
	const isLastLine = lineIndex === lines.length - 1;
	const maxColumn = line.length;
	let column = Number.isFinite(error.column) ? clamp(error.column - 1, 0, maxColumn) : maxColumn;
	if (isLastLine && column >= line.length) {
		// Avoid shrinking the last line one character at a time when the error is at or beyond EOF.
		column = 0;
	}
	const prefix = line.slice(0, column);
	if (prefix.trim().length > 0) {
		truncatedLines.push(prefix);
	}
	const truncatedSource = truncatedLines.join('\n');
	if (truncatedSource.length === source.length) {
		return null;
	}
	return { source: truncatedSource, lines: truncatedLines };
}
