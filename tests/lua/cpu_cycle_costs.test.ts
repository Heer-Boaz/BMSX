import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNativeFunction } from '../../src/bmsx/machine/cpu/cpu';

test('native cost resolution uses flat tiers by function category', () => {
	assert.deepEqual(createNativeFunction('sys_cpu_cycles_used', () => {}).cost, { base: 0, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('clock_now', () => {}).cost, { base: 0, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('math.abs', () => {}).cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('os.clock', () => {}).cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('pairs.iterator', () => {}).cost, { base: 2, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('string.format', () => {}).cost, { base: 4, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('api.display_width', () => {}).cost, { base: 0, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('api.set_camera', () => {}).cost, { base: 4, perArg: 0, perRet: 0 });
});

test('native cost resolution still allows explicit overrides', () => {
	const cost = { base: 9, perArg: 3, perRet: 2 };
	assert.deepEqual(createNativeFunction('math.abs', () => {}, cost).cost, cost);
});
