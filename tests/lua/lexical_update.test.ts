import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SourceChangeMap, type SourceTextChange } from '../../toolchain/ts/text/source_changes';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { updateLuaTokens } from '../../toolchain/ts/lua/syntax/lexical_update';
import { parseLuaChunkWithRecovery, updateLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import type { LuaTokenSequence } from '../../toolchain/ts/lua/syntax/token_sequence';
import { luaSyntaxSnapshot } from '../helpers/lua_syntax_snapshot';

function lexicalSnapshot(tokens: LuaTokenSequence) {
	let offset = 0;
	return Array.from(tokens, token => {
		const value = { offset, type: token.type, lexeme: token.lexeme, literal: token.literal,
			width: token.width, readWidth: token.readWidth, breaks: token.breaks, error: token.error };
		offset += token.width;
		return value;
	});
}

function replace(source: string, offset: number, deletedLength: number, inserted: string) {
	return { source: source.slice(0, offset) + inserted + source.slice(offset + deletedLength),
		change: { offset, deletedLength, insertedLength: inserted.length } };
}

test('incremental lexical edits and recovery agree with an independent cold scan', () => {
	const sources = [
		'', 'local a = 1\n'.repeat(18), 'local s = [==[one\ntwo]==]\nreturn s',
		'--[=[one\ntwo]=]\nreturn true', 'local a="escaped\\z \r\nvalue"\nreturn a',
		'local a = @\nremaining\n', '[' + '='.repeat(200) + 'x\nreturn 1',
		'local a=1\nlocal b=0x1p-4\nreturn a+b', '\r\n'.repeat(40),
	];
	for (const source of sources) {
		const previous = new LuaLexer(source, 'edit.lua').scanTokensWithRecovery().tokens;
		const retained = lexicalSnapshot(previous);
		for (let offset = 0; offset <= source.length; offset++) {
			for (const text of ['', 'x', '[=[', ']==]', '--', '\r\n', '"', '\0']) {
				for (const deleted of [0, 1]) {
					if (offset + deleted > source.length) continue;
					const edit = replace(source, offset, deleted, text);
					const changes = SourceChangeMap.unchanged(source.length).append([edit.change]);
					const next = updateLuaTokens(previous, edit.source, 'edit.lua', changes);
					const cold = new LuaLexer(edit.source, 'edit.lua').scanTokensWithRecovery().tokens;
					assert.deepEqual(lexicalSnapshot(next), lexicalSnapshot(cold), JSON.stringify({ source, offset, deleted, text }));
				}
			}
		}
		assert.deepEqual(lexicalSnapshot(previous), retained);
	}
});

test('composed disjoint and overlapping edits preserve lexical and parser outcomes across generations', () => {
	let source = 'local function f(a)\n return a+1\nend\n' + 'local value = f(1) -- comment\n'.repeat(100);
	let parsed = parseLuaChunkWithRecovery(source, 'batch.lua');
	let seed = 42;
	const random = (bound: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % bound; };
	const fragments = [' ', '\n', '--[=[', ']=]', 'local a=1;', '"s"', '', '(', ')'];
	for (let pass = 0; pass < 160; pass++) {
		const retained = luaSyntaxSnapshot(parsed.chunk);
		const previous = parsed;
		const edits: SourceTextChange[] = [];
		for (let i = 0; i < 1 + pass % 4; i++) {
			const offset = random(source.length + 1);
			const edit = replace(source, offset, Math.min(random(12), source.length - offset), fragments[random(fragments.length)]);
			source = edit.source;
			edits.push(edit.change);
		}
		const changes = SourceChangeMap.unchanged(previous.chunk.source.length).append(edits);
		parsed = updateLuaChunk(previous.chunk, source, changes);
		assert.deepEqual(luaSyntaxSnapshot(parsed.chunk), luaSyntaxSnapshot(parseLuaChunkWithRecovery(source, 'batch.lua').chunk), `generation ${pass}`);
		assert.deepEqual(luaSyntaxSnapshot(previous.chunk), retained);
	}
});

test('a local lexical edit scans bounded items and shares a large shifted suffix', t => {
	const source = 'local a = 1\n'.repeat(12000);
	const previous = new LuaLexer(source, 'large.lua').scanTokens();
	const edit = replace(source, 10, 1, '23 + 4');
	let scanned = 0;
	let characterReads = 0;
	const charAt = String.prototype.charAt, charCodeAt = String.prototype.charCodeAt;
	t.mock.method(String.prototype, 'charAt', function(this: string, index: number) {
		characterReads++;
		return charAt.call(this, index);
	});
	t.mock.method(String.prototype, 'charCodeAt', function(this: string, index: number) {
		characterReads++;
		return charCodeAt.call(this, index);
	});
	const scanBlock = LuaLexer.prototype.scanBlock;
	t.mock.method(LuaLexer.prototype, 'scanBlock', function(this: LuaLexer, ...args: Parameters<typeof scanBlock>) {
		const block = scanBlock.apply(this, args);
		scanned += block.items.length;
		return block;
	});
	const next = updateLuaTokens(previous, edit.source, 'large.lua', SourceChangeMap.unchanged(source.length).append([edit.change]));
	assert.ok(scanned < 100, `${scanned} items scanned`);
	assert.ok(characterReads < 5000, `${characterReads} character probes/copies, including spelling detachment`);
	assert.equal(next.width, edit.source.length);
	assert.strictEqual(next.blockAt(next.blockCount - 1), previous.blockAt(previous.blockCount - 1));
	assert.strictEqual(next.get(next.length - 2), previous.get(previous.length - 2));
});

test('resumed standalone scanner diagnostics use the complete source owner', () => {
	const source = '-- prefix\n\n  local value = @\nrest';
	const lexer = new LuaLexer(source, 'resume.lua', source.indexOf('local'));
	const result = lexer.scanTokensWithRecovery();
	assert.equal(result.syntaxError!.line, 3);
	assert.equal(result.syntaxError!.column, 17);
	assert.equal(result.syntaxError!.path, 'resume.lua');
	assert.equal(result.tokens.width, source.length - source.indexOf('local'));
});

test('distant edits leave the intervening lexical blocks untouched', t => {
	let source = 'local a = 1\n'.repeat(12000);
	const original = source;
	const previous = new LuaLexer(source, 'islands.lua').scanTokens();
	const first = replace(source, 10, 1, '23'); source = first.source;
	const second = replace(source, source.length - 2, 1, '45'); source = second.source;
	let scanned = 0;
	const scanBlock = LuaLexer.prototype.scanBlock;
	t.mock.method(LuaLexer.prototype, 'scanBlock', function(this: LuaLexer, ...args: Parameters<typeof scanBlock>) {
		const block = scanBlock.apply(this, args); scanned += block.items.length; return block;
	});
	const next = updateLuaTokens(previous, source, 'islands.lua', SourceChangeMap.unchanged(original.length).append([first.change, second.change]));
	assert.ok(scanned < 150, `${scanned} items scanned`);
	const middle = previous.blockAt(previous.blockCount >>> 1);
	assert.ok(Array.from(next.blocks(), entry => entry.block).includes(middle));
	assert.deepEqual(lexicalSnapshot(next), lexicalSnapshot(new LuaLexer(source, 'islands.lua').scanTokens()));
});

test('changing a long-comment delimiter legitimately relexes through the affected suffix', () => {
	const source = '--[=[closed]=]\n' + 'local a = 1\n'.repeat(800);
	const previous = new LuaLexer(source, 'comment.lua').scanTokens();
	const edit = replace(source, 4, 0, '=');
	const next = updateLuaTokens(previous, edit.source, 'comment.lua', SourceChangeMap.unchanged(source.length).append([edit.change]));
	assert.deepEqual(lexicalSnapshot(next), lexicalSnapshot(new LuaLexer(edit.source, 'comment.lua').scanSequence()));
	assert.notStrictEqual(next.get(next.length - 1), previous.get(previous.length - 1));
});
