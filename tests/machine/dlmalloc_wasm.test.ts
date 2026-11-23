import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAPPED_PAGE_BYTE_SHIFT, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../machine/ts/spec/bmsx/memory_map';

test('Wasm allocator uses the installed RAM extent and the normal rewind watches', () => {
	const ramBytes = 0x50000 + 16;
	const floor = DYNAMIC_RAM_BASE - RAM_BASE;
	const limit = (ramBytes & -HEAP_PAGE_SIZE) - RUNTIME_MANAGEMENT_SIZE;
	const state = limit + 0x400;
	const init = { systemRom: new Uint8Array(0), cartridgeSlots: [null, null] as const };
	const source = new Memory(init, ramBytes);
	const watches = source.ramWriteWatches();
	assert.equal(source.ramData().byteLength, ramBytes);
	assert.equal(source.ramView.byteLength, ramBytes);
	assert.equal(source.ramWords.byteLength, ramBytes);
	assert.equal(source.ramFloats.byteLength, ramBytes);
	assert.equal(watches.groupData().length, (ramBytes + MAPPED_PAGE_BYTE_SIZE - 1) >>> MAPPED_PAGE_BYTE_SHIFT);

	source.setRamBusEnd(RAM_BASE + floor);
	const allocator = source.bindDlmalloc(state);
	allocator.reset(floor, limit);
	const history = new RamHistory();
	history.start(source);
	const before = history.capture(source, null);
	const offset = allocator.allocate(73, 1);
	assert.ok(offset >= floor && offset + 73 <= limit);
	assert.equal(allocator.isObject(offset), 1);
	const dirty = (address: number) => {
		const page = address >>> MAPPED_PAGE_BYTE_SHIFT;
		return watches.historyPageDirty(page, page + 1);
	};
	assert.equal(dirty(state), true, 'allocation state participates in rewind');
	assert.equal(dirty(offset), true, 'chunk header writes participate in rewind');
	assert.equal(dirty(0), false, 'unrelated public memory remains clean');
	const after = history.capture(source, before);
	history.restore(source, after, before);
	assert.equal(allocator.occupiedBytes(), 0);
	assert.equal(allocator.allocate(73, 1), offset);

	// The new instance receives only guest bytes, not their Wasm backing tail.
	const restored = new Memory(init, ramBytes);
	const second = restored.bindDlmalloc(state);
	restored.restoreSaveState(source.captureSaveState());
	assert.equal(second.floor(), floor);
	assert.equal(second.allocationBytes(offset), allocator.allocationBytes(offset));
	assert.equal(second.allocate(180, 0), allocator.allocate(180, 0));
	second.free(offset);
	assert.equal(allocator.isObject(offset), 1, 'instance storage is independent');
});
