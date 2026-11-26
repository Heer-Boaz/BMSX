import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	CPU,
} from '../../machine/ts/machine/cpu/cpu';
import { LuaAllocationMode } from '../../machine/ts/machine/cpu/lua_heap';
import { GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import {
	hashCanonicalTableKey, valueBuiltinFunction, valueInteger, valueFloat, valueFloatBits, valueBool, valueNil, valueTable, valueClosure, valueThread,
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
		[valueThread(cpu.rootThread.address), ValueTag.Thread],
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

test('Table length remembers a boundary without scanning after distant writes', () => {
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
	assert.equal(memory.readRamRecordWord(hint), 4096, 'LEN caches its result and distant holes do not disturb it');
	// Erase the hinted entry without moving the hint (the weak-clearing owner).
	cpu.gc.tables.clearWeakEntries(table, false, true, () => false);
	assert.equal(cpu.gc.tables.length(table), 0, 'a stale nonzero hint is only a search seed');
	assert.equal(memory.readRamRecordWord(hint), 0);
});

test('Table sparse hash boundaries include Integer boundaries up to INT32_MAX without consuming larger Float keys', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 128);
	for (let bit = 30; bit >= 0; bit--) cpu.gc.tables.setInteger(table, 2 ** bit, valueBool(false));
	assert.equal(cpu.gc.tables.length(table), 2 ** 30);
	cpu.gc.tables.setInteger(table, 0x7fffffff, valueBool(false));
	assert.equal(cpu.gc.tables.getInteger(table, 0x7fffffff), valueBool(false));
	const boundary = cpu.gc.tables.length(table);
	assert.ok(boundary > 0 && boundary <= 0x7fffffff);
	assert.notEqual(cpu.gc.tables.getInteger(table, boundary), valueNil());
	if (boundary < 0x7fffffff) assert.equal(cpu.gc.tables.getInteger(table, boundary + 1), valueNil());
	cpu.gc.tables.set(table, valueFloat(2 ** 31), valueBool(true));
	assert.equal(cpu.gc.tables.get(table, valueFloat(2 ** 31)), valueBool(true));
	assert.equal(cpu.gc.tables.getInteger(table, 0x7fffffff), valueBool(false));
	assert.equal(cpu.gc.tables.length(table), boundary, 'the Float key outside the sequence range cannot change its boundary');
	cpu.gc.tables.setInteger(table, 0x7fffffff, valueNil());
	assert.equal(cpu.gc.tables.length(table), 2 ** 30);
});

test('table values come directly from the allocator-owned RAM block', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const arena = cpu.heapAllocator, occupiedBefore = arena.occupiedBytes();
	const table = cpu.createTable(2, 1);
	cpu.gc.tables.setInteger(table, 1, valueInteger(71));
	const base = cpu.gc.tables.arrayAddress(table), hash = cpu.gc.tables.hashAddress(table);
	const headerBytes = arena.allocationBytes(table - GC_OBJECT_PREFIX), backingBytes = arena.allocationBytes(base);
	assert.equal(arena.occupiedBytes() - occupiedBefore, headerBytes + backingBytes + arena.allocationBytes(hash), 'the header and body are separate chunks');
	assert.equal(memory.readRamRecordWord(base), 71);
	assert.equal(memory.readRamRecordByte(hash + 10), 0xff, 'the one-node chain ends after the two payloads and tags');
	const tags = base + 2 * 4;
	assert.equal(memory.readRamRecordByte(tags), ValueTag.Integer);
	assert.equal(memory.readRamRecordWord(table + TableHeader.Hash), 1, 'the table header owns the hash capacity');
	assert.equal(memory.readRamRecordByte(hash + 8 + 1), ValueTag.Nil, 'the spare hash value remains nil');
	const backing = table + TableHeader.ArrayStorage;
	assert.equal(memory.readRamRecordWord(backing), base);
	memory.writeRamRecordWord(backing, base + MAIN_RAM_SIZE);
	memory.writeRamRecordWord(base, 94);
	assert.equal(cpu.gc.tables.getInteger(table, 1), valueInteger(94));
	memory.writeRamRecordByte(tags, ValueTag.Nil);
	assert.equal(valueTag(cpu.gc.tables.getInteger(table, 1)), ValueTag.Nil);
	memory.writeRamRecordWord(backing, base);
	cpu.gc.tables.clear(table);
	assert.equal(arena.occupiedBytes() - occupiedBefore, headerBytes, 'clearing releases only the owned body');
});

test('mixed table migration preserves a sparse raw array prefix and hash overflow', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const tables = cpu.gc.tables, table = cpu.createTable(4, 0);
	const prefix = valueFloatBits(0x7fc12345), tail = valueFloatBits(0xffc23456);
	tables.setInteger(table, 1, valueBool(false));
	tables.setInteger(table, 3, prefix);
	tables.setInteger(table, 4, valueBool(true));
	// These negative keys share their home in both the two- and four-node hash.
	tables.setInteger(table, -1, valueInteger(11));
	tables.setInteger(table, -3, valueInteger(33));
	tables.setInteger(table, 5, valueInteger(50));
	tables.setInteger(table, 6, valueInteger(60));
	assert.equal(tables.arrayCapacity(table), 4, 'entries 5 and 6 start in the hash');
	const smallBody = tables.hashAddress(table);
	tables.setInteger(table, 7, tail);
	assert.equal(tables.arrayCapacity(table), 8);
	assert.notEqual(tables.hashAddress(table), smallBody);
	assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, -1, -3].map(key => tables.getInteger(table, key)),
		[valueBool(false), valueNil(), prefix, valueBool(true), valueInteger(50), valueInteger(60), tail, valueNil(), valueInteger(11), valueInteger(33)]);

	const largeBody = tables.hashAddress(table);
	tables.setInteger(table, 5, valueNil());
	tables.setInteger(table, 6, valueNil());
	// A new positive index outside the array makes rehash reconsider its
	// density. A hash-only key would leave the array partition unchanged.
	tables.setInteger(table, 9, valueInteger(90));
	assert.equal(tables.arrayCapacity(table), 4);
	assert.notEqual(tables.hashAddress(table), largeBody);
	assert.deepEqual([1, 2, 3, 4, 5, 6, 7, -1, -3, 9].map(key => tables.getInteger(table, key)),
		[valueBool(false), valueNil(), prefix, valueBool(true), valueNil(), valueNil(), tail, valueInteger(11), valueInteger(33), valueInteger(90)]);
});

test('a full collision chain compacts and grows across both link widths', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const tables = cpu.gc.tables;
	for (const capacity of [128, 256]) {
		const table = cpu.createTable(4, capacity);
		tables.setInteger(table, 1, valueBool(false));
		const keys: number[] = [];
		for (let i = -1; keys.length < capacity + 2; --i) {
			if ((hashCanonicalTableKey(valueInteger(i)) & (capacity * 2 - 1)) === 0) keys.push(i);
		}
		for (let i = 0; i < capacity; ++i) tables.setInteger(table, keys[i], valueInteger(i));
		tables.setInteger(table, keys[1], valueNil());
		tables.setInteger(table, keys[capacity], valueInteger(capacity));
		assert.equal(tables.hashSize(table), capacity);
		tables.setInteger(table, keys[capacity + 1], valueInteger(capacity + 1));
		assert.equal(tables.hashSize(table), capacity * 2);
		for (let i = 0; i <= capacity + 1; ++i) {
			assert.equal(tables.getInteger(table, keys[i]), i === 1 ? valueNil() : valueInteger(i));
		}
		assert.equal(tables.getInteger(table, 1), valueBool(false));
	}
});

test('hash rebuild routes a stored Integer by its current RAM word', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(4, 128), tables = cpu.gc.tables;
	for (let k = -1; k >= -128; --k) tables.setInteger(table, k, valueInteger(-k));
	const words = tables.hashAddress(table);
	const prior = valueInteger(memory.readRamRecordWord(words + 4 * 128));
	memory.writeRamRecordWord(words, 4);
	tables.setInteger(table, -129, valueBool(false));
	assert.equal(tables.getInteger(table, 4), prior);
});

test('numeric hash mixing distributes negative integral keys and preserves canonical matching', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 1024);
	for (let key = -1; key >= -1024; key--) cpu.gc.tables.setInteger(table, key, valueInteger(key));
	const links = cpu.gc.tables.hashAddress(table) + 1024 * 10;
	for (let slot = 0; slot < 1024; slot++) {
		let count = 0;
		for (let next = slot; next !== -1; next = (memory.readRamRecordWord(links + next * 4) | 0)) {
			assert.ok(++count <= 8, `bucket ${slot} exceeded its chain depth bound`);
		}
		assert.equal(cpu.gc.tables.getInteger(table, -(slot + 1)), valueInteger(-(slot + 1)));
	}
	cpu.gc.tables.set(table, valueFloat(-0), valueBool(true)); assert.equal(cpu.gc.tables.getInteger(table, 0), valueBool(true));
	cpu.gc.tables.setInteger(table, 0, valueBool(false)); assert.equal(cpu.gc.tables.get(table, valueFloat(-0)), valueBool(false));
	// The same physical buckets are checked in the C++ table inspection suite.
	const slots = new ValueSlots(2);
	const vectors: ReadonlyArray<readonly [Value, number]> = [
		[valueInteger(-1), 0], [valueInteger(-2), 607], [valueInteger(-3), 190], [valueInteger(-1024), 140],
		[valueInteger(0), 0], [valueFloat(0.5), 224], [valueFloat(1.5), 0], [valueFloat(4294967296), 24],
		[valueFloat(Infinity), 0],
	];
	for (const [key, bucket] of vectors) {
		const one = cpu.createTable(0, 1024); cpu.gc.tables.set(one, key, valueBool(false));
		assert.equal(cpu.gc.tables.loadStoredEntry(one, bucket, slots, 0), true);
		assert.equal(slots.get(1), valueBool(false));
	}
});

test('Table hashes runtime object keys from value-owned identity', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 4);
	const tableKey = valueTable(cpu.createTable(0, 0));

	cpu.gc.tables.set(table, tableKey, valueInteger(101));

	assert.equal(cpu.gc.tables.get(table, tableKey), valueInteger(101));
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

test('dense array growth reuses a fitting backing and preserves the tagged prefix', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(1, 0), tables = cpu.gc.tables;
	const first = tables.arrayAddress(table);
	tables.set(table, valueInteger(1), valueBool(false));
	tables.set(table, valueInteger(2), valueInteger(0x12345678));
	assert.equal(tables.arrayAddress(table), first);
	tables.set(table, valueInteger(3), valueBool(true));
	assert.equal(tables.get(table, valueInteger(1)), valueBool(false));
	assert.equal(tables.get(table, valueInteger(2)), valueInteger(0x12345678));
	assert.equal(tables.get(table, valueInteger(3)), valueBool(true));
	assert.equal(tables.get(table, valueInteger(4)), valueNil());
});

test('record admission charges both storage blocks together and frees unissued allocations on OOM', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const budget = cpu.gc.budget, arena = cpu.heapAllocator;
	const used = budget.usedBytes(), occupied = arena.occupiedBytes();
	const nil = valueNil();
	assert.equal(budget.allocateRecord(16, true, 64, 4, nil, nil, nil, 64, LuaAllocationMode.Retry,
		arena.capacityBytes() + 1, 8), 0);
	assert.equal(budget.usedBytes(), used);
	assert.equal(arena.occupiedBytes(), occupied);
	const record = budget.allocateRecord(16, true, 64, 4, nil, nil, nil, undefined, LuaAllocationMode.Retry, 128, 8);
	assert.notEqual(record, 0);
	const first = memory.readRamRecordWord(record + 4), second = memory.readRamRecordWord(record + 8);
	assert.notEqual(first, 0);
	assert.notEqual(second, 0);
	assert.notEqual(first, second);
	assert.equal(budget.usedBytes(), used + 16 + 64 + 128);
	budget.releaseRecord(first, 64);
	budget.releaseRecord(second, 128);
	budget.releaseObject(record, 16);
	assert.equal(budget.usedBytes(), used);
	assert.equal(arena.occupiedBytes(), occupied);
});
