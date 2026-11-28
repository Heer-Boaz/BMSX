import { bindOpen, initialize as initializeCell } from '../helpers/native_heap/upvalue_record';
import { initializeRecord as initializeClosure } from '../helpers/native_heap/closure_record';
import { GC_THREAD_TRACE_OPEN, GC_THREAD_VISITS, GC_TRACE_CURSOR, GC_TRACE_RECORD, GC_VISIT_COUNT, GcPhase } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { allocateClosureRecordReference } from '../helpers/captured_closure_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES, FrameField } from '../../machine/ts/machine/cpu/call_state';

import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_OFFSET, GC_GRAY_INDEX_BITS } from '../../toolchain/ts/firmware/stock_object_layout';
import { THREAD_CONTROL_COUNT_MASK, ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { close, UPVALUE_HEAP_BYTES } from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../helpers/firmware_heap_layout';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { bootManagedTestSystem, linkManagedTestSystem } from '../helpers/managed_system';
import { allocateThreadRecordReference } from '../helpers/thread_allocation_reference';

const TRACE = 'kernel/gc_thread_trace', PROBE = 'test/gc_thread_trace';
const entrySource = `local probe<const> = require('${PROBE}')
halt_until_irq
return function(control, arena, metadata, address, atomic, limit, resumed, pending_strings, replace, output)
	return probe.trace(control, arena, metadata, address, atomic, limit, resumed, pending_strings, replace, output)
end`;
const cursorBits = GC_GRAY_INDEX_BITS + 1;
const enum Stage { Frames, Values, Clear }
const openHead = 1;
const probeSource = `module<const>
local thread<const> = require('${TRACE}')
local trace<const> = function(control, arena, metadata, address, atomic, limit, resumed, pending_strings, replace, output)
	local work<const>, strings<const> = thread.trace_thread(control, arena, metadata, address, atomic, limit, resumed, pending_strings, replace)
	local latch<const>: *u32 = ${RAM_BASE} + output
	*latch = strings
	return work
end
return { trace = trace }
`;
function fixture(optLevel: 0 | 3) {
	const linked = linkManagedTestSystem(entrySource, optLevel, [{ path: PROBE, source: probeSource }]);
	const { object } = linked;
	const exported = object.sections.rodata.moduleExports.find(entry => entry.path === PROBE && entry.exportPathKey === 'trace');
	assert.ok(exported);
	const entry = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
	assert.ok(entry >= 0);
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.layout, [entry]);
	assert.ok(valueSlots <= CPU_FIXED_VALUE_COUNT && frames <= CPU_FIXED_FRAME_COUNT, `${valueSlots} slots, ${frames} frames`);
	const { cpu, memory } = bootManagedTestSystem(linked), oracle = bootManagedTestSystem(linked).cpu;
	runGuestToHalt(cpu, 1_000_000);
	runGuestToHalt(oracle, 1_000_000);
	const management = nativeHeapReference(cpu).heapAllocator.managementOffset(), arena = nativeHeapReference(cpu).heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const floor = memory.ramBusEnd() - RAM_BASE, output = management + GC_WORKSPACE_END - 4;
	const actual = memory.ramData().subarray(floor, output), expected = oracle.memory.ramData().subarray(floor, output);
	function compare() {
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, index) => byte !== expected[index]);
		assert.equal(actual[offset], expected[offset], `private heap byte 0x${(floor + offset).toString(16)}`);
	}
	function word(address: number, value: number) {
		for (const target of [cpu, oracle]) target.memory.writeRamRecordWord(address, value);
	}
	function add(create: (target: CPU) => number) {
		const address = create(cpu);
		assert.notEqual(address, 0);
		assert.equal(create(oracle), address);
		return address;
	}
	function cell() {
		return add(target => {
			const address = nativeHeapReference(target).luaHeap.allocateRecord(UPVALUE_HEAP_BYTES, true, 0, 0);
			initializeCell(target.memory, address, nativeHeapReference(target).gc.white());
			nativeHeapReference(target).gc.publishObject(address);
			return address;
		});
	}
	function closure() {
		return add(target => {
			const address = allocateClosureRecordReference(target, 0);
			initializeClosure(target.memory, address, target.captureClosureBinding(target.rootThread.currentFrame!.closure), false, nativeHeapReference(target).gc.white(), 0);
			nativeHeapReference(target).gc.publishObject(address);
			return address;
		});
	}
	function value(thread: number, slot: number, tag: ValueTag, payload: number) {
		for (const target of [cpu, oracle]) {
			const mem = target.memory, block = mem.readRamRecordWord(thread + ThreadField.StackBlock);
			const capacity = mem.readRamRecordWord(thread + ThreadField.StackCapacity);
			mem.writeRamRecordWord(block + 4 * slot, payload);
			mem.writeRamRecordByte(block + 4 * capacity + slot, tag);
		}
	}
	function begin(address: number, atomic: boolean, limit: number, resumed: boolean, pendingStrings = 0) {
		assert.ok(cpu.beginHeapService(linked.layout.functions[entry].address,
			[control, arena, metadata, address, +atomic, limit, +resumed, pendingStrings, 0, output]));
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
	function traceNative(address: number, atomic: boolean, limit: number, resumed: boolean) {
		const mem = oracle.memory;
		return nativeHeapReference(oracle).gc['traceThread'](address, atomic, limit, resumed ? mem.readRamRecordWord(control + GC_TRACE_CURSOR) : 0,
			resumed ? mem.readRamRecordWord(control + GC_THREAD_TRACE_OPEN) : openHead,
			resumed ? mem.readRamRecordWord(control + GC_THREAD_TRACE_OPEN + 4) : 0, resumed);
	}
	function step(address: number, atomic: boolean, limit: number, resumed: boolean, pendingStrings = 0) {
		const work = traceNative(address, atomic, limit, resumed);
		begin(address, atomic, limit, resumed, pendingStrings);
		assert.deepEqual(finish(), [work, nativeHeapReference(oracle).stringPool.takeMarkWork()]);
		compare();
		return work;
	}
	word(control, GcPhase.Mark | 0x100);
	return { cpu, oracle, memory, control, add, word, cell, closure, value, traceNative, begin, grant, finish, step, compare };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua Thread trace matches native frame, open-chain, and tagged argument continuations at O${optLevel}`, () => {
		const { cpu, oracle, memory, control, add, word, cell, closure, value, step } = fixture(optLevel);
		const thread = add(target => allocateThreadRecordReference(target, 0)), resumer = add(target => allocateThreadRecordReference(target, 0));
		const entry = closure(), framed = closure(), handler = closure(), ignored = closure();
		const open = cell(), stale = cell();
		const string = add(target => nativeHeapReference(target).stringPool.intern('thread-open-value'));
		const err = add(target => nativeHeapReference(target).stringPool.intern('thread-error-value'));
		const prior = add(target => nativeHeapReference(target).stringPool.intern('thread-pending-value'));
		const frames = memory.readRamRecordWord(thread + ThreadField.FrameBlock);
		word(thread + ThreadField.Resumer, resumer);
		word(thread + ThreadField.Entry, entry);
		word(thread + ThreadField.ErrorWord, err);
		word(thread + ThreadField.ErrorKind, ValueTag.String);
		word(thread + ThreadField.FrameDepth, 2);
		word(frames + FrameField.Closure, framed);
		word(frames + FrameField.OpenHead, open);
		const last = frames + FRAME_CONTROL_BYTES;
		word(last + FrameField.Closure, 0);
		// The source reads the canonical header even for a null Closure.
		// A matching public word still fails the allocator-issued predicate.
		word(RAM_BASE, ValueTag.Closure | (nativeHeapReference(cpu).gc.white() << 8));
		word(last + FrameField.OpenHead, 0);
		word(last + FrameField.StackBase, 2);
		word(last + FrameField.Top, 3);
		word(last + FrameField.StackCapacity, 6);
		// Only the handler in the live argument area is a root; an
		// address-shaped word in Thread padding is not a Value.
		word(thread + 68, ignored);
		word(last + FrameField.VarargBase, 1);
		value(thread, 6, ValueTag.String, string);
		value(thread, 1, ValueTag.Closure, handler);
		for (const target of [cpu, oracle]) {
			bindOpen(target.memory, open, thread, 6, stale);
			bindOpen(target.memory, stale, thread, 7, 0);
			nativeHeapReference(target).stringPool.beginReachabilityEpoch();
			nativeHeapReference(target).stringPool.markReachable(prior);
		}
		assert.equal(nativeHeapReference(cpu).stringPool.takeMarkWork(), 1);
		assert.equal(step(thread, false, 1, false, 1), 22, 'header drains pending and error string work');
		assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT), 1);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_CURSOR), 0);
		assert.equal(memory.readRamRecordWord(control + GC_THREAD_TRACE_OPEN), openHead);
		assert.equal(step(thread, false, 14, true), 14);
		assert.equal(memory.readRamRecordWord(control + GC_THREAD_TRACE_OPEN), open);
		assert.equal(step(thread, false, 4, true), 5);
		assert.equal(memory.readRamRecordWord(control + GC_THREAD_TRACE_OPEN), stale);
		assert.equal(memory.readRamRecordWord(control + GC_THREAD_TRACE_OPEN + 4), 7);

		// A returning frame can close the saved cell and move the control
		// array before the next collector grant. The cursor is logical.
		for (const target of [cpu, oracle]) close(nativeHeapReference(target).gc, stale);
		const newFrames = add(target => {
			const staged = nativeHeapReference(target).heapAllocator.allocate(4 * FRAME_CONTROL_BYTES, true);
			return nativeHeapReference(target).gc.threads.growFrameBacking(thread, 4, staged);
		});
		assert.notEqual(newFrames, frames);
		assert.equal(step(thread, false, 1, true), 14, 'closed saved cell clocks no Next lane and the relocated second frame is read');
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_CURSOR), Stage.Values << cursorBits);
		for (let i = 0; i < 16 && memory.readRamRecordWord(control + GC_TRACE_RECORD) !== 0; ++i) step(thread, false, 3, true);
		assert.equal(memory.readRamRecordByte(ignored + GC_COLOR_OFFSET), nativeHeapReference(cpu).gc.white(), 'Thread padding is not a root');
		assert.equal(memory.readRamRecordWord(thread + 68), ignored, 'trace leaves padding intact');
		assert.equal(memory.readRamRecordByte(handler + GC_COLOR_OFFSET), 2, 'the tagged handler slot is traced');
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), 0);
		assert.equal(memory.readRamRecordWord(control + GC_THREAD_TRACE_OPEN + 4), 0);
	});

	test(`BLua atomic Thread trace preserves live frame slots and rewinds between cleared planes at O${optLevel}`, () => {
		const { cpu, oracle, memory, control, word, value, traceNative, begin, grant, finish, step, compare } = fixture(optLevel);
		const thread = cpu.rootThread.address;
		const depth = memory.readRamRecordWord(thread + ThreadField.FrameDepth) & THREAD_CONTROL_COUNT_MASK;
		assert.ok(depth > 0);
		const frame = memory.readRamRecordWord(thread + ThreadField.FrameBlock) + (depth - 1) * FRAME_CONTROL_BYTES;
		const stack = memory.readRamRecordWord(thread + ThreadField.StackBlock), capacity = memory.readRamRecordWord(thread + ThreadField.StackCapacity);
		const liveTop = 4;
		word(frame + FrameField.StackBase, 0);
		word(frame + FrameField.Top, liveTop);
		word(frame + FrameField.StackCapacity, capacity);
		for (let index = 0; index < capacity; ++index) value(thread, index, ValueTag.Integer, 0x6d000000 + index);
		assert.equal(step(thread, true, 1, false), 20);
		for (let i = 0; i < 16 && (memory.readRamRecordWord(control + GC_TRACE_CURSOR) >>> cursorBits) !== Stage.Clear; ++i)
			step(thread, true, 1, true);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_CURSOR), (Stage.Clear << cursorBits) | liveTop);
		assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT), 0);

		const payload = stack + 4 * liveTop, tag = stack + 4 * capacity + liveTop;
		const work = traceNative(thread, true, 4, true);
		begin(thread, true, 4, true);
		for (let i = 0; i < 512 && memory.readRamRecordWord(payload + 4) !== 0; ++i) grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(payload), 0);
		assert.equal(memory.readRamRecordWord(payload + 4), 0);
		assert.equal(memory.readRamRecordByte(tag), ValueTag.Integer, 'payload plane is cleared before tags');
		const partial = captureCpuCheckpoint(cpu);
		assert.deepEqual(finish(), [work, 0]);
		compare();
		restoreCpuCheckpoint(cpu, partial);
		assert.deepEqual(finish(), [work, 0]);
		compare();
		for (let i = 0; i < 16 && memory.readRamRecordWord(control + GC_TRACE_RECORD) !== 0; ++i) step(thread, true, 3, true);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), 0);
		for (let index = 0; index < capacity; ++index) {
			assert.equal(memory.readRamRecordWord(stack + 4 * index), index < liveTop ? 0x6d000000 + index : 0);
			assert.equal(memory.readRamRecordByte(stack + 4 * capacity + index), index < liveTop ? ValueTag.Integer : ValueTag.Nil);
		}
	});
}
