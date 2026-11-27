import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GcPhase, GC_DIAGNOSTIC_OFFSET } from '../../machine/ts/machine/cpu/gc_heap';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { type Value, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, ValueTag } from '../../machine/ts/machine/cpu/value';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { GC_ROOT_BANKS_OFFSET } from '../helpers/firmware_heap_layout';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';

const MODULE = 'kernel/table_grow';
const ADAPTER = 'table_grow_result';
const adapter = `module<const>
	local grow<const> = require('${MODULE}')
	local invoke<const> = function(management, cycles, extra, mode)
		return grow.grow_table(management, cycles, extra, mode) and 1 or 0
	end
	return { invoke = invoke }`;
const links = new Map<number, ReturnType<typeof linkFirmwareProbe>>();

function fixture(optLevel: 0 | 3) {
	let linked = links.get(optLevel);
	if (linked === undefined) {
		linked = linkFirmwareProbe(optLevel, [{ path: ADAPTER, source: adapter, chunk: parseLuaChunk(adapter, ADAPTER) }],
			[{ path: ADAPTER, member: 'invoke', arity: 4 }]);
		links.set(optLevel, linked);
	}
	const { cpu, memory } = createTestHeapServiceCpu(linked);
	runGuestToHalt(cpu, 10_000);
	const heap = cpu.luaHeap, arena = cpu.heapAllocator, { gc } = cpu, { tables } = gc;
	const management = arena.managementOffset(), head = management + GC_DIAGNOSTIC_OFFSET;
	memory.writeRamRecordWord(management + GC_ROOT_BANKS_OFFSET, cpu.rootThread.address);
	const parked = () => memory.readRamRecordWord(head + 48);
	let scoped = false;
	function cloneNativeReference() {
		const reference = createTestHeapServiceCpu(linked!).cpu;
		restoreCpuCheckpoint(reference, captureCpuCheckpoint(cpu));
		return reference;
	}
	function begin(receiver: number, key: Value, value: Value, sourceCycles: number, extra = 0, mode = 0) {
		memory.writeRamRecordWord(head + 52, receiver);
		memory.writeRamRecordPair(head + 56, valueTag(key), valuePayload(key));
		memory.writeRamRecordPair(head + 64, valueTag(value), valuePayload(value));
		scoped = mode === 1;
		issueFirmwareProbe(cpu, [management, sourceCycles, extra, mode]);
	}
	function grant(cycles: number) {
		assert.ok(grantFirmwareProbe(cpu, cycles) > 0);
		if (scoped) assert.equal(parked(), 0, 'General recovery never publishes the parked assignment scope');
	}
	function finish(success = true) {
		for (let i = 0; !cpu.isHaltedUntilIrq() && i < 2048; ++i) grant(512);
		assert.equal(firmwareProbeResult(cpu), +success);
		assert.equal(parked(), 0);
	}
	return { cpu, memory, heap, arena, gc, tables, management, begin, grant, finish, parked, cloneNativeReference };
}

function pressure(f: ReturnType<typeof fixture>, bytes: number) {
	while (f.arena.allocate(4088, true)) { /* no untouched page can provide backing */ }
	while (f.arena.allocate(bytes, true)) { /* tails inside already acquired pages */ }
}

for (const opt of [0, 3] as const) {
	test(`BIOS Scheduled growth accounts scoped logical work and commits the own mapping at O${opt}`, () => {
		const f = fixture(opt);
		const receiver = f.cpu.createTable(0, 1);
		const keep = valueString(f.cpu.stringPool.intern('keep-before-bios-growth'));
		const key = valueString(f.cpu.stringPool.intern('grow-through-bios'));
		const value = valueTable(f.cpu.createTable(0, 0));
		f.tables.set(receiver, keep, valueInteger(5));
		const charge = f.heap.usedBytes();
		f.heap.setCollectionTarget(0);
		assert.equal(f.gc.phase(), GcPhase.Pause);
		f.begin(receiver, key, value, 6);
		f.finish();
		assert.equal(f.gc.phase(), GcPhase.Mark, 'a newly admitted logical debt started one incremental quantum');
		assert.equal(f.tables.hashSize(receiver), 2);
		assert.equal(f.heap.usedBytes(), charge + 10);
		assert.equal(f.tables.get(receiver, keep), valueInteger(5));
		assert.equal(f.tables.get(receiver, key), value);
	});

	test(`BIOS Scheduled preferred physical refusal retries zero extra without a parked recovery at O${opt}`, () => {
		const f = fixture(opt);
		const receiver = f.cpu.createTable(0, 1);
		const keep = valueString(f.cpu.stringPool.intern('preferred-refusal-existing'));
		const key = valueString(f.cpu.stringPool.intern('preferred-refusal-trigger'));
		f.tables.set(receiver, keep, valueInteger(5));
		f.heap.setCollectionTarget(f.heap.capacity());
		const largeBytes = TableRecords.hashStorageBytes(16);
		const spare = f.arena.allocate(48, true);
		assert.ok(spare);
		const guard = f.arena.allocate(32, true);
		assert.ok(guard);
		pressure(f, largeBytes);
		const smallBytes = TableRecords.hashStorageBytes(2);
		while (f.arena.allocate(smallBytes, true)) { /* only the known isolated spare permits zero extra */ }
		f.arena.free(spare);
		assert.equal(f.arena.allocate(largeBytes, true), 0);
		f.begin(receiver, key, valueInteger(61), 0, 9);
		f.finish();
		assert.equal(f.gc.phase(), GcPhase.Pause, 'preference fallback did not start recovery');
		assert.equal(f.tables.hashSize(receiver), 2);
		assert.equal(f.tables.get(receiver, keep), valueInteger(5));
		assert.equal(f.tables.get(receiver, key), valueInteger(61));
	});

	test(`BIOS Scheduled census holds its paid cursor and completes a staged backing transfer at O${opt}`, () => {
		const f = fixture(opt);
		const receiver = f.cpu.createTable(1024, 0);
		for (let key = 1; key <= 1024; ++key) f.tables.set(receiver, valueInteger(key), valueInteger(key + 3));
		const trigger = valueInteger(1025), before = f.heap.usedBytes();
		assert.ok(f.arena.allocate(64, true));
		f.heap.setCollectionTarget(f.heap.capacity());
		const cursor = f.management + 0x100;
		f.memory.writeRamRecordWord(cursor, 0);
		f.begin(receiver, trigger, valueInteger(17), 1);
		for (let i = 0; i < 1024 && f.memory.readRamRecordWord(cursor) === 0; ++i) f.grant(47);
		assert.ok(f.cpu.fixedInterruptActive());
		assert.ok(f.memory.readRamRecordWord(cursor) > 0 && f.memory.readRamRecordWord(cursor) < 1024);
		assert.equal(f.memory.readRamRecordWord(receiver + TableHeader.Array), 1024);
		const checkpoint = captureCpuCheckpoint(f.cpu);
		f.finish();
		const finished = captureCpuCheckpoint(f.cpu);
		restoreCpuCheckpoint(f.cpu, checkpoint);
		f.finish();
		assert.deepEqual(captureCpuCheckpoint(f.cpu).memory.ram, finished.memory.ram);
		assert.equal(f.tables.arrayCapacity(receiver), 2048);
		assert.equal(f.tables.get(receiver, valueInteger(1)), valueInteger(4));
		assert.equal(f.tables.get(receiver, valueInteger(1024)), valueInteger(1027));
		assert.equal(f.tables.get(receiver, trigger), valueInteger(17));
		assert.equal(f.heap.usedBytes(), before + 5 * 1024);
	});

	test(`one BIOS Scheduled activation performs Current then Fresh before successful retry at O${opt}`, () => {
		const f = fixture(opt);
		const receiver = f.cpu.createTable(0, 128);
		for (let key = -1; key >= -128; --key) f.tables.set(receiver, valueInteger(key), valueInteger(-key));
		const oldHash = f.tables.hashAddress(receiver);
		const float = f.cpu.createTable(0, 512);
		f.heap.setCollectionTarget(f.heap.capacity());
		f.gc.step(valueTable(float), valueNil(), valueNil(), 0, false, 1);
		assert.equal(f.gc.phase(), GcPhase.Mark);
		pressure(f, TableRecords.hashStorageBytes(256));
		const white = f.gc.white();
		const key = valueInteger(-129);
		f.begin(receiver, key, valueInteger(7), 0);
		for (let i = 0; i < 4096 && f.parked() === 0; ++i) f.grant(43);
		assert.ok(f.cpu.fixedInterruptActive());
		assert.equal(f.parked(), 1, 'the operand tuple becomes the actual parked root');
		assert.equal(f.tables.hashAddress(receiver), oldHash, 'refusal before recovery did not publish storage');
		const checkpoint = captureCpuCheckpoint(f.cpu);
		f.finish();
		assert.equal(f.gc.white(), white, 'Current retained floating garbage; Fresh reclaimed it');
		assert.equal(f.gc.tableRecordAddress(float), 0);
		assert.equal(f.tables.get(receiver, key), valueInteger(7));
		const expected = captureCpuCheckpoint(f.cpu).memory.ram;
		restoreCpuCheckpoint(f.cpu, checkpoint);
		f.finish();
		assert.deepEqual(captureCpuCheckpoint(f.cpu).memory.ram, expected);
	});

	test(`Scheduled recovery reuses a weak-cleared old home before making another reservation at O${opt}`, () => {
		const f = fixture(opt);
		const strings = f.cpu.stringPool;
		const receiver = f.cpu.createTable(0, 1), meta = f.cpu.createTable(0, 1);
		const victim = f.cpu.createTable(0, 0);
		const oldKey = valueString(strings.intern('weak-value-before-table-retry'));
		const trigger = valueString(strings.intern('weak-value-table-retry-trigger'));
		f.tables.set(meta, valueString(strings.intern('__mode')), valueString(strings.intern('v')));
		f.tables.setMetatableAddress(receiver, meta);
		f.tables.set(receiver, oldKey, valueTable(victim));
		f.heap.setCollectionTarget(f.heap.capacity());
		pressure(f, TableRecords.hashStorageBytes(2));
		const oldStorage = f.tables.hashAddress(receiver), white = f.gc.white();
		f.begin(receiver, trigger, valueInteger(12), 0);
		for (let i = 0; i < 1024 && f.parked() === 0; ++i) f.grant(43);
		assert.ok(f.cpu.fixedInterruptActive());
		assert.equal(f.parked(), 1, 'physical refusal opens a real parked recovery');
		assert.equal(f.tables.get(receiver, oldKey), valueTable(victim), 'weak processing has not yet cleared the old slot');
		f.finish();
		assert.equal(f.gc.white(), white ^ 1, 'one Fresh epoch is enough');
		assert.equal(f.gc.tableRecordAddress(victim), 0);
		assert.equal(f.tables.get(receiver, oldKey), valueNil());
		assert.equal(f.tables.get(receiver, trigger), valueInteger(12));
		assert.equal(f.tables.hashSize(receiver), 1);
		assert.equal(f.tables.hashAddress(receiver), oldStorage, 'Resume tries the old hash before planning again');
	});

	test(`General recovery traces detached Table operands and reuses a weak old home at O${opt}`, () => {
		const f = fixture(opt);
		const receiver = f.cpu.createTable(0, 1), meta = f.cpu.createTable(0, 1);
		const unrootedVictim = f.cpu.createTable(0, 0);
		const detachedKey = f.cpu.createTable(0, 0), detachedValue = f.cpu.createTable(0, 0);
		const strings = f.cpu.stringPool, key = valueTable(detachedKey), value = valueTable(detachedValue);
		const oldKey = valueString(strings.intern('general-weak-value-before-retry'));
		f.tables.set(meta, valueString(strings.intern('__mode')), valueString(strings.intern('v')));
		f.tables.setMetatableAddress(receiver, meta);
		f.tables.set(receiver, oldKey, valueTable(unrootedVictim));
		f.heap.setCollectionTarget(f.heap.capacity());
		pressure(f, TableRecords.hashStorageBytes(2));
		const white = f.gc.white(), backing = f.tables.hashAddress(receiver);
		const reference = f.cloneNativeReference();
		reference.gc.tables.set(receiver, key, value);

		// Nothing puts these three Table values in a register/bank/parked
		// head for the collector. They live only in the typed operand tuple.
		f.begin(receiver, key, value, 0, 0, 1);
		for (let i = 0; i < 4096 && f.gc.phase() === GcPhase.Pause; ++i) f.grant(19);
		assert.ok(f.cpu.fixedInterruptActive());
		assert.equal(f.gc.phase(), GcPhase.Mark);
		assert.equal(f.parked(), 0);
		const checkpoint = captureCpuCheckpoint(f.cpu);
		f.finish();
		assert.equal(f.gc.white(), white ^ 1);
		assert.equal(f.gc.tableRecordAddress(unrootedVictim), 0);
		assert.equal(f.gc.tableRecordAddress(detachedKey), detachedKey);
		assert.equal(f.gc.tableRecordAddress(detachedValue), detachedValue);
		assert.equal(f.tables.get(receiver, oldKey), valueNil());
		assert.equal(f.tables.get(receiver, key), value);
		assert.equal(f.tables.hashAddress(receiver), backing, 'General takes the old home, before any replan');
		assert.equal(f.tables.hashAddress(receiver), reference.gc.tables.hashAddress(receiver));
		assert.equal(f.arena.occupiedBytes(), reference.heapAllocator.occupiedBytes());
		assert.equal(f.heap.usedBytes(), reference.luaHeap.usedBytes());
		const expected = captureCpuCheckpoint(f.cpu).memory.ram;
		restoreCpuCheckpoint(f.cpu, checkpoint);
		f.finish();
		assert.deepEqual(captureCpuCheckpoint(f.cpu).memory.ram, expected);
	});

	test(`General restores no preferred hash slots after collecting a refused request at O${opt}`, () => {
		const f = fixture(opt);
		const receiver = f.cpu.createTable(0, 1), strings = f.cpu.stringPool;
		const keep = valueString(strings.intern('general-preferred-existing'));
		const key = valueString(strings.intern('general-preferred-trigger'));
		f.tables.set(receiver, keep, valueInteger(5));
		const garbage = f.cpu.createTable(0, 512);
		const old = f.tables.hashAddress(receiver);
		f.heap.setCollectionTarget(f.heap.capacity());
		pressure(f, TableRecords.hashStorageBytes(2));
		assert.equal(f.arena.allocate(TableRecords.hashStorageBytes(2), true), 0);
		const reference = f.cloneNativeReference();
		// The native General String store passes the preference to the
		// original allocation loop, then never restores it after recovery.
		reference.gc.tables.storeStringKey(receiver, valuePayload(key), ValueTag.Integer, 61, -2, 9);

		f.begin(receiver, key, valueInteger(61), 0, 9, 1);
		f.finish();
		assert.equal(f.gc.tableRecordAddress(garbage), 0);
		assert.notEqual(f.tables.hashAddress(receiver), old);
		assert.equal(f.tables.hashAddress(receiver), reference.gc.tables.hashAddress(receiver));
		assert.equal(f.tables.hashSize(receiver), 2, 'the previously refused extra=9 is not restored');
		assert.equal(f.tables.get(receiver, keep), valueInteger(5));
		assert.equal(f.tables.get(receiver, key), valueInteger(61));
		assert.equal(f.arena.occupiedBytes(), reference.heapAllocator.occupiedBytes());
	});

	test(`terminal Scheduled BIOS refusal leaves the original Table unchanged at O${opt}`, () => {
		const f = fixture(opt);
		const receiver = f.cpu.createTable(0, 128);
		for (let key = -1; key >= -128; --key) f.tables.set(receiver, valueInteger(key), valueInteger(-key));
		f.heap.setCollectionTarget(f.heap.capacity());
		pressure(f, TableRecords.hashStorageBytes(256));
		const old = f.tables.hashAddress(receiver), white = f.gc.white(), key = valueInteger(-129);
		f.begin(receiver, key, valueInteger(7), 0);
		f.finish(false);
		assert.equal(f.gc.white(), white ^ 1, 'a Pause refusal had exactly one attempt at Fresh');
		assert.equal(f.tables.hashAddress(receiver), old);
		assert.equal(f.tables.get(receiver, valueInteger(-128)), valueInteger(128));
		assert.equal(f.tables.get(receiver, key), valueNil());
	});
}
