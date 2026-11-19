import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { createLuaSourceUnit } from '../../toolchain/ts/lua/syntax/source_layout';
import { LUA_STATEMENT_LEAF_CAPACITY, LuaStatementSequence, type LuaStatementPart } from '../../toolchain/ts/lua/syntax/statement_sequence';

function part(seed: number, gap = false): LuaStatementPart {
	const unit = createLuaSourceUnit();
	const width = seed % 7 + 1;
	return { statement: gap ? null : { kind: LuaSyntaxKind.BreakStatement, span: { unit, start: 0, end: width - 1 } },
		width, readWidth: width + seed % 5, recovery: seed % 71 === 0, endsNewLine: seed % 2 === 0, units: [unit] };
}

function check(sequence: LuaStatementSequence, parts: readonly LuaStatementPart[]): void {
	const statements = parts.flatMap(part => part.statement === null ? [] : [part.statement]);
	assert.deepEqual([...sequence], statements);
	assert.deepEqual([...sequence.parts()], parts);
	assert.equal(sequence.length, statements.length);
	assert.equal(sequence.partCount, parts.length);
	assert.equal(sequence.hasRecovery, parts.some(part => part.recovery));
	let width = 0, readWidth = 0;
	const cursor = sequence.cursor();
	cursor.seekPart(0);
	for (let i = 0; i < parts.length; i++) {
		assert.equal(cursor.part, parts[i]);
		assert.equal(cursor.partIndex, i);
		assert.equal(cursor.offset, width);
		readWidth = Math.max(readWidth, width + parts[i].readWidth);
		width += parts[i].width;
		cursor.advancePart();
	}
	assert.equal(cursor.part, undefined);
	assert.equal(cursor.partIndex, parts.length);
	assert.equal(cursor.offset, width);
	assert.equal(sequence.width, width);
	assert.equal(sequence.readWidth, readWidth);
	for (let i = parts.length - 1; i >= 0; i--) {
		assert.equal(cursor.retreatPart(), true);
		width -= parts[i].width;
		assert.equal(cursor.part, parts[i]);
		assert.equal(cursor.offset, width);
	}
	assert.equal(cursor.retreatPart(), false);
	cursor.seek(0);
	for (let i = 0; i < statements.length; i++) {
		assert.equal(sequence.get(i), statements[i]);
		assert.equal(cursor.statement, statements[i]);
		assert.equal(cursor.index, i);
		cursor.advance();
	}
	assert.equal(cursor.statement, undefined);
	assert.equal(cursor.index, statements.length);
	for (let i = statements.length - 1; i >= 0; i--) {
		assert.equal(cursor.retreat(), true);
		assert.equal(cursor.statement, statements[i]);
		assert.equal(cursor.index, i);
	}
	assert.equal(cursor.retreat(), false);
}

test('statement sequence retains gaps, dependency ends, recovery, and occurrence ownership', () => {
	for (const count of [0, 1, 31, 32, 33, 2048]) {
		const parts = Array.from({ length: count }, (_, i) => part(i, i % 5 === 0));
		const sequence = LuaStatementSequence.fromParts(17, parts);
		assert.equal(sequence.context, 17);
		check(sequence, parts);
	}
	check(LuaStatementSequence.empty(17), []);
	const gaps = Array.from({ length: 150 }, (_, i) => part(i, true));
	check(LuaStatementSequence.fromParts(17, gaps), gaps);
});

test('statement sequence persistent forks and splices agree with flat oracle', () => {
	let parts = Array.from({ length: 110 }, (_, i) => part(i, i % 3 === 0));
	let sequence = LuaStatementSequence.fromParts(9, parts);
	const retained: { sequence: LuaStatementSequence; parts: LuaStatementPart[] }[] = [];
	let state = 591;
	const random = (max: number): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
	for (let step = 0; step < 300; step++) {
		if (step % 17 === 0) retained.push({ sequence, parts });
		if (step % 21 === 0 && retained.length > 0) ({ sequence, parts } = retained[random(retained.length)]);
		const from = random(parts.length + 1), count = random(parts.length - from + 1);
		const inserted = Array.from({ length: random(43) }, (_, i) => part(step + i, i % 5 === 0));
		sequence = sequence.replaceParts(from, count, LuaStatementSequence.fromParts(9, inserted));
		parts = [...parts.slice(0, from), ...inserted, ...parts.slice(from + count)];
		check(sequence, parts);
		const cut = random(parts.length + 1);
		check(sequence.sliceParts(0, cut).concat(sequence.sliceParts(cut, parts.length)), parts);
	}
	for (const snapshot of retained) check(snapshot.sequence, snapshot.parts);
});

test('cursor seeks and alternating directions preserve statement and part ranks', () => {
	const parts = Array.from({ length: 2100 }, (_, i) => part(i, i > 30 && i < 2000));
	const sequence = LuaStatementSequence.fromParts(0, parts);
	const indices = parts.flatMap((part, i) => part.statement === null ? [] : [i]);
	const offsets = [0];
	for (const part of parts) offsets.push(offsets[offsets.length - 1] + part.width);
	const cursor = sequence.cursor();
	for (let i = 0; i < indices.length; i++) {
		cursor.seek(i);
		assert.equal(cursor.partIndex, indices[i]);
		assert.equal(cursor.offset, offsets[indices[i]]);
		if (i + 1 < indices.length) {
			assert.equal(cursor.advance(), true);
			assert.equal(cursor.partIndex, indices[i + 1]);
			assert.equal(cursor.retreat(), true);
			assert.equal(cursor.partIndex, indices[i]);
			assert.equal(cursor.offset, offsets[indices[i]]);
		}
	}
	for (let i = 0; i < parts.length; i++) {
		cursor.seekOffset(offsets[i]);
		assert.equal(cursor.part, parts[i]);
		assert.equal(cursor.partIndex, i);
		assert.equal(cursor.index, indices.filter(index => index < i).length);
		cursor.seekOffset(offsets[i + 1] - 1);
		assert.equal(cursor.part, parts[i]);
	}
	const end = { ...part(1, true), width: 0, readWidth: 1 };
	const terminal = sequence.concat(LuaStatementSequence.fromParts(0, [end]));
	const last = terminal.cursor();
	last.seekOffset(terminal.width);
	assert.equal(last.part, end);
	assert.equal(last.advancePart(), false);
	assert.equal(last.retreatPart(), true);
	assert.equal(last.part, end);
});

test('clean reuse ends at first read dependency or recovery without scanning shared suffix', () => {
	let reads = 0;
	const parts = Array.from({ length: 32768 }, (_, i) => {
		const p = part(i);
		return { ...p, recovery: false, get readWidth() { reads++; return p.width + 1; } };
	});
	const sequence = LuaStatementSequence.fromParts(0, parts);
	reads = 0;
	const whole = sequence.reusableParts(0, sequence.readWidth);
	assert.equal(whole['root'], sequence['root']);
	assert.equal(reads, 0);
	const suffix = sequence.reusableParts(173, sequence.readWidth);
	assert.equal(suffix.partCount, parts.length - 173);
	assert.ok(reads <= 4 * LUA_STATEMENT_LEAF_CAPACITY, `${reads} reuse reads`);
	const example = LuaStatementSequence.fromParts(0, [
		{ ...part(1), width: 2, readWidth: 20, recovery: false },
		{ ...part(2, true), width: 3, readWidth: 3, recovery: false },
		{ ...part(3), width: 4, readWidth: 4, recovery: true },
		{ ...part(4), width: 5, readWidth: 5, recovery: false },
	]);
	assert.equal(example.reusableParts(0, 19).partCount, 0);
	assert.equal(example.reusableParts(0, 20).partCount, 2);
	assert.equal(example.reusableParts(1, 5).partCount, 1);
	assert.equal(example.reusableParts(2, 100).partCount, 0);
	assert.equal(example.reusableParts(3, 14).partCount, 1);
});

test('large suffix edits share nodes and preserve bounded balanced leaves', () => {
	for (const count of [128, 8192, 65536]) {
		const parts = Array.from({ length: count }, (_, i) => part(i));
		const before = LuaStatementSequence.fromParts(0, parts);
		const nodes = new Set<object>();
		function collect(node: typeof before['root']): void {
			if (node === null) return;
			nodes.add(node);
			if (node.kind === 'branch') { collect(node.left); collect(node.right); }
		}
		collect(before['root']);
		const after = before.replaceParts(3, 1, LuaStatementSequence.fromParts(0, [part(200)]));
		let allocated = 0;
		function countNew(node: typeof before['root']): void {
			if (node === null || nodes.has(node)) return;
			allocated++;
			if (node.kind === 'branch') {
				assert.ok(Math.abs(node.left.height - node.right.height) <= 1);
				countNew(node.left); countNew(node.right);
			} else assert.ok(node.parts.length <= LUA_STATEMENT_LEAF_CAPACITY);
		}
		countNew(after['root']);
		assert.ok(allocated <= 5 * before.height, `${count} parts: ${allocated} new nodes`);
		assert.equal(after.get(count - 1), before.get(count - 1));
	}
});

test('statement traversal skips large gap subtrees in both directions', () => {
	let reads = 0;
	const first = part(1), last = part(2);
	const parts = [first, ...Array.from({ length: 32768 }, (_, i) => {
		const gap = part(i, true);
		return { ...gap, get statement() { reads++; return null; } };
	}), last];
	const sequence = LuaStatementSequence.fromParts(0, parts);
	const cursor = sequence.cursor();
	reads = 0;
	assert.equal(cursor.advance(), true);
	assert.equal(cursor.statement, last.statement);
	assert.ok(reads <= 4 * LUA_STATEMENT_LEAF_CAPACITY, `${reads} forward gap reads`);
	reads = 0;
	assert.equal(cursor.retreat(), true);
	assert.equal(cursor.statement, first.statement);
	assert.ok(reads <= 4 * LUA_STATEMENT_LEAF_CAPACITY, `${reads} reverse gap reads`);
});

test('offset seeks skip interior zero-width parts but retain terminal observations', () => {
	const zero = { ...part(1, true), width: 0, readWidth: 1 };
	const wide = { ...part(2), width: 5, readWidth: 5 };
	const sequence = LuaStatementSequence.fromParts(0, [zero, zero, wide, zero, zero]);
	const cursor = sequence.cursor();
	cursor.seekOffset(0);
	assert.equal(cursor.partIndex, 2);
	cursor.seekOffset(5);
	assert.equal(cursor.partIndex, 4);
	assert.equal(cursor.part, zero);
});
