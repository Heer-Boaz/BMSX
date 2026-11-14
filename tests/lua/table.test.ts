import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	CPU,
} from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Closure } from '../../machine/ts/machine/cpu/closure';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import {
	createBuiltinFunction,
	valueString,
	ValueTag,
	valueIsTable,
	valueTag,
	type Value,
} from '../../machine/ts/machine/cpu/value';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { runCompiledLua } from './cpu_test_harness';
import { CpuSnapshot, CpuSnapshotWriter, CpuSnapshotTable } from '../../machine/ts/machine/cpu/snapshot';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';

test('runtime values expose one numeric representation tag', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const stringValue = valueString(cpu.stringPool.intern('tagged'));
	const table = cpu.createTable(0, 0);
	const closure = new Closure(0x1000, [], 0, 0, 0, 0, 0, 0, SYSTEM_EXECUTION_DOMAIN_ID, 0, false);
	const builtinFunction = createBuiltinFunction(BuiltinFunctionId.Next);
	const values: ReadonlyArray<readonly [Value, ValueTag]> = [
		[null, ValueTag.Nil],
		[false, ValueTag.False],
		[true, ValueTag.True],
		[42, ValueTag.Number],
		[stringValue, ValueTag.String],
		[table, ValueTag.Table],
		[closure, ValueTag.Closure],
		[builtinFunction, ValueTag.BuiltinFunction],
	];

	for (let index = 0; index < values.length; index += 1) {
		assert.equal(valueTag(values[index][0]), values[index][1]);
	}
	assert.equal(valueIsTable(table), true);
});

test('Table stores sparse unsigned integer keys in the hash part', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 0);
	const highKey = 0xffffffff;
	const tokenKey = 0x84222325;

	table.set(highKey, 11);
	table.set(tokenKey, 22);

	assert.equal(table.get(highKey), 11);
	assert.equal(table.get(tokenKey), 22);
	assert.equal(table.length(), 0);
	assert.ok(table.getTrackedHeapBytes() < 4096);
});

for (const route of ['generic', 'encoded', 'integer', 'integer-array'] as const) {
	test(`Table ${route} writes preserve sequence boundaries across the numeric hash tail`, () => {
		const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
		const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
		const table = cpu.createTable(4, 8);
		for (let key = 1; key <= 7; key += 1) {
			table.set(key, key * 10);
		}
		const heapBytes = table.getTrackedHeapBytes();
		assert.equal(table.length(), 7);

		for (const key of [2, 4]) {
			switch (route) {
				case 'generic':
					table.set(key, null);
					break;
				case 'encoded':
					table.store(ValueTag.Number, key, null, ValueTag.Nil, NaN, null);
					break;
				case 'integer':
					table.setInteger(key, null);
					break;
				case 'integer-array':
					assert.equal(table.storeIntegerArrayKey(key, ValueTag.Nil, NaN, null), true);
					break;
			}
			const boundary = table.length();
			assert.ok(boundary === 0 || table.get(boundary) !== null);
			assert.equal(table.get(boundary + 1), null);
			assert.equal(table.get(7), 70);

			switch (route) {
				case 'generic':
					table.set(key, false);
					break;
				case 'encoded':
					table.store(ValueTag.Number, key, null, ValueTag.False, NaN, null);
					break;
				case 'integer':
					table.setInteger(key, false);
					break;
				case 'integer-array':
					assert.equal(table.storeIntegerArrayKey(key, ValueTag.False, NaN, null), true);
					break;
			}
			assert.equal(table.length(), 7);
			assert.equal(table.get(key), false);
			assert.equal(table.getTrackedHeapBytes(), heapBytes);
		}

		table.set(9, 90);
		assert.equal(table.length(), 7);
		table.set(8, 80);
		assert.equal(table.length(), 9);
	});
}

test('Table length is a pure boundary search and writes never scan a retained suffix', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(4096, 8);
	// Descending construction leaves a hint of one, not an eagerly scanned length.
	for (let key = 4096; key >= 1; key--) table.setInteger(key, false);
	const snapshot = new CpuSnapshot(), writer = new CpuSnapshotWriter(snapshot);
	const offset = table.captureSnapshot(writer, () => {}); writer.finish();
	assert.equal(snapshot.word(offset + CpuSnapshotTable.LengthHint), 1);
	assert.equal(table.length(), 4096);
	for (let repeat = 0; repeat < 8; repeat++) {
		table.setInteger(2048, null); table.setInteger(2048, false);
	}
	const after = new CpuSnapshot(), afterWriter = new CpuSnapshotWriter(after);
	table.captureSnapshot(afterWriter, () => {}); afterWriter.finish();
	assert.deepEqual(after.words, snapshot.words, 'neither LEN nor distant hole refill scans or changes the raw hint');
	// Erase the hinted entry without moving the hint (the weak-clearing owner).
	table.clearWeakEntries(false, true, (_tag, _scalar, _reference) => false);
	assert.equal(table.length(), 0, 'a stale nonzero hint is only a search seed');
	const cleared = new CpuSnapshot(), clearedWriter = new CpuSnapshotWriter(cleared);
	table.captureSnapshot(clearedWriter, () => {}); clearedWriter.finish();
	assert.equal(cleared.word(offset + CpuSnapshotTable.LengthHint), 1);
});

test('Table sparse hash boundaries include exact binary64 integers beyond array storage', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 128);
	for (let bit = 52; bit >= 0; bit--) table.set(2 ** bit, false);
	assert.equal(table.length(), 2 ** 52);
	table.set(0x1fffffffffffff, false);
	assert.equal(table.length(), 0x1fffffffffffff);
	table.set(2 ** 53, true);
	assert.equal(table.length(), 0x1fffffffffffff, 'terminal sequence boundary does not wrap or loop');
	table.set(0x1fffffffffffff, null);
	assert.equal(table.length(), 2 ** 52);
});

test('numeric hash mixing distributes negative integral keys and preserves canonical matching', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 1024);
	for (let key = -1; key >= -1024; key--) table.set(key, key);
	const snapshot = new CpuSnapshot(), writer = new CpuSnapshotWriter(snapshot);
	const offset = table.captureSnapshot(writer, () => {}); writer.finish();
	let longest = 0;
	for (let slot = 0; slot < 1024; slot++) {
		let count = 0;
		for (let next = slot; next !== -1; next = snapshot.int(offset + CpuSnapshotTable.Data + next * 7 + 6)) count++;
		longest = Math.max(longest, count);
		assert.equal(table.get(-(slot + 1)), -(slot + 1));
	}
	assert.ok(longest <= 8, `negative integers must not collapse into a single hash chain (${longest})`);
	// The same bucket constants are checked against C++ ValueHash.
	const slots = new ValueSlots(2);
	for (const [key, bucket] of [[-1, 781], [-2, 1], [-3, 891], [-1024, 661], [0, 0], [0.5, 537], [1.5, 903], [4294967296, 909], [NaN, 903], [Infinity, 781]]) {
		const one = cpu.createTable(0, 1024); one.set(key, false);
		assert.equal(one.loadStoredEntry(bucket, slots, 0), true, `hash bucket for ${key}`);
		assert.equal(slots.get(1), false);
	}
	table.set(-0, true); assert.equal(table.get(0), true);
	table.set(0, false); assert.equal(table.get(-0), false);
});

test('Table hashes runtime object keys from value-owned identity', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 4);
	const tableKey = cpu.createTable(0, 0);

	table.set(tableKey, 101);

	assert.equal(table.get(tableKey), 101);
});

test('Table hashes all NaN keys through the canonical qNaN bucket', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const buffer = new ArrayBuffer(8);
	const words = new Uint32Array(buffer);
	const floats = new Float64Array(buffer);
	words[0] = 1;
	words[1] = 0x7ff80000;
	const firstNaN = floats[0];
	words[0] = 2;
	words[1] = 0x7ff80000;
	const secondNaN = floats[0];
	const table = cpu.createTable(0, 0);

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

test('physical table inspection preserves Lua iteration order and tagged values without mutation', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(8, 16), child = cpu.createTable(0, 0);
	const removed = valueString(cpu.stringPool.intern('removed'));
	table.set(1, -0); table.set(8, false); table.set(child, child);
	table.set(valueString(cpu.stringPool.intern('number')), NaN);
	table.set(false, Infinity); table.set(removed, 17); table.set(removed, null);
	const before = table.getTrackedHeapBytes(), values = new ValueSlots(4);
	values.setNumber(0, 123); values.setNumber(3, 456);
	const physical: Value[][] = [];
	for (let slot = 0; slot < table.storedSlotCount; slot++) {
		if (table.loadStoredEntry(slot, values, 1)) physical.push([values.get(1), values.get(2)]);
	}
	const logical: Value[][] = [];
	values.setNil(1);
	for (table.next(values.getTag(1), values.getScalar(1), values.getReference(1), values, 1); values.getTag(1) !== ValueTag.Nil;
		table.next(values.getTag(1), values.getScalar(1), values.getReference(1), values, 1)) logical.push([values.get(1), values.get(2)]);
	assert.deepEqual(physical, logical);
	assert.equal(physical.length, 5);
	assert.equal(values.get(0), 123);
	assert.equal(values.get(3), 456);
	assert.equal(table.getTrackedHeapBytes(), before);
	const previous = [values.get(1), values.get(2)];
	assert.equal(table.loadStoredEntry(1, values, 1), false);
	assert.deepEqual([values.get(1), values.get(2)], previous);
});
