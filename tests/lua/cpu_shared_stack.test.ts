import { integerConstant } from '../../toolchain/ts/lua/number';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValueTag, asClosure, valueBool, valueFloat, valueInteger, valueNil, type Value } from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
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
		assert.equal(snapshot.threads[0].stack.length, 13, 'snapshot writes the shared range once');
		cpu.restoreRuntimeState(snapshot);
		assert.deepEqual(cpu.captureRuntimeState(), snapshot);
		cpu.setExecutionHook(null, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		cpu.runUntilDepth(0, 100);
		const result: Value[] = [];
		cpu.readCompletionValues(result);
		assert.deepEqual(result, [valueInteger(41), valueNil()]);
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
