import { integerConstant } from '../../toolchain/ts/lua/number';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValueTag, valueBool, valueBuiltinFunction, valueInteger, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../machine/ts/machine/cpu/errors';
import { Thread } from '../../machine/ts/machine/cpu/thread';
import type { CallFrame } from '../../machine/ts/machine/cpu/call_state';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
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
	const thread = new Thread(null), frames: CallFrame[] = [];
	for (let index = 0; index < 8; ++index) {
		const frame = thread.acquireFrame();
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
		assert.equal(frame.previous, previous); previous = frame; ++retained;
	}
	assert.equal(retained, 5);
	thread.enterFrame(prepared); prepared.protectedContinuationIndex = 3; thread.leaveFrame();
	assert.equal(prepared.protectedContinuationIndex, -1, 'a new activation does not inherit a protected return');
	thread.leaveFrame();
	thread.trimFrames();
	assert.equal(thread.frameDepth, 0); assert.equal(thread.currentFrame, null);
	assert.equal(thread.acquireFrame(), frames[0], 'an empty thread keeps its first prepared node');
});

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
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
		assert.equal(cpu.rootThread.protectedCallDepth, 1);
		assert.equal(cpu.rootThread.currentFrame!.protectedContinuationIndex, -1);
		assert.equal(cpu.rootThread.currentFrame!.previous!.protectedContinuationIndex, 0);
		const snapshot = cpu.captureRuntimeState();
		assert.equal(snapshot.threads[0].protectedCalls[0].targetFrameIndex, 1);
		cpu.restoreRuntimeState(snapshot);
		assert.deepEqual(cpu.captureRuntimeState(), snapshot);
		assert.equal(cpu.rootThread.currentFrame!.protectedContinuationIndex, -1);
		assert.equal(cpu.rootThread.currentFrame!.previous!.protectedContinuationIndex, 0);
		assert.equal(cpu.runUntilDepth(2, 100), RunResult.Halted);
		assert.equal(cpu.rootThread.protectedCallDepth, 1, 'ordinary child return must not finish protection');
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		const values: Value[] = []; cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueBool(true), valueInteger(7)]);
		assert.equal(cpu.rootThread.protectedCallDepth, 0);
		assert.equal(cpu.rootThread.firstFrame!.next!.protectedContinuationIndex, -1);
	});

	test(`collection while admitting a callee preserves prepared identity and only active roots (${backend})`, () => {
		const { cpu } = createTestSystemCpu(callImage(1024, 1, 4), backend), thread = cpu.rootThread;
		cpu.runUntilDepth(0, 1);
		const caller = thread.currentFrame!, prepared = thread.acquireFrame();
		const live = cpu.stringPool.intern('caller-only-across-admission'); caller.registers.set(0, valueString(live));
		const trackedBytes = cpu.luaHeap.usedBytes();
		cpu.luaHeap.restoreState({ trackedBytes, nextCollectionBytes: trackedBytes });
		cpu.runUntilDepth(0, 2);
		assert.ok(cpu.gc.active(), 'stack growth triggers an allocation assist');
		assert.equal(thread.currentFrame, prepared); assert.equal(thread.firstFrame, caller); assert.equal(thread.frameDepth, 2);
		assert.equal(cpu.stringPool.find('caller-only-across-admission'), live);
		prepared.registers.set(7, valueString(cpu.stringPool.intern('retired-frame-only')));
		assert.equal(cpu.runUntilDepth(1, 100), RunResult.Halted);
		assert.equal(thread.currentFrame, caller); assert.equal(caller.next, prepared);
		assert.equal(prepared.closure, null); assert.equal(prepared.executionImage, null); assert.equal(prepared.registers.capacity(), 0);
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
		cpu.luaHeap.restoreState({ trackedBytes, nextCollectionBytes: trackedBytes });
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
			assert.equal(caller.next!.closure, null); assert.equal(caller.next!.executionImage, null);
		} else {
			cpu.runUntilDepth(0, 2);
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
			assert.equal(thread.frameDepth, 2); assert.equal(thread.stackTop, 16); assert.equal(thread.currentFrame!.stackBase, 8);
		}
		assert.equal(thread.firstFrame, caller); assert.equal(caller.stackBase, 0); assert.equal(caller.stackCapacity, 8);
	});
}
