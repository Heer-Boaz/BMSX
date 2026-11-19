import { GC_GRAY_INDEX_BITS, GC_RECORD_LINK } from '../../machine/ts/machine/cpu/gc_object';
import { integerConstant } from '../../toolchain/ts/lua/number';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValueTag, valueBool, valueBuiltinFunction, valueInteger, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../machine/ts/machine/cpu/errors';
import { FRAME_CONTROL_BYTES, FrameField, ProtectedField, type CallFrame } from '../../machine/ts/machine/cpu/call_state';
import { CLOSURE_CAPTURE_WORDS, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../machine/ts/machine/cpu/closure';
import { THREAD_STACK_SLOT_BYTES } from '../../machine/ts/machine/cpu/thread';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE, MAIN_RAM_SIZE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

function callImage(maxStack: number, returns: number, base = 0) {
	const text = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, base, 0, 0);
	writeInstruction(text, 2, OpCode.CALL, base, 1, returns === 0 ? 0 : returns + 1);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 63, 255);
	writeInstruction(text, 4, OpCode.RET, 0, 2, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 63, 255);
	return linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 4, maxStack: 8 },
		{ firstWord: 4, wordCount: 1, maxStack },
		{ firstWord: 5, wordCount: 1, maxStack: 8 },
	], exceptionFunctionIndex: 2,
	closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }] });
}

test('thread-owned nodes reuse stable identities and trim only the spare tail', () => {
	const { cpu } = createTestSystemCpu(callImage(8, 1));
	const thread = cpu.rootThread, frames: CallFrame[] = [];
	thread.leaveFrame();
	for (let index = 0; index < 8; ++index) {
		const frame = thread.acquireFrame();
		thread.reserveFrame(thread.stackRegisters.capacity());
		frame.initializeControl(0, 0, 0, false, -1, 0, 0, 0, 0, 0, 0, 0, 0);
		assert.equal(thread.frameDepth, index, 'preparation does not activate a frame');
		thread.enterFrame(frame); frames.push(frame);
		assert.equal(frame.previous, index === 0 ? null : frames[index - 1]);
	}
	while (thread.frameDepth > 1) thread.leaveFrame();
	const prepared = thread.acquireFrame();
	assert.equal(prepared, frames[1]);
	assert.equal(thread.frameIndex(prepared), -1, 'retained but inactive frames are not diagnostic stack entries');
	thread.trimFrames();
	assert.equal(thread.currentFrame, frames[0]); assert.equal(thread.acquireFrame(), prepared);
	let retained = 0, previous: CallFrame | null = null;
	for (let frame = thread.firstFrame; frame !== null; frame = frame.next) {
		assert.equal(frame.controlOffset, frames[0].controlOffset + retained * FRAME_CONTROL_BYTES,
			'surviving inactive views are rebound to their new physical depth');
		assert.equal(frame.previous, previous); previous = frame; ++retained;
	}
	assert.equal(retained, 5);
	thread.enterFrame(prepared); prepared.protectedContinuationIndex = 3; thread.leaveFrame();
	assert.equal(thread.currentFrame, frames[0], 'the retired protected slot is not active');
	thread.leaveFrame();
	thread.trimFrames();
	assert.equal(thread.frameDepth, 0); assert.equal(thread.currentFrame, null);
	assert.equal(thread.acquireFrame(), frames[0], 'an empty thread keeps its first prepared node');
});

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`frame fetch and checkpoint resume use the physical successor PC (${backend})`, () => {
		const text = new Uint8Array(4 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
		writeInstruction(text, 1, OpCode.RET, 0, 2, 0);
		writeInstruction(text, 2, OpCode.KSMI, 0, 0, 9);
		writeInstruction(text, 3, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 1 }] });
		const { cpu, memory } = createTestSystemCpu(image, backend);
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
		const { cpu, memory } = createTestSystemCpu(callImage(8, 1), backend);
		cpu.runUntilDepth(0, 1);
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
		const { cpu, memory } = createTestSystemCpu(image, backend);
		const frame = cpu.rootThread.currentFrame!;
		const start = frame.pc, domain = frame.executionImage.executionDomainId;
		const address = frame.controlOffset + FrameField.Closure;
		const first = DYNAMIC_RAM_BASE + 0x1000, second = first + 32;
		for (const [record, word] of [[first, 73], [second, 17]]) {
			const cell = record + 16;
			memory.writeRamRecordByte(record + 3, 1);
			memory.writeRamRecordWord(record + GC_RECORD_LINK, (1 << GC_GRAY_INDEX_BITS) | 0x2345);
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
			const { cpu, memory } = createTestSystemCpu(image, backend);
			const thread = cpu.rootThread, frame = thread.currentFrame!;
			const entryPc = frame.pc;
			cpu.runUntilDepth(0, 1200);
			const stack = thread.stackOffset();
			const source = mirrored ? (MAIN_RAM_SIZE - stack + 0x1000) >>> 2 : 0;
			cpu.writeFrameExecution(0, frame.executionImage.executionDomainId, frame.functionAddress, entryPc);
			memory.writeRamRecordWord(frame.controlOffset + FrameField.VarargBase, 0xb0000000 | source);
			memory.writeRamRecordWord(frame.controlOffset + FrameField.VarargCount, 0xa0000001);
			memory.writeRamRecordWord(frame.controlOffset + FrameField.Top, 0xc0000000);
			if (mirrored) {
				memory.writeRamRecordWord(stack + source * 4, 73);
				memory.writeRamRecordByte(stack + thread.stackRegisters.capacity() * 4 + source, ValueTag.Integer);
			}
			cpu.runUntilDepth(0, 10);
			assert.equal(frame.registers.get(1), valueInteger(mirrored ? 73 : 7));
			assert.equal(memory.readRamRecordWord(frame.controlOffset + FrameField.Top), 0xc0000002);
		}
	});

	test(`open RET uses the physical value frontier (${backend})`, () => {
		const text = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.RET, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 3 }] });
		const { cpu, memory } = createTestSystemCpu(image, backend);
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

	test(`only the protected target owns completion, including after snapshot restore (${backend})`, () => {
		const text = new Uint8Array(11 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 1, 0, 0);
		writeInstruction(text, 3, OpCode.CALL, 0, 2, 3);
		writeInstruction(text, 4, OpCode.RET, 0, 3, 0);
		writeInstruction(text, 5, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 6, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(text, 7, OpCode.CALL, 0, 1, 2);
		writeInstruction(text, 8, OpCode.RET, 0, 2, 0);
		writeInstruction(text, 9, OpCode.LOADK, 0, 0, 0);
		writeInstruction(text, 10, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 5, maxStack: 8 },
			{ firstWord: 5, wordCount: 4, maxStack: 8 },
			{ firstWord: 9, wordCount: 2, maxStack: 8 },
		], constants: [integerConstant(7)], systemGlobalNames: ['pcall'], closureRelocations: [
			{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) },
			{ wordIndex: 6, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 2) },
		] });
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('pcall'), valueBuiltinFunction(BuiltinFunctionId.PCall));
		for (let grant = 0; grant < 20 && cpu.getFrameDepth() !== 3; ++grant) cpu.runUntilDepth(0, 1);
		assert.equal(cpu.getFrameDepth(), 3);
		assert.equal(cpu.rootThread.protectedDepth, 1);
		assert.equal(cpu.rootThread.currentFrame!.protectedContinuationIndex, -1);
		assert.equal(cpu.rootThread.currentFrame!.previous!.protectedContinuationIndex, 0);
		const snapshot = cpu.captureRuntimeState();
		assert.equal(cpu.rootThread.currentFrame!.previous!.protectedContinuationIndex, 0);
		const ram = cpu.memory.captureSaveState();
		const oldStack = cpu.rootThread.stackOffset();
		cpu.rootThread.resizeStack(80);
		assert.notEqual(cpu.rootThread.stackOffset(), oldStack);
		assert.equal(cpu.rootThread.protectedWord(0, ProtectedField.Flags), 0);
		assert.equal(cpu.rootThread.protectedWord(0, ProtectedField.Caller), 0);
		assert.equal(cpu.rootThread.protectedWord(0, ProtectedField.Wanted), 3);
		cpu.memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(snapshot);
		assert.deepEqual(cpu.captureRuntimeState(), snapshot);
		assert.equal(cpu.rootThread.currentFrame!.protectedContinuationIndex, -1);
		assert.equal(cpu.rootThread.currentFrame!.previous!.protectedContinuationIndex, 0);
		assert.equal(cpu.runUntilDepth(2, 100), RunResult.Halted);
		assert.equal(cpu.rootThread.protectedDepth, 1, 'ordinary child return must not finish protection');
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		const values: Value[] = []; cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueBool(true), valueInteger(7)]);
		assert.equal(cpu.rootThread.protectedDepth, 0);
		assert.equal(cpu.rootThread.protectedDepth, 0);

		cpu.memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(snapshot);
		const block = cpu.memory.readRamRecordWord(cpu.rootThread.address + ThreadField.StackBlock);
		const slots = cpu.memory.readRamRecordWord(cpu.rootThread.address + ThreadField.StackCapacity);
		const control = block + ((slots * THREAD_STACK_SLOT_BYTES + 3) & ~3);
		const frames = cpu.memory.readRamRecordWord(cpu.rootThread.address + ThreadField.FrameCapacity);
		const target = cpu.rootThread.currentFrame!.previous!;
		cpu.memory.writeRamRecordWord(control + FRAME_CONTROL_BYTES + FrameField.CallSite, 0x1234);
		assert.equal(target.callSitePc, 0x1234, 'a raw write updates the suspended frame diagnostic');
		cpu.memory.writeRamRecordWord(control + frames * FRAME_CONTROL_BYTES + ProtectedField.Wanted, 4);
		assert.equal(cpu.runUntilDepth(1, 100), RunResult.Halted);
		const caller = cpu.rootThread.currentFrame!;
		assert.equal(caller.top, 3, 'return placement consumes the RAM record, not a cached host continuation');
		assert.equal(cpu.rootThread.protectedDepth, 0);
	});

	test(`collection while admitting a callee preserves prepared identity and only active roots (${backend})`, () => {
		const { cpu } = createTestSystemCpu(callImage(1024, 1, 4), backend), thread = cpu.rootThread;
		cpu.runUntilDepth(0, 1);
		const caller = thread.currentFrame!, prepared = thread.acquireFrame();
		const live = cpu.stringPool.intern('caller-only-across-admission'); caller.registers.set(0, valueString(live));
		const trackedBytes = cpu.luaHeap.usedBytes();
		cpu.luaHeap.setCollectionTarget(trackedBytes);
		cpu.runUntilDepth(0, 2);
		assert.ok(cpu.gc.active(), 'stack growth triggers an allocation assist');
		assert.equal(thread.currentFrame, prepared); assert.equal(thread.firstFrame, caller); assert.equal(thread.frameDepth, 2);
		assert.equal(cpu.stringPool.find('caller-only-across-admission'), live);
		prepared.registers.set(7, valueString(cpu.stringPool.intern('retired-frame-only')));
		assert.equal(cpu.runUntilDepth(1, 100), RunResult.Halted);
		assert.equal(thread.currentFrame, caller); assert.equal(caller.next, prepared);
		assert.equal(prepared.executionImage, null); assert.equal(prepared.registers.capacity(), 0);
		cpu.collectTrackedHeapBytes();
		assert.equal(cpu.stringPool.find('retired-frame-only'), undefined, 'unused retained frames and their old windows are not roots');
		assert.equal(cpu.stringPool.find('caller-only-across-admission'), live);
	});

	test(`return growth keeps the callee rooted until results have moved (${backend})`, () => {
		const { cpu } = createTestSystemCpu(callImage(8, 62), backend), thread = cpu.rootThread;
		while (thread.frameDepth !== 2) cpu.runUntilDepth(0, 1);
		const caller = thread.firstFrame!, callee = thread.currentFrame!;
		const result = cpu.stringPool.intern('returning-frame-only'); callee.registers.set(0, valueString(result)); callee.top = 1;
		const trackedBytes = cpu.luaHeap.usedBytes();
		cpu.luaHeap.setCollectionTarget(trackedBytes);
		assert.equal(cpu.runUntilDepth(1, 100), RunResult.Halted);
		assert.ok(cpu.gc.active(), 'caller window growth triggers an allocation assist');
		assert.equal(cpu.stringPool.find('returning-frame-only'), result);
		assert.equal(caller.registers.getStringId(0), result); assert.equal(caller.stackCapacity, 64); assert.equal(caller.top, 62);
		for (let index = 1; index < 62; ++index) assert.equal(caller.registers.getTag(index), ValueTag.Nil);
		assert.equal(thread.currentFrame, caller); assert.equal(caller.next, callee);
	});

	for (const completion of [false, true]) test(`failed call admission leaves no unallocated extent (${backend}, completion=${completion})`, () => {
		const { cpu } = createTestSystemCpu(callImage(PSX_MACHINE_SPEC.ramBytes, 1), backend), thread = cpu.rootThread;
		cpu.runUntilDepth(0, 1);
		const caller = thread.currentFrame!;
		if (completion) {
			assert.throws(() => cpu.beginCompletionCall(caller.registers.getClosure(0, cpu.gc)), error => error === LUA_OUT_OF_MEMORY_SIGNAL);
			assert.equal(thread.frameDepth, 1); assert.equal(thread.stackTop, 8);
			assert.equal(caller.next!.executionImage, null);
		} else {
			cpu.runUntilDepth(0, 2);
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
			assert.equal(thread.frameDepth, 2); assert.equal(thread.stackTop, 16); assert.equal(thread.currentFrame!.stackBase, 8);
		}
		assert.equal(thread.firstFrame, caller); assert.equal(caller.stackBase, 0); assert.equal(caller.stackCapacity, 8);
	});
}
