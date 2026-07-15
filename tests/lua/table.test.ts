import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BuiltinFunctionId, CPU, StringValue, createBuiltinFunction, Table, type Value } from '../../machine/ts/machine/cpu/cpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
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

test('Table hashes runtime object keys from value-owned identity', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory, new IrqController(memory));
	const table = cpu.createTable(0, 4);
	const tableKey = cpu.createTable(0, 0);
	const nativeFnKey = cpu.createNativeFunction('key_fn', () => {});
	const nativeObjectKey = cpu.createNativeObject({}, { get: () => null, set: () => {}, len: () => 0, nextEntry: () => null });

	table.set(tableKey, 101);
	table.set(nativeFnKey, 202);
	table.set(nativeObjectKey, 303);

	assert.equal(table.get(tableKey), 101);
	assert.equal(table.get(nativeFnKey), 202);
	assert.equal(table.get(nativeObjectKey), 303);
});

test('Table hashes all NaN keys through the canonical qNaN bucket', () => {
	const buffer = new ArrayBuffer(8);
	const words = new Uint32Array(buffer);
	const floats = new Float64Array(buffer);
	words[0] = 1;
	words[1] = 0x7ff80000;
	const firstNaN = floats[0];
	words[0] = 2;
	words[1] = 0x7ff80000;
	const secondNaN = floats[0];
	const table = new Table(0, 0);

	table.set(firstNaN, 11);
	table.set(secondNaN, 22);

	assert.equal(table.get(firstNaN), 22);
	assert.equal(table.get(secondNaN), 22);
	table.set(firstNaN, null);
	assert.equal(table.get(secondNaN), null);
});

test('CPU modulus follows Lua floor-modulo semantics', () => {
	const [negativeNormalized, fnvXorNormalized] = runCompiledLua(`
return -1 % 0x100000000, (0x84222325 ~ 0x61) % 0x100000000
`);

	assert.equal(negativeNormalized, 0xffffffff);
	assert.equal(fnvXorNormalized, 0x84222344);
});

test('string.byte nil position uses default', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory, new IrqController(memory));
	const stringByteId = BuiltinFunctionId.StringByte;

	const out: Value[] = [];
	cpu.callBuiltinFunction(createBuiltinFunction(stringByteId), [StringValue.get(cpu.stringPool.intern('A')), null], out);
	assert.deepEqual(out, [65]);
});
