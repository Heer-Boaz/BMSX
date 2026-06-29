import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNativeFunction } from '../../machine/ts/machine/cpu/cpu';

test('native cost resolution uses flat tiers by function category', () => {
	assert.deepEqual(createNativeFunction('devtools.get_lua_entry_path', () => {}).cost, { base: 0, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('os.difftime', () => {}).cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('pairs.iterator', () => {}).cost, { base: 2, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('string.format', () => {}).cost, { base: 4, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('unknown_native', () => {}).cost, { base: 1, perArg: 0, perRet: 0 });
});

test('native cost resolution still allows explicit overrides', () => {
	const cost = { base: 9, perArg: 3, perRet: 2 };
	assert.deepEqual(createNativeFunction('unknown_native', () => {}, cost).cost, cost);
});
