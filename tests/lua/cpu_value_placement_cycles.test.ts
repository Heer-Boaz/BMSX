import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	for (const [op, operand, placed] of [[OpCode.LOADNIL, 0, 0], [OpCode.LOADNIL, 128, 128],
		[OpCode.VARARG, 0, 3], [OpCode.VARARG, 1, 0], [OpCode.VARARG, 3, 2], [OpCode.VARARG, 129, 128]]) {
		test(`value ranges charge placed slots on cold and warm execution (${backend}, ${OpCode[op]}, ${operand})`, () => {
			const text = new Uint8Array(5 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
			writeInstruction(text, 2, OpCode.JMP, 0, 63, 63, 255);
			writeInstruction(text, 3, op, 2, operand, 0, (operand >>> 6) << 3);
			writeInstruction(text, 4, OpCode.RET, 0, 1, 0);
			const image = linkRawTestSystemBlua32({ text, functions: [
				{ firstWord: 0, wordCount: 3, maxStack: 8 },
				{ firstWord: 3, wordCount: 2, maxStack: 160, isVararg: true },
			], closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(0, 1) }] });
			const { cpu } = createTestSystemCpu(image, backend);
			cpu.runUntilDepth(0, 1);
			const closure = cpu.rootThread.currentFrame!.registers.getClosure(0);
			for (let call = 0; call < 20; ++call) {
				cpu.beginCompletionCall(closure, [17, 29, 31]);
				const stackBase = cpu.rootThread.currentFrame!.stackBase;
				assert.equal(cpu.runUntilDepth(1, 1000), RunResult.Halted);
				assert.equal(cpu.instructionBudgetRemaining, 1000 - BASE_CYCLES[op] - 2 - placed);
				for (let i = 0; i < placed; ++i)
					assert.equal(cpu.rootThread.stackRegisters.get(stackBase + 2 + i), op === OpCode.VARARG && i < 3 ? [17, 29, 31][i] : null);
			}
		});
	}
	for (const [params, args, vararg] of [[3, 1, false], [1, 3, false], [3, 1, true], [1, 3, true]] as const) {
		test(`CALL charges only initialized parameters (${backend}, params=${params}, args=${args}, vararg=${vararg})`, () => {
			const text = new Uint8Array(6 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
			writeInstruction(text, 2, OpCode.MOV, 4, 0, 0);
			writeInstruction(text, 3, OpCode.CALL, 4, args + 1, 1);
			writeInstruction(text, 4, OpCode.JMP, 0, 63, 61, 255);
			writeInstruction(text, 5, OpCode.RET, 0, 1, 0);
			const image = linkRawTestSystemBlua32({ text, functions: [
				{ firstWord: 0, wordCount: 5, maxStack: 16 },
				{ firstWord: 5, wordCount: 1, numParams: params, maxStack: 8, isVararg: vararg },
			], closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(0, 1) }] });
			const { cpu } = createTestSystemCpu(image, backend);
			cpu.runUntilDepth(0, 5000); cpu.runUntilDepth(1, 100);
			const root = cpu.rootThread.currentFrame!;
			const placed = vararg ? params : Math.max(params - args, 0);
			for (const grant of [1, 2, 2 + placed]) {
				root.registers.copySlotFrom(root.registers, 4, 0);
				for (let i = 0; i < args; ++i) root.registers.setNumber(5 + i, 17 + i);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, root.functionAddress, image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES);
				assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
				assert.equal(cpu.instructionBudgetRemaining, grant - 2 - placed);
				assert.equal(cpu.getFrameDepth(), 2, 'an exhausted CALL completes placement but cannot execute the callee RET');
				const callee = cpu.rootThread.currentFrame!;
				for (let i = 0; i < params; ++i) assert.equal(callee.registers.get(i), i < args ? 17 + i : null);
				cpu.runUntilDepth(1, 100);
			}
		});
	}
	test(`descriptor bindings and distinct open captures are charged independently (${backend})`, () => {
		const text = new Uint8Array(8 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 2, 0, 0);
		writeInstruction(text, 3, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 4, OpCode.CLOSURE, 3, 0, 0);
		writeInstruction(text, 5, OpCode.RET, 2, 3, 0);
		writeInstruction(text, 6, OpCode.GETUP, 0, 0, 0);
		writeInstruction(text, 7, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, constants: [17], functions: [
			{ firstWord: 0, wordCount: 6, maxStack: 8 },
			{ firstWord: 6, wordCount: 2, maxStack: 2, staticClosure: false,
				upvalueDescs: [{ inStack: true, index: 0 }, { inStack: true, index: 1 }] },
		], closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(0, 1) }, { wordIndex: 4, functionAddress: blua32TestFunctionAddress(0, 1) }] });
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - 1 - 2, 'CLOSURE pays for both descriptor bindings');
		const first = cpu.rootThread.currentFrame!.registers.getClosure(2);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, -2, 'rebinding already-open cells still processes descriptors');
		const second = cpu.rootThread.currentFrame!.registers.getClosure(3);
		assert.notEqual(first.upvalues[0], first.upvalues[1]);
		assert.equal(first.upvalues[0], second.upvalues[0]);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Halted);
		assert.equal(cpu.instructionBudgetRemaining, 1 - 2 - 2 - 2, 'two distinct open captures, plus two received closure values');
		assert.equal(first.upvalues[0].open, false);
	});
	for (const wanted of [0, 1, 5]) test(`nested builtin protection charges every receiving range (${backend}, C=${wanted})`, () => {
		const text = new Uint8Array(5 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
		writeInstruction(text, 1, OpCode.GETSYS, 1, 0, 0);
		writeInstruction(text, 2, OpCode.GETSYS, 2, 0, 1);
		writeInstruction(text, 3, OpCode.CALL, 0, 3, wanted);
		writeInstruction(text, 4, OpCode.JMP, 0, 63, 63, 255);
		const image = linkRawTestSystemBlua32({ text, systemGlobalNames: ['pcall', 'isyieldable'], functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }] });
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('pcall'), ValueTag.BuiltinFunction, BuiltinFunctionId.PCall, null);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('isyieldable'), ValueTag.BuiltinFunction, BuiltinFunctionId.CoroutineIsYieldable, null);
		cpu.runUntilDepth(0, 3);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		const placed = wanted === 0 ? 3 : wanted - 1;
		assert.equal(cpu.instructionBudgetRemaining, 1 - 2 - 4 - 4 - 4 - 2 - placed);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`coroutine yield and resume each charge the actual receiving range (${backend})`, () => {
		const text = new Uint8Array(13 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 1, 0, 0);
		writeInstruction(text, 3, OpCode.CALL, 0, 2, 2);
		writeInstruction(text, 4, OpCode.GETSYS, 4, 0, 1);
		writeInstruction(text, 5, OpCode.MOV, 5, 0, 0);
		writeInstruction(text, 6, OpCode.CALL, 4, 2, 6);
		writeInstruction(text, 7, OpCode.JMP, 0, 63, 60, 255);
		writeInstruction(text, 8, OpCode.GETSYS, 0, 0, 2);
		writeInstruction(text, 9, OpCode.LOADK, 1, 0, 0);
		writeInstruction(text, 10, OpCode.LOADK, 2, 0, 1);
		writeInstruction(text, 11, OpCode.CALL, 0, 3, 3);
		writeInstruction(text, 12, OpCode.RET, 0, 1, 0);
		const image = linkRawTestSystemBlua32({ text, constants: [17, 29], systemGlobalNames: ['create', 'resume', 'yield'], functions: [
			{ firstWord: 0, wordCount: 8, maxStack: 12 }, { firstWord: 8, wordCount: 5, maxStack: 8 },
		], closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(0, 1) }] });
		const { cpu } = createTestSystemCpu(image, backend);
		for (const [name, id] of [['create', BuiltinFunctionId.CoroutineCreate], ['resume', BuiltinFunctionId.CoroutineResume], ['yield', BuiltinFunctionId.CoroutineYield]] as const)
			cpu.setSystemGlobalByKey(cpu.stringPool.intern(name), ValueTag.BuiltinFunction, id, null);
		while (cpu.activeThread === cpu.rootThread) cpu.runUntilDepth(0, 1);
		const child = cpu.activeThread;
		cpu.runUntilDepth(0, 3);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - 2 - 4 - 5);
		assert.equal(cpu.activeThread, cpu.rootThread);
		assert.deepEqual(Array.from({ length: 5 }, (_, i) => cpu.rootThread.currentFrame!.registers.get(4 + i)), [true, 17, 29, null, null]);
		const root = cpu.rootThread.currentFrame!;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, root.functionAddress, image.image.functions[0].codeAddress + 4 * INSTRUCTION_BYTES);
		cpu.runUntilDepth(0, 2);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - 2 - 4 - 2, 'resuming the fixed two-result yield fills both missing values');
		assert.equal(cpu.activeThread, child);
		assert.deepEqual([child.currentFrame!.registers.get(0), child.currentFrame!.registers.get(1)], [null, null]);
	});
	for (const vararg of [false, true]) test(`first coroutine resume charges copied formals and retained extras (${backend}, vararg=${vararg})`, () => {
		const text = new Uint8Array(9 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 1, 0, 0);
		writeInstruction(text, 3, OpCode.CALL, 0, 2, 2);
		writeInstruction(text, 4, OpCode.GETSYS, 4, 0, 1);
		writeInstruction(text, 5, OpCode.MOV, 5, 0, 0);
		writeInstruction(text, 6, OpCode.CALL, 4, 5, 1);
		writeInstruction(text, 7, OpCode.JMP, 0, 63, 63, 255);
		writeInstruction(text, 8, OpCode.RET, 0, 1, 0);
		const image = linkRawTestSystemBlua32({ text, systemGlobalNames: ['create', 'resume'], functions: [
			{ firstWord: 0, wordCount: 8, maxStack: 16 }, { firstWord: 8, wordCount: 1, numParams: 2, maxStack: 8, isVararg: vararg },
		], closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(0, 1) }] });
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('create'), ValueTag.BuiltinFunction, BuiltinFunctionId.CoroutineCreate, null);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('resume'), ValueTag.BuiltinFunction, BuiltinFunctionId.CoroutineResume, null);
		while (cpu.rootThread.currentFrame!.pc !== image.image.functions[0].codeAddress + 6 * INSTRUCTION_BYTES) cpu.runUntilDepth(0, 1);
		for (let i = 0; i < 3; ++i) cpu.rootThread.currentFrame!.registers.setNumber(6 + i, 17 + i);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - 2 - 4 - 2 - (vararg ? 1 : 0));
		assert.notEqual(cpu.activeThread, cpu.rootThread);
		assert.deepEqual([cpu.activeThread.currentFrame!.registers.get(0), cpu.activeThread.currentFrame!.registers.get(1)], [17, 18]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`protected error unwind charges captured cells and error receiving slots (${backend})`, () => {
		const text = new Uint8Array(13 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 1, 0, 0);
		writeInstruction(text, 3, OpCode.CALL, 0, 2, 5);
		writeInstruction(text, 4, OpCode.JMP, 0, 63, 63, 255);
		writeInstruction(text, 5, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 6, OpCode.CLOSURE, 2, 0, 0);
		writeInstruction(text, 7, OpCode.GETSYS, 4, 0, 1);
		writeInstruction(text, 8, OpCode.LOADK, 5, 0, 0);
		writeInstruction(text, 9, OpCode.CALL, 4, 2, 1);
		writeInstruction(text, 10, OpCode.RET, 0, 1, 0);
		writeInstruction(text, 11, OpCode.GETUP, 0, 0, 0);
		writeInstruction(text, 12, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, constants: [17], systemGlobalNames: ['pcall', 'error'], functions: [
			{ firstWord: 0, wordCount: 5, maxStack: 8 }, { firstWord: 5, wordCount: 6, maxStack: 8 },
			{ firstWord: 11, wordCount: 2, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 0 }] },
		], closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(0, 1) }, { wordIndex: 6, functionAddress: blua32TestFunctionAddress(0, 2) }] });
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('pcall'), ValueTag.BuiltinFunction, BuiltinFunctionId.PCall, null);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('error'), ValueTag.BuiltinFunction, BuiltinFunctionId.Error, null);
		while (cpu.activeThread.currentFrame!.pc !== image.image.functions[1].codeAddress + 4 * INSTRUCTION_BYTES) cpu.runUntilDepth(0, 1);
		const capture = cpu.activeThread.currentFrame!.registers.getClosure(2).upvalues[0];
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - 2 - 2 - 1 - 4);
		assert.equal(capture.open, false);
		assert.deepEqual(Array.from({ length: 4 }, (_, i) => cpu.rootThread.currentFrame!.registers.get(i)), [false, 17, null, null]);
	});
	test(`RFE closes actual captures without charging reservation capacity (${backend})`, () => {
		const text = new Uint8Array(4 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 1, OpCode.CLOSURE, 2, 0, 0);
		writeInstruction(text, 2, OpCode.RFE, 0, 0, 0);
		writeInstruction(text, 3, OpCode.RET, 0, 1, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 3, maxStack: 160 },
			{ firstWord: 3, wordCount: 1, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 0 }] },
		], closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(0, 1) }] });
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.runUntilDepth(0, 1);
		const frame = cpu.rootThread.currentFrame!;
		frame.isExceptionFrame = true;
		const capture = frame.registers.getClosure(2).upvalues[0];
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Halted);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.RFE] - 1);
		assert.equal(capture.open, false);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) test(`coroutine close charges open captures and its selected result range (${backend})`, () => {
	const text = new Uint8Array(17 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.CLOSURE, 1, 0, 0);
	writeInstruction(text, 3, OpCode.CALL, 0, 2, 2);
	writeInstruction(text, 4, OpCode.GETSYS, 4, 0, 1);
	writeInstruction(text, 5, OpCode.MOV, 5, 0, 0);
	writeInstruction(text, 6, OpCode.CALL, 4, 2, 1);
	writeInstruction(text, 7, OpCode.GETSYS, 4, 0, 3);
	writeInstruction(text, 8, OpCode.MOV, 5, 0, 0);
	writeInstruction(text, 9, OpCode.CALL, 4, 2, 5);
	writeInstruction(text, 10, OpCode.JMP, 0, 63, 63, 255);
	writeInstruction(text, 11, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 12, OpCode.CLOSURE, 2, 0, 0);
	writeInstruction(text, 13, OpCode.GETSYS, 4, 0, 2);
	writeInstruction(text, 14, OpCode.CALL, 4, 1, 1);
	writeInstruction(text, 15, OpCode.RET, 0, 1, 0);
	writeInstruction(text, 16, OpCode.RET, 0, 1, 0);
	const image = linkRawTestSystemBlua32({ text, systemGlobalNames: ['create', 'resume', 'yield', 'close'], functions: [
		{ firstWord: 0, wordCount: 11, maxStack: 12 }, { firstWord: 11, wordCount: 5, maxStack: 160 },
		{ firstWord: 16, wordCount: 1, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 0 }] },
	], closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(0, 1) }, { wordIndex: 12, functionAddress: blua32TestFunctionAddress(0, 2) }] });
	const { cpu } = createTestSystemCpu(image, backend);
	for (const [name, id] of [['create', BuiltinFunctionId.CoroutineCreate], ['resume', BuiltinFunctionId.CoroutineResume],
		['yield', BuiltinFunctionId.CoroutineYield], ['close', BuiltinFunctionId.CoroutineClose]] as const)
		cpu.setSystemGlobalByKey(cpu.stringPool.intern(name), ValueTag.BuiltinFunction, id, null);
	while (cpu.activeThread === cpu.rootThread) cpu.runUntilDepth(0, 1);
	const child = cpu.activeThread;
	while (cpu.activeThread !== cpu.rootThread) cpu.runUntilDepth(0, 1);
	const capture = child.currentFrame!.registers.getClosure(2).upvalues[0];
	assert.equal(capture.open, true);
	cpu.runUntilDepth(0, 2);
	assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
	assert.equal(cpu.instructionBudgetRemaining, 1 - 2 - 4 - 1 - 4);
	assert.equal(capture.open, false);
	assert.equal(child.frameDepth, 0);
	assert.deepEqual(Array.from({ length: 4 }, (_, i) => cpu.rootThread.currentFrame!.registers.get(4 + i)), [true, null, null, null]);
});
