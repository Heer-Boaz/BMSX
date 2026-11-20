import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { TABLE_STORE_REQUIRES_GROWTH, TableLookupStatus } from '../../machine/ts/machine/cpu/table';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import { compileLuaSource } from '../helpers/cpu_test_harness';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import * as v from '../../machine/ts/machine/cpu/value';

function machine(): CPU {
	// The real runtime owners, before loading a program image. No mock budget,
	// reference directory or substitute Table is involved in these tests.
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	return new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
}

test('Table backing is five bytes per Value plus four bytes per hash link', () => {
	const cpu = machine(), start = cpu.luaHeap.usedBytes();
	const occupied = cpu.heapAllocator.occupiedBytes();
	const table = cpu.createTable(8, 16);
	assert.equal(cpu.luaHeap.usedBytes() - start, cpu.gc.tables.getTrackedHeapBytes(table));
	assert.equal(cpu.heapAllocator.occupiedBytes() - occupied, cpu.gc.tables.getTrackedHeapBytes(table));
	const base = cpu.gc.tables.storageAddress(table);
	const links = base + (8 + 2 * 16) * 4;
	const tags = links + 16 * 4;
	assert.equal(cpu.memory.readRamRecordWord(links), 0xffffffff);
	cpu.gc.tables.setInteger(table, 3, v.valueFloatBits(0xffa12345));
	assert.equal(cpu.memory.readRamRecordWord(base + 8), 0xffa12345);
	assert.equal(cpu.memory.readRamRecordByte(tags + 2), v.ValueTag.Float);
	assert.equal(cpu.gc.tables.getInteger(table, 3), v.valueFloatBits(0xffa12345));
	cpu.gc.tables.clear(table); assert.equal(cpu.luaHeap.usedBytes() - start, 32);
});

test('Table keys normalize Integer/Float identity without changing stored value bits', () => {
	const cpu = machine(), table = cpu.createTable();
	cpu.gc.tables.set(table, v.valueFloat(2), v.valueFloatBits(0xffa12345));
	assert.equal(cpu.gc.tables.get(table, v.valueInteger(2)), v.valueFloatBits(0xffa12345));
	cpu.gc.tables.set(table, v.valueFloatBits(0x80000000), v.valueInteger(19));
	assert.equal(cpu.gc.tables.get(table, v.valueInteger(0)), v.valueInteger(19));
	cpu.gc.tables.set(table, v.valueFloatBits(0x7fa12345), v.valueInteger(20));
	cpu.gc.tables.set(table, v.valueInteger(0x7fc00000), v.valueInteger(23));
	assert.equal(cpu.gc.tables.get(table, v.valueFloatBits(0xffc54321)), v.valueInteger(20));
	assert.equal(cpu.gc.tables.get(table, v.valueInteger(0x7fc00000)), v.valueInteger(23));
	cpu.gc.tables.set(table, v.valueInteger(16777217), v.valueInteger(21));
	cpu.gc.tables.set(table, v.valueFloat(16777216), v.valueInteger(22));
	assert.equal(cpu.gc.tables.get(table, v.valueInteger(16777217)), v.valueInteger(21));
	assert.equal(cpu.gc.tables.get(table, v.valueFloat(16777216)), v.valueInteger(22));
	const entries: [v.Value, v.Value][] = [];
	cpu.gc.tables.forEachStoredEntry(table, (key, value) => entries.push([key, value]));
	assert.ok(entries.some(([key]) => key === v.valueInteger(2)));
	assert.ok(entries.some(([key]) => key === v.valueFloatBits(0x7fc00000)));
	assert.ok(!entries.some(([key]) => key === v.valueFloat(2)));
});

test('compact hash growth, cached string access and inherited reads use real heap references', () => {
	const cpu = machine(), table = cpu.createTable(), parent = cpu.createTable(), meta = cpu.createTable();
	const key = cpu.stringPool.intern('method'), index = cpu.stringPool.intern('__index');
	const inherited = v.valueTable(parent);
	cpu.gc.tables.setStringKey(meta, index, inherited); cpu.gc.tables.setMetatableAddress(table, meta);
	cpu.gc.tables.setStringKey(parent, key, v.valueBool(false));
	const result = { value: v.valueNil(), slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved };
	cpu.gc.tables.resolveStringIndexCached(table, index, key, -1, result);
	assert.equal(result.value, v.valueBool(false)); assert.equal(result.extraVisits, 1);
	for (let i = 1; i <= 512; ++i) { cpu.gc.tables.setInteger(table, i, v.valueInteger(i * -3)); cpu.gc.tables.setStringKey(table, cpu.stringPool.intern('key' + i), v.valueInteger(i)); }
	for (let i = 1; i <= 512; ++i) { assert.equal(cpu.gc.tables.getInteger(table, i), v.valueInteger(i * -3)); assert.equal(cpu.gc.tables.getStringKey(table, cpu.stringPool.find('key' + i)!), v.valueInteger(i)); }
	const cachedKey = cpu.stringPool.find('key123')!;
	cpu.gc.tables.getStringKeyCached(table, cachedKey, -1, result);
	assert.equal(result.value, v.valueInteger(123));
	const predicted = cpu.gc.tables.storeStringKeyCached(table, cachedKey, result.slot, v.ValueTag.Float, 0xffa12345);
	cpu.gc.tables.getStringKeyCached(table, cachedKey, predicted, result);
	assert.equal(result.value, v.valueFloatBits(0xffa12345));
	const empty = cpu.createTable();
	assert.equal(cpu.gc.tables.storeStringKeyWithoutGrowth(empty, key, v.ValueTag.Integer, 1), TABLE_STORE_REQUIRES_GROWTH);
	assert.equal(cpu.gc.tables.getStringKey(empty, key), v.valueNil());
});

test('tombstone continuation retains a stable object hash, not the recycled reference', () => {
	const cpu = machine(), table = cpu.createTable(0, 64), keyObject = cpu.createTable();
	const key = v.valueTable(keyObject), target = new ValueSlots(2);
	cpu.gc.tables.set(table, key, v.valueInteger(7));
	for (let i = 1; i <= 20; ++i) cpu.gc.tables.setStringKey(table, cpu.stringPool.intern('other' + i), v.valueInteger(i));
	cpu.gc.tables.next(table, key, target, 0); const after = target.get(0);
	cpu.gc.tables.set(table, key, v.valueNil()); cpu.gc.tables.next(table, key, target, 0);
	assert.equal(target.get(0), after);
	const entries: v.Value[] = [];
	cpu.gc.tables.forEachStoredEntry(table, (k, value) => entries.push(k, value));
	assert.ok(!entries.some(value => v.valueTag(value) === v.ValueTag.DeadKey));
	cpu.gc.tables.set(table, key, v.valueInteger(8)); assert.equal(cpu.gc.tables.get(table, key), v.valueInteger(8));
});

test('compact Tables participate in incremental tracing, weak clearing and reference recycling', () => {
	const cpu = machine(), table = cpu.createTable(), child = cpu.createTable();
	const root = v.valueTable(table), childValue = v.valueTable(child);
	cpu.gc.tables.setStringKey(table, cpu.stringPool.intern('child'), childValue);
	cpu.gc.collect(root);
	assert.equal(cpu.gc.tables.getStringKey(table, cpu.stringPool.find('child')!), childValue);
	assert.equal(cpu.gc.tableRecordAddress(v.valuePayload(childValue)), child);
	const weak = cpu.createTable(), meta = cpu.createTable(), dead = cpu.createTable();
	const deadReference = dead;
	cpu.gc.tables.setStringKey(meta, cpu.stringPool.intern('__mode'), v.valueString(cpu.stringPool.intern('v'))); cpu.gc.tables.setMetatableAddress(weak, meta);
	cpu.gc.tables.setInteger(weak, 1, v.valueTable(deadReference));
	cpu.gc.tables.setStringKey(table, cpu.stringPool.intern('weak'), v.valueTable(weak));
	cpu.gc.collect(root);
	assert.equal(cpu.gc.tables.getInteger(weak, 1), v.valueNil());
	const replacement = cpu.createTable();
	assert.equal(replacement, deadReference);
	assert.equal(cpu.gc.tables.getInteger(weak, 1), v.valueNil());
});

test('length candidates are bounded signed-32 keys and keep their guest probe count', () => {
	const cpu = machine(), table = cpu.createTable(), work = { probes: 0 };
	assert.equal(cpu.gc.tables.length(table, work), 0); assert.equal(work.probes, 1);
	for (let i = 4096; i >= 1; --i) cpu.gc.tables.setInteger(table, i, v.valueBool(true));
	assert.equal(cpu.gc.tables.length(table, work), 4096); assert.equal(work.probes, 26);
	cpu.gc.tables.setInteger(table, -2147483648, v.valueInteger(7));
	cpu.gc.tables.setInteger(table, 2147483647, v.valueInteger(8));
	assert.equal(cpu.gc.tables.getInteger(table, -2147483648), v.valueInteger(7));
	assert.equal(cpu.gc.tables.getInteger(table, 2147483647), v.valueInteger(8));
	assert.equal(cpu.gc.tables.length(table, work), 4096);
});

test('Table mutation streams preserve raw words through collisions, growth and deletions', () => {
	const cpu = machine(), table = cpu.createTable(), oracle = new Map<v.Value, v.Value>();
	const keys: v.Value[] = [v.valueBool(false), v.valueBool(true), v.valueFloatBits(0x7fa12345), v.valueFloatBits(0xffc00001), v.valueFloatBits(0x80000000), v.valueInteger(0), v.valueInteger(-2147483648), v.valueInteger(2147483647)];
	for (let i = 1; i <= 48; ++i) keys.push(v.valueInteger(i), v.valueFloat(i), v.valueFloat(i + 0.5), v.valueString(cpu.stringPool.intern('field' + i)), v.valueTable(cpu.createTable()));
	let seed = 0x5130bbad;
	const next = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
	for (let i = 0; i < 20000; ++i) {
		const key = keys[next() % keys.length], word = next();
		const value = (word & 7) === 0 ? v.valueNil() : (word & 1) === 0 ? v.valueInteger(word | 0) : v.valueFloatBits(word);
		cpu.gc.tables.set(table, key, value); const canonical = v.canonicalTableKey(key);
		if (v.isNil(value)) oracle.delete(canonical); else oracle.set(canonical, value);
		assert.equal(cpu.gc.tables.get(table, key), value);
		if ((i & 255) === 0) {
			const observed = new Map<v.Value, v.Value>(); cpu.gc.tables.forEachStoredEntry(table, (k, val) => observed.set(k, val));
			assert.deepEqual(observed, oracle);
			for (const k of keys) assert.equal(cpu.gc.tables.get(table, k), oracle.get(v.canonicalTableKey(k)) ?? v.valueNil());
		}
	}
});

test('machine snapshots restore table records and their references to a different heap', () => {
	const image = linkTestSystemBlua32(compileLuaSource('return 0', 'table-record-checkpoint.lua'));
	const { cpu: source } = createTestSystemCpu(image);
	const table = source.createTable(4, 16), child = source.createTable(), meta = source.createTable();
	source.gc.tables.setMetatableAddress(table, meta);
	source.gc.tables.setInteger(table, 1, v.valueFloatBits(0xffa54321));
	source.gc.tables.setInteger(table, 2, v.valueInteger(-2147483648));
	source.gc.tables.setInteger(table, 3, v.valueTable(child));
	source.gc.tables.set(table, v.valueFloatBits(0xffa12345), v.valueFloatBits(0xffc00000));
	const name = source.stringPool.intern('saved_table');
	source.setGlobalByKey(name, v.valueTable(table));
	const { cpu: target } = createTestSystemCpu(image);
	for (let i = 0; i < 5; ++i) target.createTable();
	target.memory.restoreSaveState(source.memory.captureSaveState());
	target.restoreRuntimeState(source.captureRuntimeState());
	const restored = v.valuePayload(target.getGlobalByKey(name));
	assert.equal(restored, table);
	assert.equal(target.gc.tables.metatableAddress(restored), meta);
	assert.equal(target.gc.tables.getInteger(restored, 1), v.valueFloatBits(0xffa54321));
	assert.equal(target.gc.tables.getInteger(restored, 2), v.valueInteger(-2147483648));
	assert.equal(v.valuePayload(target.gc.tables.getInteger(restored, 3)), child);
	assert.equal(target.gc.tables.get(restored, v.valueFloatBits(0x7fc00001)), v.valueFloatBits(0xffc00000));
	assert.equal(target.gc.tables.getTrackedHeapBytes(restored), source.gc.tables.getTrackedHeapBytes(table));
});
