import { resetAllocatorReference } from '../helpers/heap_allocator_reference';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { LuaHeap } from '../../machine/ts/machine/cpu/lua_heap';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET, BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { DYNAMIC_RAM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { readLE32 } from '../../machine/ts/common/endian';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';

const path = 'kernel/heap_bootstrap', romString = 'BMSX cold heap ROM directory probe';
const entrySource = `halt_until_irq
return '${romString}'`;
const source = readFileSync('machine/bios/' + path + '.lua', 'utf8');
const module = { path, source, chunk: parseLuaChunk(source, path) };
const arenaStateBytes = 24 + 33 * 8 + 32 * 4 + 16; // shared C state, including control terminator
const firstSmallBinBack = 24 + 12;
const weakClosureHeadsOffset = 0x3d00, weakClosureHeadsBytes = 128 * 4;
const coldCollectionTarget = 1024 * 1024; // LuaHeap at fb40f6432

for (const optLevel of [0, 3] as const) {
	test('BIOS cold heap on poisoned metadata matches the independent native owners and restores during bin initialization at O' + optLevel, () => {
		const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), [module], {
			entrySource, optLevel, programDomain: 'system',
		});
		const linked = linkTestSystemBlua32(compiled);
		const object = encodeCompiledProgramObject(compiled);
		const names = [[path, 'initialize_heap'], ['kernel/dlmalloc', 'bmsx_dlmalloc_allocate'], ['kernel/dlmalloc', 'bmsx_dlmalloc_free'], [path, 'publish_system_directory']];
		const indices = names.map(([path, name]) => {
			const entry = object.sections.rodata.moduleExports.find(entry => entry.path === path && entry.exportPathKey === name)!;
			const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[entry.slotName]);
			assert.ok(index >= 0, name);
			return index;
		});
		const fixed = deriveBlua32FixedStack(linked.image, indices);
		assert.ok(fixed.frames <= HEAP_SERVICE_FRAME_COUNT);
		assert.ok(fixed.valueSlots <= HEAP_SERVICE_VALUE_COUNT);
		const system = linked.image.address;
		const bucketAddress = readLE32(linked.romBytes, system + BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET);
		const bucketCount = readLE32(linked.romBytes, system + BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET);
		for (const staticEnd of [DYNAMIC_RAM_BASE, DYNAMIC_RAM_BASE + 0x111, 0x083fc000]) {
			const { cpu, memory } = createTestSystemCpu(linked);
			const oracle = createTestSystemCpu(linked).cpu;
			const arena = cpu.heapAllocator, management = arena.managementOffset(), state = arena.allocatorStateOffset();
			const metadata = management + HEAP_STRING_METADATA_OFFSET;
			const end = state + arenaStateBytes;
			const floor = oracle.heapAllocator.floorOffset(staticEnd);
			const expectedBytes = oracle.memory.ramData().subarray(metadata, end);
			const actualBytes = memory.ramData().subarray(metadata, end);
			const heads = management + weakClosureHeadsOffset;
			const weakHeads = memory.ramData().subarray(heads, heads + weakClosureHeadsBytes);
			// Poison every word the firmware owns. No bins, phase, directory or
			// admission target may come from the CPU fixture's startup path.
			actualBytes.fill(0x6d);
			weakHeads.fill(0x6d);
			memory.writeRamRecordWord(metadata - 4, 0xdecafbad);
			memory.writeRamRecordWord(end, 0xdecafbad);
			memory.writeRamRecordWord(heads - 4, 0xdecafbad);
			memory.writeRamRecordWord(heads + weakClosureHeadsBytes, 0xdecafbad);
			// Mechanical bus state comes from reset independent of the algorithm.
			memory.setRamBusEnd(RAM_BASE + floor);
			resetAllocatorReference(oracle.memory, oracle.heapAllocator, staticEnd);
			const nativeBudget = new LuaHeap(oracle);
			nativeBudget.setCollectionTarget(coldCollectionTarget);
			oracle.stringPool.activateRomTable(SYSTEM_EXECUTION_DOMAIN_ID, bucketAddress, bucketCount);

			const compare = () => {
				assert.deepEqual(actualBytes, expectedBytes);
				assert.equal(memory.readRamRecordWord(metadata - 4), 0xdecafbad);
				assert.equal(memory.readRamRecordWord(end), 0xdecafbad);
				assert.equal(memory.readRamRecordWord(heads - 4), 0xdecafbad);
				assert.equal(memory.readRamRecordWord(heads + weakClosureHeadsBytes), 0xdecafbad);
				assert.ok(weakHeads.every(byte => byte === 0), 'cold firmware cleared only the weak bucket heads');
				assert.equal(memory.ramBusEnd(), oracle.memory.ramBusEnd());
			};
			const grant = () => {
				assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
				return 1 - cpu.instructionBudgetRemaining;
			};
			function finish(expected: number) {
				let cycles = 0;
				for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) cycles += grant();
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(cpu.heapServiceResult(), expected);
				return cycles;
			}
			function begin(index: number, args: number[]) {
				assert.ok(cpu.beginHeapService(linked.image.functions[indices[index]].address, args));
			}
			begin(0, [management, floor]);
			const back = state + firstSmallBinBack;
			const self = oracle.memory.readRamRecordWord(back);
			assert.notEqual(self, 0);
			for (let i = 0; i < 4096 && memory.readRamRecordWord(back) !== self; ++i) grant();
			assert.equal(memory.readRamRecordWord(back), self);
			assert.equal(cpu.heapServiceActive(), true);
			assert.equal(cpu.luaHeap.collectionTarget(), 0);
			assert.equal(cpu.gc.phase(), GcPhase.Pause);
			assert.equal(cpu.gc.white(), 0);
			const checkpoint = captureCpuCheckpoint(cpu);
			const cycles = finish(0);
			begin(3, [management, bucketAddress, bucketCount]);
			finish(0);
			compare();
			restoreCpuCheckpoint(cpu, checkpoint);
			assert.equal(finish(0), cycles);
			begin(3, [management, bucketAddress, bucketCount]);
			finish(0);
			compare();
			assert.equal(arena.occupiedBytes(), 0);
			assert.equal(cpu.luaHeap.usedBytes(), 0);
			assert.equal(cpu.luaHeap.collectionTarget(), nativeBudget.collectionTarget());
			const linkedString = oracle.stringPool.find(romString)!;
			assert.ok(linkedString > 0 && linkedString < RAM_BASE);
			assert.equal(cpu.stringPool.find(romString), linkedString);
			assert.equal(cpu.stringPool.find('impossible-cold-heap-string-never-in-ROM'), undefined);
			// The first allocation from the guest-produced bins is directly
			// usable by the unchanged oracle, but did not depend on a seed.
			const expected = oracle.heapAllocator.allocate(21, false);
			const offset = expected === 0 ? 0 : expected - RAM_BASE;
			begin(1, [state, 21, 1]);
			finish(offset);
			compare();
			assert.equal(arena.issuedObjectStart(offset), offset !== 0);
			if (offset !== 0) {
				oracle.heapAllocator.free(expected);
				begin(2, [state, offset]);
				finish(0);
				compare();
			}
		}
	});
}

test('cold heap entrance accounts for its frozen owner statements and delegates bin mutations', () => {
	const basis = 'fb40f64327849066a7b676350b4c9e6e6f6d685d';
	assert.match(source, new RegExp('Source basis: ' + basis));
	for (const line of source.split('\n')) {
		const text = line.trim();
		if (!text || text.startsWith('--') || text === 'module<const>' || text === 'end'
			|| text.startsWith('return { initialize_heap = initialize_heap,')) continue;
		assert.match(text, /-- .*\b[ABCHLST]:\d+/, text);
	}
	assert.match(source, /bmsx_dlmalloc_reset\(management \+ layout.arena_offset, floor, management\) -- A:35-36 B:32-33 C:462-473/);
	assert.match(source, /metadata\[index\] = 0 -- A:33-34 B:30-31/);
	assert.match(source, /\*target = admission.min_collection_bytes -- L:13/);
	assert.match(source, /directory\[0\] = system_buckets -- S:136-137 T:150-151/);
	assert.match(source, /directory\[1\] = system_bucket_count -- S:138 T:152/);
});
