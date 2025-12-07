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

export function parseLuaChunk(source: string, chunkName: string): ParsedLuaChunk {
	const lexer = new LuaLexer(source, chunkName, { canonicalizeIdentifiers: ide_state.caseInsensitive ? ide_state.canonicalization : 'none' });
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, chunkName, source);
	const chunk = parser.parseChunk();
	return { chunk, tokens };
}

export function parseLuaChunkWithRecovery(source: string, chunkName: string): ParsedLuaChunk {
	let currentSource = source;
	while (true) {
		try {
			return parseLuaChunk(currentSource, chunkName);
		} catch (error) {
			if (!(error instanceof LuaSyntaxError)) {
				throw error;
			}
			const truncated = truncateSourceAtSyntaxError(currentSource, error);
			if (truncated === null) {
				return null;
			}
			currentSource = truncated;
		}
	}
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
	const line = lines[lineIndex];
	const maxColumn = lineIndex === lines.length - 1 ? Math.max(line.length - 1, 0) : line.length;
	const column = Number.isFinite(error.column) ? clamp(error.column - 1, 0, maxColumn) : maxColumn;
	const prefix = line.slice(0, column);
	if (prefix.trim().length > 0) {
		truncated.push(prefix);
	}
	const result = truncated.join('\n');
	if (result.length === source.length) {
		return null;
	}
	return result;
}
