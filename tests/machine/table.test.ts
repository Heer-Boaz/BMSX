import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	CPU,
} from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import {
	valueBuiltinFunction, valueInteger, valueFloat, valueFloatBits, valueBool, valueNil, valueTable, valueClosure, valueThread,
	valueString,
	ValueTag,
	valueIsTable,
	valueTag,
	type Value,
} from '../../machine/ts/machine/cpu/value';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { runCompiledLua } from '../helpers/cpu_test_harness';
import { TableHeader } from '../../machine/ts/machine/cpu/table';
import { MAIN_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';

test('runtime values expose distinct Integer and Float tags with equal payload words', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const stringValue = valueString(cpu.stringPool.intern('tagged'));
	const table = cpu.createTable(0, 0);
	const values: ReadonlyArray<readonly [Value, ValueTag]> = [
		[valueNil(), ValueTag.Nil],
		[valueBool(false), ValueTag.False],
		[valueBool(true), ValueTag.True],
		[valueInteger(42), ValueTag.Integer],
		[valueFloatBits(42), ValueTag.Float],
		[stringValue, ValueTag.String],
		[valueTable(table), ValueTag.Table],
		[valueClosure(42), ValueTag.Closure],
		[valueBuiltinFunction(BuiltinFunctionId.Next), ValueTag.BuiltinFunction],
		[valueThread(cpu.gc.reference(cpu.rootThread)), ValueTag.Thread],
	];

	for (let index = 0; index < values.length; index += 1) {
		assert.equal(valueTag(values[index][0]), values[index][1]);
	}
	assert.equal(valueIsTable(valueTable(table)), true);
});

test('Table stores sparse high-bit Integer words in the hash part', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 0);
	const highKey = valueInteger(0xffffffff);
	const tokenKey = valueInteger(0x84222325);

	cpu.gc.tables.set(table, highKey, valueInteger(11));
	cpu.gc.tables.set(table, tokenKey, valueInteger(22));

	assert.equal(cpu.gc.tables.get(table, highKey), valueInteger(11));
	assert.equal(cpu.gc.tables.get(table, tokenKey), valueInteger(22));
	assert.equal(cpu.gc.tables.length(table), 0);
	assert.ok(cpu.gc.tables.getTrackedHeapBytes(table) < 4096);
});

for (const route of ['generic', 'float', 'encoded', 'integer', 'integer-array'] as const) {
	test(`Table ${route} writes preserve sequence boundaries across the numeric hash tail`, () => {
		const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
		const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
		const table = cpu.createTable(4, 8);
		for (let key = 1; key <= 7; key += 1) {
			cpu.gc.tables.set(table, valueInteger(key), valueInteger(key * 10));
		}
		const heapBytes = cpu.gc.tables.getTrackedHeapBytes(table);
		assert.equal(cpu.gc.tables.length(table), 7);

		for (const key of [2, 4]) {
			switch (route) {
				case 'generic':
					cpu.gc.tables.set(table, valueInteger(key), valueNil());
					break;
				case 'float':
					cpu.gc.tables.set(table, valueFloat(key), valueNil());
					break;
				case 'encoded':
					cpu.gc.tables.store(table, ValueTag.Integer, key, ValueTag.Nil, 0);
					break;
				case 'integer':
					cpu.gc.tables.setInteger(table, key, valueNil());
					break;
				case 'integer-array':
					assert.equal(cpu.gc.tables.storeIntegerArrayKey(table, key, ValueTag.Nil, 0), true);
					break;
			}
			const boundary = cpu.gc.tables.length(table);
			assert.ok(boundary === 0 || cpu.gc.tables.get(table, valueInteger(boundary)) !== valueNil());
			assert.equal(cpu.gc.tables.get(table, valueInteger(boundary + 1)), valueNil());
			assert.equal(cpu.gc.tables.getInteger(table, 7), valueInteger(70));

			switch (route) {
				case 'generic':
					cpu.gc.tables.set(table, valueInteger(key), valueBool(false));
					break;
				case 'float':
					cpu.gc.tables.set(table, valueFloat(key), valueBool(false));
					break;
				case 'encoded':
					cpu.gc.tables.store(table, ValueTag.Integer, key, ValueTag.False, 0);
					break;
				case 'integer':
					cpu.gc.tables.setInteger(table, key, valueBool(false));
					break;
				case 'integer-array':
					assert.equal(cpu.gc.tables.storeIntegerArrayKey(table, key, ValueTag.False, 0), true);
					break;
			}
			assert.equal(cpu.gc.tables.length(table), 7);
			assert.equal(cpu.gc.tables.get(table, valueInteger(key)), valueBool(false));
			assert.equal(cpu.gc.tables.getTrackedHeapBytes(table), heapBytes);
		}

		cpu.gc.tables.setInteger(table, 9, valueInteger(90));
		assert.equal(cpu.gc.tables.length(table), 7);
		cpu.gc.tables.setInteger(table, 8, valueInteger(80));
		assert.equal(cpu.gc.tables.length(table), 9);
	});
}

test('Table length is a pure boundary search and writes never scan a retained suffix', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(4096, 8);
	// Descending construction leaves a hint of one, not an eagerly scanned length.
	for (let key = 4096; key >= 1; key--) cpu.gc.tables.setInteger(table, key, valueBool(false));
	const hint = table + TableHeader.Length;
	assert.equal(memory.readRamRecordWord(hint), 1);
	assert.equal(cpu.gc.tables.length(table), 4096);
	for (let repeat = 0; repeat < 8; repeat++) {
		cpu.gc.tables.setInteger(table, 2048, valueNil()); cpu.gc.tables.setInteger(table, 2048, valueBool(false));
	}
	assert.equal(memory.readRamRecordWord(hint), 1, 'neither LEN nor distant hole refill scans or changes the raw hint');
	// Erase the hinted entry without moving the hint (the weak-clearing owner).
	cpu.gc.tables.clearWeakEntries(table, false, true, () => false);
	assert.equal(cpu.gc.tables.length(table), 0, 'a stale nonzero hint is only a search seed');
	assert.equal(memory.readRamRecordWord(hint), 1);
});

test('Table sparse hash boundaries include Integer boundaries up to INT32_MAX without consuming larger Float keys', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 128);
	for (let bit = 30; bit >= 0; bit--) cpu.gc.tables.setInteger(table, 2 ** bit, valueBool(false));
	assert.equal(cpu.gc.tables.length(table), 2 ** 30);
	cpu.gc.tables.setInteger(table, 0x7fffffff, valueBool(false));
	assert.equal(cpu.gc.tables.length(table), 0x7fffffff);
	cpu.gc.tables.set(table, valueFloat(2 ** 31), valueBool(true));
	assert.equal(cpu.gc.tables.length(table), 0x7fffffff, 'terminal sequence boundary does not wrap or loop');
	cpu.gc.tables.setInteger(table, 0x7fffffff, valueNil());
	assert.equal(cpu.gc.tables.length(table), 2 ** 30);
});

test('table values come directly from the allocator-owned RAM block', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const occupiedBefore = cpu.heapAllocator.occupiedBytes();
	const table = cpu.createTable(2, 1);
	cpu.gc.tables.setInteger(table, 1, valueInteger(71));
	const base = cpu.gc.tables.storageAddress(table);
	assert.equal(cpu.heapAllocator.occupiedBytes() - occupiedBefore, 56, 'the 32-byte header and 24-byte body are physical allocations');
	assert.equal(memory.readMappedU32LE(base), 71);
	assert.equal(memory.readMappedU32LE(base + 4 * 4), 0xffffffff, 'the hash-chain word follows the four payload words');
	const tags = base + 5 * 4;
	assert.equal(memory.readMappedU8(tags), ValueTag.Integer);
	const backing = table + TableHeader.Storage;
	assert.equal(memory.readMappedU32LE(backing), base);
	memory.writeMappedU32LE(backing, base + MAIN_RAM_SIZE);
	memory.writeMappedU32LE(base, 94);
	assert.equal(cpu.gc.tables.getInteger(table, 1), valueInteger(94));
	memory.writeMappedU8(tags, ValueTag.Nil);
	assert.equal(valueTag(cpu.gc.tables.getInteger(table, 1)), ValueTag.Nil);
	memory.writeMappedU32LE(backing, base);
	cpu.gc.tables.clear(table);
	assert.equal(cpu.heapAllocator.occupiedBytes() - occupiedBefore, 32, 'clearing releases only the owned body');
});

test('numeric hash mixing distributes negative integral keys and preserves canonical matching', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 1024);
	for (let key = -1; key >= -1024; key--) cpu.gc.tables.setInteger(table, key, valueInteger(key));
	const links = cpu.gc.tables.storageAddress(table) + 1024 * 2 * 4;
	let longest = 0;
	for (let slot = 0; slot < 1024; slot++) {
		let count = 0;
		for (let next = slot; next !== -1; next = (memory.readMappedU32LE(links + next * 4) | 0)) count++;
		longest = Math.max(longest, count);
		assert.equal(cpu.gc.tables.getInteger(table, -(slot + 1)), valueInteger(-(slot + 1)));
	}
	assert.ok(longest <= 8, `negative integers must not collapse into a single hash chain (${longest})`);
	// The same physical buckets are checked in the C++ table inspection suite.
	const slots = new ValueSlots(2);
	const vectors: ReadonlyArray<readonly [Value, number]> = [
		[valueInteger(-1), 0], [valueInteger(-2), 607], [valueInteger(-3), 190], [valueInteger(-1024), 140],
		[valueInteger(0), 0], [valueFloat(0.5), 224], [valueFloat(1.5), 0], [valueFloat(4294967296), 24],
		[valueFloatBits(0xffa01234), 981], [valueFloat(Infinity), 0],
	];
	for (const [key, bucket] of vectors) {
		const one = cpu.createTable(0, 1024); cpu.gc.tables.set(one, key, valueBool(false));
		assert.equal(cpu.gc.tables.loadStoredEntry(one, bucket, slots, 0), true);
		assert.equal(slots.get(1), valueBool(false));
	}
	cpu.gc.tables.set(table, valueFloat(-0), valueBool(true)); assert.equal(cpu.gc.tables.getInteger(table, 0), valueBool(true));
	cpu.gc.tables.setInteger(table, 0, valueBool(false)); assert.equal(cpu.gc.tables.get(table, valueFloat(-0)), valueBool(false));
});

test('Table hashes runtime object keys from value-owned identity', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 4);
	const tableKey = valueTable(cpu.createTable(0, 0));

	cpu.gc.tables.set(table, tableKey, valueInteger(101));

	assert.equal(cpu.gc.tables.get(table, tableKey), valueInteger(101));
});

test('Table hashes all NaN keys through the canonical qNaN bucket', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const firstNaN = valueFloatBits(0xffa00001);
	const secondNaN = valueFloatBits(0x7fc00002);
	const table = cpu.createTable(0, 0);

	cpu.gc.tables.set(table, firstNaN, valueInteger(11));
	cpu.gc.tables.set(table, secondNaN, valueInteger(22));

	assert.equal(cpu.gc.tables.get(table, firstNaN), valueInteger(22));
	assert.equal(cpu.gc.tables.get(table, secondNaN), valueInteger(22));
	cpu.gc.tables.set(table, firstNaN, valueNil());
	assert.equal(cpu.gc.tables.get(table, secondNaN), valueNil());
});

test('CPU modulus follows Lua floor-modulo semantics', () => {
	const values = runCompiledLua('return -1 % 7, 1 % -7, 0x84222325 ~ 0x61');
	assert.deepEqual(values, [valueInteger(6), valueInteger(-6), valueInteger(0x84222344)]);
});

test('physical table inspection preserves Lua iteration order and tagged values without mutation', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(8, 16), child = valueTable(cpu.createTable(0, 0));
	const removed = valueString(cpu.stringPool.intern('removed'));
	cpu.gc.tables.setInteger(table, 1, valueFloatBits(0x80000000)); cpu.gc.tables.setInteger(table, 8, valueBool(false)); cpu.gc.tables.set(table, child, child);
	cpu.gc.tables.set(table, valueString(cpu.stringPool.intern('number')), valueFloatBits(0xffc01234));
	cpu.gc.tables.set(table, valueBool(false), valueFloat(Infinity)); cpu.gc.tables.set(table, removed, valueInteger(17)); cpu.gc.tables.set(table, removed, valueNil());
	const before = cpu.gc.tables.getTrackedHeapBytes(table), values = new ValueSlots(4);
	values.setInteger(0, 123); values.setInteger(3, 456);
	const physical: Value[][] = [];
	for (let slot = 0; slot < cpu.gc.tables.storedSlotCount(table); slot++) {
		if (cpu.gc.tables.loadStoredEntry(table, slot, values, 1)) physical.push([values.get(1), values.get(2)]);
	}
	const logical: Value[][] = [];
	values.setNil(1);
	for (cpu.gc.tables.next(table, values.get(1), values, 1); values.getTag(1) !== ValueTag.Nil;
		cpu.gc.tables.next(table, values.get(1), values, 1)) logical.push([values.get(1), values.get(2)]);
	assert.deepEqual(physical, logical);
	assert.equal(physical.length, 5);
	assert.equal(values.get(0), valueInteger(123));
	assert.equal(values.get(3), valueInteger(456));
	assert.equal(cpu.gc.tables.getTrackedHeapBytes(table), before);
	const previous = [values.get(1), values.get(2)];
	assert.equal(cpu.gc.tables.loadStoredEntry(table, 1, values, 1), false);
	assert.deepEqual([values.get(1), values.get(2)], previous);
});
