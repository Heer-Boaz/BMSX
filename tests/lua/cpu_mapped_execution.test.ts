import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import {
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
	BLUA32_FUNCTION_ALIGNMENT,
	BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
	BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET,
	BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
	BLUA32_FUNCTION_RECORD_SIZE,
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
import { BASE_CYCLES, OpCode, encodeFixedValueCount } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { materializeCpuCompletionValues } from './cpu_test_harness';

const RAM_FUNCTION_ADDRESS = DYNAMIC_RAM_BASE + 0x1000;
const RAM_CODE_ADDRESS = RAM_FUNCTION_ADDRESS + 0x100;

test('compact and padded ROM calls use admitted record spans with identical cycles and results', () => {
	const text = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 1);
	writeInstruction(text, 2, OpCode.CALL, 0, encodeFixedValueCount(0), 2);
	writeInstruction(text, 3, OpCode.RET, 0, 2, 0);
	writeInstruction(text, 4, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 5, OpCode.RET, 0, 2, 0);
	const image = linkRawTestSystemBlua32({ text,
		functions: [{ firstWord: 0, wordCount: 4, maxStack: 2 }, { firstWord: 4, wordCount: 2 }],
	});
	const sourceRecord = image.symbols.functionAddresses[1];
	const record = (image.romBytes.byteLength + BLUA32_FUNCTION_ALIGNMENT - 1) & ~(BLUA32_FUNCTION_ALIGNMENT - 1);
	const compactLength = record + BLUA32_FUNCTION_RECORD_SIZE;
	for (const instrumented of [false, true]) for (const padded of [false, true]) {
		const romBytes = new Uint8Array(padded ? (compactLength + MAPPED_PAGE_BYTE_MASK) & ~MAPPED_PAGE_BYTE_MASK : compactLength);
		romBytes.set(image.romBytes);
		romBytes.set(image.romBytes.subarray(sourceRecord, sourceRecord + BLUA32_FUNCTION_RECORD_SIZE), record);
		const { cpu, memory } = createTestSystemCpu({ romBytes });
		cpu.rootThread.frameAtDepth(0).registers.setNumber(1, record);
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const readWord = memory.readMappedBusU32LE.bind(memory);
		let scalarRecordReads = 0;
		memory.readMappedBusU32LE = (address, signals, access) => {
			if (address >= record && address < record + BLUA32_FUNCTION_RECORD_SIZE) scalarRecordReads++;
			return readWord(address, signals, access);
		};
		const cycles = BASE_CYCLES[OpCode.CLOSURE] + BASE_CYCLES[OpCode.CALL] + 2 * BASE_CYCLES[OpCode.RET] + BASE_CYCLES[OpCode.K1];
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [1]);
		assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(memory.readBusFaultSequence(), 0);
		assert.equal(scalarRecordReads, 0, 'a fully backed record needs no repeated per-word bus dispatch, including in a partial page');
		if (!padded) {
			assert.notEqual(romBytes.byteLength & MAPPED_PAGE_BYTE_MASK, 0);
			assert.equal(record & ~MAPPED_PAGE_BYTE_MASK, romBytes.byteLength & ~MAPPED_PAGE_BYTE_MASK, 'the callee record is in the compact image\'s partial final page');
		}
	}
});

test('WIDE and sequential fetch cross function-record metadata boundaries', () => {
	const code = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.K1, 0, 0, 0, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 2, 0, 0);
	const image = linkRawTestSystemBlua32({
		text: code,
		functions: [
			{ firstWord: 0, wordCount: 1, maxStack: 1 },
			{ firstWord: 1, wordCount: 2, maxStack: 1 },
		],
		irqFunctionIndex: 1,
		exceptionFunctionIndex: 1,
	});
	const { cpu } = createTestSystemCpu(image);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [1]);
	assert.equal(cpu.getFrameDepth(), 0);
});

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
	writeInstruction(systemCode, 5, OpCode.RET, 0, 3, 0, 0);
	writeInstruction(systemCode, 6, OpCode.K1, 0, 0, 0, 0);
	writeInstruction(systemCode, 7, OpCode.RET, 0, 2, 0, 0);
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
	writeInstruction(ramCode, 2, OpCode.CALL, 0, encodeFixedValueCount(0), 2, 0);
	writeInstruction(ramCode, 3, OpCode.RET, 0, 2, 0, 0);
	writeRamFunction(memory, ramCode, 1);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const closures = materializeCpuCompletionValues(cpu) as Closure[];
	assert.equal(closures[0].functionAddress, RAM_FUNCTION_ADDRESS);
	assert.equal(closures[1].functionAddress, RAM_FUNCTION_ADDRESS);
	const closure = closures[1];

	cpu.beginCompletionCall(closure);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [1]);

	const readMappedBusU32BE = memory.readMappedBusU32BE.bind(memory);
	let instructionReadCount = 0;
	memory.readMappedBusU32BE = (addr, busSignals, faultAccess): number => {
		instructionReadCount += 1;
		return readMappedBusU32BE(addr, busSignals, faultAccess);
	};
	cpu.beginCompletionCall(closure);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [1]);
	assert.equal(instructionReadCount, 0);

	const replacement = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(replacement, 0, OpCode.K0, 0, 0, 0, 0);
	writeInstruction(replacement, 1, OpCode.RET, 0, 2, 0, 0);
	memory.writeBytes(RAM_CODE_ADDRESS, replacement);

	cpu.beginCompletionCall(closure);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [0]);
	assert.equal(instructionReadCount, 2);
});
