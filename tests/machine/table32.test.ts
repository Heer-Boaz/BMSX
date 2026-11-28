import { readStockGlobalValue } from '../../toolchain/ts/firmware/stock_global_bank';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { TableLookupStatus, TableRecords } from '../../machine/ts/machine/cpu/table';
import { RAM_RECORD_WORD_MASK } from '../../machine/ts/spec/bmsx/memory_map';
import { LUA_FAULT_REASON_INDEX_NAN, LUA_FAULT_REASON_INDEX_NIL } from '../../machine/ts/spec/blua32/cop0';
import { runGuestToHalt } from '../helpers/cpu_test_harness';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { bootManagedTestSystem, linkManagedTestSystem } from '../helpers/managed_system';
import { installAllocationStress } from '../helpers/gc_stress';
import * as v from '../../machine/ts/machine/cpu/value';

const tableRom = linkManagedTestSystem('', 0);

test('Table budget charges allocated Value and hash slots rather than physical hash links', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const start = nativeHeapReference(cpu).luaHeap.usedBytes();
	const occupied = nativeHeapReference(cpu).heapAllocator.occupiedBytes();
	const table = createReferenceTable(cpu, 8, 16);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes() - start, 32 + 5 * 8 + 10 * 16);
	assert.equal(nativeHeapReference(cpu).heapAllocator.occupiedBytes() - occupied, nativeHeapReference(cpu).gc.tables.getTrackedHeapBytes(table));
	const base = cpu.tables.arrayAddress(table);
	const links = cpu.tables.hashAddress(table) + 16 * 10;
	const tags = base + 8 * 4;
	assert.equal(cpu.memory.readRamRecordByte(links), 0xff);
	nativeHeapReference(cpu).gc.tables.setInteger(table, 3, v.valueFloatBits(0xffa12345));
	assert.equal(cpu.memory.readRamRecordWord(base + 8), 0xffa12345);
	assert.equal(cpu.memory.readRamRecordByte(tags + 2), v.ValueTag.Float);
	assert.equal(cpu.tables.getInteger(table, 3), v.valueFloatBits(0xffa12345));
	nativeHeapReference(cpu).gc.tables.clear(table); assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes() - start, 32);
});

test('full byte-index chains survive copying and widening during rehash', () => {
	const { cpu } = createCartlibProgramHarness(`
local source<const> = {}
for i = 1, 128 do source[-i] = i end
local copy<const> = table.copy(source)
copy[-129] = true
original, duplicate = source, copy
`);
	runGuestToHalt(cpu, 20_000_000);
	const tables = nativeHeapReference(cpu).gc.tables;
	const source = v.valuePayload(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('original')!));
	const copy = v.valuePayload(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('duplicate')!));
	assert.equal(tables.hashSize(source), 128);
	assert.equal(tables.hashSize(copy), 256);
	for (let key = 1; key <= 128; ++key) {
		assert.equal(tables.getInteger(source, -key), v.valueInteger(key));
		assert.equal(tables.getInteger(copy, -key), v.valueInteger(key));
	}
	assert.equal(tables.getInteger(source, -129), v.valueNil());
	assert.equal(tables.getInteger(copy, -129), v.valueBool(true));
});

test('firmware copy retains the census and density bands of a large hash', () => {
	const { cpu } = createCartlibProgramHarness(`
local source<const> = {}
for i = 1, 1025 do source[-i] = i end
source[-9] = nil
source[72] = true
original, duplicate = source, table.copy(source)
`);
	runGuestToHalt(cpu, 20_000_000);
	const tables = nativeHeapReference(cpu).gc.tables;
	const source = v.valuePayload(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('original')!));
	const copy = v.valuePayload(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('duplicate')!));
	assert.equal(tables.hashSize(source), 2048);
	assert.equal(tables.hashSize(copy), 2048);
	const sourceBacking = tables.hashAddress(source) & RAM_RECORD_WORD_MASK;
	const copyBacking = tables.hashAddress(copy) & RAM_RECORD_WORD_MASK;
	assert.notEqual(sourceBacking, copyBacking);
	const bytes = TableRecords.hashStorageBytes(2048);
	const ram = cpu.memory.ramData();
	assert.deepEqual(ram.subarray(copyBacking, copyBacking + bytes), ram.subarray(sourceBacking, sourceBacking + bytes));
});

test('array growth keeps a full hash when none of its keys move into the array', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const tables = nativeHeapReference(cpu).gc.tables, table = createReferenceTable(cpu, 1, 1);
	tables.setInteger(table, 1, v.valueBool(false));
	tables.setInteger(table, -1, v.valueInteger(41));
	const hash = tables.hashAddress(table);
	tables.setInteger(table, 2, v.valueInteger(42));
	assert.equal(tables.arrayCapacity(table), 2);
	assert.equal(tables.hashAddress(table), hash);
	assert.equal(tables.getInteger(table, -1), v.valueInteger(41));
});

test('only index one selects an array on the first integer insertion', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const tables = nativeHeapReference(cpu).gc.tables;
	for (const key of [1, 2, 0x7fffffff]) {
		const table = createReferenceTable(cpu);
		tables.setInteger(table, key, v.valueBool(false));
		assert.equal(tables.arrayCapacity(table), key === 1 ? 1 : 0);
		assert.equal(tables.hashSize(table), key === 1 ? 0 : 1);
		assert.equal(tables.getInteger(table, key), v.valueBool(false));
	}
});

test('integer growth counts a partial array density band at the strict half boundary', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const tables = nativeHeapReference(cpu).gc.tables;
	for (const added of [16, 17]) {
		const table = createReferenceTable(cpu, 13, 0);
		for (const key of [1, 2, 3, 4, 5, 9, 10, 13]) tables.setInteger(table, key, v.valueBool(false));
		tables.setInteger(table, added, v.valueInteger(41));
		// At 17 exactly eight of the first sixteen are present; at 16 there are nine.
		assert.equal(tables.arrayCapacity(table), added === 16 ? 16 : 8);
		assert.equal(tables.hashSize(table), added === 16 ? 0 : 4);
		for (const key of [1, 2, 3, 4, 5, 9, 10, 13]) assert.equal(tables.getInteger(table, key), v.valueBool(false));
		assert.equal(tables.getInteger(table, added), v.valueInteger(41));
	}
});

test('growth for non-array keys preserves sparse reserved slots and their charge', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const tables = nativeHeapReference(cpu).gc.tables;
	const mixed = createReferenceTable(cpu, 8, 0), identity = createReferenceTable(cpu);
	const keys = [v.valueString(nativeHeapReference(cpu).stringPool.intern('hash only')), v.valueInteger(-1), v.valueFloat(0.5), v.valueTable(identity)];
	const bytes = nativeHeapReference(cpu).luaHeap.usedBytes(), retained = v.valueFloatBits(0xffc01234);
	tables.setInteger(mixed, 8, retained);
	const arrayAddress = tables.arrayAddress(mixed);
	const slots = [1, 2, 4, 4];
	for (let i = 0; i < keys.length; ++i) {
		tables.set(mixed, keys[i], v.valueInteger(i));
		assert.equal(tables.arrayCapacity(mixed), 8);
		assert.equal(tables.arrayAddress(mixed), arrayAddress);
		assert.equal(tables.getInteger(mixed, 8), retained);
		assert.equal(tables.hashSize(mixed), slots[i]);
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), bytes + 10 * slots[i]);
	}
	for (let slot = 1; slot < 8; ++slot) tables.setInteger(mixed, slot, v.valueInteger(slot));
	tables.set(mixed, v.valueFloat(9), retained);
	assert.equal(tables.arrayCapacity(mixed), 16);
	assert.equal(tables.hashSize(mixed), 4);
	assert.equal(tables.getInteger(mixed, 9), retained);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), bytes + 4 * 10 + 8 * 5);
	for (let i = 0; i < keys.length; ++i) assert.equal(tables.get(mixed, keys[i]), v.valueInteger(i));
});

test('tombstone-driven rebuild returns only retired capacity and preserves live mappings', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const tables = nativeHeapReference(cpu).gc.tables, keys = new Int32Array(16);
	let assigned = 0, collision = 0;
	for (let id = -1; assigned !== keys.length || collision === 0; --id) {
		const home = v.hashCanonicalTableKey(v.valueInteger(id)) & (keys.length - 1);
		if (keys[home] === 0) { keys[home] = id; ++assigned; }
		else if (home === 0) collision = id;
	}
	const spare = createReferenceTable(cpu, 0, 16), tombstones = createReferenceTable(cpu, 0, 16);
	const start = nativeHeapReference(cpu).luaHeap.usedBytes();
	for (const id of keys) tables.setInteger(tombstones, id, v.valueInteger(17));
	for (let i = 2; i < keys.length; ++i) tables.setInteger(tombstones, keys[i], v.valueNil());
	for (let i = 0; i < 2; ++i) tables.setInteger(spare, keys[i], v.valueInteger(17));
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), start, 'filling and clearing mappings does not change the reservation');
	const before = tables.hashAddress(tombstones);
	tables.setInteger(tombstones, collision, v.valueInteger(23));
	tables.setInteger(spare, collision, v.valueInteger(23));
	assert.notEqual(tables.hashAddress(tombstones), before);
	assert.equal(tables.hashSize(tombstones), 4);
	assert.equal(tables.hashSize(spare), 16);
	assert.equal(tables.arrayCapacity(tombstones), tables.arrayCapacity(spare));
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), start - (16 - 4) * 10);
	for (const id of [keys[0], keys[1], collision]) assert.equal(tables.getInteger(tombstones, id), tables.getInteger(spare, id));

	const logical = nativeHeapReference(cpu).luaHeap.usedBytes(), table = createReferenceTable(cpu, 0, 3);
	const backing = tables.hashAddress(table);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical + 32 + 40, 'an empty three-slot request immediately charges four slots');
	for (let i = 0; i < 4; ++i) tables.setInteger(table, keys[i], v.valueInteger(29));
	assert.equal(tables.hashSize(table), 4);
	assert.equal(tables.hashAddress(table), backing);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical + 32 + 40);
	const ram = cpu.memory.captureSaveState();
	tables.setInteger(table, keys[0], v.valueNil());
	assert.equal(tables.getInteger(table, keys[0]), v.valueNil());
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical + 32 + 40);
	cpu.memory.restoreSaveState(ram);
	assert.equal(tables.getInteger(table, keys[0]), v.valueInteger(29));
	tables.setInteger(table, keys[0], v.valueNil());
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical + 32 + 40, 'deletion after restore retains the rounded reservation');
});

test('hash deletion and replay retain backing while a hash slot can be reused', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const tables = nativeHeapReference(cpu).gc.tables, keys = new Int32Array(4);
	let assigned = 0;
	for (let id = -1; assigned !== keys.length; --id) {
		const home = v.hashCanonicalTableKey(v.valueInteger(id)) & (keys.length - 1);
		if (keys[home] === 0) { keys[home] = id; ++assigned; }
	}
	const table = createReferenceTable(cpu);
	for (const key of keys) tables.setInteger(table, key, v.valueInteger(13));
	const backing = tables.hashAddress(table), home = v.hashCanonicalTableKey(v.valueInteger(1)) & (keys.length - 1);
	tables.setInteger(table, keys[home], v.valueNil());
	tables.setInteger(table, keys[(home + 1) & (keys.length - 1)], v.valueNil());
	const used = nativeHeapReference(cpu).luaHeap.usedBytes(), saved = cpu.memory.captureSaveState();
	for (const replay of [false, true]) {
		if (replay) cpu.memory.restoreSaveState(saved);
		for (let step = 0; step < 16; ++step) {
			tables.setInteger(table, 1, v.valueInteger(29));
			assert.equal(tables.hashAddress(table), backing);
			assert.equal(tables.arrayCapacity(table), 0, 'placement in an existing hash slot does not repartition live keys');
			assert.equal(tables.hashSize(table), 4);
			assert.equal(tables.getInteger(table, 1), v.valueInteger(29));
			tables.setInteger(table, 1, v.valueNil());
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), used);
		}
	}
});

test('allocation stress reaches hash backing growth, not writes into existing slots', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const tables = nativeHeapReference(cpu).gc.tables, table = createReferenceTable(cpu, 0, 3);
	const backing = tables.hashAddress(table), stress = installAllocationStress(cpu);
	for (let i = 1; i <= 4; ++i) tables.setInteger(table, -i, v.valueInteger(i));
	assert.equal(stress.allocations, 0, 'the four reserved slots need no admission');
	assert.equal(tables.hashAddress(table), backing);
	tables.setInteger(table, -5, v.valueInteger(5));
	assert.notEqual(tables.hashAddress(table), backing);
	assert.equal(tables.hashSize(table), 8);
	assert.equal(stress.allocations, 1, 'a full four-slot backing needs one growth admission');
	assert.ok(nativeHeapReference(cpu).gc.active(), 'the hook actually advanced the collector');
	tables.setInteger(table, -4, v.valueInteger(5));
	tables.setInteger(table, -4, v.valueNil());
	assert.equal(stress.allocations, 1, 'neither replacement nor removal admits new bytes');
});

test('Table keys normalize Integer/Float identity without changing stored value bits', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const table = createReferenceTable(cpu);
	nativeHeapReference(cpu).gc.tables.set(table, v.valueFloat(2), v.valueFloatBits(0xffa12345));
	assert.equal(cpu.tables.get(table, v.valueInteger(2)), v.valueFloatBits(0xffa12345));
	nativeHeapReference(cpu).gc.tables.set(table, v.valueFloatBits(0x80000000), v.valueInteger(19));
	assert.equal(cpu.tables.get(table, v.valueInteger(0)), v.valueInteger(19));
	nativeHeapReference(cpu).gc.tables.set(table, v.valueInteger(0x7fc00000), v.valueInteger(23));
	assert.equal(cpu.tables.get(table, v.valueFloatBits(0xffc54321)), v.valueNil());
	assert.equal(cpu.tables.get(table, v.valueInteger(0x7fc00000)), v.valueInteger(23));
	nativeHeapReference(cpu).gc.tables.set(table, v.valueInteger(16777217), v.valueInteger(21));
	nativeHeapReference(cpu).gc.tables.set(table, v.valueFloat(16777216), v.valueInteger(22));
	assert.equal(cpu.tables.get(table, v.valueInteger(16777217)), v.valueInteger(21));
	assert.equal(cpu.tables.get(table, v.valueFloat(16777216)), v.valueInteger(22));
	const entries: [v.Value, v.Value][] = [];
	cpu.tables.forEachStoredEntry(table, (key, value) => entries.push([key, value]));
	assert.ok(entries.some(([key]) => key === v.valueInteger(2)));
	assert.ok(!entries.some(([key]) => key === v.valueFloat(2)));
});

test('raw nil and NaN keys miss and cannot mutate a Table even with a nil value', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const table = createReferenceTable(cpu);
	nativeHeapReference(cpu).gc.tables.setInteger(table, 1, v.valueInteger(91));
	for (const [key, reason] of [[v.valueNil(), LUA_FAULT_REASON_INDEX_NIL],
		[v.valueFloatBits(0x7fa12345), LUA_FAULT_REASON_INDEX_NAN], [v.valueFloatBits(0xffc54321), LUA_FAULT_REASON_INDEX_NAN]] as const) {
		assert.equal(cpu.tables.get(table, key), v.valueNil());
		assert.throws(() => nativeHeapReference(cpu).gc.tables.set(table, key, v.valueInteger(7)), { reason });
		assert.throws(() => nativeHeapReference(cpu).gc.tables.set(table, key, v.valueNil()), { reason });
	}
	const entries: [v.Value, v.Value][] = [];
	cpu.tables.forEachStoredEntry(table, (key, value) => entries.push([key, value]));
	assert.deepEqual(entries, [[v.valueInteger(1), v.valueInteger(91)]]);
});

test('compact hash growth, cached string access and inherited reads use real heap references', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const table = createReferenceTable(cpu), parent = createReferenceTable(cpu), meta = createReferenceTable(cpu);
	const key = nativeHeapReference(cpu).stringPool.intern('method'), index = nativeHeapReference(cpu).stringPool.intern('__index');
	const inherited = v.valueTable(parent);
	nativeHeapReference(cpu).gc.tables.setStringKey(meta, index, inherited); nativeHeapReference(cpu).gc.tables.setMetatableAddress(table, meta);
	nativeHeapReference(cpu).gc.tables.setStringKey(parent, key, v.valueBool(false));
	const result = { value: v.valueNil(), slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved, receiver: 0 };
	cpu.tables.resolveStringIndexCached(table, key, -1, result);
	assert.equal(result.value, v.valueBool(false)); assert.equal(result.extraVisits, 1);
	for (let i = 1; i <= 512; ++i) { nativeHeapReference(cpu).gc.tables.setInteger(table, i, v.valueInteger(i * -3)); nativeHeapReference(cpu).gc.tables.setStringKey(table, nativeHeapReference(cpu).stringPool.intern('key' + i), v.valueInteger(i)); }
	for (let i = 1; i <= 512; ++i) { assert.equal(cpu.tables.getInteger(table, i), v.valueInteger(i * -3)); assert.equal(cpu.tables.getStringKey(table, nativeHeapReference(cpu).stringPool.find('key' + i)!), v.valueInteger(i)); }
	const cachedKey = nativeHeapReference(cpu).stringPool.find('key123')!;
	cpu.tables.getStringKeyCached(table, cachedKey, -1, result);
	assert.equal(result.value, v.valueInteger(123));
	const predicted = result.slot;
	assert.equal(cpu.tables.storePredictedStringKey(table, cachedKey, predicted, v.ValueTag.Float, 0xffa12345), true);
	cpu.tables.getStringKeyCached(table, cachedKey, predicted, result);
	assert.equal(result.value, v.valueFloatBits(0xffa12345));
	const empty = createReferenceTable(cpu);
	nativeHeapReference(cpu).gc.tables.storeStringKey(empty, key, v.ValueTag.Integer, 1);
	assert.equal(cpu.tables.getStringKey(empty, key), v.valueInteger(1));
});

test('tombstone continuation retains a stable object hash, not the recycled reference', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const table = createReferenceTable(cpu, 0, 64), keyObject = createReferenceTable(cpu);
	const key = v.valueTable(keyObject), target = new ValueSlots(2);
	nativeHeapReference(cpu).gc.tables.set(table, key, v.valueInteger(7));
	for (let i = 1; i <= 20; ++i) nativeHeapReference(cpu).gc.tables.setStringKey(table, nativeHeapReference(cpu).stringPool.intern('other' + i), v.valueInteger(i));
	cpu.tables.next(table, key, target, 0); const after = target.get(0);
	nativeHeapReference(cpu).gc.tables.set(table, key, v.valueNil()); cpu.tables.next(table, key, target, 0);
	assert.equal(target.get(0), after);
	const entries: v.Value[] = [];
	cpu.tables.forEachStoredEntry(table, (k, value) => entries.push(k, value));
	assert.ok(!entries.some(value => v.valueTag(value) === v.ValueTag.DeadKey));
	nativeHeapReference(cpu).gc.tables.set(table, key, v.valueInteger(8)); assert.equal(cpu.tables.get(table, key), v.valueInteger(8));
});

test('compact Tables participate in incremental tracing, weak clearing and reference recycling', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const table = createReferenceTable(cpu), child = createReferenceTable(cpu);
	const root = v.valueTable(table), childValue = v.valueTable(child);
	nativeHeapReference(cpu).gc.tables.setStringKey(table, nativeHeapReference(cpu).stringPool.intern('child'), childValue);
	nativeHeapReference(cpu).gc.collect(root);
	assert.equal(cpu.tables.getStringKey(table, nativeHeapReference(cpu).stringPool.find('child')!), childValue);
	assert.equal(nativeHeapReference(cpu).gc.tableRecordAddress(v.valuePayload(childValue)), child);
	const weak = createReferenceTable(cpu), meta = createReferenceTable(cpu), dead = createReferenceTable(cpu);
	const deadReference = dead;
	nativeHeapReference(cpu).gc.tables.setStringKey(meta, nativeHeapReference(cpu).stringPool.intern('__mode'), v.valueString(nativeHeapReference(cpu).stringPool.intern('v'))); nativeHeapReference(cpu).gc.tables.setMetatableAddress(weak, meta);
	nativeHeapReference(cpu).gc.tables.setInteger(weak, 1, v.valueTable(deadReference));
	nativeHeapReference(cpu).gc.tables.setStringKey(table, nativeHeapReference(cpu).stringPool.intern('weak'), v.valueTable(weak));
	nativeHeapReference(cpu).gc.collect(root);
	assert.equal(cpu.tables.getInteger(weak, 1), v.valueNil());
	const replacement = createReferenceTable(cpu);
	assert.equal(replacement, deadReference);
	assert.equal(cpu.tables.getInteger(weak, 1), v.valueNil());
});

test('length candidates are bounded to signed-32 keys', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const table = createReferenceTable(cpu);
	assert.equal(cpu.tables.length(table), 0);
	for (let i = 4096; i >= 1; --i) nativeHeapReference(cpu).gc.tables.setInteger(table, i, v.valueBool(true));
	assert.equal(cpu.tables.length(table), 4096);
	nativeHeapReference(cpu).gc.tables.setInteger(table, -2147483648, v.valueInteger(7));
	nativeHeapReference(cpu).gc.tables.setInteger(table, 2147483647, v.valueInteger(8));
	assert.equal(cpu.tables.getInteger(table, -2147483648), v.valueInteger(7));
	assert.equal(cpu.tables.getInteger(table, 2147483647), v.valueInteger(8));
	assert.equal(cpu.tables.length(table), 4096);
});

test('Table mutation streams preserve raw words through collisions, growth and deletions', () => {
	const { cpu } = bootManagedTestSystem(tableRom);
	const table = createReferenceTable(cpu), oracle = new Map<v.Value, v.Value>();
	const keys: v.Value[] = [v.valueBool(false), v.valueBool(true), v.valueFloat(Infinity), v.valueFloat(-Infinity), v.valueFloatBits(0x80000000), v.valueInteger(0), v.valueInteger(-2147483648), v.valueInteger(2147483647)];
	for (let i = 1; i <= 48; ++i) keys.push(v.valueInteger(i), v.valueFloat(i), v.valueFloat(i + 0.5), v.valueString(nativeHeapReference(cpu).stringPool.intern('field' + i)), v.valueTable(createReferenceTable(cpu)));
	let seed = 0x5130bbad;
	const next = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
	for (let i = 0; i < 20000; ++i) {
		const key = keys[next() % keys.length], word = next();
		const value = (word & 7) === 0 ? v.valueNil() : (word & 1) === 0 ? v.valueInteger(word | 0) : v.valueFloatBits(word);
		nativeHeapReference(cpu).gc.tables.set(table, key, value); const canonical = v.canonicalTableKey(key);
		if (v.isNil(value)) oracle.delete(canonical); else oracle.set(canonical, value);
		assert.equal(cpu.tables.get(table, key), value);
		if ((i & 255) === 0) {
			const observed = new Map<v.Value, v.Value>(); cpu.tables.forEachStoredEntry(table, (k, val) => observed.set(k, val));
			assert.deepEqual(observed, oracle);
			for (const k of keys) assert.equal(cpu.tables.get(table, k), oracle.get(v.canonicalTableKey(k)) ?? v.valueNil());
		}
	}
});

test('machine snapshots restore table records and their references to a different heap', () => {
	const { cpu: source } = bootManagedTestSystem(tableRom);
	const table = createReferenceTable(source, 4, 16), child = createReferenceTable(source), meta = createReferenceTable(source);
	nativeHeapReference(source).gc.tables.setMetatableAddress(table, meta);
	nativeHeapReference(source).gc.tables.setInteger(table, 1, v.valueFloatBits(0xffa54321));
	nativeHeapReference(source).gc.tables.setInteger(table, 2, v.valueInteger(-2147483648));
	nativeHeapReference(source).gc.tables.setInteger(table, 3, v.valueTable(child));
	nativeHeapReference(source).gc.tables.set(table, v.valueFloat(1.5), v.valueFloatBits(0xffc00000));
	const name = nativeHeapReference(source).stringPool.intern('saved_table');
	setReferenceGlobal(source, name, v.valueTable(table));
	const { cpu: target } = bootManagedTestSystem(tableRom);
	for (let i = 0; i < 5; ++i) createReferenceTable(target);
	target.memory.restoreSaveState(source.memory.captureSaveState());
	target.restoreRuntimeState(source.captureRuntimeState());
	const restored = v.valuePayload(readStockGlobalValue(target.memory, name));
	assert.equal(restored, table);
	assert.equal(target.tables.metatableAddress(restored), meta);
	assert.equal(target.tables.getInteger(restored, 1), v.valueFloatBits(0xffa54321));
	assert.equal(target.tables.getInteger(restored, 2), v.valueInteger(-2147483648));
	assert.equal(v.valuePayload(target.tables.getInteger(restored, 3)), child);
	assert.equal(target.tables.get(restored, v.valueFloat(1.5)), v.valueFloatBits(0xffc00000));
	assert.equal(nativeHeapReference(target).gc.tables.getTrackedHeapBytes(restored), nativeHeapReference(source).gc.tables.getTrackedHeapBytes(table));
});

test('failed array growth releases the provisional hash without changing the live mixed table', () => {
	const { cpu } = bootManagedTestSystem(linkManagedTestSystem(`
local entries<const> = require('bmsx/startup')
local protect<const> = blua32.closure(entries.protected_call)
local function set(t)
	t[7] = true
end
return function(t) return protect(set, t) end
`, 0));
	runGuestToHalt(cpu, 4_194_304);
	const results: v.Value[] = [];
	cpu.readCompletionValues(results);
	const { tables } = nativeHeapReference(cpu).gc, arena = nativeHeapReference(cpu).heapAllocator;
	const table = createReferenceTable(cpu, 4, 4);
	for (const key of [1, 3, 4, -1, -3, 5, 6]) tables.setInteger(table, key, v.valueInteger(key));
	cpu.beginCompletionCall(v.valuePayload(results[0]), [v.valueTable(table)]);
	nativeHeapReference(cpu).gc.collect();
	nativeHeapReference(cpu).luaHeap.setCollectionTarget(nativeHeapReference(cpu).luaHeap.capacity());
	const array = tables.arrayAddress(table), hash = tables.hashAddress(table);
	// Repartitioning for key 7 needs a 28-byte hash and a 40-byte array.
	// Isolate one hash-sized hole so the first reservation succeeds and the second cannot.
	const hole = arena.allocate(28, true);
	assert.notEqual(arena.allocate(64, true), 0);
	for (const size of [4096, 256, 8]) while (arena.allocate(size, true) !== 0) {}
	arena.free(hole);
	const used = nativeHeapReference(cpu).luaHeap.usedBytes(), occupied = arena.occupiedBytes();
	runGuestToHalt(cpu, 4_194_304);
	cpu.readCompletionValues(results);
	assert.deepEqual(results, [v.valueBool(false), v.valueString(nativeHeapReference(cpu).stringPool.find('Out of memory.')!)]);
	assert.equal(tables.arrayAddress(table), array);
	assert.equal(tables.hashAddress(table), hash);
	assert.equal(arena.occupiedBytes(), occupied);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), used);
	for (const key of [1, 3, 4, -1, -3, 5, 6]) assert.equal(tables.getInteger(table, key), v.valueInteger(key));
	assert.equal(tables.getInteger(table, 7), v.valueNil());
});
