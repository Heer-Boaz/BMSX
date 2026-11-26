import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_NEXT_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import {
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT,
} from '../../machine/ts/spec/bmsx/heap_service';
import { CART_ROM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const STRINGS = 'kernel/gc_strings';
const PROBE = 'test/string_pool';
const entrySource = 'halt_until_irq';
const probeSource = `module<const>
local strings<const> = require('${STRINGS}')
local sweeping<const> = function(metadata)
	if strings.sweeping(metadata) then return 1 end
	return 0
end
return { sweeping = sweeping }
`;
const modules = [
	...['kernel/dlmalloc', STRINGS].map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: PROBE, source: probeSource },
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
const BUCKETS = 0x00, CAPACITY = 0x04, EPOCH = 0x0c, SWEEP = 0x10;
const SWEEP_LINK = 0x30, SWEEP_LEFT = 0x34, REHASH_BASE = 0x38, REHASH_READY = 0x3c;
const RAM_BUCKET_REHASH = 0x80000000;
const names = ['bios-string-collision-a', 'bios-string-collision-b', 'bios-string-collision-c', 'bios-string-collision-d'];

function fixture(optLevel: 0 | 3) {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const object = encodeCompiledProgramObject(compiled);
	const linked = linkTestSystemBlua32(compiled);
	const entries = new Map<string, number>();
	for (const { path, exportPathKey, slotName } of object.sections.rodata.moduleExports) {
		if (path !== STRINGS && path !== PROBE || exportPathKey.startsWith('internal.')
			|| path === STRINGS && exportPathKey === 'sweeping') continue;
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
		assert.ok(index >= 0, exportPathKey);
		entries.set(exportPathKey, index);
	}
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [...entries.values()]);
	assert.ok(valueSlots <= HEAP_SERVICE_VALUE_COUNT && frames <= HEAP_SERVICE_FRAME_COUNT);
	const { cpu, memory } = createTestSystemCpu(linked);
	const oracle = createTestSystemCpu(linked).cpu;
	const management = cpu.heapAllocator.managementOffset();
	const metadata = management + HEAP_STRING_METADATA_OFFSET;
	const arena = management + 0x400;
	assert.equal(cpu.runUntilDepth(0, 1024), RunResult.Halted);
	assert.equal(oracle.runUntilDepth(0, 1024), RunResult.Halted);
	const ids = names.map(name => {
		const id = cpu.stringPool.intern(name);
		assert.equal(id, oracle.stringPool.intern(name));
		return id;
	});
	const floor = memory.ramBusEnd() - RAM_BASE;
	const end = management + HEAP_SERVICE_THREAD_OFFSET;
	const actual = memory.ramData().subarray(floor, end);
	const expected = oracle.memory.ramData().subarray(floor, end);

	function compare() {
		if (Buffer.compare(actual, expected) === 0) return;
		const index = actual.findIndex((byte, index) => byte !== expected[index]);
		assert.equal(actual[index], expected[index], `private arena byte 0x${(floor + index).toString(16)}`);
	}
	function word(field: number, value: number) {
		memory.writeRamRecordWord(metadata + field, value);
		oracle.memory.writeRamRecordWord(metadata + field, value);
	}
	function begin(name: string, ...args: number[]) {
		assert.ok(cpu.beginHeapService(linked.image.functions[entries.get(name)!].address, [metadata, ...args]));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.ok(cpu.instructionBudgetRemaining < cycles, 'retired BIOS instructions');
	}
	function finish() {
		for (let i = 0; i < 1024 && cpu.heapServiceActive(); ++i) grant(512);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		return cpu.heapServiceResult();
	}
	function invoke(name: string, result: number, ...args: number[]) {
		begin(name, ...args);
		assert.equal(finish(), result, name);
		compare();
	}
	compare();
	return { cpu, memory, oracle, ids, metadata, arena, word, compare, begin, grant, finish, invoke };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua String reachability and sweep entry match the TS reference at O${optLevel}`, () => {
		const { memory, oracle, ids, metadata, word, invoke } = fixture(optLevel);
		const pool = oracle.stringPool;
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
		const pool = oracle.stringPool;
		const oldBase = memory.readRamRecordWord(metadata + BUCKETS), count = memory.readRamRecordWord(metadata + CAPACITY);
		assert.equal(count & RAM_BUCKET_REHASH, 0, 'fixture starts with a single published directory');
		const oldBytes = oracle.heapAllocator.allocationBytes(oldBase);
		const nextBase = oracle.heapAllocator.allocate(8 * count, true);
		assert.ok(nextBase > 0);
		assert.equal(cpu.heapAllocator.allocate(8 * count, true), nextBase);
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
		assert.ok(cpu.heapServiceActive());
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
}
