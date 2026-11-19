import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SourceChangeMap, type SourceTextChange } from '../../toolchain/ts/text/source_changes';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { updateLuaTokens, type LuaLexicalUpdate } from '../../toolchain/ts/lua/syntax/lexical_update';
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


function checkReplacements(previous: LuaTokenSequence, update: LuaLexicalUpdate, oldSource: string, source: string): void {
	const oldBlocks = [...previous.blocks()];
	const newBlocks = [...update.tokens.blocks()];
	let replay = previous, blockDelta = 0, oldEnd = 0, newEnd = 0;
	for (const replacement of update.replacements) {
		const oldBlockEnd = replacement.oldBlockStart + replacement.oldBlockCount;
		assert.equal(replacement.oldStart, oldBlocks[replacement.oldBlockStart].offset);
		assert.equal(replacement.oldEnd, oldBlockEnd === oldBlocks.length ? previous.width : oldBlocks[oldBlockEnd].offset);
		assert.ok(replacement.oldStart >= oldEnd);
		assert.ok(replacement.newStart >= newEnd);
		assert.equal(oldSource.slice(oldEnd, replacement.oldStart), source.slice(newEnd, replacement.newStart));
		let width = 0;
		for (let i = 0; i < replacement.blocks.length; i++) {
			const block = replacement.blocks[i];
			const placement = newBlocks[replacement.oldBlockStart + blockDelta + i];
			assert.strictEqual(placement.block, block);
			assert.equal(placement.offset, replacement.newStart + width);
			for (const item of block.items) width += item.width;
		}
		assert.equal(replacement.newEnd, replacement.newStart + width);
		replay = replay.replaceBlocks(replacement.oldBlockStart + blockDelta, replacement.oldBlockCount, replacement.blocks);
		blockDelta += replacement.blocks.length - replacement.oldBlockCount;
		oldEnd = replacement.oldEnd;
		newEnd = replacement.newEnd;
	}
	assert.equal(oldSource.slice(oldEnd), source.slice(newEnd));
	assert.equal(replay.blockCount, update.tokens.blockCount);
	for (let i = 0; i < replay.blockCount; i++) assert.strictEqual(replay.blockAt(i), update.tokens.blockAt(i));
	assert.deepEqual(lexicalSnapshot(update.tokens), lexicalSnapshot(new LuaLexer(source, 'replacement.lua').scanSequence()));
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
					const next = updateLuaTokens(previous, edit.source, 'edit.lua', changes).tokens;
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
	const next = updateLuaTokens(previous, edit.source, 'large.lua', SourceChangeMap.unchanged(source.length).append([edit.change])).tokens;
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
	const next = updateLuaTokens(previous, source, 'islands.lua', SourceChangeMap.unchanged(original.length).append([first.change, second.change])).tokens;
	assert.ok(scanned < 150, `${scanned} items scanned`);
	const middle = previous.blockAt(previous.blockCount >>> 1);
	assert.ok(Array.from(next.blocks(), entry => entry.block).includes(middle));
	assert.deepEqual(lexicalSnapshot(next), lexicalSnapshot(new LuaLexer(source, 'islands.lua').scanTokens()));
});

test('changing a long-comment delimiter legitimately relexes through the affected suffix', () => {
	const source = '--[=[closed]=]\n' + 'local a = 1\n'.repeat(800);
	const previous = new LuaLexer(source, 'comment.lua').scanTokens();
	const edit = replace(source, 4, 0, '=');
	const next = updateLuaTokens(previous, edit.source, 'comment.lua', SourceChangeMap.unchanged(source.length).append([edit.change])).tokens;
	assert.deepEqual(lexicalSnapshot(next), lexicalSnapshot(new LuaLexer(edit.source, 'comment.lua').scanSequence()));
	assert.notStrictEqual(next.get(next.length - 1), previous.get(previous.length - 1));
});


test('no lexical changes retain the previous sequence without replacement runs', () => {
	for (const source of ['', 'local x=1', '@bad suffix']) {
		const previous = new LuaLexer(source, 'unchanged.lua').scanSequence();
		const result = updateLuaTokens(previous, source, 'unchanged.lua', SourceChangeMap.unchanged(source.length));
		assert.strictEqual(result.tokens, previous);
		assert.deepEqual(result.replacements, []);
	}
});

test('replacement runs expose exact original block ownership and shifted source spans', () => {
	const sources = [
		'', '()'.repeat(16), 'local x = 1\n'.repeat(150),
		'--[=[closed]=]\n' + 'local a = 1\n'.repeat(80),
		'local x = @broken\nremaining suffix',
		'[' + '='.repeat(200) + 'x\nreturn 1',
	];
	for (const original of sources) {
		for (const start of [0, original.length >>> 1, original.length]) {
			for (const text of [' ', '--[=[', ']=]', '@', 'a']) {
				let source = original;
				const edits: SourceTextChange[] = [];
				const first = replace(source, start, Math.min(1, source.length - start), text);
				source = first.source; edits.push(first.change);
				// A second edit can merge with this run, or remain a distant island.
				const second = replace(source, source.length, 0, '\nreturn true');
				source = second.source; edits.push(second.change);
				const previous = new LuaLexer(original, 'replacement.lua').scanSequence();
				const result = updateLuaTokens(previous, source, 'replacement.lua', SourceChangeMap.unchanged(original.length).append(edits));
				checkReplacements(previous, result, original, source);
			}
		}
	}
});

test('distant edits report separate runs and overlapping lexical dependencies merge once', () => {
	const original = 'local a = 1\n'.repeat(300);
	const previous = new LuaLexer(original, 'runs.lua').scanSequence();
	const first = replace(original, 10, 1, '234');
	const distant = replace(first.source, first.source.length - 2, 1, '56');
	const result = updateLuaTokens(previous, distant.source, 'runs.lua',
		SourceChangeMap.unchanged(original.length).append([first.change, distant.change]));
	assert.equal(result.replacements.length, 2);
	checkReplacements(previous, result, original, distant.source);
	const nearby = replace(first.source, 15, 1, 'xy');
	const merged = updateLuaTokens(previous, nearby.source, 'runs.lua',
		SourceChangeMap.unchanged(original.length).append([first.change, nearby.change]));
	assert.equal(merged.replacements.length, 1);
	checkReplacements(previous, merged, original, nearby.source);
});

test('terminal EOF block ownership survives zero-width old coverage and lexical failure consumes the source suffix', () => {
	const original = '()'.repeat(16);
	const previous = new LuaLexer(original, 'eof.lua').scanSequence();
	const edit = replace(original, original.length, 0, '@ broken suffix\nmore');
	const result = updateLuaTokens(previous, edit.source, 'eof.lua', SourceChangeMap.unchanged(original.length).append([edit.change]));
	assert.equal(result.replacements.length, 1);
	const replacement = result.replacements[0];
	assert.equal(replacement.oldBlockStart, 1);
	assert.equal(replacement.oldBlockCount, 1);
	assert.equal(replacement.oldStart, original.length);
	assert.equal(replacement.oldEnd, original.length);
	assert.equal(replacement.newEnd, edit.source.length);
	checkReplacements(previous, result, original, edit.source);

	const comment = '--[=[closed]=]\n' + 'local x=1\n'.repeat(100);
	const oldComment = new LuaLexer(comment, 'comment.lua').scanSequence();
	const delimiter = replace(comment, 4, 0, '=');
	const failed = updateLuaTokens(oldComment, delimiter.source, 'comment.lua', SourceChangeMap.unchanged(comment.length).append([delimiter.change]));
	assert.equal(failed.replacements.length, 1);
	assert.equal(failed.replacements[0].oldBlockCount, oldComment.blockCount);
	assert.equal(failed.replacements[0].oldEnd, comment.length);
	assert.equal(failed.replacements[0].newEnd, delimiter.source.length);
	checkReplacements(oldComment, failed, comment, delimiter.source);
});
