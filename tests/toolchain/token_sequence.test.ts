import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { createLuaSourceUnit } from '../../toolchain/ts/lua/syntax/source_layout';
import { LuaTokenType, isLuaTrivia, type LuaToken } from '../../toolchain/ts/lua/syntax/token';
import { LUA_LEXICAL_BLOCK_CAPACITY, LuaTokenSequence, type LuaTokenBlock } from '../../toolchain/ts/lua/syntax/token_sequence';

function block(count: number, seed = 0): LuaTokenBlock {
	const unit = createLuaSourceUnit();
	const items: LuaToken[] = [];
	let start = 0;
	for (let i = 0; i < count; i++) {
		const width = (seed + i) % 4 + 1;
		items.push({ type: (seed + i) % 3 === 0 ? LuaTokenType.WhitespaceTrivia : LuaTokenType.Identifier,
			lexeme: 'x'.repeat(width), literal: null, unit, start, end: start + width - 1, width,
			readWidth: width + (seed + i) % 7, breaks: 0 });
		start += width;
	}
	return { unit, items };
}

function check(sequence: LuaTokenSequence, blocks: readonly LuaTokenBlock[]): void {
	const items = blocks.flatMap(block => block.items);
	const significant = items.filter(item => !isLuaTrivia(item.type));
	assert.equal(sequence.length, items.length);
	assert.equal(sequence.blockCount, blocks.length);
	assert.equal(sequence.significantCount, significant.length);
	assert.deepEqual([...sequence], items);
	assert.deepEqual([...sequence.blocks()].map(placement => placement.block), blocks);
	const cursor = sequence.cursor();
	let offset = 0, readWidth = 0;
	for (let i = 0; i < items.length; i++) {
		assert.equal(sequence.get(i), items[i]);
		assert.equal(cursor.token, items[i]);
		assert.equal(cursor.index, i);
		assert.equal(cursor.offset, offset);
		readWidth = Math.max(readWidth, offset + items[i].readWidth);
		offset += items[i].width;
		cursor.advance();
	}
	assert.equal(cursor.token, undefined);
	assert.equal(cursor.index, items.length);
	assert.equal(cursor.offset, offset);
	assert.equal(sequence.width, offset);
	assert.equal(sequence.readWidth, readWidth);
	for (let i = items.length - 1; i >= 0; i--) {
		assert.equal(cursor.retreat(), true);
		offset -= items[i].width;
		assert.equal(cursor.token, items[i]);
		assert.equal(cursor.index, i);
		assert.equal(cursor.offset, offset);
	}
	assert.equal(cursor.retreat(), false);
	for (let i = 0; i < significant.length; i++) assert.equal(sequence.getSignificant(i), significant[i]);
}

test('lexical sequence has full-fidelity relative block/cursor and source offset parity', () => {
	const blocks = Array.from({ length: 17 }, (_, i) => block(i % LUA_LEXICAL_BLOCK_CAPACITY + 1, i));
	const sequence = LuaTokenSequence.fromBlocks(blocks);
	check(sequence, blocks);
	const cursor = sequence.cursor();
	let offset = 0, index = 0;
	for (const placement of sequence.blocks()) {
		assert.equal(placement.offset, offset);
		assert.equal(placement.itemIndex, index);
		assert.equal(sequence.blockAt(placement.index), placement.block);
		for (const item of placement.block.items) {
			cursor.seek(index);
			assert.equal(cursor.token, item);
			assert.equal(cursor.offset, offset);
			assert.equal(cursor.blockOffset, placement.offset);
			assert.equal(cursor.blockIndex, placement.index);
			for (let local = 0; local < item.width; local++) {
				cursor.seekOffset(offset + local);
				assert.equal(cursor.token, item);
				assert.equal(cursor.offset, offset);
			}
			offset += item.width;
			index++;
		}
	}
	assert.deepEqual([...sequence.placements()], [...sequence.blocks()].map(p => ({ unit: p.block.unit, offset: p.offset })));
	assert.deepEqual([...sequence.blocks(11)], [...sequence.blocks()].slice(11));
});

test('significant lookahead is nonmutating and skips trivia-only subtrees', () => {
	const blocks = Array.from({ length: 120 }, (_, i) => block(32, i));
	for (let i = 1; i < 119; i++) blocks[i] = { unit: blocks[i].unit,
		items: blocks[i].items.map(item => ({ ...item, type: LuaTokenType.WhitespaceTrivia })) };
	const sequence = LuaTokenSequence.fromBlocks(blocks);
	const items = [...sequence];
	const cursor = sequence.cursor();
	for (let i = 0; i < items.length; i += 47) {
		cursor.seek(i);
		const significant = items.slice(i).filter(item => !isLuaTrivia(item.type));
		for (let distance = 0; distance <= significant.length; distance++) {
			assert.equal(cursor.peekSignificant(distance), significant[distance]);
			assert.equal(cursor.index, i);
		}
	}
	cursor.seek(0);
	while (cursor.token !== undefined) {
		const next = items.findIndex((item, i) => i > cursor.index && !isLuaTrivia(item.type));
		assert.equal(cursor.advanceSignificant(), next !== -1);
		assert.equal(cursor.index, next === -1 ? items.length : next);
	}
});

test('persistent block splices and forks agree with an independent flat oracle', () => {
	let blocks = Array.from({ length: 70 }, (_, i) => block(i % 32 + 1, i));
	let sequence = LuaTokenSequence.fromBlocks(blocks);
	const retained: { sequence: LuaTokenSequence; blocks: LuaTokenBlock[] }[] = [];
	let state = 415;
	const random = (max: number): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
	for (let step = 0; step < 240; step++) {
		if (step % 17 === 0) retained.push({ sequence, blocks });
		if (step % 19 === 0 && retained.length > 0) {
			const fork = retained[random(retained.length)];
			sequence = fork.sequence; blocks = fork.blocks;
		}
		const from = random(blocks.length + 1), deleted = random(Math.min(8, blocks.length - from) + 1);
		const inserted = Array.from({ length: random(6) }, () => block(random(32) + 1, random(100)));
		sequence = sequence.replaceBlocks(from, deleted, inserted);
		blocks = [...blocks.slice(0, from), ...inserted, ...blocks.slice(from + deleted)];
		check(sequence, blocks);
		assert.ok(sequence.height <= 2 * Math.log2(sequence.blockCount + 1) + 1);
	}
	for (const old of retained) check(old.sequence, old.blocks);
	check(LuaTokenSequence.fromBlocks([]), []);
	check(sequence.replaceBlocks(0, sequence.blockCount, []), []);
});

test('read extent index catches arbitrarily distant failed long-bracket probes and EOF reads', () => {
	const blocks = Array.from({ length: 300 }, (_, i) => block(32, i));
	const first = blocks[0].items[0];
	const width = blocks.reduce((sum, b) => sum + b.items.reduce((n, item) => n + item.width, 0), 0);
	blocks[0] = { unit: blocks[0].unit, items: [{ ...first, type: LuaTokenType.LeftBracket, readWidth: width + 1 }, ...blocks[0].items.slice(1)] };
	const sequence = LuaTokenSequence.fromBlocks(blocks);
	assert.equal(sequence.firstDependency(width - 1), 0);
	assert.equal(sequence.firstDependency(width), 0);
	assert.equal(sequence.firstDependency(width + 1), sequence.length);
	const local = LuaTokenSequence.fromBlocks(blocks.slice(1));
	const items = [...local];
	for (let offset = 0; offset <= local.width + 8; offset += 19) {
		let start = 0, expected = items.length;
		for (let i = 0; i < items.length; i++) {
			if (start <= offset && start + items[i].readWidth > offset) { expected = i; break; }
			start += items[i].width;
		}
		assert.equal(local.firstDependency(offset), expected);
	}
});

test('zero-width EOF and failed lexical suffix remain point spans with full source coverage', () => {
	for (const width of [0, 17]) {
		const unit = createLuaSourceUnit();
		const eof: LuaToken = { type: LuaTokenType.Eof, lexeme: '', literal: null, unit, start: 0, end: 0, width, readWidth: width + 1, breaks: 0 };
		const prefix = block(32);
		const blocks = [{ unit: prefix.unit, items: prefix.items.map(item => ({ ...item, readWidth: item.width })) }, { unit, items: [eof] }];
		const sequence = LuaTokenSequence.fromBlocks(blocks);
		check(sequence, blocks);
		const cursor = sequence.cursor();
		cursor.seekOffset(sequence.width - (width === 0 ? 0 : 1));
		assert.equal(cursor.token, eof);
		assert.equal(sequence.firstDependency(sequence.width), 32);
		assert.equal(cursor.advance(), false);
		assert.equal(cursor.retreat(), true);
		assert.equal(cursor.token, eof);
	}
});

test('large shifted suffixes retain blocks and nodes with logarithmic edit allocation', () => {
	for (const count of [128, 8192]) {
		const blocks = Array.from({ length: count }, (_, i) => block(1, i));
		const before = LuaTokenSequence.fromBlocks(blocks);
		const nodes = new Set<object>();
		function collect(node: typeof before['root']): void {
			if (node === null) return;
			nodes.add(node);
			if (node.kind === 'branch') { collect(node.left); collect(node.right); }
		}
		collect(before['root']);
		const after = before.replaceBlocks(0, 0, [block(32)]);
		let allocated = 0;
		function countNew(node: typeof before['root']): void {
			if (node === null || nodes.has(node)) return;
			allocated++;
			if (node.kind === 'branch') { countNew(node.left); countNew(node.right); }
		}
		countNew(after['root']);
		assert.ok(allocated <= 4 * before.height, `${count} blocks: ${allocated} new nodes`);
		for (let i = 0; i < blocks.length; i++) assert.equal(after.blockAt(i + 1), before.blockAt(i));
	}
});

test('dependency search and significant rank touch one bounded block, not the prefix', () => {
	let reads = 0;
	const blocks = Array.from({ length: 4096 }, (_, seed) => {
		const original = block(32, seed);
		return { unit: original.unit, items: original.items.map(item => ({ ...item,
			get readWidth() { reads++; return item.width; },
			get type() { reads++; return item.type; },
		})) };
	});
	const sequence = LuaTokenSequence.fromBlocks(blocks);
	reads = 0;
	assert.equal(sequence.firstDependency(sequence.width - 1), sequence.length - 1);
	assert.ok(reads <= LUA_LEXICAL_BLOCK_CAPACITY, `${reads} dependency token reads`);
	reads = 0;
	assert.equal(sequence.getSignificant(sequence.significantCount - 1), blocks[4095].items[31]);
	assert.ok(reads <= LUA_LEXICAL_BLOCK_CAPACITY, `${reads} significant token reads`);
	reads = 0;
	const cursor = sequence.cursor();
	assert.equal(cursor.peekSignificant(sequence.significantCount - 1), blocks[4095].items[31]);
	assert.ok(reads <= 2 * LUA_LEXICAL_BLOCK_CAPACITY, `${reads} lookahead token reads`);
});

test('cursor direction changes and random seeks retain block locations', () => {
	const blocks = Array.from({ length: 71 }, (_, i) => block(i % 32 + 1, i));
	const sequence = LuaTokenSequence.fromBlocks(blocks);
	const placements = [...sequence.blocks()];
	const items = [...sequence];
	const cursor = sequence.cursor();
	let index = 0, state = 817;
	for (let step = 0; step < 4000; step++) {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		switch (state % 4) {
			case 0:
				if (index < items.length) index++;
				cursor.advance();
				break;
			case 1:
				if (index > 0) index--;
				cursor.retreat();
				break;
			case 2:
				index = state % (items.length + 1);
				cursor.seek(index);
				break;
			case 3: {
				const next = items.findIndex((item, i) => i > index && !isLuaTrivia(item.type));
				index = next === -1 ? items.length : next;
				cursor.advanceSignificant();
				break;
			}
		}
		assert.equal(cursor.index, index);
		assert.equal(cursor.token, items[index]);
		if (index < items.length) {
			const placement = placements.find(p => index >= p.itemIndex && index < p.itemIndex + p.block.items.length)!;
			assert.equal(cursor.blockIndex, placement.index);
			assert.equal(cursor.blockOffset, placement.offset);
			assert.equal(cursor.offset, placement.offset + items[index].start);
		}
	}
});

test('significant cursor seeks and ranks agree with full-fidelity item order', () => {
	const sequence = new LuaLexer('-- heading\n' + 'local a = 1 -- trail\n'.repeat(250), 'rank.lua').scanTokens();
	const cursor = sequence.cursor();
	let rank = 0;
	for (let index = 0; index < sequence.length; index++) {
		cursor.seek(index);
		assert.equal(cursor.significantIndex, rank);
		if (!isLuaTrivia(cursor.token!.type)) {
			cursor.seekSignificant(rank);
			assert.equal(cursor.index, index);
			assert.equal(cursor.significantIndex, rank);
			assert.strictEqual(cursor.token, sequence.getSignificant(rank));
			rank++;
		}
	}
	cursor.seekSignificant(rank);
	assert.equal(cursor.token, undefined);
	assert.equal(cursor.index, sequence.length);
	assert.equal(cursor.offset, sequence.width);
	assert.equal(cursor.significantIndex, rank);
});
