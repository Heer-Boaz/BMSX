import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Table } from '../../src/bmsx/machine/cpu/cpu';
import { runCompiledLua } from './cpu_test_harness';

test('Table stores sparse unsigned integer keys in the hash part', () => {
	const table = new Table(0, 0);
	const highKey = 0xffffffff;
	const tokenKey = 0x84222325;

	table.set(highKey, 11);
	table.set(tokenKey, 22);

	assert.equal(table.get(highKey), 11);
	assert.equal(table.get(tokenKey), 22);
	assert.equal(table.arrayLength, 0);
	assert.ok(table.getTrackedHeapBytes() < 4096);
});

test('CPU modulus follows Lua floor-modulo semantics', () => {
	const [negativeNormalized, fnvXorNormalized] = runCompiledLua(`
return -1 % 0x100000000, (0x84222325 ~ 0x61) % 0x100000000
`);

	assert.equal(negativeNormalized, 0xffffffff);
	assert.equal(fnvXorNormalized, 0x84222344);
});
