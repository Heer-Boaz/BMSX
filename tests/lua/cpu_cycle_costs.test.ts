import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BuiltinFunctionId, CPU, createBuiltinFunction } from '../../machine/ts/machine/cpu/cpu';
import { Memory } from '../../machine/ts/machine/memory/memory';

test('native functions use flat default cost', () => {
	const cpu = new CPU(new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }));
	assert.deepEqual(cpu.createNativeFunction('require', () => {}).cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(cpu.createNativeFunction('loadstring', () => {}).cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(cpu.createNativeFunction('get_player_input', () => {}).cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(cpu.createNativeFunction('player_input.getButtonState', () => {}).cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(cpu.createNativeFunction('unknown_native', () => {}).cost, { base: 1, perArg: 0, perRet: 0 });
});

test('builtin cost resolution keeps VM primitives off the native callback path', () => {
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.Next).cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.Error).cost, { base: 2, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.PCall).cost, { base: 4, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.StringChar).cost, { base: 2, perArg: 0, perRet: 0 });
});

test('native functions still allow explicit cost', () => {
	const cost = { base: 9, perArg: 3, perRet: 2 };
	const cpu = new CPU(new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }));
	assert.deepEqual(cpu.createNativeFunction('unknown_native', () => {}, cost).cost, cost);
});
