import type { LuaChunk } from '../syntax/ast';
import { LuaSyntaxError } from '../errors';
import { LuaLexer } from '../syntax/lexer';
import { LuaParser } from '../syntax/parser';
import type { LuaToken } from '../syntax/token';

export type ParsedLuaChunk = {
	readonly chunk: LuaChunk;
	readonly tokens: readonly LuaToken[];
	readonly syntaxError: LuaSyntaxError | null;
};

export function parseLuaChunk(source: string, path: string): ParsedLuaChunk {
	const lexer = new LuaLexer(source, path);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, path, source);
	const chunk = parser.parseChunk();
	return { chunk, tokens, syntaxError: null };
}

export function parseLuaChunkWithRecovery(source: string, path: string): ParsedLuaChunk {
	const lexer = new LuaLexer(source, path);
	const lexed = lexer.scanTokensWithRecovery();
	const tokens = lexed.tokens;
	const parser = new LuaParser(tokens, path, source);
	const parsed = parser.parseChunkWithRecovery(lexed.syntaxError);
	return {
		chunk: parsed.path,
		tokens,
		syntaxError: parsed.syntaxError,
	};
}
