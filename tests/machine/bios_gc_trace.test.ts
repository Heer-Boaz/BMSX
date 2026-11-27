import { allocateClosureRecordReference } from '../helpers/captured_closure_reference';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { initializeRecord as initializeClosure, setCaptureAddress } from '../../machine/ts/machine/cpu/closure';
import { type CPU } from '../../machine/ts/machine/cpu/cpu';
import { GC_TRACE_CURSOR, GC_TRACE_HEAD, GC_TRACE_RECORD, GC_THREAD_VISITS, GC_VISIT_COUNT, GcPhase, GcDiagnosticField } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_GRAY_INDEX_MASK, GC_OBJECT_PREFIX, GC_RECORD_LINK, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_MARK_WORK_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { initialize as initializeCell, UPVALUE_HEAP_BYTES, UPVALUE_NEXT, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GcTraceContextField, GC_TRACE_CONTEXT_OFFSET } from '../helpers/firmware_heap_layout';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { allocateThreadRecordReference } from '../helpers/thread_allocation_reference';

const TRACE = 'kernel/gc_trace';
const modules = [
	'dlmalloc', 'gc_control', 'gc_strings', 'gc_mark', 'gc_capture_trace', 'gc_thread_trace', 'gc_table_head',
	'gc_table_mode', 'gc_weak_mode', 'gc_table_trace', 'string_record', 'gc_trace',
].map(name => {
	const path = `kernel/${name}`, source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const indexOfRecord = (address: number) => (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT;

function fixture(optLevel: 0 | 3) {
	const linked = linkFirmwareProbe(optLevel, modules, [{path: TRACE, member: 'trace_quantum', arity: 6}]);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	for (const target of [cpu, oracle]) {
		runGuestToHalt(target, 10_000);
		target.stringPool.beginReachabilityEpoch();
	}
	const management = cpu.heapAllocator.managementOffset(), arena = cpu.heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const context = management + GC_TRACE_CONTEXT_OFFSET;
	const floor = memory.ramBusEnd() - RAM_BASE;
	const actual = memory.ramData().subarray(floor, context), expected = oracle.memory.ramData().subarray(floor, context);
	function compare() {
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, index) => byte !== expected[index]);
		assert.equal(actual[offset], expected[offset], `private heap byte 0x${(floor + offset).toString(16)}`);
	}
	function word(address: number, value: number) {
		for (const target of [cpu, oracle]) target.memory.writeRamRecordWord(address, value);
	}
	function byte(address: number, value: number) {
		for (const target of [cpu, oracle]) target.memory.writeRamRecordByte(address, value);
	}
	function add(create: (target: CPU) => number) {
		const address = create(cpu);
		assert.notEqual(address, 0);
		assert.equal(create(oracle), address);
		return address;
	}
	function closure(captured: number) {
		return add(target => {
			const address = allocateClosureRecordReference(target, 1);
			initializeClosure(target.memory, address, target.captureClosureBinding(target.rootThread.currentFrame!.closure), false, target.gc.white(), 1);
			setCaptureAddress(target.memory, address, 0, captured);
			target.gc.publishObject(address);
			return address;
		});
	}
	function cell(value: number) {
		return add(target => {
			const address = target.luaHeap.allocateRecord(UPVALUE_HEAP_BYTES, true, 0, 0);
			initializeCell(target.memory, address, target.gc.white());
			target.gc.publishObject(address);
			target.memory.writeRamRecordByte(address + UPVALUE_VALUE_TAG, ValueTag.String);
			target.memory.writeRamRecordWord(address + UPVALUE_VALUE_WORD, value);
			return address;
		});
	}
	function string(text: string) {
		const id = add(target => target.stringPool.intern(text));
		byte(id + 1, (memory.readRamRecordByte(metadata + 0xc) & 1) ^ 1);
		return id;
	}
	function pendingString(id: number) {
		for (const target of [cpu, oracle]) target.stringPool.markReachable(id);
	}
	function queue(address: number, link = GC_RECORD_LINK) {
		for (const target of [cpu, oracle]) target.gc['enqueue'](address, link, GC_TRACE_HEAD);
	}
	function beginning(limit: number, work: number, pending: number, policy = 0) {
		const modeKey = cpu.gc.diagnosticWord(GcDiagnosticField.Mode);
		assert.equal(modeKey, oracle.gc.diagnosticWord(GcDiagnosticField.Mode));
		memory.writeRamRecordWord(context + GcTraceContextField.Work, work);
		memory.writeRamRecordWord(context + GcTraceContextField.Limit, limit);
		memory.writeRamRecordWord(context + GcTraceContextField.Atomic, 0);
		memory.writeRamRecordWord(context + GcTraceContextField.PendingStringWork, pending);
		issueFirmwareProbe(cpu,
			[control, arena, metadata, context, modeKey, policy]);
	}
	function grant(cycles: number) {
		assert.ok(grantFirmwareProbe(cpu, cycles) > 0);
		assert.ok(cpu.instructionBudgetRemaining < cycles);
	}
	function finish() {
		for (let i = 0; i < 1024 && !cpu.isHaltedUntilIrq(); ++i) grant(512);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		return [firmwareProbeResult(cpu), memory.readRamRecordWord(context + GcTraceContextField.PendingStringWork)];
	}
	function check(limit: number, work: number, want: number[]) {
		beginning(limit, work, cpu.stringPool.takeMarkWork());
		const ref = oracle.gc['traceQuantum'](false, limit, work);
		assert.deepEqual([ref, oracle.memory.readRamRecordWord(management + HEAP_STRING_MARK_WORK_OFFSET)], want);
		const result = finish();
		assert.deepEqual(result, want);
		cpu.stringPool.resumeMarkWork(result[1]);
		compare();
	}
	const head = () => memory.readRamRecordWord(control + GC_TRACE_HEAD);
	const frontier = () => [memory.readRamRecordWord(control + GC_TRACE_RECORD), memory.readRamRecordWord(control + GC_TRACE_CURSOR)];
	word(control, GcPhase.Mark | 0x100);
	return { cpu, oracle, memory, control, compare, word, byte, add, closure, cell, queue, string, pendingString, beginning, grant, finish, check, head, frontier };
}

for (const optLevel of [0, 3] as const) {
	test(`Trace quantum drains and resumes the same mixed native gray queue at O${optLevel}`, () => {
		const { cpu, oracle, memory, control, compare, word, byte, add, queue, string, cell, closure, pendingString, beginning, grant, finish, check, head, frontier } = fixture(optLevel);
		const thread = add(target => allocateThreadRecordReference(target, 0)), table = add(target => target.createTable(2, 0));
		const frame = memory.readRamRecordWord(thread + ThreadField.FrameBlock);
		word(thread + ThreadField.FrameDepth, 1);
		word(frame + FrameField.StackCapacity, 8);
		const capturing = closure(cell(string('captured'))), queuedCell = cell(string('queued'));
		const array = cpu.gc.tables.arrayAddress(table);
		word(array, string('array'));
		byte(array + 8, ValueTag.String);
		queue(thread); queue(table); queue(capturing); queue(queuedCell, UPVALUE_NEXT);
		byte(queuedCell + GC_COLOR_OFFSET, 0xaa);
		pendingString(string('before queued cell'));

		beginning(2, 1, cpu.stringPool.takeMarkWork());
		for (let i = 0; i < 1024 && head() === indexOfRecord(queuedCell); ++i) grant(1);
		assert.ok(!cpu.isHaltedUntilIrq());
		assert.equal(head(), indexOfRecord(capturing));
		assert.equal(memory.readRamRecordByte(queuedCell + GC_COLOR_OFFSET), 0xaa, 'publish popped head before recoloring');
		assert.equal(memory.readRamRecordWord(queuedCell + UPVALUE_NEXT) & GC_GRAY_INDEX_MASK, indexOfRecord(capturing));
		const checkpoint = captureCpuCheckpoint(cpu);
		assert.equal(oracle.gc['traceQuantum'](false, 2, 1), 7);
		assert.deepEqual(finish(), [7, 0]);
		compare();
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.deepEqual(finish(), [7, 0]);
		compare();
		assert.equal(memory.readRamRecordWord(queuedCell + UPVALUE_NEXT), 0);
		assert.equal(memory.readRamRecordByte(queuedCell + GC_COLOR_OFFSET), 0xab);

		check(2, 0, [3, 0]);
		assert.deepEqual(frontier(), [capturing, 0]);
		pendingString(string('before capture resume'));
		check(4, 0, [7, 0]);
		assert.deepEqual(frontier(), [0, 0]);
		assert.equal(head(), indexOfRecord(table));
		check(10, 0, [11, 0]);
		assert.deepEqual(frontier(), [table, 1]);
		check(3, 0, [21, 0]);
		assert.deepEqual(frontier(), [thread, 0]);
		assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT), 1);
		check(14, 0, [14, 0]);
		check(3, 0, [0, 0]);
		assert.deepEqual(frontier(), [0, 0]);
		assert.equal(head(), 0);
	});

	test(`Trace quantum carries String work until a new head (including a rejected one) at O${optLevel}`, () => {
		const { cpu, memory, control, word, byte, add, string, pendingString, head, frontier, check } = fixture(optLevel);
		pendingString(string('deferred work'));
		check(4, 0, [0, 1]);
		// Even a correctly colored header cannot clock a link if its
		// allocation was not issued as a collector object.
		const backing = add(target => target.heapAllocator.allocate(16, true)) + GC_OBJECT_PREFIX;
		byte(backing, ValueTag.Table);
		byte(backing + GC_COLOR_OFFSET, 2);
		word(backing + GC_RECORD_LINK, indexOfRecord(cpu.rootThread.address));
		word(control + GC_TRACE_HEAD, 0x81000000 | indexOfRecord(backing));
		check(2, 2, [2, 1]);
		assert.notEqual(head(), 0);
		check(5, 2, [3, 0]);
		assert.equal(head(), 0);
		assert.deepEqual(frontier(), [0, 0]);
		assert.equal(memory.readRamRecordWord(backing + GC_RECORD_LINK), indexOfRecord(cpu.rootThread.address));
		assert.equal(memory.readRamRecordByte(backing + GC_COLOR_OFFSET), 2);
	});

	test(`Trace quantum decodes the native mirror's saved Table mode width at O${optLevel}`, () => {
		for (const policy of [0, 1]) {
			const { cpu, memory, control, word, byte, add, string, beginning, finish, frontier } = fixture(optLevel);
			const table = add(target => target.createTable(1, 0)), item = string('raw mode edge');
			const array = cpu.gc.tables.arrayAddress(table), epoch = memory.readRamRecordByte(cpu.heapAllocator.managementOffset() + HEAP_STRING_METADATA_OFFSET + 0xc) & 1;
			word(array, item);
			byte(array + 4, ValueTag.String);
			word(control + GC_TRACE_RECORD, table);
			word(control + GC_TRACE_CURSOR, 0x10000000); // Decodes as 256 in TS and u8(256) in C++.
			beginning(2, 0, 0, policy);
			assert.deepEqual(finish(), [1 + policy, 0]);
			assert.deepEqual(frontier(), [0, 0]);
			assert.equal(memory.readRamRecordByte(item + 1), epoch ^ (1 - policy));
		}
	});
}
