import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import {
	DecodedDispatchOp,
	decodedDispatchOp,
} from '../../machine/ts/machine/cpu/execution_image';
import {
	INSTRUCTION_BYTES,
	writeInstruction,
} from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import {
	createTestSystemCpu,
	linkRawTestSystemBlua32,
	type TestBlua32Image,
} from '../helpers/blua32';

function makePairImage(loop = false): TestBlua32Image {
	const code = new Uint8Array(10 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.K1, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.K1, 1, 0, 0, 0);
	writeInstruction(code, 2, OpCode.SHL, 2, 0, 1, 0);
	writeInstruction(code, 3, OpCode.BXOR, 3, 2, 1, 0);
	writeInstruction(code, 4, OpCode.ADD, 4, 3, 1, 0);
	writeInstruction(code, 5, OpCode.SHL, 5, 4, 1, 0);
	writeInstruction(code, 6, OpCode.SHR, 6, 5, 1, 0);
	writeInstruction(code, 7, OpCode.BXOR, 7, 6, 1, 0);
	// JMP -9 repeats physical PCs for cache reconfiguration checks.
	if (loop) writeInstruction(code, 8, OpCode.JMP, 0, 63, 55, 255);
	else writeInstruction(code, 8, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(code, 9, OpCode.RFE, 0, 0, 0, 0);
	return linkRawTestSystemBlua32({
		text: code,
		functions: [
			{ firstWord: 0, wordCount: 9, maxStack: 8 },
			{ firstWord: 9, wordCount: 1 },
		],
		functionIds: ['pairs', 'interrupt_return'],
		startupFunctionIndex: 0,
		irqFunctionIndex: 1,
		exceptionFunctionIndex: 1,
	});
}

test('decoded dispatch recognizes only the selected straight-line numeric pairs', () => {
	assert.equal(decodedDispatchOp(OpCode.SHL, OpCode.BXOR), DecodedDispatchOp.FusedShlBxor);
	assert.equal(decodedDispatchOp(OpCode.ADD, OpCode.SHL), DecodedDispatchOp.FusedAddShl);
	assert.equal(decodedDispatchOp(OpCode.SHR, OpCode.BXOR), DecodedDispatchOp.FusedShrBxor);
	assert.equal(decodedDispatchOp(OpCode.SHL, OpCode.ADD), OpCode.SHL);
	assert.equal(decodedDispatchOp(OpCode.BXOR, OpCode.SHL), OpCode.BXOR);
});

test('normal decoded dispatch preserves the guest budget boundary inside a fused pair', () => {
	const image = makePairImage();
	const { cpu } = createTestSystemCpu(image);
	const entryPc = image.image.functions[0].codeAddress;
	const fusedCpu = createTestSystemCpu(image).cpu;

	assert.equal(fusedCpu.runUntilDepth(0, 4), RunResult.Yielded);
	assert.equal(fusedCpu.readFramePc(0), entryPc + 4 * INSTRUCTION_BYTES);
	assert.equal(fusedCpu.lastPc, entryPc + 3 * INSTRUCTION_BYTES);
	assert.equal(fusedCpu.readFrameRegister(0, 3), 3);

	assert.equal(cpu.runUntilDepth(0, 3), RunResult.Yielded);
	assert.equal(cpu.readFramePc(0), entryPc + 3 * INSTRUCTION_BYTES);
	assert.equal(cpu.lastPc, entryPc + 2 * INSTRUCTION_BYTES);
	assert.equal(cpu.readFrameRegister(0, 2), 2);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.readFrameRegister(0, 3), 3);
	assert.equal(cpu.readFrameRegister(0, 4), 4);
	assert.equal(cpu.readFrameRegister(0, 5), 8);
	assert.equal(cpu.readFrameRegister(0, 6), 4);
	assert.equal(cpu.readFrameRegister(0, 7), 5);
});

test('instrumented dispatch observes the second instruction of a normally fused pair', () => {
	const image = makePairImage();
	const { cpu } = createTestSystemCpu(image);
	const entryPc = image.image.functions[0].codeAddress;
	const secondPc = entryPc + 3 * INSTRUCTION_BYTES;
	const visited: number[] = [];
	cpu.setExecutionHook(
		(_executionDomainId, pc) => {
			visited.push(pc);
			return pc === secondPc;
		},
		SYSTEM_EXECUTION_DOMAIN_MASK,
		0,
	);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.ExecutionStopped);
	assert.deepEqual(visited, [
		entryPc,
		entryPc + INSTRUCTION_BYTES,
		entryPc + 2 * INSTRUCTION_BYTES,
		secondPc,
	]);
	assert.equal(cpu.readFrameRegister(0, 2), 2);
	assert.equal(cpu.readFramePc(0), secondPc);
});

for (const instrumented of [false, true]) test(`sparse observation respects fusion, source stops and cached removal (source hook: ${instrumented})`, () => {
	const image = makePairImage(true), { cpu } = createTestSystemCpu(image);
	const pc = image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES;
	assert.equal(cpu.runUntilDepth(0, 9), RunResult.Yielded);
	const observations: number[] = [];
	cpu.setInstructionObserver({
		points: [new Set([pc]), new Set(), new Set()],
		observe(domain, at, registers) {
			assert.equal(domain, -1);
			assert.equal(registers.getNumber(2), 2);
			observations.push(at);
		},
	});
	if (instrumented) {
		cpu.setExecutionHook((_domain, at) => at === pc, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.ExecutionStopped);
		assert.deepEqual(observations, []);
		cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	}
	assert.equal(cpu.runUntilDepth(0, instrumented ? 1 : 4), RunResult.Yielded);
	assert.equal(cpu.instructionBudgetRemaining, 0);
	assert.equal(cpu.readFrameRegister(0, 3), 3);
	assert.deepEqual(observations, [pc]);
	cpu.setInstructionObserver(null);
	cpu.runUntilDepth(0, 9);
	assert.deepEqual(observations, [pc]);
});
