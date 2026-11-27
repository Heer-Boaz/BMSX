import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { allocateClosureRecordReference } from '../helpers/captured_closure_reference';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { initializeRecord as initializeClosure, setCaptureAddress } from '../../machine/ts/machine/cpu/closure';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_TRACE_CURSOR, GC_TRACE_HEAD, GC_TRACE_RECORD, GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_OBJECT_PREFIX, GC_RECORD_LINK, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { bindOpen, initialize as initializeCell, UPVALUE_HEAP_BYTES, UPVALUE_NEXT, UPVALUE_RECORD_KIND, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END } from '../helpers/firmware_heap_layout';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { allocateThreadRecordReference } from '../helpers/thread_allocation_reference';

const TRACE = 'kernel/gc_capture_trace', PROBE = 'test/gc_capture_trace';
const entrySource = 'halt_until_irq';
const probeSource = `module<const>
local trace<const> = require('${TRACE}')
local queued<const> = function(control, arena, metadata, address, kind, limit, pending, replace, output)
	local work, strings = trace.trace_admitted(control, arena, metadata, address, kind, limit, pending, replace)
	local latch<const>: *u32 = ${RAM_BASE} + output
	*latch = strings
	return work
end
local resumed<const> = function(control, arena, metadata, closure, limit, pending, replace, output)
	local work, strings = trace.resume_captures(control, arena, metadata, closure, limit, pending, replace)
	local latch<const>: *u32 = ${RAM_BASE} + output
	*latch = strings
	return work
end
return { queued = queued, resumed = resumed }
`;
const modules = [
	...['kernel/dlmalloc', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/gc_mark', TRACE].map(path =>
		({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: PROBE, source: probeSource },
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const object = encodeCompiledProgramObject(compiled), linked = linkTestSystemBlua32(compiled);
	const entries = new Map<string, number>();
	for (const { path, exportPathKey, slotName } of object.sections.rodata.moduleExports) {
		if (path !== PROBE) continue;
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
		assert.ok(index >= 0, exportPathKey);
		entries.set(exportPathKey, index);
	}
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [...entries.values()]);
	assert.ok(valueSlots <= CPU_FIXED_VALUE_COUNT && frames <= CPU_FIXED_FRAME_COUNT, `${valueSlots} slots, ${frames} frames`);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const management = cpu.heapAllocator.managementOffset(), arena = cpu.heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const floor = memory.ramBusEnd() - RAM_BASE, output = management + GC_WORKSPACE_END - 4;
	const actual = memory.ramData().subarray(floor, output), expected = oracle.memory.ramData().subarray(floor, output);
	function compare() {
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, index) => byte !== expected[index]);
		assert.equal(actual[offset], expected[offset], `private heap byte 0x${(floor + offset).toString(16)}`);
	}
	function word(address: number, value: number) {
		memory.writeRamRecordWord(address, value);
		oracle.memory.writeRamRecordWord(address, value);
	}
	function add(create: (target: CPU) => number) {
		const address = create(cpu);
		assert.notEqual(address, 0);
		assert.equal(create(oracle), address);
		return address;
	}
	function cell() {
		return add(target => {
			const address = target.luaHeap.allocateRecord(UPVALUE_HEAP_BYTES, true, 0, 0);
			initializeCell(target.memory, address, target.gc.white());
			target.gc.publishObject(address);
			return address;
		});
	}
	function closure(captures: number[]) {
		return add(target => {
			const address = allocateClosureRecordReference(target, captures.length);
			const prototype = target.captureClosureBinding(target.rootThread.currentFrame!.closure);
			initializeClosure(target.memory, address, prototype, false, target.gc.white(), captures.length);
			for (const [index, cell] of captures.entries()) setCaptureAddress(target.memory, address, index, cell);
			target.gc.publishObject(address);
			return address;
		});
	}
	function enqueue(address: number, link: number) {
		for (const target of [cpu, oracle]) target.gc['enqueue'](address, link, GC_TRACE_HEAD);
	}
	function begin(name: 'queued' | 'resumed', ...args: number[]) {
		assert.ok(cpu.beginHeapService(linked.image.functions[entries.get(name)!].address, [control, arena, metadata, ...args, output]));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.ok(cpu.instructionBudgetRemaining < cycles, 'ordinary guest instructions retire');
	}
	function finish() {
		for (let i = 0; i < 1024 && cpu.heapServiceActive(); ++i) grant(512);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		return [cpu.heapServiceResult(), memory.readRamRecordWord(output)];
	}
	word(control, GcPhase.Mark | 0x100);
	return { cpu, memory, oracle, control, metadata, add, cell, closure, enqueue, word, begin, grant, finish, compare };
}

const grayIndex = (address: number) => (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT;

for (const optLevel of [0, 3] as const) {
	test(`BLua Closure fast trace matches native open, closed, duplicate and unissued capture lanes at O${optLevel}`, () => {
		const { cpu, memory, oracle, control, add, cell, closure, enqueue, word, begin, finish, compare } = fixture(optLevel);
		const open = cell(), closed = cell();
		const owner = add(target => allocateThreadRecordReference(target, 0)), table = add(target => createReferenceTable(target));
		const fake = add(target => target.heapAllocator.allocate(32, true)) + GC_OBJECT_PREFIX;
		const string = add(target => target.stringPool.intern('bios-trace-closed-value'));
		const prior = add(target => target.stringPool.intern('bios-trace-prior-work'));
		const liveColor = cpu.gc.white();
		const alias = (closed | 0x40000001) >>> 0;
		const head = closure([open, closed, closed, fake, alias]);
		const slot = 2;
		for (const target of [cpu, oracle]) {
			const mem = target.memory;
			bindOpen(mem, open, owner, slot, 0);
			const block = mem.readRamRecordWord(owner + ThreadField.StackBlock), capacity = mem.readRamRecordWord(owner + ThreadField.StackCapacity);
			mem.writeRamRecordWord(block + 4 * slot, table);
			mem.writeRamRecordByte(block + 4 * capacity + slot, ValueTag.Table);
			mem.writeRamRecordByte(closed + UPVALUE_VALUE_TAG, ValueTag.String);
			mem.writeRamRecordWord(closed + UPVALUE_VALUE_WORD, string);
			target.stringPool.beginReachabilityEpoch();
			target.stringPool.markReachable(prior);
		}
		assert.equal(cpu.stringPool.takeMarkWork(), 1);
		word(fake, UPVALUE_RECORD_KIND | (liveColor << 8));
		word(open, memory.readRamRecordWord(open) | 0x9800);
		word(closed, memory.readRamRecordWord(closed) | 0x7400);
		enqueue(head, GC_RECORD_LINK);
		const expectedWork = oracle.gc['trace'](false, 64), expectedStrings = oracle.stringPool.takeMarkWork();
		begin('queued', head, ValueTag.Closure, 64, 1, 0);
		assert.deepEqual(finish(), [expectedWork, expectedStrings]);
		assert.deepEqual([expectedWork, expectedStrings], [16, 2]);
		assert.equal(memory.readRamRecordByte(open + GC_COLOR_OFFSET), 0x9b);
		assert.equal(memory.readRamRecordByte(closed + GC_COLOR_OFFSET), 0x77);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), grayIndex(table));
		assert.equal(memory.readRamRecordWord(table + GC_RECORD_LINK), grayIndex(owner), 'open owner queues before captured value');
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), 0);
		compare();
	});

	test(`BLua traceCaptures resumes native cursor and String-work boundaries at O${optLevel}`, () => {
		const { cpu, memory, oracle, control, add, cell, closure, enqueue, word, begin, grant, finish, compare } = fixture(optLevel);
		const first = cell(), second = cell(), head = closure([first, first, second]);
		const string = add(target => target.stringPool.intern('bios-slow-capture-string'));
		const prior = add(target => target.stringPool.intern('bios-slow-pending-string'));
		for (const target of [cpu, oracle]) {
			target.memory.writeRamRecordByte(first + UPVALUE_VALUE_TAG, ValueTag.String);
			target.memory.writeRamRecordWord(first + UPVALUE_VALUE_WORD, string);
			target.stringPool.beginReachabilityEpoch();
			target.stringPool.markReachable(prior);
		}
		assert.equal(cpu.stringPool.takeMarkWork(), 1);
		enqueue(head, GC_RECORD_LINK);
		assert.equal(oracle.gc['trace'](false, 3), 3);
		begin('queued', head, ValueTag.Closure, 3, 1, 0);
		const pendingCarry = oracle.stringPool.takeMarkWork();
		assert.equal(pendingCarry, 1);
		assert.deepEqual(finish(), [3, pendingCarry], 'no capture visit leaves the old String latch pending');
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), head);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_CURSOR), 0);
		compare();

		let pending = pendingCarry;
		for (const [limit, cursor, want] of [[1, 1, 7], [1, 2, 1], [1, 0, 5]]) {
			oracle.stringPool.resumeMarkWork(pending);
			const work = oracle.gc['resumeTrace'](head, false, limit);
			assert.equal(work, want);
			begin('resumed', head, limit, pending, 0);
			let partial: ReturnType<typeof captureCpuCheckpoint> | null = null;
			if (cursor === 1) {
				for (let i = 0; i < 512 && memory.readRamRecordByte(first + GC_COLOR_OFFSET) !== 3; ++i) grant(1);
				assert.ok(cpu.heapServiceActive());
				assert.equal(memory.readRamRecordByte(first + GC_COLOR_OFFSET), 3);
				assert.equal(memory.readRamRecordWord(control + GC_TRACE_CURSOR), 0, 'the first capture is only partly traced');
				partial = captureCpuCheckpoint(cpu);
			}
			const expected = [work, oracle.stringPool.takeMarkWork()];
			assert.deepEqual(finish(), expected);
			if (partial !== null) {
				restoreCpuCheckpoint(cpu, partial);
				assert.deepEqual(finish(), expected, 'pending String work is preserved while the capture is in flight');
			}
			assert.equal(memory.readRamRecordWord(control + GC_TRACE_CURSOR), cursor);
			compare();
			pending = 0;
		}
		word(control + GC_TRACE_RECORD, head);
		word(control + GC_TRACE_CURSOR, 0x80000001);
		begin('resumed', head, 4, 0, 0);
		assert.deepEqual(finish(), [oracle.gc['resumeTrace'](head, false, 4), 0], 'cursor comparison is unsigned');
		compare();
	});

	test(`BLua closed Upvalue trace resumes between gray queue pop and link clear at O${optLevel}`, () => {
		const { cpu, memory, oracle, control, add, cell, closure, enqueue, word, begin, grant, finish, compare } = fixture(optLevel);
		const tail = closure([]), head = cell();
		const string = add(target => target.stringPool.intern('bios-queued-upvalue-string'));
		for (const target of [cpu, oracle]) {
			target.memory.writeRamRecordByte(head + UPVALUE_VALUE_TAG, ValueTag.String);
			target.memory.writeRamRecordWord(head + UPVALUE_VALUE_WORD, string);
			target.stringPool.beginReachabilityEpoch();
		}
		word(head, memory.readRamRecordWord(head) | 0x9000);
		enqueue(tail, GC_RECORD_LINK);
		enqueue(head, UPVALUE_NEXT);
		begin('queued', head, UPVALUE_RECORD_KIND, 1, 0, 0);
		for (let i = 0; i < 256 && memory.readRamRecordWord(control + GC_TRACE_HEAD) !== grayIndex(tail); ++i) grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), grayIndex(tail));
		assert.equal(memory.readRamRecordWord(head + UPVALUE_NEXT), grayIndex(tail), 'Next has not cleared yet');
		assert.equal(memory.readRamRecordByte(head + GC_COLOR_OFFSET), 0x92, 'recolor follows unlink');
		const partial = captureCpuCheckpoint(cpu);
		const work = oracle.gc['trace'](false, 1), stringWork = oracle.stringPool.takeMarkWork();
		assert.deepEqual([work, stringWork], [4, 1]);
		assert.deepEqual(finish(), [work, stringWork]);
		assert.equal(memory.readRamRecordWord(head + UPVALUE_NEXT), 0);
		compare();
		restoreCpuCheckpoint(cpu, partial);
		assert.deepEqual(finish(), [work, stringWork]);
		compare();
		// The C++ mirror stores the full color byte, even on a raw header.
		word(tail, memory.readRamRecordWord(tail) | 0x9000);
		begin('queued', tail, ValueTag.Closure, 8, 0, 1);
		assert.deepEqual(finish(), [oracle.gc['trace'](false, 8), 0]);
		assert.equal(memory.readRamRecordByte(tail + GC_COLOR_OFFSET), 3);
		oracle.memory.writeRamRecordByte(tail + GC_COLOR_OFFSET, 3);
		compare();
	});
}
