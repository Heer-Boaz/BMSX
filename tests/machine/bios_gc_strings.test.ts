import { nativeHeapReference } from '../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HEAP_LOGICAL_OCCUPIED_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_NEXT_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_STRING_RECORD_KIND } from '../../machine/ts/spec/blua32/image_format';
import { CART_ROM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END } from '../helpers/firmware_heap_layout';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';

const STRINGS = 'kernel/gc_strings';
const PROBE = 'test/string_pool';
const probeSource = `module<const>
local strings<const> = require('${STRINGS}')
local sweeping<const> = function(metadata)
	if strings.sweeping(metadata) then return 1 end
	return 0
end
local sweep_buckets<const> = function(metadata, arena, occupied, cursor, count, next_base, allowance, done)
	local work, remaining, complete = strings.sweep_buckets(metadata, arena, occupied, cursor, count, next_base, allowance)
	if remaining ~= allowance - work or complete ~= (done ~= 0) then return -1 end
	return work
end
return { sweeping = sweeping, sweep_buckets = sweep_buckets }
`;
const modules = [
	...['kernel/dlmalloc', STRINGS].map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: PROBE, source: probeSource },
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
const BUCKETS = 0x00, CAPACITY = 0x04, EPOCH = 0x0c, SWEEP = 0x10;
const SWEEP_LINK = 0x30, SWEEP_LEFT = 0x34, REHASH_BASE = 0x38, REHASH_READY = 0x3c;
const RAM_BUCKET_REHASH = 0x80000000, RAM_BUCKET_SHRINK = 0x40000000;
const SWEEP_REHASH = 0x80000000, SWEEP_SHRINK = 0xc0000000;
const names = ['bios-string-collision-a', 'bios-string-collision-b', 'bios-string-collision-c', 'bios-string-collision-d'];

function fixture(optLevel: 0 | 3) {
	const leaves = [
		{ path: STRINGS, member: 'mark', arity: 2 },
		{ path: STRINGS, member: 'begin_reachability_epoch', arity: 1, result: false },
		{ path: STRINGS, member: 'begin_sweep', arity: 1, result: false },
		{ path: STRINGS, member: 'estimate_sweep_work', arity: 1 },
		{ path: STRINGS, member: 'rehash_step', arity: 5 },
		{ path: STRINGS, member: 'sweep_step', arity: 5 },
		{ path: PROBE, member: 'sweeping', arity: 1 },
		{ path: PROBE, member: 'sweep_buckets', arity: 8 },
	] as const;
	const linked = linkFirmwareProbe(optLevel, modules, leaves);
	const { cpu, memory } = createTestHeapServiceCpu(linked);
	const oracle = createTestHeapServiceCpu(linked).cpu;
	const management = cpu.heapAllocator.managementOffset();
	const metadata = management + HEAP_STRING_METADATA_OFFSET;
	const occupied = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
	const arena = management + 0x400;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const ids = names.map(name => {
		const id = nativeHeapReference(cpu).stringPool.intern(name);
		assert.equal(id, nativeHeapReference(oracle).stringPool.intern(name));
		return id;
	});
	const floor = memory.ramBusEnd() - RAM_BASE;
	const end = management + GC_WORKSPACE_END;
	const actual = memory.ramData().subarray(floor, end);
	const expected = oracle.memory.ramData().subarray(floor, end);

	function compare(start = 0, stop = actual.length) {
		if (Buffer.compare(actual.subarray(start, stop), expected.subarray(start, stop)) === 0) return;
		const offset = actual.subarray(start, stop).findIndex((byte, index) => byte !== expected[start + index]) + start;
		assert.equal(actual[offset], expected[offset], `private arena byte 0x${(floor + offset).toString(16)}`);
	}
	function word(field: number, value: number) {
		memory.writeRamRecordWord(metadata + field, value);
		oracle.memory.writeRamRecordWord(metadata + field, value);
	}
	function begin(name: typeof leaves[number]['member'], ...args: number[]) {
		issueFirmwareProbe(cpu, [metadata, ...args], leaves.findIndex(leaf => leaf.member === name));
	}
	function grant(cycles: number) {
		assert.ok(grantFirmwareProbe(cpu, cycles) > 0, 'retired BIOS instructions');
	}
	function finish() {
		for (let i = 0; i < 1024 && !cpu.isHaltedUntilIrq(); ++i) grant(512);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		return firmwareProbeResult(cpu);
	}
	function invoke(name: typeof leaves[number]['member'], result: number, ...args: number[]) {
		begin(name, ...args);
		assert.equal(finish(), result, name);
		compare();
	}
	compare();
	return { cpu, memory, oracle, ids, metadata, arena, occupied, floor, word, compare, begin, grant, finish, invoke };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua String reachability and sweep entry match the TS reference at O${optLevel}`, () => {
		const { memory, oracle, ids, metadata, word, invoke } = fixture(optLevel);
		const pool = nativeHeapReference(oracle).stringPool;
		const previous = memory.readRamRecordByte(ids[0] + 1) & 1;
		word(EPOCH, 0xa5c3d000 | previous);
		pool.beginReachabilityEpoch();
		invoke('begin_reachability_epoch', 0);
		assert.equal(memory.readRamRecordWord(metadata + EPOCH), (0xa5c3d000 | (previous ^ 1)) >>> 0);
		for (const [id, work] of [[ids[0], 1], [ids[0], 0], [ids[1], 1], [0x1000, 0],
			[CART_ROM_BASE + 0x200, 0], [(CART_ROM_BASE + 0x200 + 0x80000000) >>> 0, 0]]) {
			pool.markReachable(id);
			assert.equal(pool.takeMarkWork(), work);
			invoke('mark', work, id);
		}
		assert.equal(memory.readRamRecordByte(ids[0] + 1), previous ^ 1);
		assert.equal(memory.readRamRecordByte(ids[2] + 1), previous, 'an unmarked String stays in the previous epoch');
		word(SWEEP, 0);
		invoke('sweeping', 0);
		for (const ready of [0, 5, RAM_BUCKET_REHASH]) {
			word(REHASH_READY, ready);
			word(SWEEP_LINK, ids[1] + BLUA32_STRING_NEXT_OFFSET);
			word(SWEEP_LEFT, 12);
			pool.beginSweep();
			invoke('begin_sweep', 0);
			invoke('sweeping', +pool.sweeping());
			assert.equal(memory.readRamRecordWord(metadata + SWEEP), ready || 1);
		}
		for (const capacity of [16, 2048, RAM_BUCKET_REHASH | 32]) {
			word(CAPACITY, capacity);
			invoke('estimate_sweep_work', pool.estimateSweepWork());
		}
	});

	test(`BLua String directory rehash matches each reference quantum and resumes before publication at O${optLevel}`, () => {
		const { cpu, memory, oracle, ids, metadata, arena, word, compare, begin, grant, finish, invoke } = fixture(optLevel);
		const pool = nativeHeapReference(oracle).stringPool;
		const oldBase = memory.readRamRecordWord(metadata + BUCKETS), count = memory.readRamRecordWord(metadata + CAPACITY);
		assert.equal(count & RAM_BUCKET_REHASH, 0, 'fixture starts with a single published directory');
		const oldBytes = nativeHeapReference(oracle).heapAllocator.allocationBytes(oldBase);
		const nextBase = nativeHeapReference(oracle).heapAllocator.allocate(8 * count, true);
		assert.ok(nextBase > 0);
		assert.equal(nativeHeapReference(cpu).heapAllocator.allocate(8 * count, true), nextBase);
		for (const mem of [memory, oracle.memory]) mem.ramData().fill(0x6d, nextBase - RAM_BASE, nextBase - RAM_BASE + 8 * count);
		word(CAPACITY, count | RAM_BUCKET_REHASH);
		word(REHASH_BASE, nextBase);
		word(REHASH_READY, 0);

		function step(allowance: number) {
			invoke('rehash_step', pool['rehashStep'](count, nextBase, allowance), arena, count, nextBase, allowance);
		}
		step(0);
		let index = 0;
		while (index < count && memory.readRamRecordWord(oldBase + 4 * index) === 0) ++index;
		assert.ok(index < count);
		step(index + 1);
		const head = oldBase + 4 * index, record = memory.readRamRecordWord(head);
		const next = memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
		const hash = memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET);
		const bucket = nextBase + 4 * (hash & (2 * count - 1));
		assert.equal(memory.readRamRecordWord(bucket), 0, 'this first destination slot has been prepared');
		begin('rehash_step', arena, count, nextBase, 1);
		for (let i = 0; i < 256 && memory.readRamRecordWord(head) === record; ++i) grant(1);
		assert.equal(memory.readRamRecordWord(head), next, 'the old bucket has been unlinked');
		assert.equal(memory.readRamRecordWord(bucket), 0, 'the new bucket has not published the String yet');
		assert.ok(cpu.fixedInterruptActive());
		const partial = captureCpuCheckpoint(cpu);
		const firstWork = pool['rehashStep'](count, nextBase, 1);
		assert.equal(finish(), firstWork);
		compare();
		restoreCpuCheckpoint(cpu, partial);
		assert.equal(finish(), firstWork);
		compare();

		const occupied = oracle.heapAllocator.occupiedBytes();
		for (let i = 0; i < count * 4 && memory.readRamRecordWord(metadata + REHASH_BASE); ++i) step(i % 3 + 1);
		assert.equal(memory.readRamRecordWord(metadata + REHASH_BASE), 0);
		assert.equal(memory.readRamRecordWord(metadata + CAPACITY), count * 2);
		assert.equal(memory.readRamRecordWord(metadata + BUCKETS), nextBase);
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupied - oldBytes, 'the old directory storage is released');
		for (const [i, name] of names.entries()) assert.equal(cpu.stringPool.find(name), ids[i]);
	});

	test(`BLua sweeps retained and dead Strings and resumes between unlink and release at O${optLevel}`, () => {
		const { cpu, memory, oracle, ids, metadata, arena, occupied, floor, compare, begin, grant, finish, invoke } = fixture(optLevel);
		const pool = nativeHeapReference(oracle).stringPool;
		const base = memory.readRamRecordWord(metadata + BUCKETS);
		const count = memory.readRamRecordWord(metadata + CAPACITY);
		const bucketOf = (record: number) => memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET) & (count - 1);
		const dead = ids.reduce((earlier, id) => bucketOf(id) < bucketOf(earlier) ? id : earlier);
		assert.ok(bucketOf(dead) < count - 1, 'the dead String does not end the bucket subphase');
		const deadBytes = BLUA32_STRING_RECORD_HEADER_SIZE + pool.byteLength(dead);

		pool.beginReachabilityEpoch();
		invoke('begin_reachability_epoch', 0);
		for (let index = 0; index < count; ++index) {
			for (let record = memory.readRamRecordWord(base + 4 * index); record !== 0; record = memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET)) {
				if (record === dead) continue;
				pool.markReachable(record);
				invoke('mark', pool.takeMarkWork(), record);
			}
		}
		pool.beginSweep();
		invoke('begin_sweep', 0);

		let deadLink = base + 4 * bucketOf(dead);
		while (memory.readRamRecordWord(deadLink) !== dead) deadLink = memory.readRamRecordWord(deadLink) + BLUA32_STRING_NEXT_OFFSET;
		for (let quantum = 0; quantum < count * 4 && memory.readRamRecordWord(metadata + SWEEP_LINK) !== deadLink; ++quantum) {
			const cursor = memory.readRamRecordWord(metadata + SWEEP);
			invoke('sweep_buckets', pool.sweepStep(1), arena, occupied, cursor, count, 0, 1, 0);
		}
		assert.equal(memory.readRamRecordWord(metadata + SWEEP_LINK), deadLink);
		const charged = memory.readRamRecordWord(occupied);
		const next = memory.readRamRecordWord(dead + BLUA32_STRING_NEXT_OFFSET);
		begin('sweep_buckets', arena, occupied, memory.readRamRecordWord(metadata + SWEEP), count, 0, 1, 0);
		for (let i = 0; i < 256 && memory.readRamRecordWord(deadLink) === dead; ++i) grant(1);
		assert.equal(memory.readRamRecordWord(deadLink), next);
		assert.equal(memory.readRamRecordByte(dead), BLUA32_STRING_RECORD_KIND, 'retirement has not cleared the record kind');
		assert.equal(memory.readRamRecordWord(occupied), charged, 'no logical release has been admitted yet');
		const partial = captureCpuCheckpoint(cpu);
		const firstWork = pool.sweepStep(1);
		assert.equal(finish(), firstWork);
		compare();
		restoreCpuCheckpoint(cpu, partial);
		assert.equal(finish(), firstWork);
		compare();
		assert.equal(memory.readRamRecordByte(dead), 0);
		assert.equal(memory.readRamRecordWord(occupied), charged - deadBytes);

		const cursor = memory.readRamRecordWord(metadata + SWEEP), allowance = 4096;
		begin('sweep_buckets', arena, occupied, cursor, count, 0, allowance, 1);
		assert.equal(finish(), pool.sweepStep(allowance));
		// The reference goes on to end the cycle. The bucket kernel returns
		// its exact handoff instead, still leaving that one write to its caller.
		const sweep = metadata + SWEEP - floor;
		compare(0, sweep);
		compare(sweep + 4);
		assert.equal(memory.readRamRecordWord(metadata + SWEEP), cursor);
		assert.equal(oracle.memory.readRamRecordWord(metadata + SWEEP), 0);
		for (const [i, name] of names.entries()) assert.equal(cpu.stringPool.find(name), ids[i] === dead ? undefined : ids[i]);
	});

	test(`BLua sweeps both prepared prefixes without advancing the frozen rehash at O${optLevel}`, () => {
		const { cpu, memory, oracle, metadata, arena, occupied, word, invoke } = fixture(optLevel);
		const pool = nativeHeapReference(oracle).stringPool;
		const count = memory.readRamRecordWord(metadata + CAPACITY);
		const nextBase = nativeHeapReference(oracle).heapAllocator.allocate(8 * count, true);
		assert.ok(nextBase > 0);
		assert.equal(nativeHeapReference(cpu).heapAllocator.allocate(8 * count, true), nextBase);
		word(CAPACITY, count | RAM_BUCKET_REHASH);
		word(REHASH_BASE, nextBase);
		let low = 0, high = 0, ready = 0;
		for (let quantum = 0; quantum < 4 * count && ready < count - 1 && (low === 0 || high === 0); ++quantum) {
			invoke('rehash_step', pool['rehashStep'](count, nextBase, 1), arena, count, nextBase, 1);
			ready = memory.readRamRecordWord(metadata + REHASH_READY);
			if (ready === 0) continue;
			low ||= memory.readRamRecordWord(nextBase + 4 * (ready - 1));
			high ||= memory.readRamRecordWord(nextBase + 4 * (count + ready - 1));
		}
		assert.ok(ready > 0 && ready < count && low !== 0 && high !== 0, 'both frozen prefixes contain a String');
		const retired = [low, high].map(record => {
			const index = memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET) & (2 * count - 1);
			return { record, bucket: nextBase + 4 * index };
		});
		const previousEpoch = (memory.readRamRecordWord(metadata + EPOCH) & 1) ^ 1;
		for (const mem of [memory, oracle.memory]) {
			mem.writeRamRecordByte(low + 1, previousEpoch);
			mem.writeRamRecordByte(high + 1, previousEpoch);
		}
		const bytes = 2 * BLUA32_STRING_RECORD_HEADER_SIZE + pool.byteLength(low) + pool.byteLength(high);
		const charged = memory.readRamRecordWord(occupied);
		pool.beginSweep();
		invoke('begin_sweep', 0);

		for (let quantum = 0; quantum < 6 * count; ++quantum) {
			invoke('sweep_step', pool.sweepStep(1), arena, occupied, 1, 0);
			assert.equal(memory.readRamRecordWord(metadata + REHASH_READY), ready);
			if (memory.readRamRecordWord(metadata + SWEEP) === SWEEP_REHASH) break;
		}
		assert.equal(memory.readRamRecordWord(metadata + SWEEP), SWEEP_REHASH);
		assert.equal(memory.readRamRecordWord(metadata + REHASH_BASE), nextBase);
		assert.equal(memory.readRamRecordWord(metadata + REHASH_READY), ready);
		// Coalescing may reuse freed payload for free-list links. Check the
		// directories, not the underlying byte formerly used for record kind.
		for (const { record, bucket } of retired) {
			for (let id = memory.readRamRecordWord(bucket); id !== 0; id = memory.readRamRecordWord(id + BLUA32_STRING_NEXT_OFFSET)) {
				assert.notEqual(id, record);
			}
		}
		assert.equal(memory.readRamRecordWord(occupied), charged - bytes);
		invoke('sweep_step', pool.sweepStep(0), arena, occupied, 0, 0);
		assert.equal(memory.readRamRecordWord(metadata + SWEEP), SWEEP_REHASH);
		const allowance = 4 * count;
		invoke('sweep_step', pool.sweepStep(allowance), arena, occupied, allowance, 0);
		assert.equal(memory.readRamRecordWord(metadata + BUCKETS), nextBase);
		assert.equal(memory.readRamRecordWord(metadata + CAPACITY), 2 * count);
		assert.equal(memory.readRamRecordWord(metadata + SWEEP), 0);
	});

	test(`BLua republishes a contracted String directory, resumes a link move, and preserves the mirror boundary at O${optLevel}`, () => {
		const { cpu, memory, oracle, ids, metadata, arena, occupied, word, compare, begin, grant, finish, invoke } = fixture(optLevel);
		const pool = nativeHeapReference(oracle).stringPool;
		const oldBase = memory.readRamRecordWord(metadata + BUCKETS);
		const oldCount = memory.readRamRecordWord(metadata + CAPACITY);
		const count = 2048, half = count >>> 1;
		const base = nativeHeapReference(oracle).heapAllocator.allocate(4 * count, true);
		assert.ok(base > 0);
		assert.equal(nativeHeapReference(cpu).heapAllocator.allocate(4 * count, true), base);
		for (const mem of [memory, oracle.memory]) mem.ramData().fill(0, base - RAM_BASE, base - RAM_BASE + 4 * count);
		let records = 0, upperRecords = 0;
		for (let i = 0; i < oldCount; ++i) {
			let record = memory.readRamRecordWord(oldBase + 4 * i);
			while (record !== 0) {
				const link = record + BLUA32_STRING_NEXT_OFFSET, next = memory.readRamRecordWord(link);
				const index = memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET) & (count - 1);
				const target = base + 4 * index;
				for (const mem of [memory, oracle.memory]) {
					mem.writeRamRecordWord(link, mem.readRamRecordWord(target));
					mem.writeRamRecordWord(target, record);
				}
				++records;
				if (index >= half) ++upperRecords;
				record = next;
			}
		}
		assert.ok(records <= (count >>> 2) && upperRecords > 0, 'the enlarged directory is sparse and has upper links');
		word(BUCKETS, base);
		word(CAPACITY, count);
		nativeHeapReference(cpu).heapAllocator.free(oldBase);
		nativeHeapReference(oracle).heapAllocator.free(oldBase);
		const backingBytes = nativeHeapReference(cpu).heapAllocator.allocationBytes(base), charged = memory.readRamRecordWord(occupied);
		pool.beginSweep();
		invoke('begin_sweep', 0);
		function step(allowance: number, exact = 1) {
			invoke('sweep_step', pool.sweepStep(allowance), arena, occupied, allowance, exact);
		}
		step(count + records);
		assert.equal(memory.readRamRecordWord(metadata + SWEEP), SWEEP_SHRINK);
		assert.equal(memory.readRamRecordWord(metadata + CAPACITY), count | RAM_BUCKET_SHRINK);
		assert.equal(memory.readRamRecordWord(metadata + REHASH_READY), 0);
		let first = 0;
		while (memory.readRamRecordWord(base + 4 * (half + first)) === 0) ++first;
		step(first);
		assert.equal(memory.readRamRecordWord(metadata + REHASH_READY), first);

		const upper = base + 4 * (half + first), lower = base + 4 * first;
		const record = memory.readRamRecordWord(upper), next = memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
		const oldLower = memory.readRamRecordWord(lower);
		begin('sweep_step', arena, occupied, 1, 1);
		for (let i = 0; i < 256 && memory.readRamRecordWord(upper) === record; ++i) grant(1);
		assert.equal(memory.readRamRecordWord(upper), next, 'the upper bucket has unlinked');
		assert.equal(memory.readRamRecordWord(lower), oldLower, 'the lower bucket has not published');
		assert.ok(cpu.fixedInterruptActive());
		const partial = captureCpuCheckpoint(cpu);
		const work = pool.sweepStep(1);
		assert.equal(finish(), work);
		compare();
		restoreCpuCheckpoint(cpu, partial);
		assert.equal(finish(), work);
		compare();

		step(half + upperRecords - first - 1);
		assert.equal(memory.readRamRecordWord(metadata + REHASH_READY), half);
		assert.equal(memory.readRamRecordWord(metadata + SWEEP), SWEEP_SHRINK);
		assert.equal(nativeHeapReference(cpu).heapAllocator.allocationBytes(base), backingBytes, 'the exact work boundary still owns both halves');
		const atBoundary = captureCpuCheckpoint(cpu), oracleAtBoundary = captureCpuCheckpoint(oracle);
		step(1);
		assert.equal(memory.readRamRecordWord(metadata + SWEEP), 0);
		assert.equal(nativeHeapReference(cpu).heapAllocator.allocationBytes(base), backingBytes - 4 * half);

		restoreCpuCheckpoint(cpu, atBoundary);
		restoreCpuCheckpoint(oracle, oracleAtBoundary);
		word(REHASH_READY, half + 1);
		// The C++ reference leaves this raw state and allocation untouched.
		invoke('sweep_step', 0, arena, occupied, 1, 1);
		assert.equal(memory.readRamRecordWord(metadata + REHASH_READY), half + 1);
		assert.equal(nativeHeapReference(cpu).heapAllocator.allocationBytes(base), backingBytes);
		// The TS reference publishes even though the raw cursor overshot.
		step(1, 0);
		assert.equal(memory.readRamRecordWord(metadata + SWEEP), 0);
		assert.equal(memory.readRamRecordWord(metadata + CAPACITY), half);
		assert.equal(memory.readRamRecordWord(metadata + REHASH_READY), 0);
		assert.equal(memory.readRamRecordWord(occupied), charged);
		assert.equal(nativeHeapReference(cpu).heapAllocator.allocationBytes(base), backingBytes - 4 * half);
		for (const [i, name] of names.entries()) assert.equal(cpu.stringPool.find(name), ids[i], name);
	});
}
