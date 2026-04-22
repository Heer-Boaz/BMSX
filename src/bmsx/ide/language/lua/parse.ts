import type { LuaChunk } from '../../../lua/syntax/ast';
import { LuaSyntaxError } from '../../../lua/errors';
import { LuaLexer } from '../../../lua/syntax/lexer';
import { LuaParser } from '../../../lua/syntax/parser';
import type { LuaToken } from '../../../lua/syntax/token';

export type ParsedLuaChunk = {
	chunk: LuaChunk | null;
	tokens: LuaToken[];
	syntaxError?: LuaSyntaxError | null;
};

export function parseLuaChunk(source: string, path: string, lines: readonly string[]): ParsedLuaChunk {
	const lexer = new LuaLexer(source, path);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, path, lines);
	const chunk = parser.parseChunk();
	return { chunk, tokens, syntaxError: null };
}

export function parseLuaChunkWithRecovery(source: string, path: string, lines: readonly string[]): ParsedLuaChunk {
	const lexer = new LuaLexer(source, path);
	const lexed = lexer.scanTokensWithRecovery();
	const tokens = lexed.tokens;
	const parser = new LuaParser(tokens, path, lines);
	const parsed = parser.parseChunkWithRecovery();
	let syntaxError = parsed.syntaxError;
	if (lexed.syntaxError) {
		if (!syntaxError) {
			syntaxError = lexed.syntaxError;
		} else if (lexed.syntaxError.line < syntaxError.line || (lexed.syntaxError.line === syntaxError.line && lexed.syntaxError.column < syntaxError.column)) {
			syntaxError = lexed.syntaxError;
		}
	}
	return {
		chunk: parsed.path,
		tokens,
		syntaxError,
	};
}
