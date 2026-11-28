import { GC_CHANGED_HEAD, GC_TRACE_HEAD } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GC_COLOR_OFFSET, GC_GRAY_INDEX_MASK, GC_OBJECT_PREFIX, GC_RECORD_LINK, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { THREAD_RECORD_KIND } from '../../machine/ts/machine/cpu/thread_record';
import { UPVALUE_NEXT } from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueFromTag } from '../../machine/ts/machine/cpu/value';
import { CART_ROM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET } from '../helpers/firmware_heap_layout';
import { seedTestRomClosure } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';

const MARK = 'kernel/gc_mark', PROBE = 'test/gc_mark';
const probeSource = `module<const>
local mark<const> = require('${MARK}')
local mark_value<const> = function(control, arena, metadata, tag, payload, queue, replace, output)
	local object_work, string_work = mark.mark_value(control, arena, metadata, tag, payload, queue, replace)
	local string_result<const>: *u32 = ${RAM_BASE} + output
	*string_result = string_work
	return object_work
end
return { mark_value = mark_value }
`;
const modules = [{ path: PROBE, source: probeSource, chunk: parseLuaChunk(probeSource, PROBE) }];
const leaves = [
	{ path: PROBE, member: 'mark_value', arity: 8 },
	{ path: MARK, member: 'mark_record', arity: 6 },
	{ path: MARK, member: 'enqueue', arity: 5, result: false },
] as const;
type Entry = typeof leaves[number]['member'];

function fixture(optLevel: 0 | 3) {
	const linked = linkFirmwareProbe(optLevel, modules, leaves);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const management = cpu.heapAllocator.managementOffset(), arena = cpu.heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const output = management + GC_WORKSPACE_END - 4;
	const floor = memory.ramBusEnd() - RAM_BASE;
	function compare(label = 'private heap state') {
		const actual = memory.ramData().subarray(floor, output), expected = oracle.memory.ramData().subarray(floor, output);
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, index) => byte !== expected[index]);
		assert.equal(actual[offset], expected[offset], `${label}, byte 0x${(floor + offset).toString(16)}`);
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
	function begin(name: Entry, ...args: number[]) {
		issueFirmwareProbe(cpu, [control, ...args], leaves.findIndex(leaf => leaf.member === name));
	}
	function grant(cycles: number) {
		return grantFirmwareProbe(cpu, cycles);
	}
	function finish(cycles = 128) {
		let retired = 0;
		for (let i = 0; i < 512 && !cpu.isHaltedUntilIrq(); ++i) retired += grant(cycles);
		return [firmwareProbeResult(cpu), retired];
	}
	function markValue(tag: ValueTag, payload: number) {
		const objectWork = +nativeHeapReference(oracle).gc.markValue(valueFromTag(tag, payload));
		const stringWork = nativeHeapReference(oracle).stringPool.takeMarkWork();
		memory.writeRamRecordWord(output, 0xa5a5a5a5);
		begin('mark_value', arena, metadata, tag, payload, GC_TRACE_HEAD, 0, output);
		const [object] = finish();
		const actual = [object, memory.readRamRecordWord(output)];
		assert.deepEqual(actual, [objectWork, stringWork]);
		compare(`mark tag ${tag}`);
		return actual;
	}
	return { cpu, memory, oracle, arena, control, metadata, compare, add, word, begin, grant, finish, markValue };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua markValue follows raw tags, object issuance and String work at O${optLevel}`, () => {
		const { cpu, oracle, memory, control, metadata, add, word, markValue } = fixture(optLevel);
		const table = add(target => createReferenceTable(target, 3, 2));
		const closure = add(target => seedTestRomClosure(target, target.readFrameFunctionAddress(0)));
		const thread = add(target => target.rootThread.address);
		const backing = add(target => nativeHeapReference(target).heapAllocator.allocate(48, true)) + GC_OBJECT_PREFIX;
		const string = add(target => nativeHeapReference(target).stringPool.intern('unvisited-ram-string'));
		const oldMark = memory.readRamRecordByte(string + 1) & 1;
		word(metadata + 0x0c, 0x9aceba00 | (oldMark ^ 1));
		word(control, 0x0000e501); // Mark phase, current white is low bit of the raw byte.
		word(control + GC_TRACE_HEAD, 0xfff02345);
		for (const [address, kind] of [[table, ValueTag.Table], [closure, ValueTag.Closure],
			[thread, THREAD_RECORD_KIND], [backing, ValueTag.Table]]) {
			word(address, 0x8120b500 | kind);
			word(address + GC_RECORD_LINK, 0xedcba987);
		}
		assert.deepEqual(markValue(ValueTag.Table, backing), [0, 0], 'unissued backing is not a Table');
		assert.deepEqual(markValue(ValueTag.Thread, table), [0, 0], 'kind mismatch cannot enqueue');
		const aliasedTable = ((table & GC_RECORD_MASK) | 0xc0000007) >>> 0;
		assert.deepEqual(markValue(ValueTag.Table, aliasedTable), [1, 0]);
		assert.equal(memory.readRamRecordByte(table + GC_COLOR_OFFSET), 0xb6);
		assert.equal(memory.readRamRecordWord(table + GC_RECORD_LINK), ((0xedcba987 & ~GC_GRAY_INDEX_MASK) | 0x2345) >>> 0);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), (table & GC_RECORD_MASK) >>> GC_RECORD_SHIFT);
		assert.deepEqual(markValue(ValueTag.Table, table), [0, 0], 'an already marked record does not relink');
		assert.deepEqual(markValue(ValueTag.Closure, closure), [1, 0]);
		assert.deepEqual(markValue(ValueTag.Thread, thread), [1, 0]);
		assert.deepEqual(markValue(ValueTag.String, string + 0x04000000), [0, 1], 'RAM String tags retain the record-port alias');
		assert.deepEqual(markValue(ValueTag.String, string), [0, 0]);
		for (const id of [0x1000, CART_ROM_BASE + 0x200, (CART_ROM_BASE + 0x80000200) >>> 0])
			assert.deepEqual(markValue(ValueTag.String, id), [0, 0]);
		for (const tag of [ValueTag.Nil, ValueTag.Integer, ValueTag.Float, ValueTag.BuiltinFunction, ValueTag.DeadKey])
			assert.deepEqual(markValue(tag, table), [0, 0]);
		assert.equal(nativeHeapReference(oracle).stringPool.takeMarkWork(), 0);
	});

	test(`BLua markRecord resumes between recoloring and publishing the gray head at O${optLevel}`, () => {
		const { cpu, memory, oracle, arena, control, add, word, begin, grant, finish, compare } = fixture(optLevel);
		const table = add(target => createReferenceTable(target));
		const oldHead = 0xfff92345, oldLink = 0x91abcdef;
		word(control, 0x0000e001);
		word(control + GC_CHANGED_HEAD, oldHead);
		word(table, 0x80005c00 | ValueTag.Table);
		word(table + GC_RECORD_LINK, oldLink);
		assert.equal(nativeHeapReference(oracle).gc['markRecord'](table, ValueTag.Table, GC_CHANGED_HEAD), true);
		begin('mark_record', arena, table, ValueTag.Table, GC_CHANGED_HEAD, 0);
		for (let i = 0; i < 512 && memory.readRamRecordByte(table + GC_COLOR_OFFSET) !== 0x5e; ++i) grant(1);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(memory.readRamRecordByte(table + GC_COLOR_OFFSET), 0x5e);
		assert.equal(memory.readRamRecordWord(table + GC_RECORD_LINK), ((oldLink & ~GC_GRAY_INDEX_MASK) | (oldHead & GC_GRAY_INDEX_MASK)) >>> 0);
		assert.equal(memory.readRamRecordWord(control + GC_CHANGED_HEAD), oldHead, 'queue publication has not yet retired');
		const checkpoint = captureCpuCheckpoint(cpu);
		const first = finish(1);
		assert.equal(first[0], 1);
		compare();
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(memory.readRamRecordWord(control + GC_CHANGED_HEAD), oldHead);
		assert.deepEqual(finish(1), first);
		compare();
	});

	test(`BLua enqueue preserves its selected mirror color store and non-gray link path at O${optLevel}`, () => {
		const { memory, oracle, control, add, word, begin, finish, compare } = fixture(optLevel);
		const table = add(target => createReferenceTable(target));
		for (const replace of [0, 1]) {
			const head = 0xd00e9def;
			word(table, 0x8000ad00 | ValueTag.Table);
			word(table + UPVALUE_NEXT, 0xffdeface);
			word(control + GC_CHANGED_HEAD, head);
			nativeHeapReference(oracle).gc['enqueue'](table, UPVALUE_NEXT, GC_CHANGED_HEAD);
			// Pinned C++ gc_heap.h::color differs only in that it overwrites the lane.
			if (replace) oracle.memory.writeRamRecordByte(table + GC_COLOR_OFFSET, 2);
			begin('enqueue', table, UPVALUE_NEXT, GC_CHANGED_HEAD, replace);
			assert.equal(finish()[0], 0);
			assert.equal(memory.readRamRecordWord(table + UPVALUE_NEXT), head & GC_GRAY_INDEX_MASK);
			assert.equal(memory.readRamRecordByte(table + GC_COLOR_OFFSET), replace ? 2 : 0xae);
			compare();
		}
	});
}
