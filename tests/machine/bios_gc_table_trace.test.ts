import { GC_TRACE_CURSOR, GC_TRACE_HEAD, GC_TRACE_RECORD } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_OFFSET, GC_GRAY_INDEX_MASK, GC_RECORD_LINK, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET } from '../helpers/firmware_heap_layout';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';

const TRACE = 'kernel/gc_table_trace', PROBE = 'test/gc_table_trace', entrySource = 'halt_until_irq';
const probeSource = `module<const>
local trace<const> = require('${TRACE}')
local entries<const> = function(control, arena, metadata, record, mode, next, work, limit, pending, replace_color, result)
	local credited<const>, remaining<const> = trace.trace_table_entries(control, arena, metadata, record, mode, next, work, limit, pending, replace_color)
	local output<const>: *u32 = ${RAM_BASE} + result
	*output = remaining
	return credited
end
return { entries = entries }
`;
const modules = [
	...['kernel/dlmalloc', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/gc_mark', TRACE]
		.map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: PROBE, source: probeSource },
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
const CURSOR_SHIFT = 20;
const indexOfRecord = (address: number) => (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const entries = new Map<string, number>();
	for (const { path, exportPathKey, slotName } of object.sections.rodata.moduleExports) {
		if (path !== PROBE && (path !== TRACE || exportPathKey !== 'trace_table_edges')) continue;
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
		assert.ok(index >= 0, exportPathKey);
		entries.set(exportPathKey, index);
	}
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [...entries.values()]);
	assert.ok(valueSlots <= CPU_FIXED_VALUE_COUNT && frames <= CPU_FIXED_FRAME_COUNT, `pinned stack: ${valueSlots} values, ${frames} frames`);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const management = cpu.heapAllocator.managementOffset(), arena = cpu.heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const floor = memory.ramBusEnd() - RAM_BASE, output = management + GC_WORKSPACE_END - 4;
	function compare(label: string) {
		const actual = memory.ramData().subarray(floor, output), expected = oracle.memory.ramData().subarray(floor, output);
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, i) => byte !== expected[i]);
		assert.equal(actual[offset], expected[offset], `${label}: RAM 0x${(floor + offset).toString(16)}`);
	}
	function add(create: (target: typeof cpu) => number) {
		const address = create(cpu);
		assert.notEqual(address, 0);
		assert.equal(create(oracle), address);
		return address;
	}
	function word(address: number, value: number) {
		memory.writeRamRecordWord(address, value);
		oracle.memory.writeRamRecordWord(address, value);
	}
	function byte(address: number, value: number) {
		memory.writeRamRecordByte(address, value);
		oracle.memory.writeRamRecordByte(address, value);
	}
	function begin(name: string, ...args: number[]) {
		assert.ok(cpu.beginHeapService(linked.image.functions[entries.get(name)!].address, [control, arena, metadata, ...args]));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.ok(cpu.instructionBudgetRemaining < cycles);
		return cycles - cpu.instructionBudgetRemaining;
	}
	function finish(cycles = 64) {
		let elapsed = 0;
		for (let i = 0; i < 8192 && cpu.heapServiceActive(); ++i) elapsed += grant(cycles);
		return { work: cpu.heapServiceResult(), pending: memory.readRamRecordWord(output), elapsed };
	}
	function beginEdges(record: number, mode: number, first: number, end: number) {
		nativeHeapReference(oracle).gc['traceTableEdges'](record, mode, first, end);
		const expected = nativeHeapReference(oracle).stringPool.takeMarkWork();
		begin('trace_table_edges', record, mode, first, end, 0);
		return expected;
	}
	function beginEntries(record: number, mode: number, next: number, work: number, limit: number) {
		const credited = nativeHeapReference(oracle).gc['traceTableEntries'](record, mode, next, work, limit);
		const pending = nativeHeapReference(oracle).stringPool.takeMarkWork();
		begin('entries', record, mode, next, work, limit, nativeHeapReference(cpu).stringPool.takeMarkWork(), 0, output);
		return [credited, pending];
	}
	function checkEntries(record: number, mode: number, next: number, work: number, limit: number, expected: number[]) {
		assert.deepEqual(beginEntries(record, mode, next, work, limit), expected, 'native work and carry');
		const finished = finish();
		assert.deepEqual([finished.work, finished.pending], expected, 'firmware work and carry');
		compare(`table extent [${next}, allowance ${limit})`);
	}
	function table(array: number, hash: number) {
		const record = add(target => createReferenceTable(target, array, hash));
		const arrayBase = cpu.tables.arrayAddress(record), hashBase = cpu.tables.hashAddress(record);
		assert.equal(cpu.tables.arrayCapacity(record), array);
		assert.equal(cpu.tables.hashSize(record), hash);
		function arraySlot(slot: number, tag: ValueTag, payload: number) {
			word(arrayBase + 4 * slot, payload);
			byte(arrayBase + 4 * array + slot, tag);
		}
		function hashSlot(slot: number, tag: ValueTag, payload: number) {
			word(hashBase + 4 * slot, payload);
			byte(hashBase + 8 * hash + slot, tag);
		}
		return { record, arraySlot, hashSlot };
	}
	function string(text: string) {
		const id = add(target => nativeHeapReference(target).stringPool.intern(text));
		byte(id + 1, 0x94);
		return id;
	}
	function pendingString(id: number) {
		nativeHeapReference(cpu).stringPool.markReachable(id);
		nativeHeapReference(oracle).stringPool.markReachable(id);
	}
	function frontier() {
		return [memory.readRamRecordWord(control + GC_TRACE_RECORD), memory.readRamRecordWord(control + GC_TRACE_CURSOR)];
	}
	word(control, 0x0000e501); // Mark phase, white's low bit is 1.
	word(metadata + 0x0c, 0xa5a5a501);
	return { cpu, memory, control, compare, add, word, byte, table, string, pendingString, frontier,
		beginEdges, beginEntries, checkEntries, grant, finish };
}

for (const optLevel of [0, 3] as const) {
	for (const mode of [0, 1, 2, 3] as const) {
		test(`BLua Table edge mode ${mode} visits only eligible ranged slots at O${optLevel}`, () => {
			const { cpu, memory, control, compare, add, byte, word, table, string, beginEdges, grant, finish } = fixture(optLevel);
			const { record, arraySlot, hashSlot } = table(4, 8);
			const keyObject = add(target => createReferenceTable(target)), valueObject = add(target => target.rootThread.address);
			byte(keyObject + GC_COLOR_OFFSET, 0xb1);
			byte(valueObject + GC_COLOR_OFFSET, 0xd1);
			word(keyObject + GC_RECORD_LINK, 0x83a01fff);
			word(valueObject + GC_RECORD_LINK, 0x4f002fff);
			const arrayEdge = string('table trace array'), keyEdge = string('table trace key'), valueEdge = string('table trace value');
			const vacantKey = string('vacant key lane'), vacantValue = string('vacant value lane');
			const before = string('before range'), after = string('after range');
			arraySlot(0, ValueTag.String, before);
			arraySlot(1, ValueTag.String, arrayEdge);
			arraySlot(2, ValueTag.Nil, 0xdeadf00d);
			arraySlot(3, ValueTag.Integer, 5);
			hashSlot(0, ValueTag.String, keyEdge); hashSlot(8, ValueTag.String, valueEdge);
			hashSlot(1, ValueTag.Table, keyObject); hashSlot(9, ValueTag.Thread, valueObject);
			hashSlot(2, ValueTag.Nil, ValueTag.Thread); hashSlot(10, ValueTag.String, vacantValue);
			hashSlot(3, ValueTag.String, vacantKey); hashSlot(11, ValueTag.Nil, 0xcafecafe);
			hashSlot(4, ValueTag.String, after); hashSlot(12, ValueTag.String, after);
			const expected = [3, 2, 1, 0][mode];
			assert.equal(beginEdges(record, mode, 1, 8), expected);
			if (mode === 0) {
				for (let i = 0; i < 2048 && memory.readRamRecordByte(keyEdge + 1) !== 1; ++i) grant(1);
				assert.equal(cpu.heapServiceActive(), true);
				assert.equal(memory.readRamRecordByte(arrayEdge + 1), 1, 'array edge precedes hash');
				assert.equal(memory.readRamRecordByte(keyEdge + 1), 1);
				assert.equal(memory.readRamRecordByte(valueEdge + 1), 0x94, 'hash key mark precedes value mark');
			}
			assert.equal(finish().work, expected);
			compare(`edge mode ${mode}`);
			const marksKey = mode === 0 || mode === 2, marksValue = mode === 0 || mode === 1;
			assert.equal(memory.readRamRecordByte(keyObject + GC_COLOR_OFFSET), marksKey ? 0xb2 : 0xb1);
			assert.equal(memory.readRamRecordByte(valueObject + GC_COLOR_OFFSET), marksValue ? 0xd2 : 0xd1);
			assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), marksValue ? indexOfRecord(valueObject)
				: marksKey ? indexOfRecord(keyObject) : 0);
			if (mode === 0) {
				assert.equal(memory.readRamRecordWord(valueObject + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK, indexOfRecord(keyObject));
			}
			for (const id of [before, after, vacantKey, vacantValue]) assert.equal(memory.readRamRecordByte(id + 1), 0x94);
			assert.equal(beginEdges(record, mode, 1, 8), 0, 'repeat charges no already marked String');
			assert.equal(finish().work, 0);
			compare('repeated edges');
			const tailWork = mode === 3 ? 0 : 1;
			assert.equal(beginEdges(record, mode, 1, 0xffffffff), tailWork, 'unsigned full-range bound');
			assert.equal(finish().work, tailWork);
			compare('full-range bound');
		});
	}

	test(`BLua Table trace credits physical extent and rewinds at ordered cursor stores at O${optLevel}`, () => {
		const { cpu, memory, control, compare, add, word, byte, table, string, pendingString, frontier, beginEntries, checkEntries, grant, finish } = fixture(optLevel);
		const { record, arraySlot, hashSlot } = table(3, 4);
		const object = add(target => target.rootThread.address);
		byte(object + GC_COLOR_OFFSET, 0xb1);
		const arr = string('span array'), key = string('span hash key'), value = string('span hash value');
		arraySlot(0, ValueTag.String, arr);
		arraySlot(1, ValueTag.Nil, 0xdeadbeef);
		arraySlot(2, ValueTag.Thread, object);
		hashSlot(0, ValueTag.String, key); hashSlot(4, ValueTag.String, value);
		hashSlot(1, ValueTag.String, key); hashSlot(5, ValueTag.Nil, 0xdeadbeef);
		hashSlot(2, ValueTag.Integer, 32); hashSlot(6, ValueTag.True, 0);
		word(control + GC_TRACE_CURSOR, 0xef95d6e7);
		pendingString(string('span carried credit'));
		const expected = beginEntries(record, 0, 0, 2, 3);
		assert.deepEqual(expected, [5, 0], 'initial work + one array word + carried and new marks');
		for (let i = 0; i < 2048 && frontier()[0] === 0; ++i) grant(1);
		assert.equal(cpu.heapServiceActive(), true);
		assert.deepEqual(frontier(), [record, 0xef95d6e7], 'record publishes before its cursor');
		const checkpoint = captureCpuCheckpoint(cpu);
		const finished = finish(1);
		assert.deepEqual([finished.work, finished.pending], expected);
		assert.deepEqual(frontier(), [record, 1]);
		compare('partial table trace');
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.deepEqual(frontier(), [record, 0xef95d6e7]);
		assert.deepEqual(finish(1), finished);
		compare('replayed table trace');
		checkEntries(record, 0, 1, 0, 3, [6, 0]);
		assert.deepEqual(frontier(), [record, 4]);
		assert.equal(memory.readRamRecordByte(object + GC_COLOR_OFFSET), 0xb2);
		checkEntries(record, 0, 4, 0, 4, [4, 0]);
		assert.deepEqual(frontier(), [record, 6]);
		checkEntries(record, 0, 6, 0, 1, [2, 0]); // Last vacant hash slot still consumes two words.
		assert.deepEqual(frontier(), [0, 0]);
	});

	test(`BLua Table cursor preserves the String carry when no span runs at O${optLevel}`, () => {
		const { table, string, pendingString, frontier, checkEntries } = fixture(optLevel);
		const { record, hashSlot } = table(2, 2);
		hashSlot(0, ValueTag.String, string('unvisited limited key'));
		hashSlot(2, ValueTag.String, string('unvisited limited value'));
		pendingString(string('undrained credit'));
		checkEntries(record, 2, 2, 7, 7, [7, 1]);
		assert.deepEqual(frontier(), [record, (2 << CURSOR_SHIFT) | 2]);
		checkEntries(record, 3, 2, 0, 1, [2, 0]); // No traversal visitor, extent charge unchanged.
		assert.deepEqual(frontier(), [record, (3 << CURSOR_SHIFT) | 3]);
		pendingString(string('undrained terminal credit'));
		checkEntries(record, 3, 4, 0, 3, [0, 1]);
		assert.deepEqual(frontier(), [0, 0]);
	});
}
