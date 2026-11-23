import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HeapAllocator } from '../../machine/ts/machine/cpu/heap_allocator';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';

const MANAGEMENT = RAM_BASE + PSX_MACHINE_SPEC.ramBytes - RUNTIME_MANAGEMENT_SIZE;
const FLOOR = RAM_BASE + 0x126000;

function fixture() {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const heap = new HeapAllocator(memory);
	heap.reset(FLOOR);
	return { heap, memory };
}

test('aligned chunks fit the installed heap and account for live space without overlap', () => {
	const { heap, memory } = fixture();
	assert.equal(heap.floorAddress(), FLOOR);
	assert.equal(heap.capacityBytes(), MANAGEMENT - FLOOR);
	const chunks: Array<{ address: number; extent: number; requested: number; marker: number }> = [];
	let seed = 7, occupied = 0;
	for (let i = 0; i < 4000; ++i) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const requested = 1 + (seed % 6000), owned = (seed & 1) !== 0;
		const address = heap.allocate(requested, owned);
		if (address === 0) break;
		const extent = heap.allocationBytes(address), marker = i & 0xff;
		assert.equal(address & 7, 0);
		assert.equal(heap.issuedObjectStart(address - RAM_BASE), !owned);
		assert.ok(address >= FLOOR && address + requested <= MANAGEMENT);
		assert.ok(extent >= requested);
		memory.writeRamRecordByte(address + requested - 1, marker);
		occupied += extent;
		chunks.push({ address, extent, requested, marker });
	}
	assert.ok(chunks.length > 500);
	assert.equal(heap.occupiedBytes(), occupied);
	chunks.sort((a, b) => a.address - b.address);
	for (let i = 0; i < chunks.length; ++i) {
		const { address, extent, requested, marker } = chunks[i];
		if (i + 1 < chunks.length) assert.ok(address + extent <= chunks[i + 1].address, 'chunk extents do not overlap');
		assert.equal(memory.readRamRecordByte(address + requested - 1), marker);
	}
	for (const { address } of chunks) heap.free(address);
	assert.equal(heap.occupiedBytes(), 0);
});

test('adjacent returned chunks coalesce even when the floor cannot supply more RAM', () => {
	const { heap, memory } = fixture();
	assert.equal(heap.setFloor(MANAGEMENT - HEAP_PAGE_SIZE), true);
	const left = heap.allocate(1152, true), middle = heap.allocate(1152, false), neighbor = heap.allocate(1152, true);
	for (const address of [left, middle, neighbor]) assert.notEqual(address, 0);
	memory.writeRamRecordWord(neighbor + 1148, 0x531c249a);
	const neighborBytes = heap.allocationBytes(neighbor);
	assert.equal(heap.allocate(1700, true), 0);
	heap.free(left);
	assert.equal(heap.allocate(1700, true), 0, 'either returned chunk alone is too small');
	heap.free(middle);
	const combined = heap.allocate(1700, true);
	assert.notEqual(combined, 0, 'the adjacent chunks now admit a larger request');
	assert.equal(memory.readRamRecordWord(neighbor + 1148), 0x531c249a);
	assert.equal(heap.occupiedBytes(), neighborBytes + heap.allocationBytes(combined));
	heap.free(neighbor);
	heap.free(combined);
	assert.equal(heap.occupiedBytes(), 0);
});

test('the floor cannot cover live chunks and never drops below the static region', () => {
	const { heap, memory } = fixture();
	assert.equal(heap.setFloor(MANAGEMENT - HEAP_PAGE_SIZE + 1), true, 'an empty heap accepts the rounded floor');
	assert.equal(heap.capacityBytes(), 0);
	assert.equal(heap.allocate(8, false), 0);
	assert.equal(heap.setFloor(FLOOR), true);
	const low = heap.allocate(64 * HEAP_PAGE_SIZE, false);
	assert.notEqual(low, 0);
	memory.writeRamRecordWord(low, 0x92123456);
	const target = low + HEAP_PAGE_SIZE;
	assert.equal(heap.setFloor(target), false, 'the change would cover part of a live chunk');
	assert.equal(heap.floorAddress(), FLOOR);
	assert.equal(memory.readRamRecordWord(low), 0x92123456);
	heap.free(low);
	assert.equal(heap.setFloor(target), true);
	assert.equal(heap.floorAddress(), (target + HEAP_PAGE_SIZE - 1) & -HEAP_PAGE_SIZE);
	assert.equal(heap.setFloor(RAM_BASE), true);
	assert.equal(heap.floorAddress(), DYNAMIC_RAM_BASE);
});

test('free-list links and neighboring payloads survive the normal sparse history restore', () => {
	const { heap, memory } = fixture();
	const first = heap.allocate(700, true), body = heap.allocate(64 * HEAP_PAGE_SIZE, false), last = heap.allocate(800, true);
	for (const address of [first, body, last]) assert.notEqual(address, 0);
	memory.writeRamRecordWord(first + 696, 0x12123456);
	memory.writeRamRecordWord(body + 4, 0x89234567);
	memory.writeRamRecordWord(last, 0x76543210);
	const bodyExtent = heap.allocationBytes(body), occupied = heap.occupiedBytes();
	const archive = new RamHistory();
	archive.start(memory);
	const before = archive.capture(memory, null);
	heap.free(body);
	const releasedRam = memory.captureSaveState().ram;
	const freed = archive.capture(memory, before);
	archive.restore(memory, freed, before);
	assert.equal(heap.occupiedBytes(), occupied);
	assert.equal(memory.readRamRecordWord(body + 4), 0x89234567);
	assert.equal(heap.issuedObjectStart(body - RAM_BASE), true);
	archive.restore(memory, before, freed);
	assert.equal(Buffer.compare(memory.ramData(), releasedRam), 0, 'forward history recreates allocator data in the guest bytes');
	assert.equal(heap.occupiedBytes(), occupied - bodyExtent);
	assert.equal(memory.readRamRecordWord(first + 696), 0x12123456);
	assert.equal(memory.readRamRecordWord(last), 0x76543210);
	const replacement = heap.allocate(64 * HEAP_PAGE_SIZE, false);
	assert.notEqual(replacement, 0);
	archive.restore(memory, freed, freed);
	assert.equal(heap.allocate(64 * HEAP_PAGE_SIZE, false), replacement, 'repeating a branch makes the same allocation');
});

test('shrinking backing releases its suffix without moving or erasing the retained payload', () => {
	const { heap, memory } = fixture();
	const retained = 4096, whole = 3 * retained, payload = heap.allocate(whole, true);
	assert.notEqual(payload, 0);
	memory.writeRamRecordWord(payload, 8);
	memory.writeRamRecordWord(payload + retained - 4, 9);
	const bytes = heap.allocationBytes(payload), checkpoint = memory.captureSaveState();
	for (let attempt = 0; attempt < 2; ++attempt) {
		heap.shrinkBacking(payload, retained);
		const reduced = heap.allocationBytes(payload);
		assert.ok(reduced >= retained && reduced < bytes);
		assert.equal(heap.occupiedBytes(), reduced);
		assert.equal(memory.readRamRecordWord(payload), 8);
		assert.equal(memory.readRamRecordWord(payload + retained - 4), 9);
		memory.restoreSaveState(checkpoint);
		assert.equal(heap.allocationBytes(payload), bytes);
		assert.equal(heap.occupiedBytes(), bytes);
	}
});
