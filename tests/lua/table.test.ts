import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	Closure,
	CPU,
	Table,
} from '../../machine/ts/machine/cpu/cpu';
import {
	BuiltinFunctionId,
	StringValue,
	createBuiltinFunction,
	ValueTag,
	valueIsClosure,
	valueIsHeap,
	valueIsNumber,
	valueIsTable,
	valueTag,
	type Value,
} from '../../machine/ts/machine/cpu/value';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { runCompiledLua } from './cpu_test_harness';

test('runtime values expose one numeric representation tag', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() });
	const cpu = new CPU(memory, new IrqController(memory));
	const stringValue = StringValue.get(cpu.stringPool.intern('tagged'));
	const table = cpu.createTable(0, 0);
	const closure = new Closure(0x1000, [], 0);
	const builtinFunction = createBuiltinFunction(BuiltinFunctionId.Next);
	const nativeFunction = cpu.createNativeFunction('tagged_native', () => {});
	const nativeObject = cpu.createNativeObject({}, { get: () => null, set: () => {}, len: () => 0, nextEntry: () => null });
	const values: ReadonlyArray<readonly [Value, ValueTag]> = [
		[null, ValueTag.Nil],
		[false, ValueTag.False],
		[true, ValueTag.True],
		[42, ValueTag.Number],
		[stringValue, ValueTag.String],
		[table, ValueTag.Table],
		[closure, ValueTag.Closure],
		[builtinFunction, ValueTag.BuiltinFunction],
		[nativeFunction, ValueTag.NativeFunction],
		[nativeObject, ValueTag.NativeObject],
	];

	for (let index = 0; index < values.length; index += 1) {
		assert.equal(valueTag(values[index][0]), values[index][1]);
	}
	assert.equal(valueIsNumber(42), true);
	assert.equal(valueIsNumber(closure), false);
	assert.equal(valueIsClosure(closure), true);
	assert.equal(valueIsClosure(table), false);
	assert.equal(valueIsTable(table), true);
	assert.equal(valueIsTable(nativeObject), false);
	assert.equal(valueIsHeap(table), true);
	assert.equal(valueIsHeap(nativeFunction), true);
	assert.equal(valueIsHeap({ valueTag: ValueTag.Table }), false);
});

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
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() });
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
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() });
	const cpu = new CPU(memory, new IrqController(memory));
	const stringByteId = BuiltinFunctionId.StringByte;

	const out: Value[] = [];
	cpu.callBuiltinFunction(createBuiltinFunction(stringByteId), [StringValue.get(cpu.stringPool.intern('A')), null], out);
	assert.deepEqual(out, [65]);
});
