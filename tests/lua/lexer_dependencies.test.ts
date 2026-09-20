import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import type { LuaToken } from '../../toolchain/ts/lua/syntax/token';

function payload(token: LuaToken) {
	return { type: token.type, lexeme: token.lexeme, literal: token.literal,
		width: token.width, breaks: token.breaks, error: token.error };
}

test('failed long-bracket probes retain dependencies beyond many intervening tokens', () => {
	const source = '[' + '='.repeat(200) + 'x';
	const tokens = new LuaLexer(source, 'dependency.lua').scanTokens();
	assert.equal(tokens.get(0).width, 1);
	assert.equal(tokens.get(0).readWidth, source.length);
	assert.ok(tokens.blockCount > 2);
	assert.equal(tokens.firstDependency(source.length - 1), 0);
	assert.notEqual(tokens.firstDependency(source.length), 0);
});

test('tokens before the first read dependency survive independent cold relex after source edits', () => {
	const sources = [
		'[', '[' + '='.repeat(200), '[' + '='.repeat(200) + 'x',
		'--[==x\nnext', '--[==[a\n]==] next', '1.foo 0x2p+3 5..a',
		'"a\\z\r\n b" ;\n', '"bad\\', '[==[ a ]=x ]==] ',
		'identifier  \r\nlocal f = true', 'f(a,b,c) + - -> /= //',
		'"a\\1234"', '\n'.repeat(34) + '[===x',
		'local a = @\nremaining\n', 'local a = upperCase\nrest',
	];
	for (const source of sources) {
		const old = new LuaLexer(source, 'dependency.lua').scanTokensWithRecovery().tokens;
		for (let offset = 0; offset <= source.length; offset++) {
			for (const inserted of ['', 'a', '[', '=', ']', '\n', '\0', ' ', '9', '"']) {
				for (const deleted of [0, 1]) {
					if (offset + deleted > source.length) continue;
					const dependency = old.firstDependency(offset);
					const edited = source.slice(0, offset) + inserted + source.slice(offset + deleted);
					const fresh = new LuaLexer(edited, 'dependency.lua').scanTokensWithRecovery().tokens;
					for (let index = 0; index < dependency; index++) {
						assert.deepEqual(payload(fresh.get(index)), payload(old.get(index)), JSON.stringify({ source, offset, inserted, deleted, index }));
					}
				}
			}
		}
	}
});
