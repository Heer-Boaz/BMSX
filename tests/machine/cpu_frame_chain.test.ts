import { nativeHeapReference } from '../helpers/native_heap/reference';
import { reserveThreadFrameReference, resizeThreadStackReference, reserveThreadStorageReference } from '../helpers/thread_allocation_reference';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { CLOSURE_COUNT_SHIFT, CLOSURE_COUNT_WORD } from '../../machine/ts/machine/cpu/closure';
import { integerConstant } from '../../toolchain/ts/lua/number';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValueTag, valueFloatBits, valueBool, valueInteger, valueNil, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../machine/ts/machine/cpu/errors';
import { FRAME_CONTROL_BYTES, FrameField, type CallFrame } from '../../machine/ts/machine/cpu/call_state';
import { CLOSURE_CAPTURE_WORDS } from '../../machine/ts/machine/cpu/closure';
import { UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../machine/ts/machine/cpu/upvalue';
import { THREAD_STACK_SLOT_BYTES, ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE, MAIN_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createTestSystemCpu, linkRawTestSystemBlua32, seedTestRomClosure } from '../helpers/blua32';
import { compileCoroutineTest } from '../helpers/coroutine';
import { runGuestToHalt } from '../helpers/cpu_execution';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';

function callImage(maxStack: number, returns: number, base = 0) {
	const text = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.CALL, base, 1, returns === 0 ? 0 : returns + 1);
	writeInstruction(text, 1, OpCode.JMP, 0, 63, 63, 255);
	writeInstruction(text, 2, OpCode.RET, 0, 2, 0);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 63, 255);
	return linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 2, maxStack: 8 },
		{ firstWord: 2, wordCount: 1, maxStack },
		{ firstWord: 3, wordCount: 1, maxStack: 8 },
	], exceptionFunctionIndex: 2 });
}

test('thread growth resizes only the required storage lane', () => {
	const { cpu, memory } = createTestHeapServiceCpu(callImage(8, 1));
	const thread = cpu.rootThread, frame = thread.currentFrame!;
	const location = (field: ThreadField) => memory.readRamRecordWord(thread.address + field);
	const oldFrameCapacity = location(ThreadField.FrameCapacity), oldFrames = location(ThreadField.FrameBlock);
	frame.registers.setInteger(0, 73);
	const pc = frame.pc;

	resizeThreadStackReference(cpu, thread, 64);
	const stack = location(ThreadField.StackBlock);
	assert.equal(location(ThreadField.StackCapacity), 64);
	assert.equal(location(ThreadField.FrameBlock), oldFrames);
	assert.equal(frame.registers.get(0), valueInteger(73));

	reserveThreadFrameReference(cpu, thread, 64);
	const frames = location(ThreadField.FrameBlock);
	assert.equal(location(ThreadField.FrameCapacity), 2 * oldFrameCapacity);
	assert.equal(location(ThreadField.StackBlock), stack);
	assert.equal(frame.pc, pc);

});

test('Thread growth at its logical assist threshold admits only the new capacity', () => {
	const { cpu, memory } = createTestHeapServiceCpu(callImage(8, 1));
	const thread = cpu.rootThread, frame = thread.currentFrame!, heap = nativeHeapReference(cpu).luaHeap;
	const read = (field: ThreadField) => memory.readRamRecordWord(thread.address + field);
	const oldValues = read(ThreadField.StackBlock), oldFrames = read(ThreadField.FrameBlock);
	const oldValueCount = read(ThreadField.StackCapacity), oldFrameCount = read(ThreadField.FrameCapacity);
	const pc = frame.pc;
	frame.registers.setInteger(0, 73); frame.top = 1;
	let target = heap.usedBytes() + (64 - oldValueCount) * THREAD_STACK_SLOT_BYTES + oldFrameCount * FRAME_CONTROL_BYTES;
	heap.setCollectionTarget(target);
	reserveThreadFrameReference(cpu, thread, 64);
	assert.notEqual(read(ThreadField.StackBlock), oldValues);
	assert.notEqual(read(ThreadField.FrameBlock), oldFrames);
	assert.equal(read(ThreadField.StackCapacity), 64);
	assert.equal(read(ThreadField.FrameCapacity), 2 * oldFrameCount);
	assert.equal(heap.usedBytes(), target);
	assert.equal(heap.collectionTarget(), target, 'only the combined increase affects the admission threshold');
	assert.equal(nativeHeapReference(cpu).gc.active(), false);
	assert.equal(frame.pc, pc); assert.equal(frame.registers.get(0), valueInteger(73));

	heap.setCollectionTarget(target += (128 - 64) * THREAD_STACK_SLOT_BYTES);
	resizeThreadStackReference(cpu, thread, 128);
	assert.equal(heap.usedBytes(), target);
	assert.equal(heap.collectionTarget(), target);
	assert.equal(nativeHeapReference(cpu).gc.active(), false);
});

test('full collection trims both Thread execution reservations with no replacement space', () => {
	const { cpu, memory } = createTestHeapServiceCpu(callImage(8, 1));
	const thread = cpu.rootThread, arena = nativeHeapReference(cpu).heapAllocator, frame = thread.currentFrame!;
	reserveThreadStorageReference(cpu, thread.address, 64, 8, valueNil());
	thread.bindStack();
	frame.registers.setInteger(0, 73); frame.top = 1;
	const read = (field: ThreadField) => memory.readRamRecordWord(thread.address + field);
	const blocks = [ThreadField.StackBlock, ThreadField.FrameBlock];
	const before = blocks.map(read), pc = frame.pc;
	while (arena.allocate(4088, true) !== 0) {}
	while (arena.allocate(4 * FRAME_CONTROL_BYTES, true) !== 0) {}
	const history = new RamHistory();
	history.start(memory);
	const initial = history.capture(memory, null), state = cpu.captureRuntimeState();
	nativeHeapReference(cpu).gc.collect();
	assert.deepEqual(blocks.map(read), before);
	assert.deepEqual([ThreadField.StackCapacity, ThreadField.FrameCapacity].map(read), [32, 4]);
	assert.equal(frame.registers.get(0), valueInteger(73));
	assert.equal(frame.pc, pc);
	const regrow = () => {
		reserveThreadStorageReference(cpu, thread.address, 0, 8, valueNil());
		thread.bindStack();
		assert.deepEqual(blocks.map(read), before);
		assert.equal(frame.pc, pc);
	};
	regrow();
	const expected = memory.captureSaveState().ram;
	const completed = history.capture(memory, initial);
	history.restore(memory, completed, initial);
	cpu.restoreRuntimeState(state);
	assert.deepEqual([ThreadField.StackCapacity, ThreadField.FrameCapacity].map(read), [64, 8]);
	assert.equal(cpu.rootThread.currentFrame!.registers.get(0), valueInteger(73));
	nativeHeapReference(cpu).gc.collect();
	regrow();
	assert.equal(Buffer.compare(memory.captureSaveState().ram, expected), 0, 'rewind restores the tag plane and the allocator suffixes');
});

test('a stack grows when only its increment fits and rewinds to the old tag plane', () => {
	const { cpu, memory } = createTestHeapServiceCpu(callImage(8, 1));
	const thread = cpu.rootThread, arena = nativeHeapReference(cpu).heapAllocator;
	resizeThreadStackReference(cpu, thread, 1536);
	const base = memory.readRamRecordWord(thread.address + ThreadField.StackBlock);
	while (arena.allocate(4096, true) !== 0) {}
	resizeThreadStackReference(cpu, thread, 1024);
	assert.equal(arena.allocate(1536 * THREAD_STACK_SLOT_BYTES, true), 0);
	const raw = valueFloatBits(0xffa12345);
	thread.stackRegisters.set(1023, raw);
	const history = new RamHistory();
	history.start(memory);
	const before = history.capture(memory, null), state = cpu.captureRuntimeState();
	resizeThreadStackReference(cpu, thread, 1536);
	assert.equal(memory.readRamRecordWord(thread.address + ThreadField.StackBlock), base);
	assert.equal(thread.stackRegisters.get(1023), raw);
	assert.equal(thread.stackRegisters.get(1024), valueNil());
	assert.equal(thread.stackRegisters.get(1535), valueNil());
	const expected = memory.captureSaveState().ram;
	history.restore(memory, history.capture(memory, before), before);
	cpu.restoreRuntimeState(state);
	assert.equal(thread.stackRegisters.capacity(), 1024);
	assert.equal(thread.stackRegisters.get(1023), raw);
	resizeThreadStackReference(cpu, thread, 1536);
	assert.equal(Buffer.compare(memory.captureSaveState().ram, expected), 0);
});

test('second-lane physical failure does not publish either replacement or charge', () => {
	const { cpu, memory } = createTestHeapServiceCpu(callImage(8, 1));
	const thread = cpu.rootThread, frame = thread.currentFrame!, arena = nativeHeapReference(cpu).heapAllocator;
	const read = (field: ThreadField) => memory.readRamRecordWord(thread.address + field);
	frame.registers.setInteger(0, 73); frame.top = 1;
	nativeHeapReference(cpu).gc.collect();
	const fields = [ThreadField.StackBlock, ThreadField.FrameBlock, ThreadField.StackCapacity, ThreadField.FrameCapacity];
	const before = fields.map(read), used = nativeHeapReference(cpu).luaHeap.usedBytes();
	const newValues = 128, valueBytes = newValues * THREAD_STACK_SLOT_BYTES;
	const frameBytes = 2 * before[3] * FRAME_CONTROL_BYTES;
	const spare = arena.allocate(frameBytes, true);
	assert.notEqual(spare, 0);
	assert.notEqual(arena.allocate(frameBytes, true), 0);
	while (arena.allocate(4088, true) !== 0) {}
	while (arena.allocate(frameBytes, true) !== 0) {}
	arena.free(spare);
	const available = arena.allocate(frameBytes, true);
	assert.notEqual(available, 0);
	assert.equal(arena.allocate(valueBytes, true), 0, 'after staging the controls no replacement stack fits');
	arena.free(available);
	const occupied = arena.occupiedBytes();
	assert.throws(() => reserveThreadFrameReference(cpu, thread, newValues), error => error === LUA_OUT_OF_MEMORY_SIGNAL);
	assert.deepEqual(fields.map(read), before);
	assert.equal(frame.registers.get(0), valueInteger(73));
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), used);
	assert.equal(arena.occupiedBytes(), occupied, 'no destination survives the failed owner allocation');
});

test('reusing a frame view does not publish it before activation', () => {
	const { cpu } = createTestHeapServiceCpu(callImage(8, 1));
	const thread = cpu.rootThread, frames: CallFrame[] = [];
	thread.leaveFrame();
	for (let index = 0; index < 8; ++index) {
		const frame = thread.acquireFrame();
		reserveThreadFrameReference(cpu, thread, thread.stackRegisters.capacity());
		frame.initializeControl(0, 0, 0, false, -1, 0, 0, 0, 0, 0, 0, 0, 0);
		assert.equal(thread.frameDepth, index, 'preparation does not activate a frame');
		thread.enterFrame(frame); frames.push(frame);
		assert.equal(frame.previous, index === 0 ? null : frames[index - 1]);
	}
	while (thread.frameDepth > 1) thread.leaveFrame();
	const prepared = thread.acquireFrame();
	assert.equal(prepared, frames[1]);
	assert.equal(thread.frameIndex(prepared), -1, 'retained but inactive frames are not diagnostic stack entries');
	assert.equal(thread.currentFrame, frames[0]);
	assert.equal(prepared.controlOffset, frames[0].controlOffset + FRAME_CONTROL_BYTES);
	thread.enterFrame(prepared); thread.leaveFrame();
	assert.equal(thread.currentFrame, frames[0], 'the retired activation is not active');
	thread.leaveFrame();
	assert.equal(thread.frameDepth, 0); assert.equal(thread.currentFrame, null);
	assert.equal(thread.acquireFrame(), frames[0], 'an empty thread keeps its first prepared node');
});

for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`frame fetch and checkpoint resume use the physical successor PC (${backend})`, () => {
		const text = new Uint8Array(4 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
		writeInstruction(text, 1, OpCode.RET, 0, 2, 0);
		writeInstruction(text, 2, OpCode.KSMI, 0, 0, 9);
		writeInstruction(text, 3, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 1 }] });
		const { cpu, memory } = createTestHeapServiceCpu(image, backend);
		const state = cpu.captureRuntimeState(), initialRam = memory.captureSaveState();
		const frame = cpu.rootThread.currentFrame!;
		memory.writeRamRecordWord(frame.controlOffset + FrameField.Pc, frame.pc + 2 * INSTRUCTION_BYTES);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		const values: Value[] = []; cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueInteger(9)]);

		memory.restoreSaveState(initialRam);
		cpu.restoreRuntimeState(state);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueInteger(1)]);
	});

	test(`RET restores a saved bank even when the selected socket is empty (${backend})`, () => {
		const image = callImage(8, 1);
		const { cpu, memory } = createTestHeapServiceCpu(image, backend);
		cpu.rootThread.frameAtDepth(0).registers.setClosure(0, seedTestRomClosure(cpu, image.symbols.functionAddresses[1]));
		const caller = cpu.rootThread.currentFrame!;
		caller.savedExecutionBank = 1;
		assert.equal(cpu.activeCartridgeSlot(), -1, 'a saved bank is not the current fetch latch');
		const checkpoint = cpu.captureRuntimeState(), ram = memory.captureSaveState();
		memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(checkpoint);
		assert.equal(cpu.activeCartridgeSlot(), -1, 'restoring the raw frame does not replace the live bank latch');
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.getFrameDepth(), 2, 'the current BIOS bank still admits CALL');
		cpu.runUntilDepth(1, 100);
		assert.equal(cpu.activeCartridgeSlot(), 1, 'RET loads the saved execution bank');
		const missing = cpu.captureRuntimeState(), missingRam = memory.captureSaveState();
		memory.restoreSaveState(missingRam); cpu.restoreRuntimeState(missing);
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readCauseWord() & 0x7c, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR);
		assert.equal(cpu.readExceptionDomainWord(), 1);
	});

	test(`GETUP and checkpoint restore read the active closure address from RAM (${backend})`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.GETUP, 0, 0, 0);
		writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 1 }] });
		const { cpu, memory } = createTestHeapServiceCpu(image, backend);
		const frame = cpu.rootThread.currentFrame!;
		const start = frame.pc, domain = frame.executionImage.executionDomainId;
		const address = frame.controlOffset + FrameField.Closure;
		const first = DYNAMIC_RAM_BASE + 0x1000, second = first + 32;
		for (const [record, word] of [[first, 73], [second, 17]]) {
			const cell = record + 16;
			memory.writeRamRecordByte(record + 3, 1);
			memory.writeRamRecordWord(record + CLOSURE_COUNT_WORD, (1 << CLOSURE_COUNT_SHIFT) | 0x2345);
			memory.writeRamRecordWord(record + CLOSURE_CAPTURE_WORDS, cell | 0x80000000);
			memory.writeRamRecordWord(cell + UPVALUE_VALUE_WORD, word);
			memory.writeRamRecordByte(cell + UPVALUE_VALUE_TAG, ValueTag.Integer);
		}
		memory.writeRamRecordWord(address, first | 0x80000000);
		cpu.runUntilDepth(0, 1200);
		assert.equal(cpu.readFrameRegister(0, 0), valueInteger(73));
		const saved = cpu.captureRuntimeState(), ram = memory.captureSaveState();
		memory.writeRamRecordWord(address, second);
		frame.pc = start;
		cpu.runUntilDepth(0, 40);
		assert.equal(cpu.readFrameRegister(0, 0), valueInteger(17));
		assert.equal(cpu.getFrameUpvalueCount(0), 8193, 'the wide capture count does not include the gray link');
		assert.equal(frame.executionImage.executionDomainId, domain);

		memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
		cpu.rootThread.currentFrame!.pc = start;
		cpu.runUntilDepth(0, 40);
		assert.equal(cpu.readFrameRegister(0, 0), valueInteger(73));
		assert.equal(memory.readRamRecordWord(address), (first | 0x80000000) >>> 0);
	});

	test(`VARARG reads the physical source after a frame-word write (${backend})`, () => {
		const text = new Uint8Array(3 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.KSMI, 0, 0, 7);
		writeInstruction(text, 1, OpCode.VARARG, 1, 0, 0);
		writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 8, isVararg: true }] });
		for (const mirrored of [false, true]) {
			const { cpu, memory } = createTestHeapServiceCpu(image, backend);
			const thread = cpu.rootThread, frame = thread.currentFrame!;
			const entryPc = frame.pc;
			cpu.runUntilDepth(0, 1200);
			const stack = thread.stackOffset();
			const source = mirrored ? (MAIN_RAM_SIZE - stack + 0x1000) >>> 2 : 0;
			cpu.writeFrameExecution(0, frame.executionImage.executionDomainId, frame.functionAddress, entryPc);
			memory.writeRamRecordWord(frame.controlOffset + FrameField.VarargBase, 0xb0000000 | source);
			memory.writeRamRecordWord(frame.controlOffset + FrameField.ArgumentCount, 1);
			memory.writeRamRecordWord(frame.controlOffset + FrameField.StackBase, source + 1);
			frame.growRegisterWindow(frame.stackCapacity);
			memory.writeRamRecordWord(frame.controlOffset + FrameField.Top, 0xc0000000);
			memory.writeRamRecordWord(stack + source * 4, 73);
			memory.writeRamRecordByte(stack + thread.stackRegisters.capacity() * 4 + source, ValueTag.Integer);
			cpu.runUntilDepth(0, 10);
			assert.equal(frame.registers.get(0), valueInteger(7));
			assert.equal(frame.registers.get(1), valueInteger(73));
			assert.equal(memory.readRamRecordWord(frame.controlOffset + FrameField.Top), 0xc0000002);
		}
	});

	test(`open RET uses the physical value frontier (${backend})`, () => {
		const text = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.RET, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 3 }] });
		const { cpu, memory } = createTestHeapServiceCpu(image, backend);
		const frame = cpu.rootThread.currentFrame!;
		frame.registers.setInteger(0, 7);
		frame.registers.setInteger(1, 14);
		frame.registers.setInteger(2, 21);
		memory.writeRamRecordWord(frame.controlOffset + FrameField.Top, 0x80000002);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		const values: Value[] = [];
		cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueInteger(7), valueInteger(14)]);
	});

	test(`suspended protected CALL returns through an ordinary frame after RAM restore (${backend})`, () => {
		const linked = compileCoroutineTest(`
local function leaf()
  halt_until_irq
  return 7
end
local function target() return leaf() end
return pcall(target)
`, 0);
		const { cpu, memory } = createTestSystemCpu(linked, backend);
		runGuestToHalt(cpu, 500_000);
		assert.ok(cpu.isHaltedUntilIrq());
		const protection = linked.symbols.metadata.functionIds.indexOf('module:kernel/protected_call/module');
		assert.notEqual(protection, -1);
		const prototype = linked.symbols.functionAddresses[protection];
		const thread = cpu.rootThread;
		const leaf = thread.currentFrame!, wrapper = leaf.previous!.previous!;
		assert.equal(wrapper.functionAddress, prototype);
		const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
		const finish = () => {
			cpu.clearHaltUntilIrq();
			runGuestToHalt(cpu, 100_000);
			const values: Value[] = [];
			cpu.readCompletionValues(values);
			assert.deepEqual(values, [valueBool(true), valueInteger(7)]);
		};
		finish();
		memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(state);
		assert.deepEqual(cpu.captureRuntimeState(), state);
		assert.equal(thread.currentFrame!.previous!.previous!.functionAddress, prototype);
		finish();
	});

	test(`collection while admitting a callee preserves prepared identity and only active roots (${backend})`, () => {
		const image = callImage(1024, 1, 4);
		const { cpu } = createTestHeapServiceCpu(image, backend), thread = cpu.rootThread;
		cpu.rootThread.frameAtDepth(0).registers.setClosure(4, seedTestRomClosure(cpu, image.symbols.functionAddresses[1]));
		const caller = thread.currentFrame!, prepared = thread.acquireFrame();
		const live = nativeHeapReference(cpu).stringPool.intern('caller-only-across-admission'); caller.registers.set(0, valueString(live));
		const trackedBytes = nativeHeapReference(cpu).luaHeap.usedBytes();
		nativeHeapReference(cpu).luaHeap.setCollectionTarget(trackedBytes);
		cpu.runUntilDepth(0, BASE_CYCLES[OpCode.CALL] + 6);
		assert.ok(nativeHeapReference(cpu).gc.active(), 'stack growth triggers an allocation assist');
		assert.equal(thread.currentFrame, prepared); assert.equal(thread.firstFrame, caller); assert.equal(thread.frameDepth, 2);
		assert.equal(nativeHeapReference(cpu).stringPool.find('caller-only-across-admission'), live);
		prepared.registers.set(7, valueString(nativeHeapReference(cpu).stringPool.intern('retired-frame-only')));
		assert.equal(cpu.runUntilDepth(1, 100), RunResult.Halted);
		assert.equal(thread.currentFrame, caller); assert.equal(caller.next, prepared);
		assert.equal(prepared.executionImage, null); assert.equal(prepared.registers.capacity(), 0);
		nativeHeapReference(cpu).gc.collect();
		assert.equal(nativeHeapReference(cpu).stringPool.find('retired-frame-only'), undefined, 'unused retained frames and their old windows are not roots');
		assert.equal(nativeHeapReference(cpu).stringPool.find('caller-only-across-admission'), live);
	});

	test(`return growth keeps the callee rooted until results have moved (${backend})`, () => {
		const image = callImage(8, 62);
		const { cpu } = createTestHeapServiceCpu(image, backend), thread = cpu.rootThread;
		thread.firstFrame!.registers.setClosure(0, seedTestRomClosure(cpu, image.symbols.functionAddresses[1]));
		for (let grant = 0; grant < 8 && thread.frameDepth !== 2; ++grant) cpu.runUntilDepth(0, 1);
		assert.equal(thread.frameDepth, 2);
		const caller = thread.firstFrame!, callee = thread.currentFrame!;
		const result = nativeHeapReference(cpu).stringPool.intern('returning-frame-only'); callee.registers.set(0, valueString(result)); callee.top = 1;
		const trackedBytes = nativeHeapReference(cpu).luaHeap.usedBytes();
		nativeHeapReference(cpu).luaHeap.setCollectionTarget(trackedBytes);
		assert.equal(cpu.runUntilDepth(1, 100), RunResult.Halted);
		assert.ok(nativeHeapReference(cpu).gc.active(), 'caller window growth triggers an allocation assist');
		assert.equal(nativeHeapReference(cpu).stringPool.find('returning-frame-only'), result);
		assert.equal(caller.registers.getStringId(0), result); assert.equal(caller.stackCapacity, 64); assert.equal(caller.top, 62);
		for (let index = 1; index < 62; ++index) assert.equal(caller.registers.getTag(index), ValueTag.Nil);
		assert.equal(thread.currentFrame, caller); assert.equal(caller.next, callee);
	});

	for (const completion of [false, true]) test(`failed call admission leaves no unallocated extent (${backend}, completion=${completion})`, () => {
		const image = callImage(PSX_MACHINE_SPEC.ramBytes, 1);
		const { cpu } = createTestHeapServiceCpu(image, backend), thread = cpu.rootThread;
		cpu.rootThread.frameAtDepth(0).registers.setClosure(0, seedTestRomClosure(cpu, image.symbols.functionAddresses[1]));
		const caller = thread.currentFrame!;
		if (completion) {
			const values = cpu.memory.readRamRecordWord(thread.address + ThreadField.StackBlock);
			const frames = cpu.memory.readRamRecordWord(thread.address + ThreadField.FrameBlock);
			assert.throws(() => cpu.beginCompletionCall(caller.registers.getPayload(0)), error => error === LUA_OUT_OF_MEMORY_SIGNAL);
			assert.equal(thread.frameDepth, 1); assert.equal(thread.stackTop, 8);
			assert.equal(caller.next, null, 'an impossible extent is rejected before a frame view is acquired');
			assert.equal(cpu.memory.readRamRecordWord(thread.address + ThreadField.StackBlock), values);
			assert.equal(cpu.memory.readRamRecordWord(thread.address + ThreadField.FrameBlock), frames);
		} else {
			cpu.runUntilDepth(0, 2);
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
			assert.equal(thread.frameDepth, 2); assert.equal(thread.stackTop, 16); assert.equal(thread.currentFrame!.stackBase, 8);
		}
		assert.equal(thread.firstFrame, caller); assert.equal(caller.stackBase, 0); assert.equal(caller.stackCapacity, 8);
	});
}
