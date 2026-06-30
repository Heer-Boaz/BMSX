import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BuiltinFunctionId, createBuiltinFunction, createNativeFunction } from '../../machine/ts/machine/cpu/cpu';

test('native cost resolution uses flat tiers by function category', () => {
	assert.deepEqual(createNativeFunction('loadstring', () => {}).cost, { base: 4, perArg: 0, perRet: 0 });
	assert.deepEqual(createNativeFunction('unknown_native', () => {}).cost, { base: 1, perArg: 0, perRet: 0 });
});

test('builtin cost resolution keeps VM primitives off the native callback path', () => {
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.Next).cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.Error).cost, { base: 2, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.PCall).cost, { base: 4, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.StringChar).cost, { base: 2, perArg: 0, perRet: 0 });
});

test('native cost resolution still allows explicit overrides', () => {
	const cost = { base: 9, perArg: 3, perRet: 2 };
	assert.deepEqual(createNativeFunction('unknown_native', () => {}, cost).cost, cost);
});
