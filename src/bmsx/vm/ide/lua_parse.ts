import type { LuaChunk } from '../../lua/lua_ast';
import { LuaSyntaxError } from '../../lua/luaerrors';
import { LuaLexer } from '../../lua/lualexer';
import { LuaParser } from '../../lua/luaparser';
import type { LuaToken } from '../../lua/luatoken';
import { ide_state } from './ide_state';
import { splitText } from './source_text';

export type ParsedLuaChunk = {
	chunk: LuaChunk | null;
	tokens: LuaToken[];
	syntaxError?: LuaSyntaxError | null;
};

export function parseLuaChunk(source: string, path: string, lines?: readonly string[]): ParsedLuaChunk {
	const lexer = new LuaLexer(source, path, { canonicalizeIdentifiers: ide_state.caseInsensitive ? ide_state.canonicalization : 'none' });
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, path, source, lines);
	const chunk = parser.parseChunk();
	return { chunk, tokens, syntaxError: null };
}

export function parseLuaChunkWithRecovery(source: string, path: string, lines?: readonly string[]): ParsedLuaChunk {
	const resolvedLines: readonly string[] = lines ?? splitText(source);
	const lexer = new LuaLexer(source, path, { canonicalizeIdentifiers: ide_state.caseInsensitive ? ide_state.canonicalization : 'none' });
	const lexed = lexer.scanTokensWithRecovery();
	const tokens = lexed.tokens;
	const parser = new LuaParser(tokens, path, source, resolvedLines);
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
