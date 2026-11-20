import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaSourceLocations } from '../../toolchain/ts/lua/syntax/source_locations';
import { isLuaTrivia, LuaTokenType } from '../../toolchain/ts/lua/syntax/token';
import { luaTokenLeadingTriviaStart, luaTokenTrailingTriviaEnd } from '../../toolchain/ts/lua/syntax/token_navigation';

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

test('full-fidelity tokens reconstruct source and significant ranks omit trivia', () => {
	for (const source of sources) {
		const tokens = new LuaLexer(source, 'trivia.lua').scanTokens();
		const items = Array.from(tokens.blocks(), ({ block }) => block.items).flat();
		assert.equal(items.map(token => token.lexeme).join(''), source);
		assert.equal(tokens.width, source.length);
		assert.deepEqual(Array.from({ length: tokens.significantCount }, (_, index) => tokens.getSignificant(index)), items.filter(token => !isLuaTrivia(token.type)));
	}
});

test('lexer classifies comments, whitespace and newlines without probing string contents', () => {
	const source = '-- line\n\t--[=[block\ncomment]=] "--[["';
	const tokens = new LuaLexer(source, 'trivia.lua').scanTokens();
	const locations = LuaSourceLocations.fromLexical('trivia.lua', source, tokens);
	assert.deepEqual(Array.from(tokens.blocks(), ({ block }) => block.items).flat().map(token => token.type), [
		LuaTokenType.SingleLineCommentTrivia,
		LuaTokenType.NewLineTrivia,
		LuaTokenType.WhitespaceTrivia,
		LuaTokenType.MultiLineCommentTrivia,
		LuaTokenType.WhitespaceTrivia,
		LuaTokenType.String,
		LuaTokenType.Eof,
	]);
	assert.deepEqual(locations.range(tokens.get(3)), { path: 'trivia.lua', start: { line: 2, column: 2 }, end: { line: 3, column: 10 } });
	assert.equal(tokens.get(5).literal, '--[[');
});

test('token attachment partitions lossless source including file-leading and EOF trivia', () => {
	for (const source of sources) {
		const tokens = new LuaLexer(source, 'trivia.lua').scanTokens();
		let end = 0;
		for (let index = 0; index < tokens.length; index += 1) {
			if (isLuaTrivia(tokens.get(index).type)) continue;
			assert.equal(luaTokenLeadingTriviaStart(tokens, index), end, source);
			end = tokens.get(index).type === LuaTokenType.Eof ? tokens.length : luaTokenTrailingTriviaEnd(tokens, index);
		}
		assert.equal(end, tokens.length);
	}
	const source = '-- file\nlocal --[[inside\ncomment]] \r\n -- name\n name -- inline\n\n-- eof';
	const tokens = new LuaLexer(source, 'trivia.lua').scanTokens();
	const attached: string[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		if (isLuaTrivia(tokens.get(index).type)) continue;
		const start = luaTokenLeadingTriviaStart(tokens, index);
		const end = tokens.get(index).type === LuaTokenType.Eof ? tokens.length : luaTokenTrailingTriviaEnd(tokens, index);
		attached.push(Array.from({ length: end - start }, (_, offset) => tokens.get(start + offset).lexeme).join(''));
	}
	assert.deepEqual(attached, ['-- file\nlocal --[[inside\ncomment]] \r\n', ' -- name\n name -- inline\n', '\n-- eof']);
});

test('trivia-only documents keep their source coverage and one significant EOF', () => {
	const source = '  --[=[hello]=]\n\t-- tail';
	const tokens = new LuaLexer(source, 'trivia.lua').scanTokens();
	assert.equal(tokens.width, source.length);
	assert.equal(tokens.significantCount, 1);
	assert.equal(tokens.getSignificant(0).type, LuaTokenType.Eof);
});

test('lexical recovery retains a terminal failure with the complete skipped suffix', () => {
	for (const source of ['-- lead\nlocal a = @ trailing', '-- lead\nlocal a = "unfinished', 'local a = 1\n--[=[unfinished', 'local a = @\nremaining\n', 'local a = [=[unfinished\nremaining\n']) {
		const actual = new LuaLexer(source, 'trivia.lua').scanTokensWithRecovery();
		assert.ok(actual.syntaxError);
		const locations = LuaSourceLocations.fromLexical('trivia.lua', source, actual.tokens);
		const eof = actual.tokens.get(actual.tokens.length - 1);
		assert.equal(eof.error, actual.syntaxError.message);
		assert.deepEqual(locations.range(eof).start, { line: actual.syntaxError.line, column: actual.syntaxError.column });
		assert.equal(actual.tokens.width, source.length);
		assert.equal(eof.width, source.length - locations.offset(eof.unit, eof.start));
		assert.equal(eof.breaks, source.slice(source.length - eof.width).split('\n').length - 1);
	}
});

test('real cartlib, BIOS and Nemesis sources are lossless with unchanged parser input', () => {
	for (const path of ['cartlib/world/world.lua', 'machine/bios/gpu/gpu.lua', 'carts/nemesis_s/scenes/root.lua']) {
		const source = readFileSync(path, 'utf8');
		const tokens = new LuaLexer(source, path).scanTokens();
		const items = Array.from(tokens.blocks(), ({ block }) => block.items).flat();
		assert.equal(items.map(token => token.lexeme).join(''), source, path);
		assert.deepEqual(Array.from({ length: tokens.significantCount }, (_, index) => tokens.getSignificant(index)), items.filter(token => !isLuaTrivia(token.type)), path);
	}
});
