import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { MAPPED_BUS_MASTER_DMA } from '../../machine/ts/machine/memory/bus_signals';
import { MAPPED_PAGE_BYTE_SHIFT, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { DYNAMIC_RAM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';

test('rewind shares clean pages, tracks DMA and mirrors, and branches from the installed version', () => {
	const memory = new Memory({ systemRom: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	let codeWrites = 0;
	memory.attachMappedPageInvalidator({
		invalidateMappedWords: () => { ++codeWrites; },
		invalidateMappedRange: () => {},
	});
	const watches = memory.ramWriteWatches(), archive = new RamHistory();
	archive.start(memory);
	const first = archive.capture(memory, null);
	memory.clearMappedPageWriteWatches();
	const code = DYNAMIC_RAM_BASE - RAM_BASE + 0x80;
	const dma = DYNAMIC_RAM_BASE - RAM_BASE + 0x3ffc;
	const mirror = DYNAMIC_RAM_BASE - RAM_BASE + 0x71f0;
	assert.equal(watches.anyWatched(code, 4), false, 'history does not act as a code watch');
	watches.armCodeRange(code, 8);
	memory.writeU32(RAM_BASE + code + 8, 7);
	assert.equal(codeWrites, 0);
	memory.ramView.setUint32(code, 1, true);
	memory.invalidateRamWrite(code, 4);
	assert.equal(codeWrites, 1);
	assert.equal(watches.anyWatched(code, 4), false);
	assert.equal(watches.anyWatched(code + 4, 4), true, 'publication leaves the adjacent code word watched');
	memory.writeRamRecordByte(MAIN_RAM_SIZE + code, 1);
	memory.writeU32(RAM_BASE + code + 4, 2);
	assert.equal(codeWrites, 2);
	assert.equal(watches.anyWatched(code, 8), false, 'history admission survives after both code watches are consumed');
	memory.transferDmaBlock(0, RAM_BASE + dma, 2, 4, 4, MAPPED_BUS_MASTER_DMA, MAPPED_BUS_MASTER_DMA);
	memory.writeRamRecordByte(MAIN_RAM_SIZE + mirror, 9);
	const second = archive.capture(memory, first);
	const changed = new Set([code, dma, dma + 4, mirror].map(offset => offset >>> 12));
	for (let index = 0; index < first.length; ++index)
		assert.equal(first[index] !== second[index], changed.has(index), `checkpoint page ${index}`);
	archive.restore(memory, second, first);
	assert.deepEqual([memory.readRamRecordWord(dma), memory.readRamRecordWord(dma + 4), memory.readRamRecordByte(mirror)], [0, 0, 0]);
	memory.writeRamRecordWord(code, 3);
	const branch = archive.capture(memory, first);
	assert.equal(branch[dma >>> 12], first[dma >>> 12]);
	archive.restore(memory, branch, second);
	assert.deepEqual([memory.readRamRecordWord(code), memory.readRamRecordWord(dma), memory.readRamRecordWord(dma + 4),
		memory.readRamRecordByte(mirror)], [1, 0x04030201, 0x08070605, 9]);
	memory.writeRamRecordWord(code, 4);
	archive.capture(memory, second, second);
	archive.restore(memory, second, branch);
	assert.equal(memory.readRamRecordWord(code), 3);
	archive.restore(memory, branch, second);
	assert.equal(memory.readRamRecordWord(code), 4);
	watches.disarmHistoryWrites();
	assert.equal(watches.groupData()[code >>> MAPPED_PAGE_BYTE_SHIFT], 0);
});

test('a split register write dirties only its two planes and retires exact public aliases', () => {
	const memory = new Memory({ systemRom: Uint8Array.of(1, 2, 3, 4), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const invalidated: number[] = [];
	memory.attachMappedPageInvalidator({
		invalidateMappedWords: (key, first) => { invalidated.push(key + first * 4); },
		invalidateMappedRange: () => {},
	});
	const page = MAPPED_PAGE_BYTE_SIZE, boundary = MAIN_RAM_SIZE - 8 * page, slots = 2 * page / 4;
	memory.setRamBusEnd(RAM_BASE + boundary);
	const watches = memory.ramWriteWatches();
	const dirty = (offset: number) => watches.historyPageDirty(offset >>> MAPPED_PAGE_BYTE_SHIFT, (offset >>> MAPPED_PAGE_BYTE_SHIFT) + 1);
	const registers = new ValueSlots(0);
	const publicWord = boundary - page;
	watches.armCodeRange(publicWord, 8);
	watches.armHistoryWrites();
	registers.bindRam(memory, publicWord, slots);
	registers.setInteger(0, 73);
	assert.deepEqual(invalidated, [RAM_BASE + publicWord]);
	assert.equal(watches.anyWatched(publicWord + 4, 4), true, 'the neighboring code word stays watched');
	assert.equal(dirty(publicWord), true);
	assert.equal(dirty(boundary + page), true, 'the private tag plane is also tracked');
	assert.equal(dirty(boundary), false, 'the gap between the planes stays clean');

	watches.armHistoryWrites();
	registers.bindRam(memory, boundary, slots);
	registers.setFloatBits(0, 0x80000000);
	assert.equal(memory.readRamRecordWord(boundary), 0x80000000);
	assert.equal(dirty(boundary), true);
	assert.equal(dirty(boundary + page), false, 'the private fast path must not publish a covering span');
	assert.equal(dirty(boundary + 2 * page), true);
	assert.deepEqual(invalidated, [RAM_BASE + publicWord], 'private values do not invalidate decoded code');
});
