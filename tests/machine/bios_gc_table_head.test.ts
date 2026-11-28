import { GC_MODE_META, GC_MODE_NODE, GC_TRACE_CURSOR, GC_TRACE_HEAD, GC_TRACE_RECORD, GC_VISIT_COUNT, GC_VISIT_HEADER_BYTE, GC_VISIT_MEMBER, GC_VISIT_TAIL, GC_WEAK_VISITS, GcDiagnosticField } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_OFFSET, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../toolchain/ts/firmware/stock_object_layout';
import { TableHeader } from '../../machine/ts/machine/cpu/table';
import { ValueTag, hashCanonicalTableKey, valueString } from '../../machine/ts/machine/cpu/value';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../helpers/firmware_heap_layout';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';

const HEAD = 'kernel/gc_table_head', PROBE = 'test/gc_table_head', entrySource = "return 'v', 'kv'";
const probeSource = `module<const>
local head<const> = require('${HEAD}')
local invoke<const> = function(control, arena, metadata, record, key, limit, resuming, pending, replace_color, result)
	local work<const>, carry<const> = head.trace_table(control, arena, metadata, record, key, limit, resuming, pending, replace_color)
	local output<const>: *u32 = ${RAM_BASE} + result
	*output = carry
	return work
end
return { invoke = invoke }
`;
const modules = [
	...['kernel/dlmalloc', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/gc_mark', 'kernel/gc_table_mode',
		'kernel/string_record', 'kernel/gc_weak_mode', 'kernel/gc_table_trace', HEAD]
		.map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: PROBE, source: probeSource },
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
const MODE_PENDING = 4 << 20, MODE_REMAINING = GC_MODE_NODE + 4;
const indexOfRecord = (address: number) => (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const { slotName } = object.sections.rodata.moduleExports.find(entry => entry.path === PROBE && entry.exportPathKey === 'invoke')!;
	const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
	assert.ok(index >= 0);
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [index]);
	assert.ok(valueSlots <= CPU_FIXED_VALUE_COUNT && frames <= CPU_FIXED_FRAME_COUNT, `pinned stack: ${valueSlots} values, ${frames} frames`);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const management = nativeHeapReference(cpu).heapAllocator.managementOffset(), arena = nativeHeapReference(cpu).heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const floor = memory.ramBusEnd() - RAM_BASE, output = management + GC_WORKSPACE_END - 4;
	const modeKey = nativeHeapReference(cpu).gc.diagnosticWord(GcDiagnosticField.Mode);
	assert.equal(modeKey, nativeHeapReference(oracle).gc.diagnosticWord(GcDiagnosticField.Mode));
	function compare(label: string) {
		const actual = memory.ramData().subarray(floor, output), expected = oracle.memory.ramData().subarray(floor, output);
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, i) => byte !== expected[i]);
		assert.equal(actual[offset], expected[offset], `${label}: RAM 0x${(floor + offset).toString(16)}`);
	}
	function word(address: number, value: number) {
		memory.writeRamRecordWord(address, value);
		oracle.memory.writeRamRecordWord(address, value);
	}
	function byte(address: number, value: number) {
		memory.writeRamRecordByte(address, value);
		oracle.memory.writeRamRecordByte(address, value);
	}
	function add(create: (target: typeof cpu) => number) {
		const address = create(cpu);
		assert.notEqual(address, 0);
		assert.equal(create(oracle), address);
		return address;
	}
	function string(text: string) {
		const id = add(target => nativeHeapReference(target).stringPool.intern(text));
		assert.ok(id >= RAM_BASE);
		byte(id + 1, 0x94);
		return id;
	}
	function romString(text: string) {
		const id = nativeHeapReference(cpu).stringPool.find(text)!;
		assert.equal(nativeHeapReference(oracle).stringPool.find(text), id);
		assert.ok(id > 0 && id < RAM_BASE, 'String body is in actual System ROM');
		return id;
	}
	function pendingString(id: number) {
		nativeHeapReference(cpu).stringPool.markReachable(id);
		nativeHeapReference(oracle).stringPool.markReachable(id);
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
		function node(slot: number, keyTag: ValueTag, keyWord: number, tag: ValueTag, payload: number, next: number) {
			hashSlot(slot, keyTag, keyWord);
			hashSlot(slot + hash, tag, payload);
			if (hash <= 128) byte(hashBase + 10 * hash + slot, next);
			else word(hashBase + 10 * hash + 4 * slot, next);
		}
		const home = hashCanonicalTableKey(valueString(modeKey)) & (hash - 1);
		return { record, arraySlot, node, home };
	}
	function frontier() {
		return [memory.readRamRecordWord(control + GC_TRACE_RECORD), memory.readRamRecordWord(control + GC_TRACE_CURSOR)];
	}
	function modeCursor() {
		return [memory.readRamRecordWord(control + GC_MODE_META), memory.readRamRecordWord(control + GC_MODE_NODE),
			memory.readRamRecordWord(control + MODE_REMAINING)];
	}
	function visits() {
		return [memory.readRamRecordWord(control + GC_WEAK_VISITS), memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_TAIL),
			memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT)];
	}
	function begin(record: number, limit: number, resuming: boolean) {
		const work = nativeHeapReference(oracle).gc['traceTable'](record, limit, resuming);
		const pending = nativeHeapReference(oracle).stringPool.takeMarkWork();
		assert.ok(cpu.beginHeapService(linked.image.functions[index].address,
			[control, arena, metadata, record, modeKey, limit, +resuming, nativeHeapReference(cpu).stringPool.takeMarkWork(), 0, output]));
		return [work, pending];
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.ok(cpu.instructionBudgetRemaining < cycles);
		return cycles - cpu.instructionBudgetRemaining;
	}
	function finish(cycles = 64) {
		let elapsed = 0;
		for (let i = 0; i < 8192 && cpu.heapServiceActive(); ++i) elapsed += grant(cycles);
		return { result: [cpu.heapServiceResult(), memory.readRamRecordWord(output)], elapsed };
	}
	function check(record: number, limit: number, resuming: boolean, expected: number[]) {
		assert.deepEqual(begin(record, limit, resuming), expected);
		assert.deepEqual(finish().result, expected);
		compare(`table head allowance ${limit}`);
	}
	word(control, 0x0000e501); // Mark phase, raw white bit 1.
	word(metadata + 0x0c, 0xa5a5a501);
	return { cpu, memory, control, modeKey, compare, word, byte, table, string, romString, pendingString,
		frontier, modeCursor, visits, begin, grant, finish, check };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua Table head chooses the inclusive strong fast path without consuming String carry at O${optLevel}`, () => {
		const { memory, control, word, table, string, pendingString, frontier, visits, check } = fixture(optLevel);
		const { record, arraySlot, node } = table(2, 2);
		const arr = string('fast array'), key = string('fast key'), value = string('fast value');
		arraySlot(1, ValueTag.String, arr);
		node(0, ValueTag.String, key, ValueTag.String, value, -1);
		pendingString(string('already pending'));
		word(control + GC_TRACE_CURSOR, 0xdeadfeed);
		check(record, 21, false, [15, 4]);
		assert.deepEqual(frontier(), [0, 0xdeadfeed], 'unchunked fast path leaves frontier untouched');
		assert.deepEqual(visits(), [0, 0, 0]);
		for (const id of [arr, key, value]) assert.equal(memory.readRamRecordByte(id + 1), 1);
	});

	test(`BLua Table head marks metatable before ROM weak mode and visits only hash keys at O${optLevel}`, () => {
		const { cpu, memory, control, modeKey, compare, word, byte, table, string, romString, visits, begin, grant, finish } = fixture(optLevel);
		const { record, arraySlot, node } = table(2, 2);
		const meta = table(0, 4), mode = romString('v');
		meta.node(meta.home, ValueTag.String, modeKey, ValueTag.String, mode, -1);
		word(record + TableHeader.Metatable, ((meta.record & GC_RECORD_MASK) | 0xc0000007) >>> 0);
		byte(meta.record + GC_COLOR_OFFSET, 0xb1);
		const arr = string('unmarked weak array'), key = string('marked strong key'), value = string('unmarked weak value');
		arraySlot(1, ValueTag.String, arr);
		node(0, ValueTag.String, key, ValueTag.String, value, -1);
		assert.deepEqual(begin(record, 18, false), [14, 1]);
		for (let i = 0; i < 2048 && memory.readRamRecordByte(meta.record + GC_COLOR_OFFSET) !== 0xb2; ++i) grant(1);
		assert.equal(cpu.heapServiceActive(), true);
		assert.equal(memory.readRamRecordByte(meta.record + GC_COLOR_OFFSET), 0xb2);
		assert.deepEqual(visits(), [0, 0, 0], 'metatable marker precedes weak visit append');
		assert.deepEqual(finish().result, [14, 1]);
		assert.deepEqual(visits(), [indexOfRecord(record), indexOfRecord(record), 1]);
		assert.notEqual(memory.readRamRecordByte(record + GC_VISIT_HEADER_BYTE) & GC_VISIT_MEMBER, 0);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), indexOfRecord(meta.record));
		assert.equal(memory.readRamRecordByte(key + 1), 1);
		for (const id of [arr, value]) assert.equal(memory.readRamRecordByte(id + 1), 0x94);
		compare('ROM weak value mode');
	});

	test(`BLua Table head rewinds pending-mode publication then resumes without charging or remarking head at O${optLevel}`, () => {
		const { cpu, memory, control, modeKey, compare, word, byte, table, string, romString, frontier, modeCursor, visits,
			pendingString, begin, grant, finish, check } = fixture(optLevel);
		const { record, arraySlot, node } = table(2, 2), meta = table(0, 4);
		const next = (meta.home + 1) & 3, arr = string('ignored fully weak array'), hash = string('ignored fully weak hash');
		arraySlot(1, ValueTag.String, arr);
		node(0, ValueTag.String, hash, ValueTag.String, hash, -1);
		word(record + TableHeader.Metatable, meta.record);
		byte(meta.record + GC_COLOR_OFFSET, 0xe1);
		meta.node(meta.home, ValueTag.Integer, modeKey, ValueTag.True, 0, next);
		meta.node(next, ValueTag.String, modeKey, ValueTag.String, romString('kv'), -1);
		pendingString(string('pending while mode suspends'));
		assert.deepEqual(begin(record, 10, false), [10, 1]);
		for (let i = 0; i < 2048 && frontier()[0] === 0; ++i) grant(1);
		assert.equal(cpu.heapServiceActive(), true);
		assert.deepEqual(frontier(), [record, 0], 'trace cursor has not yet been committed');
		assert.deepEqual(modeCursor(), [meta.record, next, 3]);
		assert.deepEqual(visits(), [0, 0, 0]);
		const checkpoint = captureCpuCheckpoint(cpu);
		const finished = finish(1);
		assert.deepEqual(finished.result, [10, 1]);
		assert.deepEqual(frontier(), [record, MODE_PENDING]);
		compare('mode search parked');
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.deepEqual(finish(1), finished);
		compare('replayed parked mode search');
		word(control + GC_TRACE_HEAD, 0);
		byte(meta.record + GC_COLOR_OFFSET, 0xe1);
		check(record, 1, true, [1, 0]);
		assert.equal(memory.readRamRecordByte(meta.record + GC_COLOR_OFFSET), 0xe1, 'mode resume does not remark metatable');
		assert.deepEqual(frontier(), [0, 0]);
		assert.deepEqual(modeCursor(), [0, 0, 0]);
		assert.deepEqual(visits(), [indexOfRecord(record), indexOfRecord(record), 1]);
		for (const id of [arr, hash]) assert.equal(memory.readRamRecordByte(id + 1), 0x94);
	});

	test(`BLua Table head mode resume reads null's raw projection and rejects unissued kind at O${optLevel}`, () => {
		const { memory, control, word, byte, table, string, frontier, modeCursor, visits, check } = fixture(optLevel);
		const { record, arraySlot } = table(1, 2), former = table(0, 2);
		const id = string('ordinary edge after null metatable');
		arraySlot(0, ValueTag.String, id);
		byte(RAM_BASE, ValueTag.Table);
		word(control + GC_MODE_META, former.record);
		word(control + GC_MODE_NODE, former.home);
		word(control + MODE_REMAINING, 1);
		word(control + GC_TRACE_RECORD, record);
		word(control + GC_TRACE_CURSOR, MODE_PENDING);
		check(record, 1, true, [2, 0]);
		assert.deepEqual(modeCursor(), [0, 0, 0], 'disappeared metatable retires its old mode probe');
		assert.deepEqual(frontier(), [record, 1], 'resuming admission uses the ranged path');
		assert.deepEqual(visits(), [0, 0, 0]);
		assert.equal(memory.readRamRecordByte(id + 1), 1);
		assert.equal(memory.readRamRecordByte(RAM_BASE), ValueTag.Table);
	});
}
