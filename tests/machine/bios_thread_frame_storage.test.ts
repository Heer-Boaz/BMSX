import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import { CLOSURE_PROTOTYPE_ADDRESS, initializeRecord } from '../../machine/ts/machine/cpu/closure';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { ThreadField, THREAD_STACK_SLOT_BYTES } from '../../machine/ts/machine/cpu/thread_record';
import { type Value, valueClosure, valueInteger, valuePayload } from '../../machine/ts/machine/cpu/value';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';

const path = 'kernel/thread_frame_storage';
const source = `local function hold(a, b) halt_until_irq; return a,b end; return hold`;

for (const level of [0, 3] as const) {
	function fixture() {
		const compiled = compileHeapServiceSystem(source, level, [{ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') }]);
		const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
		function entry(exportPathKey: string) {
			const { slotName } = object.sections.rodata.moduleExports.find(e => e.path === path && e.exportPathKey === exportPathKey)!;
			const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
			assert.ok(index >= 0);
			const stack = deriveBlua32FixedStack(linked.image, [index]);
			assert.ok(stack.frames <= HEAP_SERVICE_FRAME_COUNT && stack.valueSlots <= HEAP_SERVICE_VALUE_COUNT,
				`${exportPathKey}: ${stack.frames} pinned frames / ${stack.valueSlots} slots`);
			return linked.image.functions[index].address;
		}
		const attempt = entry('reserve_frame_storage'), full = entry('grow_thread_frame_storage');
		function machine() {
			const memory = new Memory({ systemRom: linked.romBytes, cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
			const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
			cpu.reset();
			runGuestToHalt(cpu, 10_000);
			return cpu;
		}
		const cpu = machine(), oracle = machine(), { memory, heapAllocator: arena } = cpu;
		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
		const results: Value[] = [];
		cpu.readCompletionValues(results);
		const closure = valuePayload(results[0]);
		const prototypeAddress = memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
		const prototype = linked.image.functions.find(f => f.address === prototypeAddress)!;
		assert.ok(prototype);
		cpu.beginCompletionCall(closure, [valueInteger(0x481029b4), valueInteger(-302981)]);
		const thread = cpu.activeThread, address = thread.address, frame = thread.currentFrame!;
		const management = arena.managementOffset();
		const read = (field: ThreadField) => memory.readRamRecordWord(address + field);
		const control = read(ThreadField.FrameBlock), occupied = read(ThreadField.FrameDepth) * FRAME_CONTROL_BYTES;
		for (let offset = occupied; offset < read(ThreadField.FrameCapacity) * FRAME_CONTROL_BYTES; offset += 4)
			memory.writeRamRecordWord(control + offset, 0xacce5701);
		function seedOracle() { restoreCpuCheckpoint(oracle, captureCpuCheckpoint(cpu)); }
		function grant(cycles: number) {
			assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
			const consumed = cycles - cpu.instructionBudgetRemaining;
			assert.ok(consumed > 0);
			return consumed;
		}
		function finish() {
			let cycles = 0;
			for (let grants = 0; grants < 32768 && cpu.heapServiceActive(); ++grants) cycles += grant(256);
			assert.equal(cpu.heapServiceActive(), false);
			return cycles;
		}
		function start(values: number, frames: number, root = closure, cycles = 0) {
			assert.ok(cpu.beginHeapService(full, [management, address, values, frames, root, cycles]));
		}
		function tryOnce(values: number, frames: number) {
			assert.ok(cpu.beginHeapService(attempt, [management, address, values, frames]));
		}
		function compare() {
			const first = memory.ramBusEnd() - RAM_BASE, last = management + HEAP_SERVICE_THREAD_OFFSET;
			const actual = memory.ramData().subarray(first, last), native = oracle.memory.ramData().subarray(first, last);
			if (Buffer.compare(actual, native) === 0) return;
			const mismatch = actual.findIndex((byte, i) => byte !== native[i]);
			assert.equal(actual[mismatch], native[mismatch], `native raw byte offset 0x${(first + mismatch).toString(16)}`);
		}
		return { cpu, oracle, memory, arena, thread, frame, management, address, closure, prototype, read, seedOracle, grant, finish, start, tryOnce, compare };
	}

	test(`paired Values/Frames growth follows native publication order and rewinds at O${level}`, () => {
		const f = fixture(), { cpu, oracle, memory, thread, frame, address, read } = f;
		const oldValues = read(ThreadField.StackCapacity), oldFrames = read(ThreadField.FrameCapacity), oldControl = read(ThreadField.FrameBlock);
		const pc = frame.pc, depth = thread.frameDepth, occupied = cpu.luaHeap.usedBytes();
		const values = oldValues * 2, frames = oldFrames * 2;
		f.seedOracle();
		oracle.luaHeap.reserveThreadFrameStorage(address, values, frames, valueClosure(f.closure));
		oracle.rebindRelocatedThread(address);
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		f.start(values, frames);
		for (let n = 0; n < 30000 && read(ThreadField.StackCapacity) !== values; ++n) f.grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(read(ThreadField.StackCapacity), values);
		assert.equal(read(ThreadField.FrameBlock), oldControl, 'Values publish before Frames');
		assert.equal(cpu.luaHeap.usedBytes(), occupied, 'Value charge follows the raw Value descriptor');
		assert.equal(thread.stackRegisters.capacity(), oldValues, 'no rebind or caller execution halfway through');
		assert.equal(frame.pc, pc);
		const cpuState = cpu.captureRuntimeState(), middle = history.capture(memory, baseline);
		const spent = f.finish();
		function compare() {
			assert.equal(cpu.heapServiceResult(), 0);
			assert.equal(thread.stackRegisters.capacity(), values);
			assert.equal(thread.frameCapacity, frames);
			assert.equal(thread.frameDepth, depth);
			assert.equal(frame.pc, pc);
			assert.equal(frame.registers.getPayload(0), 0x481029b4);
			assert.equal(frame.registers.getPayload(1), (-302981) >>> 0);
			assert.equal(cpu.luaHeap.usedBytes(), occupied + (values - oldValues) * THREAD_STACK_SLOT_BYTES + (frames - oldFrames) * FRAME_CONTROL_BYTES);
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
		oracle.luaHeap.reserveThreadFrameStorage(address, values, 0, valueClosure(f.closure));
		f.start(values, 0);
		f.finish();
		assert.equal(cpu.heapServiceResult(), 0);
		f.compare();
		const frames = read(ThreadField.FrameCapacity) * 2;
		oracle.luaHeap.reserveThreadFrameStorage(address, 0, frames, valueClosure(f.closure));
		f.start(0, frames);
		f.finish();
		assert.equal(cpu.heapServiceResult(), 0);
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
		const occupied = arena.occupiedBytes(), logical = cpu.luaHeap.usedBytes();
		const valueBlock = read(ThreadField.StackBlock), frameBlock = read(ThreadField.FrameBlock);
		f.seedOracle();
		const native = oracle.heapAllocator;
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
			assert.equal(cpu.heapServiceResult(), 0);
			assert.equal(arena.occupiedBytes(), occupied);
			assert.equal(cpu.luaHeap.usedBytes(), logical);
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
		const detached = cpu.luaHeap.allocateClosureRecord(0);
		initializeRecord(memory, detached, { functionAddress: prototype.address, executionDomainId: -1, codeAddress: prototype.codeAddress,
			numParams: prototype.numParams, maxStack: prototype.maxStack, flags: prototype.flags, upvalueTableAddress: prototype.upvalueTableAddress,
			recordUpvalueCount: 0 }, false, cpu.gc.white(), 0);
		cpu.gc.publishObject(detached);
		const victim = cpu.createTable(0, 2048);
		const staged = arena.allocate(frames * FRAME_CONTROL_BYTES, true);
		assert.notEqual(staged, 0);
		assert.notEqual(arena.allocate(32, true), 0);
		while (arena.allocate(4088, true)) { /* leave only a GC-reclaimable large reservation */ }
		while (arena.allocate(24, true)) { /* exhaust remaining holes */ }
		arena.free(staged);
		f.seedOracle();
		oracle.luaHeap.reserveThreadFrameStorage(address, values, frames, valueClosure(detached));
		const oldStack = read(ThreadField.StackBlock);
		f.start(values, frames, detached);
		for (let n = 0; n < 32768 && cpu.gc.phase() !== GcPhase.Strings; ++n) f.grant(32);
		assert.equal(cpu.gc.phase(), GcPhase.Strings);
		assert.ok(cpu.heapServiceActive());
		assert.equal(read(ThreadField.StackBlock), oldStack, 'retry had not touched the owner while collection runs');
		const checkpoint = captureCpuCheckpoint(cpu);
		const spent = f.finish();
		function verify() {
			assert.equal(cpu.heapServiceResult(), 0);
			assert.equal(cpu.gc.closureRecordAddress(detached), detached);
			assert.equal(cpu.gc.tableRecordAddress(victim), 0);
			for (const field of [ThreadField.StackBlock, ThreadField.StackCapacity, ThreadField.FrameBlock, ThreadField.FrameCapacity])
				assert.equal(read(field), oracle.memory.readRamRecordWord(address + field));
			assert.equal(cpu.luaHeap.usedBytes(), oracle.luaHeap.usedBytes());
			assert.equal(arena.occupiedBytes(), oracle.heapAllocator.occupiedBytes());
		}
		verify();
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(f.finish(), spent);
		verify();
	});
	test(`logical assist is clocked before reservation and impossible extent never collects at O${level}`, () => {
		const f = fixture(), { cpu, oracle, arena, address, read } = f;
		const values = read(ThreadField.StackCapacity) * 2;
		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.usedBytes());
		f.seedOracle();
		oracle.luaHeap.reserveThreadFrameStorage(address, values, 0, valueClosure(f.closure));
		const occupied = arena.occupiedBytes(), logical = cpu.luaHeap.usedBytes();
		f.start(values, 0, f.closure, 1024);
		for (let n = 0; n < 12000 && cpu.gc.epochWork() === 0; ++n) f.grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.ok(cpu.gc.epochWork() > 0);
		assert.equal(arena.occupiedBytes(), occupied, 'logical assist precedes physical reservation');
		assert.equal(cpu.luaHeap.usedBytes(), logical);
		f.finish();
		assert.equal(cpu.heapServiceResult(), 0);
		assert.equal(cpu.gc.phase(), oracle.gc.phase());
		assert.equal(cpu.gc.epochWork(), oracle.gc.epochWork());
		assert.equal(cpu.luaHeap.collectionTarget(), oracle.luaHeap.collectionTarget());
		assert.equal(arena.occupiedBytes(), oracle.heapAllocator.occupiedBytes());
		assert.equal(read(ThreadField.StackBlock), oracle.memory.readRamRecordWord(address + ThreadField.StackBlock));
		f.seedOracle();
		assert.throws(() => oracle.luaHeap.reserveThreadFrameStorage(address, 0x100000, 0, valueClosure(f.closure)));
		f.start(0x100000, 0);
		f.finish();
		assert.equal(cpu.heapServiceResult(), LUA_FAULT_REASON_OUT_OF_MEMORY + 1);
		f.compare();
	});

}
