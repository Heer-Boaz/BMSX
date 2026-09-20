import type { SourceChangeMap } from '../../text/source_changes';
import { updateLuaTokens } from '../syntax/lexical_update';
import type { LuaChunk } from '../syntax/ast';
import { LuaSyntaxError } from '../errors';
import { LuaLexer } from '../syntax/lexer';
import { LuaParser } from '../syntax/parser';
import { LuaSyntaxUpdate } from '../syntax/syntax_update';
import type { LuaTokenSequence } from '../syntax/token_sequence';

export type ParsedLuaChunk = {
	readonly chunk: LuaChunk;
	readonly tokens: LuaTokenSequence;
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
	const tokens = lexer.scanSequence();
	const parser = new LuaParser(tokens, path, source);
	const parsed = parser.parseChunkWithRecovery();
	return {
		chunk: parsed.path,
		tokens,
		syntaxError: parsed.syntaxError,
	};
}

/** Reuse lexically unchanged syntax through the same grammar as a cold parse. */
export function updateLuaChunk(previous: LuaChunk, source: string, changes: SourceChangeMap): ParsedLuaChunk {
	const lexical = updateLuaTokens(previous.tokens, source, previous.locations.path, changes);
	const tokens = lexical.tokens;
	const update = new LuaSyntaxUpdate(previous, source, changes, lexical);
	const parsed = new LuaParser(tokens, previous.locations.path, source, update).parseChunkWithRecovery();
	return { chunk: parsed.path, tokens, syntaxError: parsed.syntaxError };
}
