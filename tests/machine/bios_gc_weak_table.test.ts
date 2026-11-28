import { GcDiagnosticField } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GC_COLOR_OFFSET, GC_OBJECT_PREFIX, GC_RECORD_MASK } from '../../toolchain/ts/firmware/stock_object_layout';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { ValueTag, valueFromTag } from '../../machine/ts/machine/cpu/value';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../helpers/firmware_heap_layout';
import { seedTestRomClosure } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';

const weak = 'kernel/gc_weak_table';
const leaves = [
	{ path: weak, member: 'value_is_alive', arity: 4 },
	{ path: weak, member: 'clear_weak_entries', arity: 8 },
] as const;
type Entry = typeof leaves[number]['member'];

function fixture(optLevel: 0 | 3) {
	const linked = linkFirmwareProbe(optLevel, [], leaves);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const management = nativeHeapReference(cpu).heapAllocator.managementOffset(), arena = nativeHeapReference(cpu).heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const firstByte = memory.ramBusEnd() - RAM_BASE, lastByte = management + GC_WORKSPACE_END;
	const newIndex = nativeHeapReference(cpu).gc.diagnosticWord(GcDiagnosticField.NewIndex);
	function compare(label: string) {
		const actual = memory.ramData().subarray(firstByte, lastByte), expected = oracle.memory.ramData().subarray(firstByte, lastByte);
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, index) => byte !== expected[index]);
		assert.equal(actual[offset], expected[offset], `${label}: RAM 0x${(firstByte + offset).toString(16)}`);
	}
	function add(create: (target: typeof cpu) => number) {
		const address = create(cpu);
		assert.notEqual(address, 0);
		assert.equal(create(oracle), address);
		return address;
	}
	function word(address: number, value: number) {
		memory.writeRamRecordWord(address, value);
		oracle.memory.writeRamRecordWord(address, value);
	}
	function byte(address: number, value: number) {
		memory.writeRamRecordByte(address, value);
		oracle.memory.writeRamRecordByte(address, value);
	}
	function begin(name: Entry, ...args: number[]) {
		issueFirmwareProbe(cpu, [control, arena, ...args], leaves.findIndex(leaf => leaf.member === name));
	}
	function grant(cycles: number) {
		return grantFirmwareProbe(cpu, cycles);
	}
	function finish(cycles = 97) {
		let elapsed = 0;
		for (let i = 0; i < 8192 && !cpu.isHaltedUntilIrq(); ++i) elapsed += grant(cycles);
		return [firmwareProbeResult(cpu), elapsed];
	}
	function beginClear(record: number, mode: number, first: number, end: number) {
		nativeHeapReference(oracle).gc.tables.clearWeakEntries(record, (mode & 1) !== 0, (mode & 2) !== 0, nativeHeapReference(oracle).gc['alive'], first, end);
		begin('clear_weak_entries', metadata, record, mode, first, end, newIndex);
		return nativeHeapReference(oracle).stringPool.takeMarkWork();
	}
	function clear(record: number, mode: number, first: number, end: number, expectedWork: number) {
		assert.equal(beginClear(record, mode, first, end), expectedWork, 'native new String marks');
		assert.equal(finish()[0], expectedWork, 'firmware new String marks');
		compare(`clear mode ${mode} [${first}, ${end})`);
	}
	function table(array: number, hash: number) {
		const record = add(target => createReferenceTable(target, array, hash));
		const arrayBase = cpu.tables.arrayAddress(record), hashBase = cpu.tables.hashAddress(record);
		assert.equal(cpu.tables.arrayCapacity(record), array);
		assert.equal(cpu.tables.hashSize(record), hash);
		function arraySlot(slot: number, tag: ValueTag, payload: number) {
			word(arrayBase + 4 * slot, payload);
			byte(arrayBase + 4 * array + slot, tag);
		}
		function hashSlot(slot: number, tag: ValueTag, payload: number) {
			word(hashBase + 4 * slot, payload);
			byte(hashBase + 8 * hash + slot, tag);
		}
		function readHash(slot: number) {
			return [memory.readRamRecordByte(hashBase + 8 * hash + slot), memory.readRamRecordWord(hashBase + 4 * slot)];
		}
		return { record, arrayBase, hashBase, arraySlot, hashSlot, readHash };
	}
	function string(text: string) {
		const id = add(target => nativeHeapReference(target).stringPool.intern(text));
		byte(id + 1, 0x94);
		return id;
	}
	word(control, 0x0000e500); // White is 1, regardless of other raw bits.
	word(metadata + 0x0c, 0xa5a5a501);
	return { cpu, memory, oracle, newIndex, compare, add, word, byte, begin, grant, finish, beginClear, clear, table, string };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua weak liveness uses record kind, issued bit and current white at O${optLevel}`, () => {
		const { cpu, oracle, add, byte, begin, finish, compare } = fixture(optLevel);
		const table = add(target => createReferenceTable(target));
		const closure = add(target => seedTestRomClosure(target, target.readFrameFunctionAddress(0)));
		const thread = add(target => target.rootThread.address);
		const unissued = add(target => nativeHeapReference(target).heapAllocator.allocate(48, true)) + GC_OBJECT_PREFIX;
		byte(unissued, ValueTag.Table);
		byte(unissued + GC_COLOR_OFFSET, 0x80);
		byte(table + GC_COLOR_OFFSET, 0x81);
		byte(closure + GC_COLOR_OFFSET, 0xb2);
		byte(thread + GC_COLOR_OFFSET, 0xb3);
		const alias = ((closure & GC_RECORD_MASK) | 0xc0000007) >>> 0;
		for (const [tag, word, expected] of [[ValueTag.Table, table, 0], [ValueTag.Closure, alias, 1],
			[ValueTag.Thread, thread, 1], [ValueTag.Thread, closure, 0], [ValueTag.Table, unissued, 0],
			[ValueTag.String, table, 1], [ValueTag.Float, 0xffffffff, 1], [ValueTag.Nil, 0, 1]] as const) {
			assert.equal(+nativeHeapReference(oracle).gc['alive'](valueFromTag(tag, word)), expected);
			begin('value_is_alive', tag, word);
			assert.equal(finish()[0], expected);
		}
		compare('liveness is read-only');
	});

	test(`BLua weak clear preserves ranges, tombstones, counters and String edge order at O${optLevel}`, () => {
		const { cpu, memory, newIndex, add, byte, word, table, string, clear, beginClear, grant, finish, compare } = fixture(optLevel);
		const dead = add(target => createReferenceTable(target)), alive = add(target => seedTestRomClosure(target, target.readFrameFunctionAddress(0)));
		byte(dead + GC_COLOR_OFFSET, 0xe1);
		byte(alive + GC_COLOR_OFFSET, 0xe2);
		const arrString = string('surviving array'), keyString = string('surviving hash key'), valString = string('surviving hash value');
		const skipped = string('String held by a dead key'), skippedKey = string('String covering a dead value');
		const { record, arrayBase, hashBase, arraySlot, hashSlot, readHash } = table(4, 64);
		arraySlot(0, ValueTag.Table, dead);
		arraySlot(1, ValueTag.Nil, 0xcafecafe);
		arraySlot(2, ValueTag.String, arrString);
		arraySlot(3, ValueTag.Closure, alive);
		hashSlot(0, ValueTag.Table, dead); hashSlot(64, ValueTag.String, skipped);
		hashSlot(1, ValueTag.String, keyString); hashSlot(65, ValueTag.String, valString);
		hashSlot(2, ValueTag.String, skippedKey); hashSlot(66, ValueTag.Table, dead);
		hashSlot(3, ValueTag.String, newIndex); hashSlot(67, ValueTag.Table, dead);
		hashSlot(4, ValueTag.Closure, alive); hashSlot(68, ValueTag.Table, dead);
		hashSlot(5, ValueTag.Nil, ValueTag.Thread); hashSlot(69, ValueTag.DeadKey, dead);
		byte(newIndex + 1, 0x94);
		byte(record + TableHeader.NewIndexAbsent, 0);
		word(record + TableHeader.Length, 3);
		const free = memory.readRamRecordWord(record + TableHeader.Free);
		const link = hashBase + 10 * 64;
		byte(link, 1); byte(link + 1, 3);
		clear(record, 2, 1, 3, 1);
		assert.equal(memory.readRamRecordWord(arrayBase), dead);
		assert.equal(memory.readRamRecordWord(arrayBase + 4), 0xcafecafe, 'a nil slot is not erased again');
		clear(record, 2, 0, 1, 0);
		assert.equal(memory.readRamRecordWord(arrayBase), 0);
		assert.equal(memory.readRamRecordByte(arrayBase + 16), ValueTag.Nil);
		assert.equal(beginClear(record, 1, 4, 6), 2);
		for (let i = 0; i < 1024 && memory.readRamRecordByte(keyString + 1) !== 1; ++i) grant(1);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(memory.readRamRecordByte(keyString + 1), 1);
		assert.equal(memory.readRamRecordByte(valString + 1), 0x94, 'the key is marked before the value');
		assert.equal(memory.readRamRecordByte(skipped + 1), 0x94, 'a removed pair contributes no String mark');
		assert.equal(finish()[0], 2);
		compare('ordered surviving String edges');
		clear(record, 1, 4, 6, 0); // Already marked Strings and removed nodes are not charged again.
		assert.deepEqual(readHash(0), [ValueTag.Nil, ValueTag.Table]);
		assert.deepEqual(readHash(64), [ValueTag.DeadKey, dead]);
		assert.deepEqual(readHash(2), [ValueTag.String, skippedKey], 'later node was not inspected');
		clear(record, 3, 6, 4 + 64, 0);
		assert.deepEqual(readHash(2), [ValueTag.String, skippedKey]);
		assert.deepEqual(readHash(66), [ValueTag.Nil, 0]);
		assert.deepEqual(readHash(4), [ValueTag.Nil, ValueTag.Closure], 'a live object key still tombstones if its value dies');
		assert.deepEqual(readHash(68), [ValueTag.DeadKey, alive]);
		assert.deepEqual(readHash(5), [ValueTag.Nil, ValueTag.Thread]);
		assert.deepEqual(readHash(69), [ValueTag.DeadKey, dead]);
		for (const id of [newIndex, skipped, skippedKey]) assert.equal(memory.readRamRecordByte(id + 1), 0x94);
		for (const id of [arrString, keyString, valString]) assert.equal(memory.readRamRecordByte(id + 1), 1);
		assert.equal(memory.readRamRecordByte(record + TableHeader.NewIndexAbsent), 1);
		assert.equal(memory.readRamRecordWord(record + TableHeader.Length), 3);
		assert.equal(memory.readRamRecordWord(record + TableHeader.Free), free);
		assert.equal(memory.readRamRecordByte(link), 1);
		assert.equal(memory.readRamRecordByte(link + 1), 3);
	});


	test(`BLua weak hash clearing adjusts byte/word census and Integer bands at O${optLevel}`, () => {
		const { memory, add, word, byte, table, clear } = fixture(optLevel);
		const dead = add(target => seedTestRomClosure(target, target.readFrameFunctionAddress(0)));
		byte(dead + GC_COLOR_OFFSET, 0xe1);
		for (const hash of [128, 256, 1024]) {
			const { record, hashBase, hashSlot, readHash } = table(0, hash);
			const linkBase = hashBase + 10 * hash;
			const live = linkBase + (hash <= 128 ? 1 : 4) * hash;
			const keys = [[ValueTag.Integer, 1], [ValueTag.Integer, 257], [ValueTag.Integer, 0x7fffffff],
				[ValueTag.Integer, 0x80000000], [ValueTag.Integer, 0], [ValueTag.Float, 1]] as const;
			for (const [i, [tag, payload]] of keys.entries()) {
				hashSlot(i, tag, payload);
				hashSlot(i + hash, ValueTag.Closure, dead);
			}
			if (hash <= 128) byte(linkBase, 3); else word(linkBase, 3);
			word(live, keys.length);
			const bands = [0, 1, 9, 31];
			if (hash >= 1024) for (const band of bands) word(live + 4 * (1 + band), 3 + band);
			clear(record, 2, 0, keys.length - 1, 0);
			assert.equal(memory.readRamRecordWord(live), 1);
			if (hash >= 1024) {
				assert.deepEqual(bands.map(band => memory.readRamRecordWord(live + 4 * (1 + band))), [2, 4, 11, 33]);
			}
			for (const [i, key] of keys.entries()) assert.deepEqual(readHash(i), key, 'primitive key remains in place');
			assert.deepEqual(readHash(hash + keys.length - 1), [ValueTag.Closure, dead], 'range excludes boundary');
			clear(record, 2, keys.length - 1, keys.length, 0);
			assert.equal(memory.readRamRecordWord(live), 0);
			if (hash >= 1024) {
				assert.deepEqual(bands.map(band => memory.readRamRecordWord(live + 4 * (1 + band))), [2, 4, 11, 33]);
			}
			for (let i = 0; i < keys.length; ++i) assert.deepEqual(readHash(hash + i), [ValueTag.Nil, 0]);
			assert.equal(hash <= 128 ? memory.readRamRecordByte(linkBase) : memory.readRamRecordWord(linkBase), 3);
		}
	});

	test(`BLua weak clear restores between tombstone key payload and tag stores at O${optLevel}`, () => {
		const { cpu, memory, add, byte, word, table, grant, finish, beginClear, compare } = fixture(optLevel);
		const dead = add(target => createReferenceTable(target));
		byte(dead + GC_COLOR_OFFSET, 0xf1);
		const { record, hashBase, hashSlot, readHash } = table(0, 128);
		hashSlot(0, ValueTag.Table, dead);
		hashSlot(128, ValueTag.Integer, 5);
		const live = hashBase + 11 * 128;
		word(live, 1);
		assert.equal(beginClear(record, 1, 0, 1), 0);
		for (let i = 0; i < 1024 && readHash(0)[1] !== ValueTag.Table; ++i) grant(1);
		assert.ok(cpu.fixedInterruptActive());
		assert.deepEqual(readHash(0), [ValueTag.Table, ValueTag.Table], 'word precedes clearing tag');
		assert.deepEqual(readHash(128), [ValueTag.Integer, 5], 'dead-key value marker not yet published');
		assert.equal(memory.readRamRecordWord(live), 0, 'census decremented before either marker');
		const checkpoint = captureCpuCheckpoint(cpu);
		const finished = finish(1);
		assert.equal(finished[0], 0);
		assert.deepEqual(readHash(0), [ValueTag.Nil, ValueTag.Table]);
		assert.deepEqual(readHash(128), [ValueTag.DeadKey, dead]);
		compare('ordered tombstone');
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.deepEqual(readHash(0), [ValueTag.Table, ValueTag.Table]);
		assert.deepEqual(finish(1), finished);
		compare('replayed tombstone');
	});
}
