import { readStockGlobalValue } from '../../toolchain/ts/firmware/stock_global_bank';
import { initializeRecord } from '../helpers/native_heap/closure_record';
import { GcPhase } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { allocateClosureRecordReference } from '../helpers/captured_closure_reference';
import { reserveThreadStorageReference } from '../helpers/thread_allocation_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import { CLOSURE_PROTOTYPE_ADDRESS } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField, THREAD_STACK_SLOT_BYTES } from '../../machine/ts/machine/cpu/thread_record';
import { valueClosure, valuePayload } from '../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { CPU_STATUS_INTERRUPT_ENABLE_CURRENT, CPU_STATUS_USER_MODE_CURRENT, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { IO_IRQ_ACK, IO_IRQ_MASK, IRQ_DMA0_DONE } from '../../machine/ts/spec/bmsx/io';
import { CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END } from '../helpers/firmware_heap_layout';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { linkManagedTestSystem } from '../helpers/managed_system';
import { createTestRuntime } from '../helpers/runtime_sources';

const source = `
local startup<const> = require('bmsx/startup')
cop0.irq_vector = startup.user_irq
mem[${IO_IRQ_MASK}] = ${IRQ_DMA0_DONE}
function hold(a, b)
	cop0.status = cop0.status | ${CPU_STATUS_INTERRUPT_ENABLE_CURRENT | CPU_STATUS_USER_MODE_CURRENT}
	halt_until_irq
	return a, b
end
return hold(0x481029b4, -302981)
`;
// Use an ordinary fixed IRQ entry to park the real caller independently of
// its backing. The vector uses normal BLua calls and returns through RFE.
const irqSource = `
module<const>
local storage<const> = require('kernel/thread_frame_storage')
local layout<const> = require('kernel/gc_runtime_layout')
bss fixture_storage: u32[6]
local enter<const> = function()
	local interrupted<const>: *addr = layout.interrupted_context_address
	mem[${IO_IRQ_ACK}] = ${IRQ_DMA0_DONE}
	if fixture_storage[4] == 0 then
		fixture_storage[5] = storage.reserve_frame_storage(layout.management_offset, *interrupted,
			fixture_storage[0], fixture_storage[1])
	else
		fixture_storage[5] = storage.grow_thread_frame_storage(layout.management_offset, *interrupted,
			fixture_storage[0], fixture_storage[1], fixture_storage[2], fixture_storage[3])
	end
	blua32.rfe()
end
return { enter = enter }
`;
const storageIrq = { path: 'fixture/storage_irq', exportPathKey: 'enter' };

for (const level of [0, 3] as const) {
	let linked: ReturnType<typeof linkManagedTestSystem>;
	function fixture() {
		linked ??= linkManagedTestSystem(source, level, [{ path: storageIrq.path, source: irqSource }], [], 'main', {
			userIrqEntry: storageIrq,
		});
		const rom = writeTestBlua32Rom(linked);
		function machine() {
			const runtime = createTestRuntime(rom);
			runtime.boot();
			runGuestToHalt(runtime.machine.cpu, 1_000_000);
			assert.notEqual(runtime.machine.cpu.activeThread.address, CPU_RESET_BANK_ADDRESS);
			return runtime.machine;
		}
		const { cpu, irqController } = machine(), { cpu: oracle } = machine(), { memory } = cpu, { heapAllocator: arena } = nativeHeapReference(cpu);
		nativeHeapReference(cpu).luaHeap.setCollectionTarget(nativeHeapReference(cpu).luaHeap.capacity());
		const closure = valuePayload(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('hold')!));
		const prototypeAddress = memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
		const prototype = linked.layout.functions.find(f => f.address === prototypeAddress)!;
		assert.ok(prototype);
		const thread = cpu.activeThread, address = thread.address, frame = thread.currentFrame!;
		const depth = thread.frameDepth;
		const request = linked.symbols.metadata.staticScopes.declarations.find(symbol => symbol.name === 'fixture_storage')!.address!;
		const result = () => memory.readRamRecordWord(request + 20);
		const management = arena.managementOffset();
		const read = (field: ThreadField) => memory.readRamRecordWord(address + field);
		const control = read(ThreadField.FrameBlock), occupied = read(ThreadField.FrameDepth) * FRAME_CONTROL_BYTES;
		for (let offset = occupied; offset < read(ThreadField.FrameCapacity) * FRAME_CONTROL_BYTES; offset += 4)
			memory.writeRamRecordWord(control + offset, 0xacce5701);
		function seedOracle() { restoreCpuCheckpoint(oracle, captureCpuCheckpoint(cpu)); }
		function grant(cycles: number) {
			const outcome = cpu.runUntilDepth(depth, cycles, address);
			assert.equal(outcome, cpu.fixedInterruptActive() ? RunResult.Yielded : RunResult.Halted);
			const consumed = cycles - cpu.instructionBudgetRemaining;
			assert.ok(consumed > 0);
			return consumed;
		}
		function finish() {
			let cycles = 0;
			for (let grants = 0; grants < 32768 && cpu.fixedInterruptActive(); ++grants) cycles += grant(256);
			assert.equal(cpu.fixedInterruptActive(), false);
			assert.equal(cpu.activeThread, thread);
			return cycles;
		}
		function post(values: number, frames: number, root: number, cycles: number, full: number) {
			const words = [values, frames, root, cycles, full, 0xffffffff];
			for (let i = 0; i < words.length; ++i) memory.writeRamRecordWord(request + 4 * i, words[i]);
			irqController.raise(IRQ_DMA0_DONE);
			assert.equal(cpu.enterPendingInterrupt(), true);
			assert.equal(cpu.fixedInterruptActive(), true);
		}
		function start(values: number, frames: number, root = closure, cycles = 0) {
			post(values, frames, root, cycles, 1);
		}
		function tryOnce(values: number, frames: number) {
			post(values, frames, 0, 0, 0);
		}
		function compare() {
			const first = memory.ramBusEnd() - RAM_BASE, last = management + GC_WORKSPACE_END;
			const actual = memory.ramData().subarray(first, last), native = oracle.memory.ramData().subarray(first, last);
			if (Buffer.compare(actual, native) === 0) return;
			const mismatch = actual.findIndex((byte, i) => byte !== native[i]);
			assert.equal(actual[mismatch], native[mismatch], `native raw byte offset 0x${(first + mismatch).toString(16)}`);
		}
		return { cpu, oracle, memory, arena, thread, frame, address, closure, prototype, read, seedOracle, grant, finish, start, tryOnce, compare, result };
	}

	test(`paired Values/Frames growth follows native publication order and rewinds at O${level}`, () => {
		const f = fixture(), { cpu, oracle, memory, thread, frame, address, read } = f;
		const oldValues = read(ThreadField.StackCapacity), oldFrames = read(ThreadField.FrameCapacity), oldControl = read(ThreadField.FrameBlock);
		const pc = frame.pc, depth = thread.frameDepth, occupied = nativeHeapReference(cpu).luaHeap.usedBytes();
		const values = oldValues * 2, frames = oldFrames * 2;
		f.seedOracle();
		reserveThreadStorageReference(oracle, address, values, frames, valueClosure(f.closure));
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		f.start(values, frames);
		for (let n = 0; n < 30000 && read(ThreadField.StackCapacity) !== values; ++n) f.grant(1);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(read(ThreadField.StackCapacity), values);
		assert.equal(read(ThreadField.FrameBlock), oldControl, 'Values publish before Frames');
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), occupied, 'Value charge follows the raw Value descriptor');
		assert.equal(thread.stackRegisters.capacity(), oldValues, 'no rebind or caller execution halfway through');
		assert.equal(frame.pc, pc);
		const cpuState = cpu.captureRuntimeState(), middle = history.capture(memory, baseline);
		const spent = f.finish();
		function compare() {
			assert.equal(f.result(), 0);
			assert.equal(thread.stackRegisters.capacity(), values);
			assert.equal(thread.frameCapacity, frames);
			assert.equal(thread.frameDepth, depth);
			assert.equal(frame.pc, pc);
			assert.equal(frame.registers.getPayload(0), 0x481029b4);
			assert.equal(frame.registers.getPayload(1), (-302981) >>> 0);
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), occupied + (values - oldValues) * THREAD_STACK_SLOT_BYTES + (frames - oldFrames) * FRAME_CONTROL_BYTES);
			f.compare();
		}
		compare();
		const end = history.capture(memory, middle);
		history.restore(memory, end, middle);
		cpu.restoreRuntimeState(cpuState);
		assert.equal(f.finish(), spent);
		compare();
	});

	test(`single lanes preserve overlapping tag moves and frame-only realloc at O${level}`, () => {
		const f = fixture(), { cpu, oracle, address, read } = f;
		// The leaf is parameterized by the admitted raw capacity; normal CALL
		// rounds to powers of two, and this exact small native extent overlaps tags.
		f.seedOracle();
		const values = read(ThreadField.StackCapacity) + 1;
		reserveThreadStorageReference(oracle, address, values, 0, valueClosure(f.closure));
		f.start(values, 0);
		f.finish();
		assert.equal(f.result(), 0);
		f.compare();
		const frames = read(ThreadField.FrameCapacity) * 2;
		reserveThreadStorageReference(oracle, address, 0, frames, valueClosure(f.closure));
		f.start(0, frames);
		f.finish();
		assert.equal(f.result(), 0);
		f.compare();
	});

	test(`a refused Value reservation releases only newly staged Frames at O${level}`, () => {
		const f = fixture(), { cpu, oracle, memory, arena, read } = f;
		const frames = read(ThreadField.FrameCapacity) * 2, values = 2048, bytes = frames * FRAME_CONTROL_BYTES;
		const hole = arena.allocate(bytes, true);
		assert.notEqual(hole, 0);
		assert.notEqual(arena.allocate(32, true), 0);
		const holeBytes = arena.allocationBytes(hole);
		while (arena.allocate(4088, true)) { /* consume large extents */ }
		while (arena.allocate(24, true)) { /* consume remaining holes */ }
		arena.free(hole);
		const occupied = arena.occupiedBytes(), logical = nativeHeapReference(cpu).luaHeap.usedBytes();
		const valueBlock = read(ThreadField.StackBlock), frameBlock = read(ThreadField.FrameBlock);
		f.seedOracle();
		const native = nativeHeapReference(oracle).heapAllocator;
		const staged = native.allocate(bytes, true);
		assert.equal(staged, hole);
		assert.equal(native.resizeBacking(valueBlock, values * THREAD_STACK_SLOT_BYTES), 0);
		native.free(staged);
		f.tryOnce(values, frames);
		for (let n = 0; n < 40000 && arena.occupiedBytes() !== occupied + holeBytes; ++n) f.grant(1);
		assert.equal(arena.occupiedBytes(), occupied + holeBytes);
		const checkpoint = captureCpuCheckpoint(cpu);
		const spent = f.finish();
		function compare() {
			assert.equal(f.result(), 0);
			assert.equal(arena.occupiedBytes(), occupied);
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical);
			assert.equal(read(ThreadField.StackBlock), valueBlock);
			assert.equal(read(ThreadField.FrameBlock), frameBlock);
			f.compare();
		}
		compare();
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(f.finish(), spent);
		compare();
	});

	test(`full growth retains its explicit Closure through real physical recovery at O${level}`, () => {
		const f = fixture(), { cpu, oracle, memory, arena, address, read, prototype } = f;
		const values = 2048, frames = read(ThreadField.FrameCapacity) * 2;
		const detached = allocateClosureRecordReference(cpu, 0);
		initializeRecord(memory, detached, { functionAddress: prototype.address, executionDomainId: -1, codeAddress: prototype.codeAddress,
			numParams: prototype.numParams, maxStack: prototype.maxStack, flags: prototype.flags, upvalueTableAddress: prototype.upvalueTableAddress,
			recordUpvalueCount: 0 }, false, nativeHeapReference(cpu).gc.white(), 0);
		nativeHeapReference(cpu).gc.publishObject(detached);
		const victim = createReferenceTable(cpu, 0, 2048);
		const staged = arena.allocate(frames * FRAME_CONTROL_BYTES, true);
		assert.notEqual(staged, 0);
		assert.notEqual(arena.allocate(32, true), 0);
		while (arena.allocate(4088, true)) { /* leave only a GC-reclaimable large reservation */ }
		while (arena.allocate(24, true)) { /* exhaust remaining holes */ }
		arena.free(staged);
		f.seedOracle();
		reserveThreadStorageReference(oracle, address, values, frames, valueClosure(detached));
		const oldStack = read(ThreadField.StackBlock);
		f.start(values, frames, detached);
		for (let n = 0; n < 32768 && nativeHeapReference(cpu).gc.phase() !== GcPhase.Strings; ++n) f.grant(32);
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Strings);
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(read(ThreadField.StackBlock), oldStack, 'retry had not touched the owner while collection runs');
		const checkpoint = captureCpuCheckpoint(cpu);
		const spent = f.finish();
		function verify() {
			assert.equal(f.result(), 0);
			assert.equal(nativeHeapReference(cpu).gc.closureRecordAddress(detached), detached);
			assert.equal(nativeHeapReference(cpu).gc.tableRecordAddress(victim), 0);
			for (const field of [ThreadField.StackBlock, ThreadField.StackCapacity, ThreadField.FrameBlock, ThreadField.FrameCapacity])
				assert.equal(read(field), oracle.memory.readRamRecordWord(address + field));
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), nativeHeapReference(oracle).luaHeap.usedBytes());
			assert.equal(arena.occupiedBytes(), nativeHeapReference(oracle).heapAllocator.occupiedBytes());
		}
		verify();
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(f.finish(), spent);
		verify();
	});
	test(`logical assist is clocked before reservation and impossible extent never collects at O${level}`, () => {
		const f = fixture(), { cpu, oracle, arena, address, read } = f;
		const values = read(ThreadField.StackCapacity) * 2;
		nativeHeapReference(cpu).luaHeap.setCollectionTarget(nativeHeapReference(cpu).luaHeap.usedBytes());
		f.seedOracle();
		reserveThreadStorageReference(oracle, address, values, 0, valueClosure(f.closure));
		// Compare at return to the stopped mutator, after the pending atomic
		// pass that the firmware settles following the reservation.
		nativeHeapReference(oracle).gc.finishFinalMark(valueClosure(f.closure));
		const occupied = arena.occupiedBytes(), logical = nativeHeapReference(cpu).luaHeap.usedBytes();
		f.start(values, 0, f.closure, 1024);
		for (let n = 0; n < 16384 && nativeHeapReference(cpu).gc.epochWork() === 0; ++n) f.grant(1);
		assert.ok(cpu.fixedInterruptActive());
		assert.ok(nativeHeapReference(cpu).gc.epochWork() > 0);
		assert.equal(arena.occupiedBytes(), occupied, 'logical assist precedes physical reservation');
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical);
		f.finish();
		assert.equal(f.result(), 0);
		assert.equal(nativeHeapReference(cpu).gc.phase(), nativeHeapReference(oracle).gc.phase());
		assert.equal(nativeHeapReference(cpu).gc.epochWork(), nativeHeapReference(oracle).gc.epochWork());
		assert.equal(nativeHeapReference(cpu).luaHeap.collectionTarget(), nativeHeapReference(oracle).luaHeap.collectionTarget());
		assert.equal(arena.occupiedBytes(), nativeHeapReference(oracle).heapAllocator.occupiedBytes());
		assert.equal(read(ThreadField.StackBlock), oracle.memory.readRamRecordWord(address + ThreadField.StackBlock));
		f.seedOracle();
		assert.throws(() => reserveThreadStorageReference(oracle, address, 0x100000, 0, valueClosure(f.closure)));
		f.start(0x100000, 0);
		f.finish();
		assert.equal(f.result(), LUA_FAULT_REASON_OUT_OF_MEMORY + 1);
		f.compare();
	});

}
