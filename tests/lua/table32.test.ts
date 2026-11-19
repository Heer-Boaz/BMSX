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
import { compileLuaSource } from './cpu_test_harness';
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
	assert.equal(cpu.luaHeap.usedBytes() - start, table.records.getTrackedHeapBytes(table.address));
	assert.equal(cpu.heapAllocator.occupiedBytes() - occupied, table.records.getTrackedHeapBytes(table.address));
	const base = table.records.storageAddress(table.address);
	const links = base + (8 + 2 * 16) * 4;
	const tags = links + 16 * 4;
	assert.equal(cpu.memory.readRamRecordWord(links), 0xffffffff);
	table.records.setInteger(table.address, 3, v.valueFloatBits(0xffa12345));
	assert.equal(cpu.memory.readRamRecordWord(base + 8), 0xffa12345);
	assert.equal(cpu.memory.readRamRecordByte(tags + 2), v.ValueTag.Float);
	assert.equal(table.records.getInteger(table.address, 3), v.valueFloatBits(0xffa12345));
	table.records.clear(table.address); assert.equal(cpu.luaHeap.usedBytes() - start, 32);
});

test('Table keys normalize Integer/Float identity without changing stored value bits', () => {
	const cpu = machine(), table = cpu.createTable();
	table.records.set(table.address, v.valueFloat(2), v.valueFloatBits(0xffa12345));
	assert.equal(table.records.get(table.address, v.valueInteger(2)), v.valueFloatBits(0xffa12345));
	table.records.set(table.address, v.valueFloatBits(0x80000000), v.valueInteger(19));
	assert.equal(table.records.get(table.address, v.valueInteger(0)), v.valueInteger(19));
	table.records.set(table.address, v.valueFloatBits(0x7fa12345), v.valueInteger(20));
	assert.equal(table.records.get(table.address, v.valueFloatBits(0xffc54321)), v.valueInteger(20));
	table.records.set(table.address, v.valueInteger(16777217), v.valueInteger(21));
	table.records.set(table.address, v.valueFloat(16777216), v.valueInteger(22));
	assert.equal(table.records.get(table.address, v.valueInteger(16777217)), v.valueInteger(21));
	assert.equal(table.records.get(table.address, v.valueFloat(16777216)), v.valueInteger(22));
	const entries: [v.Value, v.Value][] = [];
	table.records.forEachStoredEntry(table.address, (key, value) => entries.push([key, value]));
	assert.ok(entries.some(([key]) => key === v.valueInteger(2)));
	assert.ok(entries.some(([key]) => key === v.valueFloatBits(0x7fc00000)));
	assert.ok(!entries.some(([key]) => key === v.valueFloat(2)));
});

test('compact hash growth, cached string access and inherited reads use real heap references', () => {
	const cpu = machine(), table = cpu.createTable(), parent = cpu.createTable(), meta = cpu.createTable();
	const key = cpu.stringPool.intern('method'), index = cpu.stringPool.intern('__index');
	const inherited = v.valueTable(cpu.gc.reference(parent));
	meta.records.setStringKey(meta.address, index, inherited); table.metatable = meta;
	parent.records.setStringKey(parent.address, key, v.valueBool(false));
	const result = { values: new ValueSlots(1), slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved };
	table.records.resolveStringIndexCached(table.address, index, key, -1, result);
	assert.equal(result.values.get(0), v.valueBool(false)); assert.equal(result.extraVisits, 1);
	for (let i = 1; i <= 512; ++i) { table.records.setInteger(table.address, i, v.valueInteger(i * -3)); table.records.setStringKey(table.address, cpu.stringPool.intern('key' + i), v.valueInteger(i)); }
	for (let i = 1; i <= 512; ++i) { assert.equal(table.records.getInteger(table.address, i), v.valueInteger(i * -3)); assert.equal(table.records.getStringKey(table.address, cpu.stringPool.find('key' + i)!), v.valueInteger(i)); }
	let predicted = table.records.loadStringKeyCached(table.address, cpu.stringPool.find('key123')!, -1, result.values, 0);
	assert.equal(result.values.getInteger(0), 123);
	predicted = table.records.storeStringKeyCached(table.address, cpu.stringPool.find('key123')!, predicted, v.ValueTag.Float, 0xffa12345);
	table.records.loadStringKeyCached(table.address, cpu.stringPool.find('key123')!, predicted, result.values, 0);
	assert.equal(result.values.get(0), v.valueFloatBits(0xffa12345));
	const empty = cpu.createTable();
	assert.equal(empty.records.storeStringKeyWithoutGrowth(empty.address, key, v.ValueTag.Integer, 1), TABLE_STORE_REQUIRES_GROWTH);
	assert.equal(empty.records.getStringKey(empty.address, key), v.valueNil());
});

test('tombstone continuation retains a stable object hash, not the recycled reference', () => {
	const cpu = machine(), table = cpu.createTable(0, 64), keyObject = cpu.createTable();
	keyObject.hashId = 0;
	const key = v.valueTable(cpu.gc.reference(keyObject)), target = new ValueSlots(2);
	table.records.set(table.address, key, v.valueInteger(7));
	for (let i = 1; i <= 20; ++i) table.records.setStringKey(table.address, cpu.stringPool.intern('other' + i), v.valueInteger(i));
	table.records.next(table.address, key, target, 0); const after = target.get(0);
	table.records.set(table.address, key, v.valueNil()); table.records.next(table.address, key, target, 0);
	assert.equal(target.get(0), after);
	const entries: v.Value[] = [];
	table.records.forEachStoredEntry(table.address, (k, value) => entries.push(k, value));
	assert.ok(!entries.some(value => v.valueTag(value) === v.ValueTag.DeadKey));
	table.records.set(table.address, key, v.valueInteger(8)); assert.equal(table.records.get(table.address, key), v.valueInteger(8));
});

test('compact Tables participate in incremental tracing, weak clearing and reference recycling', () => {
	const cpu = machine(), table = cpu.createTable(), child = cpu.createTable();
	const root = v.valueTable(cpu.gc.reference(table)), childValue = v.valueTable(cpu.gc.reference(child));
	table.records.setStringKey(table.address, cpu.stringPool.intern('child'), childValue);
	cpu.gc.collect(root);
	assert.equal(table.records.getStringKey(table.address, cpu.stringPool.find('child')!), childValue);
	assert.equal(cpu.gc.tableAt(v.valuePayload(childValue)), child);
	const weak = cpu.createTable(), meta = cpu.createTable(), dead = cpu.createTable();
	const deadReference = cpu.gc.reference(dead);
	meta.records.setStringKey(meta.address, cpu.stringPool.intern('__mode'), v.valueString(cpu.stringPool.intern('v'))); weak.metatable = meta;
	weak.records.setInteger(weak.address, 1, v.valueTable(deadReference));
	table.records.setStringKey(table.address, cpu.stringPool.intern('weak'), v.valueTable(cpu.gc.reference(weak)));
	cpu.gc.collect(root);
	assert.equal(weak.records.getInteger(weak.address, 1), v.valueNil());
	const replacement = cpu.createTable();
	assert.equal(cpu.gc.reference(replacement), deadReference);
	// A retired reference id never substitutes for object hash identity.
	assert.notEqual(replacement.hashId, dead.hashId);
	assert.equal(weak.records.getInteger(weak.address, 1), v.valueNil());
});

test('length candidates are bounded signed-32 keys and keep their guest probe count', () => {
	const cpu = machine(), table = cpu.createTable(), work = { probes: 0 };
	assert.equal(table.records.length(table.address, work), 0); assert.equal(work.probes, 1);
	for (let i = 4096; i >= 1; --i) table.records.setInteger(table.address, i, v.valueBool(true));
	assert.equal(table.records.length(table.address, work), 4096); assert.equal(work.probes, 26);
	table.records.setInteger(table.address, -2147483648, v.valueInteger(7));
	table.records.setInteger(table.address, 2147483647, v.valueInteger(8));
	assert.equal(table.records.getInteger(table.address, -2147483648), v.valueInteger(7));
	assert.equal(table.records.getInteger(table.address, 2147483647), v.valueInteger(8));
	assert.equal(table.records.length(table.address, work), 4096);
});

test('Table mutation streams preserve raw words through collisions, growth and deletions', () => {
	const cpu = machine(), table = cpu.createTable(), oracle = new Map<v.Value, v.Value>();
	const keys: v.Value[] = [v.valueBool(false), v.valueBool(true), v.valueFloatBits(0x7fa12345), v.valueFloatBits(0xffc00001), v.valueFloatBits(0x80000000), v.valueInteger(0), v.valueInteger(-2147483648), v.valueInteger(2147483647)];
	for (let i = 1; i <= 48; ++i) keys.push(v.valueInteger(i), v.valueFloat(i), v.valueFloat(i + 0.5), v.valueString(cpu.stringPool.intern('field' + i)), v.valueTable(cpu.gc.reference(cpu.createTable())));
	let seed = 0x5130bbad;
	const next = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
	for (let i = 0; i < 20000; ++i) {
		const key = keys[next() % keys.length], word = next();
		const value = (word & 7) === 0 ? v.valueNil() : (word & 1) === 0 ? v.valueInteger(word | 0) : v.valueFloatBits(word);
		table.records.set(table.address, key, value); const canonical = v.canonicalTableKey(key);
		if (v.isNil(value)) oracle.delete(canonical); else oracle.set(canonical, value);
		assert.equal(table.records.get(table.address, key), value);
		if ((i & 255) === 0) {
			const observed = new Map<v.Value, v.Value>(); table.records.forEachStoredEntry(table.address, (k, val) => observed.set(k, val));
			assert.deepEqual(observed, oracle);
			for (const k of keys) assert.equal(table.records.get(table.address, k), oracle.get(v.canonicalTableKey(k)) ?? v.valueNil());
		}
	}
});

test('machine snapshots restore table records and their references to a different heap', () => {
	const image = linkTestSystemBlua32(compileLuaSource('return 0', 'table-record-checkpoint.lua'));
	const { cpu: source } = createTestSystemCpu(image);
	const table = source.createTable(4, 16), child = source.createTable(), meta = source.createTable();
	table.metatable = meta;
	table.records.setInteger(table.address, 1, v.valueFloatBits(0xffa54321));
	table.records.setInteger(table.address, 2, v.valueInteger(-2147483648));
	table.records.setInteger(table.address, 3, v.valueTable(source.gc.reference(child)));
	table.records.set(table.address, v.valueFloatBits(0xffa12345), v.valueFloatBits(0xffc00000));
	const name = source.stringPool.intern('saved_table');
	source.setGlobalByKey(name, v.valueTable(source.gc.reference(table)));
	const { cpu: target } = createTestSystemCpu(image);
	for (let i = 0; i < 5; ++i) target.createTable();
	target.memory.restoreSaveState(source.memory.captureSaveState());
	target.restoreRuntimeState(source.captureRuntimeState());
	const restored = v.asTable(target.getGlobalByKey(name), target.gc);
	assert.equal(restored.address, table.address);
	assert.equal(restored.metatable?.address, meta.address);
	assert.equal(restored.records.getInteger(restored.address, 1), v.valueFloatBits(0xffa54321));
	assert.equal(restored.records.getInteger(restored.address, 2), v.valueInteger(-2147483648));
	assert.equal(v.asTable(restored.records.getInteger(restored.address, 3), target.gc).address, child.address);
	assert.equal(restored.records.get(restored.address, v.valueFloatBits(0x7fc00001)), v.valueFloatBits(0xffc00000));
	assert.equal(restored.records.getTrackedHeapBytes(restored.address), table.records.getTrackedHeapBytes(table.address));
});
