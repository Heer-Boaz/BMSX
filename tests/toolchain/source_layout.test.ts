import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HashMapBuilder } from '../../toolchain/ts/collections/hash_map';
import { createLuaSourceUnit, LuaSourceLayout } from '../../toolchain/ts/lua/syntax/source_layout';

function position(source: string, offset: number) {
	const prefix = source.slice(0, offset);
	const lines = prefix.split('\n');
	return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

test('source layout retains full text, UTF-16 positions, trivia and error suffixes', () => {
	for (const source of ['', 'a', '\n', 'a\r\nb\r\nc', '--[=[\nunterminated', 'a'.repeat(1023) + '\r\n😀\n\tend']) {
		const layout = LuaSourceLayout.create(source);
		assert.equal(layout.length, source.length);
		assert.equal(layout.read(0, source.length), source);
		for (let offset = 0; offset <= source.length; offset++) {
			const expected = position(source, offset);
			assert.deepEqual(layout.positionAt(offset), expected);
			assert.equal(layout.offsetAt(expected), offset);
		}
	}
});

test('identical and coincident occurrences stay distinct, including branches from an old snapshot', () => {
	const first = createLuaSourceUnit(), second = createLuaSourceUnit(), nested = createLuaSourceUnit();
	const original = LuaSourceLayout.create('a(); a()', [{ unit: first, offset: 0 }, { unit: nested, offset: 0 }, { unit: second, offset: 5 }]);
	const edit = original.edit();
	edit.replace(0, 0, '-- lead\n');
	edit.removeUnit(first);
	const replacement = edit.insertUnit(8);
	const updated = edit.snapshot();
	assert.equal(original.unitOffset(first), 0);
	assert.equal(original.unitOffset(second), 5);
	assert.equal(updated.hasUnit(first), false);
	assert.equal(updated.unitOffset(nested), 8);
	assert.equal(updated.unitOffset(second), 13);
	assert.equal(updated.unitOffset(replacement), 8);
	const fork = original.edit();
	const forkUnit = fork.insertUnit(0);
	assert.notEqual(replacement, forkUnit);
	assert.equal(fork.snapshot().unitOffset(first), 0);
	assert.equal(updated.unitOffset(second), 13);
});

test('replacement retires start/interior occurrences but retains the unchanged end boundary', () => {
	const units = Array.from({ length: 5 }, () => createLuaSourceUnit());
	const layout = LuaSourceLayout.create('abcd', units.map((unit, offset) => ({ unit, offset })));
	const edit = layout.edit();
	edit.replace(1, 2, 'x\ny');
	const updated = edit.snapshot();
	assert.equal(updated.read(0, updated.length), 'ax\nyd');
	assert.equal(updated.unitOffset(units[0]), 0);
	assert.equal(updated.hasUnit(units[1]), false);
	assert.equal(updated.hasUnit(units[2]), false);
	assert.equal(updated.unitOffset(units[3]), 4);
	assert.equal(updated.unitOffset(units[4]), 5);
	for (let offset = 0; offset <= updated.length; offset++) assert.deepEqual(updated.positionAt(offset), position('ax\nyd', offset));
});

test('leading insertion changes logarithmic record paths, not the shifted units', t => {
	for (const count of [100, 10000]) {
		const units = Array.from({ length: count }, () => createLuaSourceUnit());
		const before = LuaSourceLayout.create('x\n'.repeat(count), units.map((unit, index) => ({ unit, offset: index * 2 })));
		const write = t.mock.method(HashMapBuilder.prototype, 'set');
		const edit = before.edit();
		edit.replace(0, 0, 'lead\n');
		const after = edit.snapshot();
		assert.ok(write.mock.callCount() < 20 * before.height, `${count} units: ${write.mock.callCount()} record writes`);
		write.mock.restore();
		for (let index = 0; index < count; index++) {
			assert.equal(before.unitOffset(units[index]), index * 2);
			assert.equal(after.unitOffset(units[index]), index * 2 + 5);
		}
	}
});

test('deterministic edit and marker sequences agree with flat source while old snapshots remain valid', () => {
	let text = 'abc\r\n'.repeat(400);
	let layout = LuaSourceLayout.create(text);
	let state = 1729;
	const random = () => state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
	const units = new Map<ReturnType<typeof createLuaSourceUnit>, number>();
	const retained: { layout: LuaSourceLayout; text: string; units: Map<ReturnType<typeof createLuaSourceUnit>, number> }[] = [];
	for (let step = 0; step < 2000; step++) {
		const edit = layout.edit();
		if (step % 3 === 0) {
			const offset = random() % (text.length + 1);
			units.set(edit.insertUnit(offset), offset);
		} else {
			const offset = random() % (text.length + 1);
			const length = Math.min(random() % 10, text.length - offset);
			const inserted = ['x', '\r\n', '', '😀\n'][random() >>> 30];
			edit.replace(offset, length, inserted);
			text = text.slice(0, offset) + inserted + text.slice(offset + length);
			for (const [unit, at] of units) {
				if (at >= offset && at < offset + length) units.delete(unit);
				else if (at >= offset + length) units.set(unit, at + inserted.length - length);
			}
		}
		layout = edit.snapshot();
		assert.equal(layout.read(0, layout.length), text);
		for (const [unit, at] of units) assert.equal(layout.unitOffset(unit), at);
		for (let sample = 0; sample < 3; sample++) {
			const offset = random() % (text.length + 1);
			const expected = position(text, offset);
			assert.deepEqual(layout.positionAt(offset), expected);
			assert.equal(layout.offsetAt(expected), offset);
		}
		assert.ok(layout.height < 2 * Math.log2(layout.recordCount + 2));
		if (step % 100 === 0) retained.push({ layout, text, units: new Map(units) });
	}
	for (const old of retained) {
		assert.equal(old.layout.read(0, old.layout.length), old.text);
		for (const [unit, at] of old.units) assert.equal(old.layout.unitOffset(unit), at);
	}
});


test('retiring temporary units does not accumulate source fragments or historical records', () => {
	const text = 'abc\ndef'.repeat(32);
	const initial = LuaSourceLayout.create(text);
	let layout = initial;
	for (let index = 0; index < 10000; index++) {
		const edit = layout.edit();
		const unit = edit.insertUnit((index * 139) % (text.length + 1));
		edit.removeUnit(unit);
		layout = edit.snapshot();
	}
	assert.equal(layout.read(0, layout.length), text);
	assert.equal(layout.recordCount, initial.recordCount);
	assert.equal(initial.read(0, initial.length), text);
});


test('sequential cursor sees each occurrence and text leaf once, including boundary seeks', () => {
	const units = Array.from({ length: 5 }, () => createLuaSourceUnit());
	const layout = LuaSourceLayout.create('ab\ncd', units.map((unit, index) => ({ unit, offset: [0, 0, 2, 5, 5][index] })));
	const cursor = layout.cursor();
	const seen: number[] = [];
	let text = '';
	for (; cursor.current !== undefined; cursor.next()) {
		const leaf = cursor.current;
		if (leaf.kind === 'unit') {
			seen.push(leaf.unit);
			assert.equal(cursor.offset, layout.unitOffset(leaf.unit));
		} else {
			assert.equal(cursor.offset, text.length);
			text += leaf.text;
		}
	}
	assert.equal(text, 'ab\ncd');
	assert.deepEqual(seen, units);
	assert.equal(cursor.offset, layout.length);
	assert.equal(cursor.next(), false);
	for (let offset = 0; offset <= layout.length; offset++) {
		const positioned = layout.cursor(offset);
		let suffix = '';
		for (; positioned.current !== undefined; positioned.next()) {
			const leaf = positioned.current;
			if (leaf.kind === 'unit') assert.ok(positioned.offset >= offset);
			else suffix += leaf.text.slice(Math.max(0, offset - positioned.offset));
		}
		assert.equal(suffix, text.slice(offset));
	}
	const empty = LuaSourceLayout.create('').cursor();
	assert.equal(empty.current, undefined);
	assert.equal(empty.next(), false);
});
