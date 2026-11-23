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
