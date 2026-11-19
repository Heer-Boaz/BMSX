import { FrameField, FRAME_CONTROL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { DYNAMIC_RAM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SHIFT } from '../../machine/ts/machine/memory/mapped_page';
import { integerConstant } from '../../toolchain/ts/lua/number';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValueTag, asClosure, valueBool, valueFloat, valueInteger, valueNil, type Value } from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { compileCoroutineTest } from '../helpers/coroutine';

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`fixed CALL reuses supplied slots and preserves only its lower caller prefix (${backend})`, () => {
		const text = new Uint8Array(8 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 4, 0, 0);
		writeInstruction(text, 3, OpCode.LOADK, 5, 0, 0);
		writeInstruction(text, 4, OpCode.CALL, 4, 2, 3);
		writeInstruction(text, 5, OpCode.RET, 4, 3, 0);
		writeInstruction(text, 6, OpCode.MOV, 2, 0, 0);
		writeInstruction(text, 7, OpCode.RET, 0, 3, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 6, maxStack: 128 },
			{ firstWord: 6, wordCount: 2, numParams: 2, maxStack: 8 },
		], constants: [integerConstant(37)], closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(0, 1) }] });
		const { cpu } = createTestSystemCpu(image, backend);
		const calleePc = image.image.functions[1].codeAddress;
		cpu.setExecutionHook((_domain, pc) => pc === calleePc, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.ExecutionStopped);
		const parent = cpu.rootThread.firstFrame!, child = cpu.rootThread.currentFrame!;
		assert.equal(child.stackBase, parent.stackBase + 5);
		assert.equal(cpu.rootThread.stackTop, child.stackBase + child.stackCapacity);
		assert.equal(cpu.rootThread.stackRegisters.capacity(), 128, 'callee shares the existing allocation, not an appended maxStack window');
		assert.equal(child.registers.get(0), valueInteger(37));
		assert.equal(child.registers.get(1), valueNil(), 'only the missing parameter is nil-filled');
		child.registers.setInteger(0, 41);
		assert.equal(parent.registers.get(5), valueInteger(41), 'the argument and parameter are the same physical slot');
		assert.equal(parent.registers.get(0), valueInteger(1));
		const snapshot = cpu.captureRuntimeState();
		assert.equal(snapshot.threads[0].stackTop, 13, 'snapshot retains the shared stack extent');
		cpu.restoreRuntimeState(snapshot);
		assert.deepEqual(cpu.captureRuntimeState(), snapshot);
		cpu.setExecutionHook(null, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		cpu.runUntilDepth(0, 100);
		const result: Value[] = [];
		cpu.readCompletionValues(result);
		assert.deepEqual(result, [valueInteger(41), valueNil()]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`overlapping parent and child captures close with their own activation (${backend})`, () => {
		const text = new Uint8Array(18 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.KSMI, 5, 0, 37);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(text, 3, OpCode.SETGL, 0, 0, 0);
		writeInstruction(text, 4, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 5, OpCode.CLOSURE, 4, 0, 0);
		writeInstruction(text, 6, OpCode.CALL, 4, 2, 1);
		writeInstruction(text, 7, OpCode.KSMI, 5, 0, 51);
		writeInstruction(text, 8, OpCode.RET, 0, 1, 0);
		writeInstruction(text, 9, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 10, OpCode.CLOSURE, 1, 0, 0);
		writeInstruction(text, 11, OpCode.SETGL, 1, 0, 1);
		writeInstruction(text, 12, OpCode.KSMI, 0, 0, 42);
		writeInstruction(text, 13, OpCode.RET, 0, 1, 0);
		writeInstruction(text, 14, OpCode.GETUP, 0, 0, 0);
		writeInstruction(text, 15, OpCode.RET, 0, 2, 0);
		writeInstruction(text, 16, OpCode.GETUP, 0, 0, 0);
		writeInstruction(text, 17, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 9, maxStack: 6 },
			{ firstWord: 9, wordCount: 5, numParams: 1, maxStack: 2 },
			{ firstWord: 14, wordCount: 2, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 5 }] },
			{ firstWord: 16, wordCount: 2, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 0 }] },
		], globalNames: ['outer_read', 'inner_read'], closureRelocations: [
			{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(0, 2) },
			{ wordIndex: 5, functionAddress: blua32TestFunctionAddress(0, 1) },
			{ wordIndex: 10, functionAddress: blua32TestFunctionAddress(0, 3) },
		] });
		const { cpu } = createTestSystemCpu(image, backend);
		assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
		for (const [name, expected] of [['outer_read', 51], ['inner_read', 42]] as const) {
			cpu.beginCompletionCall(asClosure(cpu.getGlobalByKey(cpu.stringPool.intern(name)), cpu.gc));
			assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
			const values: Value[] = [];
			cpu.readCompletionValues(values);
			assert.deepEqual(values, [valueInteger(expected)], name);
		}
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) for (const optLevel of [0, 3] as const) {
	test(`shared stack closes live captures and preserves varargs through nested GC and replay (${backend}, O${optLevel})`, () => {
		const image = compileCoroutineTest(`
local collect<const> = collectgarbage
local function outer(first, ...)
 local saved = { first }
 local function read() return saved[1] end
 local function nested(value)
  local overwritten = { value }
  collect()
  return overwritten[1], read()
 end
 first = 99
 local a, b = nested(23)
 return read, a, b, ...
end
local read, a, b, c, d = outer(17, false, -0.0)
collect()
return read(), a, b, c, d
`, optLevel);
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.installBootPrimitives();
		let result = RunResult.Yielded;
		for (let step = 0; step < 1000 && result === RunResult.Yielded; ++step) {
			result = cpu.runUntilDepth(0, 13);
			const state = cpu.captureRuntimeState();
			cpu.restoreRuntimeState(state);
			assert.deepEqual(cpu.captureRuntimeState(), state);
		}
		assert.equal(result, RunResult.Halted);
		const values: Value[] = [];
		cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueInteger(17), valueInteger(23), valueInteger(17), valueBool(false), valueFloat(-0)]);
	});

	test(`zero results are not one nil (${backend}, O${optLevel})`, () => {
		const image = compileCoroutineTest(`
local count<const> = select
local function empty() return end
local function implicit() end
local function nilvalue() return nil end
return count('#', empty()), count('#', implicit()), count('#', nilvalue())
`, optLevel);
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, 10000), RunResult.Halted);
		const values: Value[] = [];
		cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueInteger(0), valueInteger(0), valueInteger(1)]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) for (const top of [0, 31]) {
	test(`open captures remain roots when open VARARG sets top to ${top} (${backend})`, () => {
		const text = new Uint8Array(8 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.NEWT, 2, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(text, 3, OpCode.SETGL, 0, 0, 0);
		writeInstruction(text, 4, OpCode.VARARG, top, 0, 0);
		writeInstruction(text, 5, OpCode.RET, 0, 1, 0);
		writeInstruction(text, 6, OpCode.GETUP, 0, 0, 0);
		writeInstruction(text, 7, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 6, maxStack: 4, isVararg: true },
			{ firstWord: 6, wordCount: 2, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 2 }] },
		], globalNames: ['read'], closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(0, 1) }] });
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.setExecutionHook((_domain, pc) => pc === image.image.functions[0].codeAddress + 5 * INSTRUCTION_BYTES, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.ExecutionStopped);
		assert.equal(cpu.rootThread.currentFrame!.top, top);
		cpu.collectTrackedHeapBytes(); cpu.restoreRuntimeState(cpu.captureRuntimeState());
		const table = cpu.rootThread.currentFrame!.registers.get(2);
		assert.equal(cpu.rootThread.currentFrame!.registers.getTag(2), ValueTag.Table, 'capture owns its cell independently of the open result range');
		cpu.setExecutionHook(null, SYSTEM_EXECUTION_DOMAIN_MASK, 0); cpu.runUntilDepth(0, 100);
		cpu.beginCompletionCall(asClosure(cpu.getGlobalByKey(cpu.stringPool.intern('read')), cpu.gc));
		cpu.runUntilDepth(0, 100);
		const values: Value[] = []; cpu.readCompletionValues(values);
		assert.deepEqual(values, [table]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript])
test(`an active physical stack aliases bus loads and stores without losing code watches (${backend})`, () => {
	const text = new Uint8Array(5 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.KSMI, 0, 0, 37);
	writeInstruction(text, 1, OpCode.LOAD_MEM, 1, 4, 0);
	writeInstruction(text, 2, OpCode.STORE_MEM, 5, 4, 0);
	writeInstruction(text, 3, OpCode.MOV, 2, 0, 0);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }] });
	const { cpu } = createTestSystemCpu(image, backend);
	const fn = image.image.functions[0];
	const cycles = BASE_CYCLES[OpCode.KSMI] + BASE_CYCLES[OpCode.LOAD_MEM] + BASE_CYCLES[OpCode.STORE_MEM]
		+ BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP];
	const thread = cpu.rootThread, regs = thread.currentFrame!.registers;
	regs.setInteger(4, DYNAMIC_RAM_BASE); regs.setInteger(5, 73);
	cpu.runUntilDepth(0, 512 * cycles);
	if (backend === CpuExecutionBackend.JavaScript)
		assert.ok(thread.currentFrame!.decodedPage!.compiledBlocks!.entries[(fn.codeAddress & MAPPED_PAGE_BYTE_MASK) >>> 2],
			'the alias regression exercises a warmed JavaScript entry');
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, fn.address, fn.codeAddress);
	const offset = thread.stackOffset();
	regs.setInteger(4, RAM_BASE + offset);
	cpu.runUntilDepth(0, 512 * cycles);
	assert.equal(regs.getInteger(1), 37, 'a bus read observes the preceding dirty register');
	assert.equal(regs.getInteger(2), 73, 'a bus write invalidates the resident register value');
	assert.equal(cpu.memory.readRamRecordWord(RAM_BASE + offset), 73);
	const watches = cpu.memory.ramWriteWatches();
	const page = offset >>> MAPPED_PAGE_BYTE_SHIFT, word = (offset & MAPPED_PAGE_BYTE_MASK) >>> 2;
	watches.armWord(page, word);
	watches.armWord(page, word + 7);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, fn.address, fn.codeAddress);
	cpu.runUntilDepth(0, cycles);
	assert.equal(watches.anyWatched(offset, 4), false, 'the stack write consumed its exact word watch');
	assert.equal(watches.anyWatched(offset + 7 * 4, 4), true, 'the unused slot remains watched');
	watches.invalidateWrite(offset + 7 * 4, 4, RAM_BASE, cpu);
	assert.equal(watches.anyWatched(offset + 7 * 4, 4), false, 'unrelated descriptor watches need not be consumed');
	const frame = thread.currentFrame!;
	const baseWord = RAM_BASE + frame.controlOffset + FrameField.StackBase;
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, fn.address, fn.codeAddress);
	regs.setInteger(3, 123); regs.setInteger(4, baseWord); regs.setInteger(5, 0xfff00001);
	cpu.runUntilDepth(0, cycles);
	assert.equal(thread.stackRegisters.getInteger(3), 0, 'the next instruction sees the newly selected register window');
	assert.equal(frame.stackBase, 1, 'upper geometry bits do not drive the slot index');
	assert.equal(thread.stackTop, 9);
	regs.setInteger(0, 99);
	assert.equal(cpu.memory.readRamRecordWord(offset + 4), 99, 'the external write rebinds the frame view');
	cpu.memory.writeMappedU32LE(baseWord, 0);
	const relocatedControl = MAIN_RAM_SIZE - 4 + ((thread.stackRegisters.byteLength() + 3) & ~3);
	for (let i = 0; i < FRAME_CONTROL_BYTES; i += 4)
		cpu.memory.writeRamRecordWord(relocatedControl + i, cpu.memory.readRamRecordWord(frame.controlOffset + i));
	const descriptor = thread.address + ThreadField.StackBlock, descriptorOffset = descriptor - RAM_BASE;
	watches.armWord(descriptorOffset >>> MAPPED_PAGE_BYTE_SHIFT, (descriptorOffset & MAPPED_PAGE_BYTE_MASK) >>> 2);
	cpu.memory.writeMappedU32LE(descriptor, RAM_BASE + MAIN_RAM_SIZE - 4);
	assert.equal(watches.anyWatched(descriptorOffset, 4, false), false, 'the overlapping code watch is consumed');
	assert.equal(watches.anyWatched(descriptorOffset, 4), true, 'the stack view rearms independently');
	assert.ok(thread.stackRegisters.ramMirrored(), 'the relocated bank needs the physical record port');
	regs.setInteger(0, 123);
	regs.setFloatBits(1, 0xffc00042);
	assert.equal(cpu.memory.readRamRecordWord(MAIN_RAM_SIZE - 4), 123);
	assert.equal(cpu.memory.readRamRecordWord(0), 0xffc00042, 'only the record port wraps payload addresses');
	assert.equal(cpu.memory.readRamRecordByte(28), ValueTag.Integer);
	assert.equal(cpu.memory.readRamRecordByte(29), ValueTag.Float, 'the byte plane wraps separately');
	assert.equal(regs.getPayload(1), 0xffc00042);
	regs.copyWithin(1, 0, 2);
	assert.equal(regs.getInteger(1), 123);
	assert.equal(regs.getPayload(2), 0xffc00042, 'wrapped overlap copies have memmove order');
	const checkpoint = cpu.captureRuntimeState();
	const ram = cpu.memory.captureSaveState();
	regs.setInteger(1, 7);
	cpu.memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(checkpoint);
	assert.equal(cpu.readFrameRegister(0, 1), valueInteger(123), 'restoring RAM restores a wrapped register bank');

});
