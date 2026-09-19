import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunk, parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';

test('the parser publishes source, tokens and syntax as one retained generation', () => {
	const source = 'local value = { item = 1 }; return value.item';
	const tokens = new LuaLexer(source, 'owner.lua').scanTokens();
	const chunk = new LuaParser(tokens, 'owner.lua', source).parseChunk();
	assert.equal(chunk.source, source);
	assert.equal(chunk.tokens, tokens);
	assert.equal(chunk.syntaxError, null);
	const analysis = buildLuaFileSemanticData(source, 'owner.lua', undefined, chunk);
	assert.equal(analysis.chunk, chunk);
	assert.equal(analysis.chunk.tokens, tokens);
});

test('a compiler-owned syntax tree is bound and compiled without relexing or reparsing', t => {
	const path = 'compiler_owner.lua';
	const source = 'local value = 3\nlocal function add(other) return value + other end\nreturn add(4)';
	const parsed = parseLuaChunk(source, path);
	t.mock.method(LuaLexer.prototype, 'scanTokens', () => assert.fail('retained source must not be relexed'));
	t.mock.method(LuaLexer.prototype, 'scanTokensWithRecovery', () => assert.fail('retained source must not be relexed'));
	t.mock.method(LuaParser.prototype, 'parseChunk', () => assert.fail('retained source must not be reparsed'));
	t.mock.method(LuaParser.prototype, 'parseChunkWithRecovery', () => assert.fail('retained source must not be reparsed'));
	const snapshot = buildLuaSemanticWorkspaceSnapshot([{ path, source, chunk: parsed.chunk }]);
	assert.equal(snapshot.getFileData(path)!.chunk, parsed.chunk);
	assert.doesNotThrow(() => compileLuaChunkToProgram(parsed.chunk, [], { entrySource: source, optLevel: 0 }));
	assert.doesNotThrow(() => compileLuaChunkToProgram(parsed.chunk, [], { entrySource: source, optLevel: 3 }));
});

for (const [name, source, line] of [
	['lexical error after valid syntax', 'return 1\n@', 2],
	['syntax error before lexical error', 'local value = )\n@', 1],
	['incomplete member', 'local value = {}\nreturn value.', 2],
	['unterminated long comment', '--[=[\nreturn 1', 1],
] as const) {
	test(`recovered source retains the same diagnostic and token owner: ${name}`, () => {
		const parsed = parseLuaChunkWithRecovery(source, 'recovery.lua');
		assert.equal(parsed.chunk.source, source);
		assert.equal(parsed.chunk.tokens, parsed.tokens);
		assert.equal(parsed.chunk.syntaxError, parsed.syntaxError);
		assert.equal(parsed.syntaxError!.line, line);
		const analysis = buildLuaFileSemanticData(source, 'recovery.lua', parsed);
		assert.equal(analysis.syntaxError, parsed.syntaxError);
		assert.equal(analysis.chunk, parsed.chunk);
	});
}
