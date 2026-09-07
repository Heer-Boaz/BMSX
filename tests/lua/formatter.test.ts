import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { formatLuaDocument } from '../../ide/language/lua/formatter';
import { LuaSyntaxError } from '../../toolchain/ts/lua/errors';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaTokenType } from '../../toolchain/ts/lua/syntax/token';

test('comment open/close text inside strings does not protect unrelated code from formatting', () => {
	const source = "if ready then\nlocal start = '--[['\nvalue()\nlocal finish = ']]'\nend";
	assert.equal(formatLuaDocument(source, source.split('\n')), "if ready then\n\tlocal start = '--[['\n\tvalue()\n\tlocal finish = ']]'\nend");
});

test('a long-comment opener inside a line comment is not a second comment', () => {
	const source = 'if ready then\n-- --[[\nvalue()\n-- ]]\nend';
	assert.equal(formatLuaDocument(source, source.split('\n')), 'if ready then\n\t-- --[[\n\tvalue()\n\t-- ]]\nend');
});

test('long string opening suffixes, interior lines and closing prefixes retain every character', () => {
	const source = 'if ready then\nlocal s = [==[open  \n  middle \t\n   close]==]   \nuse(s)\nend';
	const expected = 'if ready then\n\tlocal s = [==[open  \n  middle \t\n   close]==]\n\tuse(s)\nend';
	assert.equal(formatLuaDocument(source, source.split('\n')), expected);
});

test('two-line literals keep closing-line indentation that is part of the string value', () => {
	const source = 'do\nlocal s = [[first\n   second]]\nend';
	assert.equal(formatLuaDocument(source, source.split('\n')), 'do\n\tlocal s = [[first\n   second]]\nend');
});

test('multiline short strings retain z-escape whitespace and source spelling', () => {
	const source = 'do\nlocal s = "first\\z  \n \t second"   \nend';
	assert.equal(formatLuaDocument(source, source.split('\n')), 'do\n\tlocal s = "first\\z  \n \t second"\nend');
});

test('long comments preserve their content while surrounding code is indented', () => {
	const source = 'do\n--[=[open  \n  ]] is content\n   close]=]   \nwork() -- trailing  \nend';
	const expected = 'do\n\t--[=[open  \n  ]] is content\n   close]=]\n\twork() -- trailing  \nend';
	assert.equal(formatLuaDocument(source, source.split('\n')), expected);
});

test('only significant tokens contribute indentation, including mixed close/open lines', () => {
	const source = 'if ready then\n-- end } else\nif next then\nrun()\nelse\nrun_again()\nend\nelseif done then\nrepeat\nstep()\nuntil stopped\nelse\nlocal t = {\n{ 1 };\n}\nend\n';
	const expected = 'if ready then\n\t-- end } else\n\tif next then\n\t\trun()\n\telse\n\t\trun_again()\n\tend\nelseif done then\n\trepeat\n\t\tstep()\n\tuntil stopped\nelse\n\tlocal t = {\n\t\t{ 1 };\n\t}\nend\n';
	assert.equal(formatLuaDocument(source, source.split('\n')), expected);
});

test('empty, whitespace-only and EOF-comment documents do not need a final newline', () => {
	assert.equal(formatLuaDocument('', ['']), '');
	assert.equal(formatLuaDocument(' \t\n \n', [' \t', ' ', '']), '\n\n');
	assert.equal(formatLuaDocument('  -- tail  ', ['  -- tail  ']), '-- tail  ');
});

test('malformed strings and comments are diagnosed instead of formatted through recovery', () => {
	for (const source of ['local s = "unfinished', '--[=[unfinished']) {
		assert.throws(() => formatLuaDocument(source, source.split('\n')), LuaSyntaxError);
	}
});

test('formatting real source is idempotent and preserves non-whitespace lexemes and values', () => {
	for (const path of ['cartlib/world/world.lua', 'machine/bios/gpu/gpu.lua', 'carts/nemesis_s/scenes/root.lua']) {
		const source = readFileSync(path, 'utf8');
		const formatted = formatLuaDocument(source, source.split('\n'));
		assert.equal(formatLuaDocument(formatted, formatted.split('\n')), formatted, path);
		const before = new LuaLexer(source, path, false).scanTokens();
		const after = new LuaLexer(formatted, path, false).scanTokens();
		assert.deepEqual(
			after.filter(token => token.type !== LuaTokenType.WhitespaceTrivia && token.type !== LuaTokenType.NewLineTrivia)
				.map(token => [token.type, token.lexeme, token.literal]),
			before.filter(token => token.type !== LuaTokenType.WhitespaceTrivia && token.type !== LuaTokenType.NewLineTrivia)
				.map(token => [token.type, token.lexeme, token.literal]),
			path,
		);
	}
});
