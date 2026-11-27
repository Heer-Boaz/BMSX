import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END } from '../helpers/firmware_heap_layout';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';

const MODULE = 'kernel/table_create';
const OBJECT_HEAD = 0x6c, OBJECT_COUNT = 0x70, SWEEP_LINK = 0x74;
const modules = ['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', MODULE].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});

function fixture(optLevel: 0 | 3) {
	const linked = linkFirmwareProbe(optLevel, modules, [{path: MODULE, member: 'create_table', arity: 8}]);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const first = memory.ramBusEnd() - RAM_BASE, last = management + GC_WORKSPACE_END;
	function compare() {
		const left = memory.ramData().subarray(first, last), right = oracle.memory.ramData().subarray(first, last);
		if (Buffer.compare(left, right) === 0) return;
		const index = left.findIndex((value, index) => value !== right[index]);
		assert.equal(left[index], right[index], `private RAM differs at 0x${(first + index).toString(16)}`);
	}
	function begin(array: number, hash: number) {
		const charged = TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(array, hash);
		issueFirmwareProbe(cpu, [
			cpu.heapAllocator.allocatorStateOffset(), control, cpu.luaHeap.occupiedOffset,
			array, hash, array * 5, TableRecords.hashStorageBytes(hash), charged,
		]);
	}
	function grant(cycles: number) {
		const spent = grantFirmwareProbe(cpu, cycles);
		assert.ok(spent > 0);
		return spent;
	}
	function finish() {
		let spent = 0;
		for (let i = 0; i < 128 && !cpu.isHaltedUntilIrq(); ++i) spent += grant(2048);
		return spent;
	}
	return { cpu, oracle, control, memory, begin, grant, finish, compare };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua table creation initializes all fresh backing layouts and publishes the same object at O${optLevel}`, () => {
		const { cpu, oracle, control, memory, begin, finish, compare } = fixture(optLevel);
		for (const [index, [array, requested]] of [[0, 0], [1, 1], [3, 2], [5, 64], [8, 65], [9, 129], [11, 513], [7, 1024]].entries()) {
			const hash = TableRecords.hashCapacity(requested);
			const previous = memory.readRamRecordWord(control + OBJECT_HEAD), oldCount = memory.readRamRecordWord(control + OBJECT_COUNT);
			const sweep = index % 2 === 0 ? control + OBJECT_HEAD : previous - GC_OBJECT_LINK_BEFORE;
			for (const mem of [memory, oracle.memory]) {
				mem.writeRamRecordWord(control + SWEEP_LINK, sweep);
				mem.writeRamRecordByte(control + 1, 0xa0 | (index & 1));
			}
			const address = oracle.createTable(array, requested);
			begin(array, hash);
			finish();
			assert.equal(firmwareProbeResult(cpu), address - RAM_BASE);
			assert.equal(memory.readRamRecordWord(address + TableHeader.Kind), ValueTag.Table | ((index & 1) << 8) | (1 << 16));
			assert.equal(memory.readRamRecordWord(address + TableHeader.Free), (hash - 1) >>> 0);
			assert.equal(memory.readRamRecordWord(control + OBJECT_HEAD), address);
			assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), oldCount + 1);
			assert.equal(memory.readRamRecordWord(address - GC_OBJECT_LINK_BEFORE), previous);
			assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), index % 2 === 0 ? address - GC_OBJECT_LINK_BEFORE : sweep);
			compare();
		}
	});

	test(`BLua table creation resumes in the Array and Hash writes before publishing inventory at O${optLevel}`, () => {
		const { cpu, oracle, control, memory, begin, grant, finish, compare } = fixture(optLevel);
		const array = 33, hash = 256, hashBytes = TableRecords.hashStorageBytes(hash);
		const previous = memory.readRamRecordWord(control + OBJECT_HEAD), count = memory.readRamRecordWord(control + OBJECT_COUNT);
		const address = oracle.createTable(array, hash);
		const value = oracle.memory.readRamRecordWord(address + TableHeader.ArrayStorage) + 8;
		const link = oracle.memory.readRamRecordWord(address + TableHeader.HashStorage) + hash * 10;
		// The native oracle computed the chosen payload addresses. Seed just
		// the two adjacent pairs observed by this test, not allocator links.
		for (const field of [value, value + 4, link, link + 4])
			memory.writeRamRecordWord(field, 0x9d9d9d9d);
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		begin(array, hash);
		function partial(field: number, word: number) {
			const next = memory.readRamRecordWord(field + 4);
			assert.notEqual(memory.readRamRecordWord(field), word);
			assert.notEqual(next, word);
			for (let i = 0; i < 32768 && memory.readRamRecordWord(field) !== word; ++i) grant(1);
			assert.ok(!cpu.isHaltedUntilIrq(), 'the raw store retired before the pinned firmware return');
			assert.equal(memory.readRamRecordWord(field), word);
			assert.equal(memory.readRamRecordWord(field + 4), next, 'the next word is still stale');
			assert.equal(memory.readRamRecordWord(control + OBJECT_HEAD), previous);
			assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), count);
			return captureCpuCheckpoint(cpu);
		}
		const values = partial(value, 0);
		const links = partial(link, 0xffffffff);
		const partialRam = history.capture(memory, baseline);
		let toPublication = 0;
		for (let i = 0; i < 32768 && memory.readRamRecordWord(control + OBJECT_HEAD) === previous; ++i) toPublication += grant(1);
		assert.ok(!cpu.isHaltedUntilIrq());
		assert.equal(memory.readRamRecordWord(control + OBJECT_HEAD), address);
		assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), count, 'the result is stopped between the ordered inventory stores');
		const lastHash = oracle.memory.readRamRecordWord(address + TableHeader.HashStorage) + hashBytes - 4;
		assert.equal(memory.readRamRecordWord(lastHash), 0, 'even the last census word precedes inventory');
		const publication = captureCpuCheckpoint(cpu);
		const afterPublication = finish();
		const spent = toPublication + afterPublication;
		assert.equal(firmwareProbeResult(cpu), address - RAM_BASE);
		compare();
		const completed = history.capture(memory, partialRam);
		history.restore(memory, completed, partialRam);
		cpu.restoreRuntimeState(links.cpu);
		assert.equal(finish(), spent);
		compare();
		restoreCpuCheckpoint(cpu, publication);
		assert.equal(finish(), afterPublication);
		assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), count + 1);
		compare();
		restoreCpuCheckpoint(cpu, values);
		assert.ok(finish() > spent);
		assert.equal(firmwareProbeResult(cpu), address - RAM_BASE);
		compare();
	});

	test(`BLua table creation refusal performs only the legacy reservation cleanup at O${optLevel}`, () => {
		const { cpu, oracle, control, memory, begin, finish, compare } = fixture(optLevel);
		const arena = cpu.heapAllocator;
		const record = arena.allocate(TableRecords.HEADER_BYTES + GC_OBJECT_PREFIX, true);
		assert.ok(record && arena.allocate(32, true));
		const array = arena.allocate(5, true);
		assert.ok(array && arena.allocate(32, true));
		while (arena.allocate(4088, true)) { /* leave isolated backing slots */ }
		while (arena.allocate(TableRecords.hashStorageBytes(8), true)) { /* exhaust the hash fit */ }
		arena.free(array);
		arena.free(record);
		restoreCpuCheckpoint(oracle, captureCpuCheckpoint(cpu));
		const occupied = arena.occupiedBytes(), charged = cpu.luaHeap.usedBytes();
		const head = memory.readRamRecordWord(control + OBJECT_HEAD), count = memory.readRamRecordWord(control + OBJECT_COUNT);
		assert.equal(oracle.luaHeap['reserveRecord'](TableRecords.HEADER_BYTES, true, 5, TableHeader.ArrayStorage,
			TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(1, 8), TableRecords.hashStorageBytes(8), TableHeader.HashStorage), 0);
		begin(1, 8);
		finish();
		assert.equal(firmwareProbeResult(cpu), 0);
		assert.equal(arena.occupiedBytes(), occupied);
		assert.equal(cpu.luaHeap.usedBytes(), charged);
		assert.equal(memory.readRamRecordWord(control + OBJECT_HEAD), head);
		assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), count);
		compare();
	});
}
