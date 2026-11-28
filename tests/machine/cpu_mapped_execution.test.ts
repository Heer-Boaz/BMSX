import { reserveThreadFrameReference } from '../helpers/thread_allocation_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueInteger } from '../../machine/ts/machine/cpu/value';

import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import {
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
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
	INSTRUCTION_BYTES,
	writeInstruction,
} from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode, encodeFixedValueCount } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { RAM_CODE_FIXTURE_BYTES, createTestSystemCpu, linkRawTestSystemBlua32, seedTestMappedStaticClosure, seedTestRomClosure } from '../helpers/blua32';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';

const RAM_FUNCTION_ADDRESS = DYNAMIC_RAM_BASE + 0x1000;
const RAM_CODE_ADDRESS = RAM_FUNCTION_ADDRESS + 0x100;

test('compact and padded ROM calls use admitted record spans with identical cycles and results', () => {
	const text = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.CALL, 0, encodeFixedValueCount(0), 2);
	writeInstruction(text, 1, OpCode.RET, 0, 2, 0);
	writeInstruction(text, 2, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 3, OpCode.RET, 0, 2, 0);
	const image = linkRawTestSystemBlua32({ text,
		functions: [{ firstWord: 0, wordCount: 2, maxStack: 2 }, { firstWord: 2, wordCount: 2 }],
	}, RAM_CODE_FIXTURE_BYTES);
	const sourceRecord = image.symbols.functionAddresses[1];
	// The second image pads this same final record page; the compact one ends
	// at the record, independently of how earlier image sections were laid out.
	const record = (image.romBytes.byteLength + MAPPED_PAGE_BYTE_MASK) & ~MAPPED_PAGE_BYTE_MASK;
	const compactLength = record + BLUA32_FUNCTION_RECORD_SIZE;
	for (const instrumented of [false, true]) for (const padded of [false, true]) {
		const romBytes = new Uint8Array(padded ? (compactLength + MAPPED_PAGE_BYTE_MASK) & ~MAPPED_PAGE_BYTE_MASK : compactLength);
		romBytes.set(image.romBytes);
		romBytes.set(image.romBytes.subarray(sourceRecord, sourceRecord + BLUA32_FUNCTION_RECORD_SIZE), record);
		const { cpu, memory } = createTestHeapServiceCpu({ romBytes });
		reserveThreadFrameReference(cpu, cpu.rootThread, 16);
		cpu.rootThread.frameAtDepth(0).registers.setClosure(0, seedTestRomClosure(cpu, record));
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const readWord = memory.readMappedBusU32LE.bind(memory);
		let scalarRecordReads = 0;
		memory.readMappedBusU32LE = (address, signals, access) => {
			if (address >= record && address < record + BLUA32_FUNCTION_RECORD_SIZE) scalarRecordReads++;
			return readWord(address, signals, access);
		};
		const cycles = BASE_CYCLES[OpCode.CALL] + 2 * (BASE_CYCLES[OpCode.RET] + 1) + BASE_CYCLES[OpCode.K1];
		runGuestToHalt(cpu, cycles);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(1)]);
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
	}, RAM_CODE_FIXTURE_BYTES);
	const { cpu } = createTestSystemCpu(image);

	runGuestToHalt(cpu, 100);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(1)]);
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

test('a published RAM function executes updated code without repeating the record fetch', () => {
	const systemCode = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(systemCode, 0, OpCode.JMP, 0, 63, 63, 255);
	writeInstruction(systemCode, 1, OpCode.K1, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text: systemCode, functions: [
		{ firstWord: 0, wordCount: 1, maxStack: 8 }, { firstWord: 1, wordCount: 1 },
	] }, RAM_CODE_FIXTURE_BYTES);
	const { cpu, memory } = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter);
	reserveThreadFrameReference(cpu, cpu.rootThread, 16);
	const code = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(code, 1, OpCode.RET, 0, 2, 0);
	writeRamFunction(memory, code, 1);
	const closure = seedTestMappedStaticClosure(cpu, RAM_FUNCTION_ADDRESS);
	assert.equal(cpu.captureClosureBinding(closure).functionAddress, RAM_FUNCTION_ADDRESS);
	cpu.beginCompletionCall(closure);
	runGuestToHalt(cpu, 100, 1);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(1)]);

	const readWord = memory.readMappedBusU32LE.bind(memory);
	let recordReads = 0;
	memory.readMappedBusU32LE = (address, signals, access) => {
		if (address >= RAM_FUNCTION_ADDRESS && address < RAM_FUNCTION_ADDRESS + BLUA32_FUNCTION_RECORD_SIZE) ++recordReads;
		return readWord(address, signals, access);
	};
	writeInstruction(code, 0, OpCode.K0, 0, 0, 0);
	memory.writeBytes(RAM_CODE_ADDRESS, code);
	cpu.beginCompletionCall(closure);
	runGuestToHalt(cpu, 100, 1);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(0)]);
	assert.equal(recordReads, 0, 'RAM code is live, the completed Function record is not re-read');
});
