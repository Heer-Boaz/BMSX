import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaLexer } from '../../src/bmsx/lua/lexer.ts';
import { LuaSyntaxError } from '../../src/bmsx/lua/errors.ts';
import { LuaTokenType, type LuaToken } from '../../src/bmsx/lua/token.ts';

function lex(source: string): LuaToken[] {
	const lexer = new LuaLexer(source, 'chunk');
	return lexer.scanTokens();
}

function requireNumberLiteral(token: LuaToken): number {
	if (typeof token.literal !== 'number') {
		throw new Error('Expected numeric literal.');
	}
	return token.literal;
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

test('parses numeric literals', () => {
	const tokens = lex('0 42 3.14 .25 6e1 7.5E-2');
	const numberTokens = tokens.filter((token) => token.type === LuaTokenType.Number);
	assert.equal(numberTokens.length, 6);
	assert.equal(requireNumberLiteral(numberTokens[0]), 0);
	assert.equal(requireNumberLiteral(numberTokens[1]), 42);
	assert.equal(requireNumberLiteral(numberTokens[2]), 3.14);
	assert.equal(requireNumberLiteral(numberTokens[3]), 0.25);
	assert.equal(requireNumberLiteral(numberTokens[4]), 60);
	assert.equal(Math.abs(requireNumberLiteral(numberTokens[5]) - 0.075) < 1e-12, true);
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

test('tracks token positions', () => {
	const tokens = lex('local a\nreturn a');
	const localToken = tokens[0];
	const identifierToken = tokens[1];
	const returnToken = tokens[2];
	assert.equal(localToken.line, 1);
	assert.equal(localToken.column, 1);
	assert.equal(identifierToken.line, 1);
	assert.equal(identifierToken.column, 7);
	assert.equal(returnToken.line, 2);
	assert.equal(returnToken.column, 1);
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
	assert.equal(requireNumberLiteral(numbers[0]), 255);
	assert.ok(Math.abs(requireNumberLiteral(numbers[1]) - 3) < 1e-12);
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
