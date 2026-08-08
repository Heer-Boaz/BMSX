import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import {
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
	BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
	BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET,
	BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
	BLUA32_FUNCTION_STATIC,
	BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
	BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
} from '../../machine/ts/spec/blua32/image_format';
import {
	BASE_BX_BITS,
	CLOSURE_ADDRESS_REGISTER_WIDE_C,
	INSTRUCTION_BYTES,
	MAX_BX_BITS,
	writeInstruction,
} from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode, encodeFixedCallArgCount } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { materializeCpuCompletionValues } from './cpu_test_harness';

const RAM_FUNCTION_ADDRESS = DYNAMIC_RAM_BASE + 0x1000;
const RAM_CODE_ADDRESS = RAM_FUNCTION_ADDRESS + 0x100;

function writeRamFunction(
	memory: ReturnType<typeof createTestSystemCpu>['memory'],
	code: Uint8Array,
	maxStack: number,
): void {
	memory.writeMappedU32LE(
		RAM_FUNCTION_ADDRESS + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
		RAM_CODE_ADDRESS,
	);
	memory.writeMappedU32LE(
		RAM_FUNCTION_ADDRESS + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
		code.byteLength,
	);
	memory.writeMappedU32LE(RAM_FUNCTION_ADDRESS + BLUA32_FUNCTION_NUM_PARAMS_OFFSET, 0);
	memory.writeMappedU32LE(RAM_FUNCTION_ADDRESS + BLUA32_FUNCTION_MAX_STACK_OFFSET, maxStack);
	memory.writeMappedU32LE(RAM_FUNCTION_ADDRESS + BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_STATIC);
	memory.writeMappedU32LE(RAM_FUNCTION_ADDRESS + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, 0);
	memory.writeMappedU32LE(RAM_FUNCTION_ADDRESS + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, 0);
	memory.writeBytes(RAM_CODE_ADDRESS, code);
}

test('the CPU addresses mapped RAM functions directly and through a register', () => {
	const systemCode = new Uint8Array(9 * INSTRUCTION_BYTES);
	writeInstruction(systemCode, 0, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(systemCode, 1, OpCode.CLOSURE, 0, 0, 0, 0);
	writeInstruction(systemCode, 2, OpCode.LOADK, 1, 0, 0, 0);
	writeInstruction(systemCode, 3, OpCode.WIDE, 0, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C, 0);
	writeInstruction(systemCode, 4, OpCode.CLOSURE, 1, 0, 1, 0);
	writeInstruction(systemCode, 5, OpCode.RET, 0, 2, 0, 0);
	writeInstruction(systemCode, 6, OpCode.K1, 0, 0, 0, 0);
	writeInstruction(systemCode, 7, OpCode.RET, 0, 1, 0, 0);
	writeInstruction(systemCode, 8, OpCode.RFE, 0, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text: systemCode,
		functions: [
			{ firstWord: 0, wordCount: 6, maxStack: 2 },
			{ firstWord: 6, wordCount: 2 },
			{ firstWord: 8, wordCount: 1 },
		],
		constants: [RAM_FUNCTION_ADDRESS],
		startupFunctionIndex: 0,
		irqFunctionIndex: 2,
		exceptionFunctionIndex: 2,
		closureRelocations: [{ wordIndex: 1, functionAddress: RAM_FUNCTION_ADDRESS }],
	});
	const { cpu, memory } = createTestSystemCpu(image);
	const romFunctionOperand = image.symbols.functionAddresses[1] >>> 4;
	const ramCode = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(ramCode, 0, OpCode.WIDE, 0, romFunctionOperand >>> BASE_BX_BITS, 0, 0);
	writeInstruction(
		ramCode,
		1,
		OpCode.CLOSURE,
		0,
		(romFunctionOperand >>> 6) & 0x3f,
		romFunctionOperand & 0x3f,
		romFunctionOperand >>> MAX_BX_BITS,
	);
	writeInstruction(ramCode, 2, OpCode.CALL, 0, encodeFixedCallArgCount(0), 1, 0);
	writeInstruction(ramCode, 3, OpCode.RET, 0, 1, 0, 0);
	writeRamFunction(memory, ramCode, 1);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const closures = materializeCpuCompletionValues(cpu) as Closure[];
	assert.equal(closures[0].functionAddress, RAM_FUNCTION_ADDRESS);
	assert.equal(closures[1].functionAddress, RAM_FUNCTION_ADDRESS);
	const closure = closures[1];

	cpu.beginCompletionCall(closure);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [1]);

	const replacement = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(replacement, 0, OpCode.K0, 0, 0, 0, 0);
	writeInstruction(replacement, 1, OpCode.RET, 0, 1, 0, 0);
	memory.writeBytes(RAM_CODE_ADDRESS, replacement);

	cpu.beginCompletionCall(closure);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [0]);
});
