import { reserveThreadFrameReference } from '../helpers/thread_allocation_reference';
import { bindOpen } from '../helpers/native_heap/upvalue_record';
import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOpen } from '../../machine/ts/machine/cpu/upvalue';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueBool, valueBuiltinFunction, valueClosure, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { seedTestCapturedClosure, seedTestRomClosure } from '../helpers/blua32';
import { createManagedTestOpcodeCpu, linkManagedTestOpcodes } from '../helpers/managed_opcode';
import { runGuestToHalt } from '../helpers/cpu_test_harness';

// A raw placement test supplies a real open Cell in its measured frame. Its
// ROM intentionally has no allocation firmware or descriptor-execution setup.
function seedOpenCaptures(cpu: CPU, prototype: number, register: number, slots: readonly number[]) {
	const cells = new Uint32Array(slots.length);
	const closure = seedTestCapturedClosure(cpu, prototype, cells);
	const frame = cpu.activeThread.currentFrame!;
	for (const [index, slot] of slots.entries()) {
		bindOpen(cpu.memory, cells[index], frame.thread.address, frame.stackBase + slot, frame.openUpvalueHead);
		frame.openUpvalueHead = cells[index];
	}
	frame.registers.set(register, valueClosure(closure));
	return { closure, cells };
}

for (const backend of [CpuExecutionBackend.Interpreter]) {
	for (const [op, operand, placed] of [[OpCode.LOADNIL, 0, 0], [OpCode.LOADNIL, 128, 128],
		[OpCode.VARARG, 0, 3], [OpCode.VARARG, 1, 0], [OpCode.VARARG, 3, 2], [OpCode.VARARG, 129, 128]]) {
		test(`value ranges charge placed slots on cold and warm execution (${backend}, ${op === OpCode.LOADNIL ? 'LOADNIL' : 'VARARG'}, ${operand})`, () => {
			const text = new Uint8Array(5 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, OpCode.JMP, 0, 63, 63, 255);
			writeInstruction(text, 3, op, 2, operand, 0, (operand >>> 6) << 3);
			writeInstruction(text, 4, OpCode.RET, 0, 1, 0);
			const image = linkManagedTestOpcodes({ text, functions: [
				{ firstWord: 0, wordCount: 1, maxStack: 8 },
				{ firstWord: 3, wordCount: 2, maxStack: 160, isVararg: true },
			] });
			const { cpu } = createManagedTestOpcodeCpu(image, backend);
			cpu.runUntilDepth(0, BASE_CYCLES[OpCode.JMP]);
			const closure = seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
			reserveThreadFrameReference(cpu, cpu.rootThread, 176);
			for (let call = 0; call < 20; ++call) {
				cpu.beginCompletionCall(closure, [valueInteger(17), valueInteger(29), valueInteger(31)]);
				const stackBase = cpu.rootThread.currentFrame!.stackBase;
				assert.equal(cpu.runUntilDepth(1, 1000), RunResult.Halted);
				assert.equal(cpu.instructionBudgetRemaining, 1000 - BASE_CYCLES[op] - BASE_CYCLES[OpCode.RET] - placed);
				for (let i = 0; i < placed; ++i)
					assert.equal(cpu.rootThread.stackRegisters.get(stackBase + 2 + i), op === OpCode.VARARG && i < 3 ? valueInteger([17, 29, 31][i]) : valueNil());
			}
		});
	}
	for (const [params, args, vararg] of [[3, 1, false], [1, 3, false], [3, 1, true], [1, 3, true]] as const) {
		test(`CALL charges only initialized parameters (${backend}, params=${params}, args=${args}, vararg=${vararg})`, () => {
			const text = new Uint8Array(6 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, 1, OpCode.LOADK, 0, 0, 0);
			writeInstruction(text, 2, OpCode.MOV, 4, 0, 0);
			writeInstruction(text, 3, OpCode.CALL, 4, args + 1, 1);
			writeInstruction(text, 4, OpCode.JMP, 0, 63, 61, 255);
			writeInstruction(text, 5, OpCode.RET, 0, 1, 0);
			const image = linkManagedTestOpcodes({ text, verifiedControlFlow: true, constants: [integerConstant(0)], functions: [
				{ firstWord: 0, wordCount: 5, maxStack: 16 },
				{ firstWord: 5, wordCount: 1, numParams: params, maxStack: 8, isVararg: vararg },
			], constValueRelocs: [{ constIndex: 0, kind: 'code_function', target: { kind: 'proto', protoIndex: 1 } }] });
			const { cpu } = createManagedTestOpcodeCpu(image, backend);
			cpu.runUntilDepth(0, 5000); cpu.runUntilDepth(1, 100);
			const root = cpu.rootThread.currentFrame!;
			const placed = vararg ? params : Math.max(params - args, 0);
			for (const grant of [1, 2, 2 + placed]) {
				root.registers.copySlotFrom(root.registers, 4, 0);
				for (let i = 0; i < args; ++i) root.registers.setInteger(5 + i, 17 + i);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, root.functionAddress, image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES);
				assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
				assert.equal(cpu.instructionBudgetRemaining, grant - BASE_CYCLES[OpCode.CALL] - placed);
				assert.equal(cpu.getFrameDepth(), 2, 'an exhausted CALL completes placement but cannot execute the callee RET');
				const callee = cpu.rootThread.currentFrame!;
				for (let i = 0; i < params; ++i) assert.equal(callee.registers.get(i), i < args ? valueInteger(17 + i) : valueNil());
				cpu.runUntilDepth(1, 100);
			}
		});
	}
	test(`RET charges distinct open captures and received closure values (${backend})`, () => {
		const text = new Uint8Array(4 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0);
		writeInstruction(text, 1, OpCode.RET, 2, 3, 0);
		writeInstruction(text, 2, OpCode.GETUP, 0, 0, 0);
		writeInstruction(text, 3, OpCode.RET, 0, 2, 0);
		const image = linkManagedTestOpcodes({ text, constants: [integerConstant(17)], functions: [
			{ firstWord: 0, wordCount: 2, maxStack: 8 },
			{ firstWord: 2, wordCount: 2, maxStack: 2, staticClosure: false,
				upvalueDescs: [{ inStack: true, index: 0 }, { inStack: true, index: 1 }] },
		] });
		const { cpu } = createManagedTestOpcodeCpu(image, backend);
		const prototype = image.symbols.functionAddresses[1];
		const { closure: first, cells } = seedOpenCaptures(cpu, prototype, 2, [0, 1]);
		const second = seedTestCapturedClosure(cpu, prototype, new Uint32Array(0), cells);
		cpu.activeThread.currentFrame!.registers.set(3, valueClosure(second));
		assert.notEqual(ClosureRecord.captureAddress(cpu.memory, first, 0), ClosureRecord.captureAddress(cpu.memory, first, 1));
		assert.equal(ClosureRecord.captureAddress(cpu.memory, first, 0), ClosureRecord.captureAddress(cpu.memory, second, 0));
		cpu.runUntilDepth(0, 1);
		runGuestToHalt(cpu, 1);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.RET] - 2 - 2, 'two distinct open captures, plus two received closure values');
		assert.deepEqual(Array.from(cells, cell => isOpen(cpu.memory, cell)), [false, false]);
	});

}

for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`RFE closes actual captures without charging reservation capacity (${backend})`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.RFE, 0, 0, 0);
		writeInstruction(text, 1, OpCode.RET, 0, 1, 0);
		const image = linkManagedTestOpcodes({ text, functions: [
			{ firstWord: 0, wordCount: 1, maxStack: 160 },
			{ firstWord: 1, wordCount: 1, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 0 }] },
		] });
		const { cpu } = createManagedTestOpcodeCpu(image, backend);
		const { cells: [capture] } = seedOpenCaptures(cpu, image.symbols.functionAddresses[1], 2, [0]);
		cpu.rootThread.currentFrame!.enterException(false);
		runGuestToHalt(cpu, 1);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.RFE] - 1);
		assert.equal(isOpen(cpu.memory, capture), false);
	});
}
