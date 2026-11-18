import assert from 'node:assert/strict';
import { test } from 'node:test';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaSourceLocations } from '../../toolchain/ts/lua/syntax/source_locations';
import { LuaSyntaxError } from '../../toolchain/ts/lua/errors';
import { isLuaTrivia, LuaTokenType, type LuaToken } from '../../toolchain/ts/lua/syntax/token';

function lex(source: string): LuaToken[] {
	const lexer = new LuaLexer(source, 'path');
	const tokens = lexer.scanTokens();
	return Array.from(tokens.blocks(), ({ block }) => block.items).flat().filter(token => !isLuaTrivia(token.type));
}

function requireStringLiteral(token: LuaToken): string {
	if (typeof token.literal !== 'string') {
		throw new Error('Expected string literal.');
	}
	return token.literal;
}

test('lexes punctuation and operators', () => {
	const tokens = lex('()+-*/%#^ =<>~=::.,.. ...');
	const types = tokens.map((token) => token.type);
	const expected = [
		LuaTokenType.LeftParen,
		LuaTokenType.RightParen,
		LuaTokenType.Plus,
		LuaTokenType.Minus,
		LuaTokenType.Star,
		LuaTokenType.Slash,
		LuaTokenType.Percent,
		LuaTokenType.Hash,
		LuaTokenType.Caret,
		LuaTokenType.Equal,
		LuaTokenType.Less,
		LuaTokenType.Greater,
		LuaTokenType.TildeEqual,
		LuaTokenType.DoubleColon,
		LuaTokenType.Dot,
		LuaTokenType.Comma,
		LuaTokenType.DotDot,
		LuaTokenType.Vararg,
		LuaTokenType.Eof,
	];
	assert.deepEqual(types, expected);
});

test('skips comments and recognizes keywords', () => {
	const tokens = lex(`
-- line comment
local value = true -- trailing
--[[ block
comment ]]
return value
`);
	const filtered = tokens.filter((token) => token.type !== LuaTokenType.Eof);
	assert.equal(filtered.length, 6);
	assert.equal(filtered[0].type, LuaTokenType.Local);
	assert.equal(filtered[1].type, LuaTokenType.Identifier);
	assert.equal(filtered[2].type, LuaTokenType.Equal);
	assert.equal(filtered[3].type, LuaTokenType.True);
	assert.equal(filtered[4].type, LuaTokenType.Return);
	assert.equal(filtered[5].type, LuaTokenType.Identifier);
});


test('bans uppercase identifiers including palette-style constants', () => {
	assert.throws(() => {
		lex('local color = MSX_COLOR_BLACK');
	}, LuaSyntaxError);
	assert.throws(() => {
		lex('local color = BAD_CONSTANT');
	}, LuaSyntaxError);
});

test('parses numeric literals', () => {
	const tokens = lex('0 42 3.14 .25 6e1 7.5E-2');
	const numberTokens = tokens.filter((token) => token.type === LuaTokenType.Number);
	assert.equal(numberTokens.length, 6);
	assert.deepEqual(numberTokens.map(token => token.literal), [
		integerConstant(0), integerConstant(42),
		{ kind: 'float', word: 0x4048f5c3 }, { kind: 'float', word: 0x3e800000 },
		{ kind: 'float', word: 0x42700000 }, { kind: 'float', word: 0x3d99999a },
	]);
});

test('parses strings with escapes', () => {
	const tokens = lex('return "line\\n" .. \'tab\\t\'');
	assert.equal(tokens[0].type, LuaTokenType.Return);
	assert.equal(tokens[1].type, LuaTokenType.String);
	assert.equal(requireStringLiteral(tokens[1]), 'line\n');
	assert.equal(tokens[2].type, LuaTokenType.DotDot);
	assert.equal(tokens[3].type, LuaTokenType.String);
	assert.equal(requireStringLiteral(tokens[3]), 'tab\t');
});

test('tracks relative token positions through the lexical generation', () => {
	const source = 'local a\nreturn a';
	const tokens = new LuaLexer(source, 'path').scanTokens();
	const locations = LuaSourceLocations.fromLexical('path', source, tokens);
	assert.deepEqual(locations.range(tokens.getSignificant(0)).start, { line: 1, column: 1 });
	assert.deepEqual(locations.range(tokens.getSignificant(1)).start, { line: 1, column: 7 });
	assert.deepEqual(locations.range(tokens.getSignificant(2)).start, { line: 2, column: 1 });
});

test('recognizes vararg marker', () => {
	const tokens = lex('function f(...) return ... end');
	const types = tokens.map((token) => token.type);
	const expected = [
		LuaTokenType.Function,
		LuaTokenType.Identifier,
		LuaTokenType.LeftParen,
		LuaTokenType.Vararg,
		LuaTokenType.RightParen,
		LuaTokenType.Return,
		LuaTokenType.Vararg,
		LuaTokenType.End,
		LuaTokenType.Eof,
	];
	assert.deepEqual(types, expected);
});

test('throws on unexpected characters', () => {
	assert.throws(() => {
		lex('@');
	}, LuaSyntaxError);
});

test('lexes bitwise and floor-division operators', () => {
	const tokens = lex('& | ~ << >> //');
	const types = tokens.filter((token) => token.type !== LuaTokenType.Eof).map((token) => token.type);
	const expected = [
		LuaTokenType.Ampersand,
		LuaTokenType.Pipe,
		LuaTokenType.Tilde,
		LuaTokenType.ShiftLeft,
		LuaTokenType.ShiftRight,
		LuaTokenType.FloorDivide,
	];
	assert.deepEqual(types, expected);
});

test('parses hexadecimal numeric literals', () => {
	const tokens = lex('0xFF 0x1.8p+1');
	const numbers = tokens.filter((token) => token.type === LuaTokenType.Number);
	assert.equal(numbers.length, 2);
	assert.deepEqual(numbers.map(token => token.literal), [integerConstant(255), { kind: 'float', word: 0x40400000 }]);
});

test('parses long bracket strings', () => {
	const tokens = lex('local text = [[Line1\nLine2]]');
	const types = tokens.map((token) => token.type);
	assert.equal(types[0], LuaTokenType.Local);
	assert.equal(types[1], LuaTokenType.Identifier);
	assert.equal(types[2], LuaTokenType.Equal);
	assert.equal(types[3], LuaTokenType.String);
	assert.equal(requireStringLiteral(tokens[3]), 'Line1\nLine2');
});

test('parses advanced escape sequences', () => {
	const tokens = lex('return "\\x41\\048\\z  \\n"');
	assert.equal(tokens[0].type, LuaTokenType.Return);
	assert.equal(tokens[1].type, LuaTokenType.String);
	assert.equal(requireStringLiteral(tokens[1]), 'A0\n');
});

test('skips long comments with equals', () => {
	const tokens = lex('--[=[\nblock\n]=]\nreturn 1');
	const filtered = tokens.filter((token) => token.type !== LuaTokenType.Eof);
	assert.equal(filtered.length, 2);
	assert.equal(filtered[0].type, LuaTokenType.Return);
	assert.equal(filtered[1].type, LuaTokenType.Number);
});
