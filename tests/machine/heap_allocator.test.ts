import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HEAP_CLASS_BYTES, HeapAllocator, heapAllocationBytes } from '../../machine/ts/machine/cpu/heap_allocator';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';

const MANAGEMENT = RAM_BASE + PSX_MACHINE_SPEC.ramBytes - RUNTIME_MANAGEMENT_SIZE;
const FLOOR = RAM_BASE + 0x126000;

function allocator(): HeapAllocator {
	const heap = new HeapAllocator(new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes));
	heap.reset(FLOOR);
	return heap;
}

test('size classes round to 8 bytes through 64 and to quarter steps up to half a page', () => {
	assert.deepEqual([1, 8, 9, 64, 65, 80, 81, 128, 129, 2047, 2048].map(heapAllocationBytes),
		[8, 8, 16, 64, 80, 80, 96, 128, 160, 2048, 2048]);
	assert.equal(heapAllocationBytes(2049), HEAP_PAGE_SIZE);
	assert.equal(heapAllocationBytes(3 * HEAP_PAGE_SIZE + 1), 4 * HEAP_PAGE_SIZE);
	for (const size of HEAP_CLASS_BYTES) assert.equal(heapAllocationBytes(size), size);
});

test('allocations stay inside the heap extent, do not overlap and fill pages from the top', () => {
	const heap = allocator();
	assert.equal(heap.floorAddress(), FLOOR);
	assert.equal(heap.capacityBytes(), MANAGEMENT - FLOOR);
	const first = heap.allocate(20, false);
	assert.equal(first, MANAGEMENT - HEAP_PAGE_SIZE, 'the highest free page below the management area comes first');
	assert.equal(heap.allocate(20, false), first + 24, 'a page hands out its slots in address order');
	assert.equal(heap.allocate(20, true), MANAGEMENT - 2 * HEAP_PAGE_SIZE, 'owned blocks use their own pages');
	const extents: [number, number][] = [];
	let seed = 7;
	for (let i = 0; i < 4000; i += 1) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const bytes = 1 + (seed % 6000);
		const address = heap.allocate(bytes, (seed & 1) !== 0);
		if (address === 0) break;
		extents.push([address, address + heapAllocationBytes(bytes)]);
	}
	extents.sort((a, b) => a[0] - b[0]);
	for (let i = 0; i < extents.length; i += 1) {
		assert.ok(extents[i][0] >= FLOOR && extents[i][1] <= MANAGEMENT, 'allocation within [floor, management area)');
		if (i > 0) assert.ok(extents[i - 1][1] <= extents[i][0], 'allocations do not overlap');
	}
});

test('freed slots are reused last-in first-out and empty pages return to the pool', () => {
	const heap = allocator();
	const a = heap.allocate(40, false), b = heap.allocate(40, false), c = heap.allocate(40, false);
	assert.equal(heap.occupiedBytes(), 120);
	heap.free(b);
	heap.free(a);
	assert.equal(heap.occupiedBytes(), 40);
	assert.equal(heap.allocate(40, false), a);
	assert.equal(heap.allocate(40, false), b);
	heap.free(a); heap.free(b); heap.free(c);
	assert.equal(heap.occupiedBytes(), 0);
	assert.equal(heap.allocate(8, false), MANAGEMENT - HEAP_PAGE_SIZE, 'the released page is the highest free page again');
	const run = heap.allocate(3 * HEAP_PAGE_SIZE, true);
	assert.equal(run, MANAGEMENT - 4 * HEAP_PAGE_SIZE);
	assert.equal(heap.occupiedBytes(), 8 + 3 * HEAP_PAGE_SIZE);
	heap.free(run);
	assert.equal(heap.occupiedBytes(), 8);
});

test('the floor cannot rise over an allocated page and never drops below the static region', () => {
	const heap = allocator();
	assert.equal(heap.setFloor(MANAGEMENT - HEAP_PAGE_SIZE + 1), true, 'an empty heap accepts any floor');
	assert.equal(heap.capacityBytes(), 0);
	assert.equal(heap.allocate(8, false), 0, 'no page remains above that floor');
	assert.equal(heap.setFloor(FLOOR), true);
	const low = heap.allocate(64 * HEAP_PAGE_SIZE, false);
	assert.equal(heap.setFloor(low + HEAP_PAGE_SIZE), false, 'a live page below the new floor refuses the change');
	assert.equal(heap.floorAddress(), FLOOR);
	heap.free(low);
	assert.equal(heap.setFloor(low + HEAP_PAGE_SIZE), true);
	assert.equal(heap.setFloor(RAM_BASE), true);
	assert.equal(heap.floorAddress(), DYNAMIC_RAM_BASE, 'the heap never extends into the reserved region');
});

test('reclaiming a large run preserves neighboring pages and rewinds the entire range', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const heap = new HeapAllocator(memory);
	const bytes = 400 * HEAP_PAGE_SIZE;
	const high = heap.allocate(2 * HEAP_PAGE_SIZE, true);
	const run = heap.allocate(bytes, false);
	const low = heap.allocate(HEAP_PAGE_SIZE, true);
	assert.equal(run + bytes, high);
	assert.equal(low + HEAP_PAGE_SIZE, run);
	assert.equal(heap.setFloor(low), true);

	const archive = new RamHistory();
	archive.start(memory);
	const allocated = archive.capture(memory, null);
	heap.free(run);
	const releasedRam = memory.captureSaveState().ram;
	const freed = archive.capture(memory, allocated);
	archive.restore(memory, freed, allocated);
	assert.equal(heap.occupiedBytes(), bytes + 3 * HEAP_PAGE_SIZE);
	assert.equal(heap.allocate(HEAP_PAGE_SIZE, true), 0, 'rewind restores the run and both neighboring allocations');

	archive.restore(memory, allocated, freed);
	assert.deepEqual(memory.ramData(), releasedRam, 'forward history publishes the released head and all returned pages');
	assert.equal(heap.occupiedBytes(), 3 * HEAP_PAGE_SIZE);
	assert.equal(heap.allocate(bytes + HEAP_PAGE_SIZE, true), 0, 'reclamation preserves the neighbors in both partial bitmap words');
	assert.equal(heap.allocate(bytes, false), run, 'the same entire run is available again');
});

test('object sweep resumes from RAM, visits vacant issued slots and skips owned pages', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const heap = new HeapAllocator(memory);
	const first = heap.allocate(32, false), vacant = heap.allocate(32, false), last = heap.allocate(32, false);
	const owned = heap.allocate(HEAP_PAGE_SIZE * 2, true);
	const run = heap.allocate(HEAP_PAGE_SIZE * 3, false);
	for (const address of [first, vacant, last, owned, run])
		memory.writeRamRecordWord(address, 1); // independently visible nonzero record kind
	heap.free(vacant);

	const visits: number[] = [];
	const retire = (allocator: HeapAllocator, address: number) => {
		visits.push(address); allocator.free(address);
		return visits.length === 1 ? -5 : -1;
	};
	heap.beginObjectSweep();
	const beforeZero = memory.captureSaveState();
	assert.equal(heap.sweepObjects(0, heap, retire), 0);
	assert.deepEqual(visits, []);
	assert.deepEqual(memory.captureSaveState(), beforeZero, 'zero allowance does not advance the sweep');
	assert.equal(heap.sweepObjects(1, heap, retire), 5, 'the run contributes the charge of one visit');
	assert.deepEqual(visits, [run]);
	visits.length = 0;
	assert.equal(heap.sweepObjects(1, heap, retire), 5, 'the first slot can finish, but cannot start the hole or the next object');
	assert.deepEqual(visits, [first]);
	assert.ok(heap.objectSweepActive());
	const cursor = heap.managementOffset() + 8;
	assert.equal(memory.readRamRecordWord(cursor), (first - RAM_BASE) | 1, 'the cursor publishes the page and next slot ordinal');
	const midSweep = memory.captureSaveState();

	const records: number[] = [], inspect = (records: number[], address: number) => { records.push(address); return 1; };
	heap.visitObjectRecords(records, inspect);
	assert.deepEqual(records, [last]);
	assert.deepEqual(memory.captureSaveState(), midSweep, 'attachment discovery has no RAM writes');

	const archive = new RamHistory();
	archive.start(memory);
	const paused = archive.capture(memory, null);
	const complete = () => {
		assert.equal(heap.allocate(32, false), first, 'the swept prefix can immediately receive a new allocation');
		memory.writeRamRecordWord(first, 2);
		visits.length = 0;
		assert.equal(heap.sweepObjects(1, heap, retire), 1, 'the issued hole consumes its own visit');
		assert.deepEqual(visits, []);
		assert.ok(heap.objectSweepActive());
		assert.equal(heap.sweepObjects(1, heap, retire), 5);
		assert.deepEqual(visits, [last], 'the cursor never revisits the new allocation in the swept prefix');
		assert.equal(heap.occupiedBytes(), HEAP_PAGE_SIZE * 2 + 32);
		assert.equal(memory.readRamRecordWord(owned), 1);
		assert.equal(memory.readRamRecordWord(first), 2);
		assert.ok(!heap.objectSweepActive());
		assert.equal(memory.readRamRecordWord(cursor), heap.managementOffset(), 'the cursor reaches the page-limit sentinel');
	};
	complete();
	const completedRam = memory.captureSaveState().ram;
	const finished = archive.capture(memory, paused);
	archive.restore(memory, finished, paused);
	assert.deepEqual(memory.captureSaveState().ram, midSweep.ram, 'rewind restores the partial-page cursor and records');
	complete();
	assert.deepEqual(memory.captureSaveState().ram, completedRam, 'the resumed sweep reproduces all RAM');

	archive.restore(memory, finished, paused);
	heap.free(last);
	const larger = heap.allocate(64, false), largerNext = heap.allocate(64, false);
	assert.equal(larger, first);
	assert.equal(largerNext, larger + 64, 'a released page can be assigned a new size class');
	memory.writeRamRecordWord(larger, 3);
	memory.writeRamRecordWord(largerNext, 4);
	records.length = 0;
	assert.equal(heap.sweepObjects(1, records, inspect), 1);
	assert.deepEqual(records, [largerNext], 'the saved ordinal resumes against the new class stride');
	assert.ok(!heap.objectSweepActive());
});

test('sparse object sweep tracks page ownership across reclamation and restore', t => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const heap = new HeapAllocator(memory);
	const high = heap.allocate(32, false), highLast = heap.allocate(32, false);
	const ownedSlots = heap.allocate(40, true);
	const owned = heap.allocate(128 * HEAP_PAGE_SIZE, true);
	const gap = heap.allocate(HEAP_PAGE_SIZE, true);
	const low = heap.allocate(3 * HEAP_PAGE_SIZE, false);
	assert.equal(low + 3 * HEAP_PAGE_SIZE, gap);
	assert.equal(gap + HEAP_PAGE_SIZE, owned);
	assert.ok(heap.setFloor(low));
	for (const address of [low, low + HEAP_PAGE_SIZE, low + 2 * HEAP_PAGE_SIZE, gap, owned, ownedSlots, high, highLast])
		memory.writeRamRecordWord(address, 1);
	heap.free(gap);

	const records: number[] = [];
	const inspect = (addresses: number[], address: number) => { addresses.push(address); return 1; };
	heap.beginObjectSweep();
	assert.equal(heap.sweepObjects(1, records, inspect), 1);
	assert.deepEqual(records, [low], 'a multi-page object emits one visit');
	assert.ok(heap.objectSweepActive());
	const paused = memory.captureSaveState();

	// The bitmap is part of the saved sweep directory, not a host cache.
	const lowPage = (low - RAM_BASE) / HEAP_PAGE_SIZE;
	const highPage = (high - RAM_BASE) / HEAP_PAGE_SIZE;
	const lowWord = heap.managementOffset() + 0x280 + (lowPage >>> 5) * 4;
	const highWord = heap.managementOffset() + 0x280 + (highPage >>> 5) * 4;
	const highBit = (1 << (highPage & 31)) >>> 0;
	const pageEntries = heap.managementOffset() + 0x1000;
	const firstTail = pageEntries + (lowPage + 1) * 12;
	assert.equal(memory.readRamRecordWord(lowWord), (1 << (lowPage & 31)) >>> 0, 'the run only indexes its head');
	assert.equal(memory.readRamRecordWord(firstTail), 0, 'the run has no descriptors in its tail pages');
	assert.equal(memory.readRamRecordWord(firstTail + 12), 0);
	for (const object of [false, true]) {
		if (object) memory.restoreSaveState(paused);
		heap.free(highLast);
		assert.equal(memory.readRamRecordWord(highWord), highBit, 'releasing a single slot preserves the object page');
		heap.free(high);
		assert.equal(memory.readRamRecordWord(highWord), 0, 'releasing the last slot removes the object page');
		assert.equal(heap.allocate(HEAP_PAGE_SIZE, !object), high, 'the same page can become either run kind');
		memory.writeRamRecordWord(high, 2);

		records.length = 0;
		heap.visitObjectRecords(records, inspect);
		assert.deepEqual(records, object ? [low, high] : [low]);
		records.length = 0;
		const reads = t.mock.method(memory, 'readRamRecordWord');
		const work = heap.sweepObjects(1, records, inspect);
		reads.mock.restore();
		assert.equal(work, object ? 1 : 0);
		assert.deepEqual(records, object ? [high] : []);
		assert.ok(!heap.objectSweepActive());
		const descriptorReads = reads.mock.calls.map(call => call.arguments[0]).filter(address => address >= pageEntries);
		const highDescriptor = pageEntries + highPage * 12;
		assert.ok(descriptorReads.every(address => object && address >= highDescriptor && address < highDescriptor + 12),
			'resuming never reads page descriptors for gaps, run tails or owner backing');
	}
});

test('releasing a middle partial page preserves allocation order, including after RAM restore', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const heap = new HeapAllocator(memory);
	const slotBytes = HEAP_PAGE_SIZE >>> 1;
	const high = heap.allocate(slotBytes, true), highSpare = heap.allocate(slotBytes, true);
	const middle = heap.allocate(slotBytes, true), middleSpare = heap.allocate(slotBytes, true);
	const low = heap.allocate(slotBytes, true), lowSpare = heap.allocate(slotBytes, true);
	heap.free(highSpare);
	heap.free(middleSpare);
	heap.free(lowSpare);
	const checkpoint = memory.captureSaveState();

	for (let replay = 0; replay < 2; ++replay) {
		memory.restoreSaveState(checkpoint);
		heap.free(middle);
		assert.equal(heap.allocate(slotBytes, true), lowSpare, 'the partial-list head keeps priority');
		assert.equal(heap.allocate(slotBytes, true), highSpare, 'the next surviving partial page keeps priority');
		assert.equal(heap.allocate(slotBytes, true), middle, 'the released page is available to the page allocator');
		assert.equal(heap.allocate(slotBytes, true), middleSpare);
		heap.free(high);
		heap.free(low);
		heap.free(middle);
		heap.free(highSpare);
		assert.equal(heap.allocate(slotBytes, true), middle, 'removing the tail preserves the new head');
		assert.equal(heap.allocate(slotBytes, true), low, 'promoting the next page clears its former predecessor');
		assert.equal(heap.allocate(slotBytes, true), high, 'no empty page remains linked');
	}
});
