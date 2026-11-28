import { nativeHeapReference } from '../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashText } from '../../machine/ts/common/hash';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../machine/ts/machine/cpu/errors';
import { HEAP_LOGICAL_OCCUPIED_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { CPU_CAUSE_CODE_DATA_BUS_ERROR } from '../../machine/ts/spec/blua32/cop0';
import { BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE } from '../../machine/ts/spec/blua32/image_format';
import { BUS_FAULT_UNALIGNED_IO, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END } from '../helpers/firmware_heap_layout';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';
import { internStringSliceReference } from '../helpers/string_slice_reference';

const SLICE = 'kernel/string_slice', PROBE = 'test/slice_publication';
const probeSource = `module<const>
local strings<const> = require('kernel/gc_strings')
local records<const> = require('kernel/dlmalloc_record')
local slice<const> = require('${SLICE}')
local hash_slice<const> = function(source, first, length)
	local start<const>, head<const> = slice.slice_head(source, first, length)
	return (slice.hash_span(start, head, length))
end
local lookup_ram_slice<const> = function(metadata, source, first, length, hash)
	local start<const>, head<const> = slice.slice_head(source, first, length)
	return (slice.lookup_ram(metadata, start, head, length, hash, nil, nil, nil))
end
local publish<const> = function(metadata, arena, occupied, source, first, length, hash)
	local bytes<const> = 16 + length
	local offset<const> = records.bmsx_dlmalloc_reserve_record(arena, bytes, 0, 0, 0, bytes, 0, 0, occupied)
	if offset == 0 then return 0 end
	local start<const>, head<const> = slice.slice_head(source, first, length)
	local id<const> = slice.publish(metadata, 0x08000000 + offset, start, head, length, hash)
	return id
end
local retain<const> = function(metadata, source, first, length, hash)
	local id<const> = lookup_ram_slice(metadata, source, first, length, hash)
	if id ~= 0 then strings.mark(metadata, id) end
	return id
end
return { publish = publish, retain = retain, hash_slice = hash_slice, lookup_ram_slice = lookup_ram_slice }
`;
const buckets = 0, capacity = 4, used = 8, rehashBase = 56, rehashReady = 60;
const growFlag = 0x80000000, shrinkFlag = 0x40000000;

function fixture(optLevel: 0 | 3) {
	const leaves = [
		{ path: PROBE, member: 'publish', arity: 7 },
		{ path: PROBE, member: 'retain', arity: 5 },
		{ path: PROBE, member: 'hash_slice', arity: 3 },
		{ path: PROBE, member: 'lookup_ram_slice', arity: 5 },
		{ path: SLICE, member: 'prepare_existing_directory', arity: 2 },
	] as const;
	const linked = linkFirmwareProbe(optLevel, [{ path: PROBE, source: probeSource, chunk: parseLuaChunk(probeSource, PROBE) }], leaves);
	const { cpu, memory } = createTestHeapServiceCpu(linked);
	const oracle = createTestHeapServiceCpu(linked).cpu;
	const management = cpu.heapAllocator.managementOffset();
	const metadata = management + HEAP_STRING_METADATA_OFFSET, occupied = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
	const arena = management + 0x400, floor = memory.ramBusEnd() - RAM_BASE;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);

	function seed(text: string) {
		const id = nativeHeapReference(cpu).stringPool.intern(text);
		assert.equal(id, nativeHeapReference(oracle).stringPool.intern(text));
		return id;
	}
	function word(field: number, value: number) {
		for (const target of [memory, oracle.memory]) target.writeRamRecordWord(metadata + field, value);
	}
	function begin(name: typeof leaves[number]['member'], ...args: number[]) {
		issueFirmwareProbe(cpu, args, leaves.findIndex(leaf => leaf.member === name));
	}
	function grant(cycles: number) {
		assert.ok(grantFirmwareProbe(cpu, cycles) > 0);
	}
	function finish() {
		for (let i = 0; i < 256 && !cpu.isHaltedUntilIrq(); ++i) grant(1024);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		return firmwareProbeResult(cpu);
	}
	function invoke(name: typeof leaves[number]['member'], ...args: number[]) {
		begin(name, ...args);
		return finish();
	}
	function equalArena() {
		const stop = management + GC_WORKSPACE_END;
		const actual = memory.ramData().subarray(floor, stop), expected = oracle.memory.ramData().subarray(floor, stop);
		const delta = actual.findIndex((byte, offset) => byte !== expected[offset]);
		assert.equal(delta, -1, `first arena difference at offset ${(floor + delta).toString(16)}`);
	}
	return { cpu, memory, oracle, metadata, arena, occupied, word, seed, begin, grant, finish, invoke, equalArena };
}

for (const optLevel of [0, 3] as const) {
	test(`borrowed BLua String spans preserve hash, split grow/shrink lookup, and reuse at O${optLevel}`, () => {
		const { cpu, memory, oracle, metadata, word, seed, begin, invoke, equalArena } = fixture(optLevel);
		const countBefore = memory.readRamRecordWord(metadata + capacity);
		let text = 'firmware-borrowed\0\xfe-value', hash = hashText(text);
		while ((hash & countBefore) === 0 || (hash & (countBefore - 1)) === countBefore - 1) {
			text += 'x';
			hash = hashText(text);
		}
		const source = seed('||' + text + '||'), match = seed(text);
		assert.equal(invoke('hash_slice', source, 2, text.length), hash);

		const oldBase = memory.readRamRecordWord(metadata + buckets);
		const oldCount = memory.readRamRecordWord(metadata + capacity);
		assert.equal(oldCount, countBefore, 'the two seeds leave the original directory size');
		const index = hash & (oldCount - 1);
		const nextBase = nativeHeapReference(cpu).heapAllocator.allocate(8 * oldCount, true);
		assert.notEqual(nextBase, 0);
		assert.equal(nextBase, nativeHeapReference(oracle).heapAllocator.allocate(8 * oldCount, true));
		word(capacity, oldCount | growFlag);
		word(rehashBase, nextBase);
		for (const target of [memory, oracle.memory]) {
			// Only the prepared prefix is visible; at its final ordinal both chains remain valid.
			target.ramData().fill(0, nextBase - RAM_BASE, nextBase - RAM_BASE + 8 * oldCount);
		}
		word(rehashReady, index + 1);
		assert.equal(invoke('lookup_ram_slice', metadata, source, 2, text.length, hash), match, 'frontier probes its old bucket');
		const oldHead = oldBase + 4 * index;
		assert.equal(memory.readRamRecordWord(oldHead), match);
		const newHead = nextBase + 4 * (hash & (2 * oldCount - 1));
		for (const target of [memory, oracle.memory]) {
			target.writeRamRecordWord(oldHead, target.readRamRecordWord(match + 12));
			target.writeRamRecordWord(match + 12, target.readRamRecordWord(newHead));
			target.writeRamRecordWord(newHead, match);
		}
		word(rehashReady, index + 2);
		assert.equal(invoke('lookup_ram_slice', metadata, source, 2, text.length, hash), match, 'finished prefix probes its new bucket');

		word(capacity, oldCount * 2 | shrinkFlag);
		word(buckets, nextBase);
		word(rehashBase, 0);
		const lower = hash & (oldCount - 1);
		const upper = nextBase + 4 * (lower + oldCount);
		const lowerHead = nextBase + 4 * lower;
		for (const target of [memory, oracle.memory]) {
			target.writeRamRecordWord(lowerHead, 0);
			target.writeRamRecordWord(upper, match);
			target.writeRamRecordWord(match + 12, 0);
		}
		word(rehashReady, lower);
		const occupiedBefore = cpu.heapAllocator.occupiedBytes();
		nativeHeapReference(cpu).stringPool.beginReachabilityEpoch();
		nativeHeapReference(oracle).stringPool.beginReachabilityEpoch();
		assert.equal(internStringSliceReference(nativeHeapReference(oracle).stringPool, source, 2, text.length), match);
		assert.equal(invoke('retain', metadata, source, 2, text.length, hash), match, 'shrink frontier probes upper after lower');
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupiedBefore);
		equalArena();

		// Fabricated spans crossing the physical wrap cannot read RAM hidden
		// under MMIO. The ordinary vector uses the same mapped byte access.
		const wrapAt = RAM_BASE + MAIN_RAM_SIZE - 3;
		const before = memory.readBusFaultSequence();
		begin('hash_slice', wrapAt - BLUA32_STRING_RECORD_HEADER_SIZE, 0, text.length);
		for (let i = 0; i < 4096 && memory.readBusFaultSequence() === before; ++i) cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_DATA_BUS_ERROR);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), RAM_BASE + 1);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNALIGNED_IO);
	});

	test(`a BLua slice miss grows and uses the new directory; a partial record is rewindable at O${optLevel}`, () => {
		const { cpu, memory, oracle, metadata, arena, occupied, seed, begin, grant, finish, invoke, equalArena } = fixture(optLevel);
		const text = 'BLua borrowed result:\0\xfe and the original bytes';
		const source = seed('##' + text + '!!');
		const dir = memory.readRamRecordWord(metadata + buckets);
		const count = memory.readRamRecordWord(metadata + capacity);
		for (let i = 0; memory.readRamRecordWord(metadata + used) < count; ++i) seed('borrowed-growth-fill-' + i);
		assert.equal(memory.readRamRecordWord(metadata + used), count);
		assert.equal(memory.readRamRecordWord(metadata + capacity), count);
		const hash = hashText(text);
		assert.equal(invoke('lookup_ram_slice', metadata, source, 2, text.length, hash), 0);
		const expectedId = internStringSliceReference(nativeHeapReference(oracle).stringPool, source, 2, text.length);
		assert.equal(invoke('prepare_existing_directory', metadata, arena), 0);
		const destination = memory.readRamRecordWord(metadata + rehashBase);
		assert.notEqual(destination, 0, 'directory growth has reserved and published the next directory');
		assert.equal(destination, oracle.memory.readRamRecordWord(metadata + rehashBase));
		assert.equal(memory.readRamRecordWord(metadata + buckets), dir, 'bounded rehash still owns the old directory');
		assert.equal(memory.readRamRecordWord(metadata + capacity), (count | growFlag) >>> 0);
		assert.ok((hash & (count - 1)) < memory.readRamRecordWord(metadata + rehashReady), 'the result belongs to the prepared prefix');
		const bucket = destination + 4 * (hash & (2 * count - 1));
		const previousHead = memory.readRamRecordWord(bucket);
		const sourceBytes = cpu.stringPool.bytes(source);
		begin('publish', metadata, arena, occupied, source, 2, text.length, hash);
		for (let i = 0; i < 4096 && memory.readRamRecordWord(expectedId + BLUA32_STRING_HASH_OFFSET) !== hash; ++i) grant(1);
		assert.equal(memory.readRamRecordWord(expectedId + BLUA32_STRING_HASH_OFFSET), hash);
		assert.equal(memory.readRamRecordWord(bucket), previousHead, 'header store is not a published chain link');
		assert.ok(cpu.fixedInterruptActive());
		const checkpoint = captureCpuCheckpoint(cpu);
		assert.equal(finish(), expectedId);
		equalArena();
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(finish(), expectedId);
		equalArena();
		assert.equal(cpu.stringPool.bytes(expectedId), text);
		assert.equal(cpu.stringPool.bytes(source), sourceBytes);
	});

	test(`the reference retries a refused slice after reclaim while retaining its source at O${optLevel}`, () => {
		const { oracle } = fixture(optLevel);
		const text = 'string-borrowed-retry-result'.repeat(96);
		const source = nativeHeapReference(oracle).stringPool.intern('##' + text + '!!');
		const victimText = 'reclaimable backing for a borrowed String'.repeat(512);
		nativeHeapReference(oracle).stringPool.intern(victimText);
		for (let extent = MAIN_RAM_SIZE >> 1; extent >= 1024; extent >>= 1)
			while (nativeHeapReference(oracle).heapAllocator.allocate(extent, true) !== 0) { /* exhaust this size class */ }
		assert.equal(nativeHeapReference(oracle).heapAllocator.allocate(BLUA32_STRING_RECORD_HEADER_SIZE + text.length, true), 0);
		const before = oracle.stringPool.bytes(source);
		const white = nativeHeapReference(oracle).gc.white();
		const result = internStringSliceReference(nativeHeapReference(oracle).stringPool, source, 2, text.length);
		assert.equal(oracle.stringPool.find(victimText), undefined);
		assert.equal(nativeHeapReference(oracle).gc.white(), white ^ 1, 'exactly one fresh recovery epoch suffices');
		assert.equal(oracle.stringPool.bytes(result), text);
		assert.equal(oracle.stringPool.bytes(source), before);
	});

	test(`the reference reports borrowed-slice OOM without freeing the source or publishing a result at O${optLevel}`, () => {
		const { oracle } = fixture(optLevel);
		const text = 'string-borrowed-oom-result'.repeat(96);
		const source = nativeHeapReference(oracle).stringPool.intern('##' + text + '!!');
		// Raw backing does not belong to the GC object inventory. Keep it issued
		// through both real recovery epochs, leaving no run large enough for the result.
		for (let extent = MAIN_RAM_SIZE >> 1; extent >= 1024; extent >>= 1)
			while (nativeHeapReference(oracle).heapAllocator.allocate(extent, true) !== 0) { /* exhaust this size class */ }
		const before = oracle.stringPool.bytes(source);
		assert.throws(() => internStringSliceReference(nativeHeapReference(oracle).stringPool, source, 2, text.length), error => error === LUA_OUT_OF_MEMORY_SIGNAL);
		assert.equal(oracle.stringPool.bytes(source), before);
		assert.equal(oracle.stringPool.find(text), undefined);
	});
}
