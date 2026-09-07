import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { isLuaTrivia, LuaTokenType } from '../../toolchain/ts/lua/syntax/token';

const sources = [
	'',
	' \t\v\r\n\n\t ',
	'-- comment without a final newline',
	'-- comment\r\nlocal value = 0x1f;\r\nreturn value -- tail\r\n',
	'local t = { ["key"] = (- --[=[between tokens]=]\n0x10); (2), } -- tail\n',
	'local a = "--[["\nlocal b = "--[=["\nlocal c = "]]"\n',
	'-- --[[ is still a line comment\nlocal a = "not a comment"\n-- ]]\n',
	'local s = [==[--[=[\n]]\n]=] inside string\n]==]\nreturn s',
	'local s = "first\\z  \n\t second"\n-- end',
];

for (let level = 0; level < 4; level += 1) {
	const equals = '='.repeat(level);
	sources.push(`--[${equals}[ long comment\n[==[ "quoted" --\n]${equals}]\nreturn true`);
}

test('trivia scan reconstructs exact source and projects to the existing significant tokens', () => {
	for (const source of sources) {
		const tokens = new LuaLexer(source, 'trivia.lua', false).scanTokens();
		assert.equal(tokens.map(token => token.lexeme).join(''), source);
		assert.deepEqual(tokens.filter(token => !isLuaTrivia(token.type)), new LuaLexer(source, 'trivia.lua').scanTokens());
	}
});

test('lexer classifies comments, whitespace and newlines without probing string contents', () => {
	const tokens = new LuaLexer('-- line\n\t--[=[block\ncomment]=] "--[["', 'trivia.lua', false).scanTokens();
	assert.deepEqual(tokens.map(token => token.type), [
		LuaTokenType.SingleLineCommentTrivia,
		LuaTokenType.NewLineTrivia,
		LuaTokenType.WhitespaceTrivia,
		LuaTokenType.MultiLineCommentTrivia,
		LuaTokenType.WhitespaceTrivia,
		LuaTokenType.String,
		LuaTokenType.Eof,
	]);
	assert.deepEqual([tokens[3].line, tokens[3].column, tokens[3].endLine, tokens[3].endColumn], [2, 2, 3, 10]);
	assert.equal(tokens[5].literal, '--[[');
});

test('default scanning produces only EOF for a trivia-only document', () => {
	assert.deepEqual(new LuaLexer('  --[=[hello]=]\n\t-- tail', 'trivia.lua').scanTokens().map(token => token.type), [LuaTokenType.Eof]);
});

test('recovery still reports the same lexical error and significant prefix in both modes', () => {
	for (const source of ['-- lead\nlocal a = @ trailing', '-- lead\nlocal a = "unfinished', 'local a = 1\n--[=[unfinished']) {
		const expected = new LuaLexer(source, 'trivia.lua').scanTokensWithRecovery();
		const actual = new LuaLexer(source, 'trivia.lua', false).scanTokensWithRecovery();
		assert.ok(actual.syntaxError);
		assert.equal(actual.syntaxError.message, expected.syntaxError!.message);
		assert.equal(actual.syntaxError.line, expected.syntaxError!.line);
		assert.equal(actual.syntaxError.column, expected.syntaxError!.column);
		assert.deepEqual(actual.tokens.filter(token => !isLuaTrivia(token.type)), expected.tokens);
	}
});

test('real cartlib, BIOS and Nemesis sources are lossless with unchanged parser input', () => {
	for (const path of ['cartlib/world/world.lua', 'machine/bios/gpu/gpu.lua', 'carts/nemesis_s/scenes/root.lua']) {
		const source = readFileSync(path, 'utf8');
		const tokens = new LuaLexer(source, path, false).scanTokens();
		assert.equal(tokens.map(token => token.lexeme).join(''), source, path);
		assert.deepEqual(tokens.filter(token => !isLuaTrivia(token.type)), new LuaLexer(source, path).scanTokens(), path);
	}
});
