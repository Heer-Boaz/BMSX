import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Table, valuesEqual } from '../../src/bmsx/emulator/cpu';
import { Memory } from '../../src/bmsx/emulator/memory';
import { StringHandleTable } from '../../src/bmsx/emulator/string_memory';
import { StringPool } from '../../src/bmsx/emulator/string_pool';

function createRuntimeStringPool(): StringPool {
	const memory = new Memory({ engineRom: new Uint8Array(0) });
	return new StringPool(new StringHandleTable(memory));
}

test('compile-time string pool still canonicalizes identical text', () => {
	const pool = new StringPool();
	const left = pool.intern('vlok');
	const right = pool.intern('vlok');
	assert.equal(left, right);
	assert.equal(left.id, right.id);
});

test('runtime string pool allocates distinct ids for identical text', () => {
	const pool = createRuntimeStringPool();
	const left = pool.intern('vlok');
	const right = pool.intern('vlok');
	assert.notEqual(left.id, right.id);
	assert.notEqual(left, right);
	assert.equal(left.text, right.text);
});

test('runtime string equality stays content-based', () => {
	const pool = createRuntimeStringPool();
	const left = pool.intern('vlok');
	const right = pool.intern('vlok');
	assert.equal(valuesEqual(left, right), true);
});

test('table lookup accepts equal runtime strings with different ids', () => {
	const pool = createRuntimeStringPool();
	const left = pool.intern('vlok');
	const right = pool.intern('vlok');
	const table = new Table(0, 2);
	table.set(left, 42);
	assert.equal(table.get(right), 42);
});
