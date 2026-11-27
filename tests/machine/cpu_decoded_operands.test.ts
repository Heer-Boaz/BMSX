import assert from 'node:assert/strict';
import { test } from 'node:test';
import { integerConstant, numberConstantFromHost, type NumberConstant } from '../../toolchain/ts/lua/number';
import { valueFloat, valueInteger, valueTable } from '../../machine/ts/machine/cpu/value';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { BASE_BX_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_EXT_BX, MAX_LOW_OPERAND, MAX_OPERAND_BITS, MIN_SIGNED_BX, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OPCODE_COUNT, OPCODE_RK_OPERANDS, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { RAM_CODE_FIXTURE_BYTES, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

test('every opcode selects the specified raw or signed RK operands', () => {
	const expected = new Uint8Array(OPCODE_COUNT);
	for (const op of [OpCode.SETT, OpCode.ADD, OpCode.SUB, OpCode.MUL, OpCode.DIV,
		OpCode.MOD, OpCode.FLOORDIV, OpCode.POW, OpCode.BAND, OpCode.BOR, OpCode.BXOR,
		OpCode.SHL, OpCode.SHR, OpCode.EQ, OpCode.LT, OpCode.LE]) expected[op] = 3;
	for (const op of [OpCode.LOAD_MEM, OpCode.STORE_MEM, OpCode.STORE_MEM_WORDS]) expected[op] = 1;
	for (const op of [OpCode.GETT, OpCode.SETI, OpCode.SETFIELD]) expected[op] = 2;
	assert.deepEqual(OPCODE_RK_OPERANDS, expected);
});

test('narrow and WIDE RK sign boundaries select the correct registers and constants', () => {
	for (const instrumented of [false, true]) for (const wide of [false, true]) {
		const limit = wide ? 16384 : 256;
		for (const [b, c] of [[limit - 1, -limit], [-limit, limit - 1], [-limit, -1],
			[limit - 1, 0], [-1, -limit], [0, limit - 1]]) {
			const text = new Uint8Array(3 * INSTRUCTION_BYTES);
			const rawB = b & (2 * limit - 1), rawC = c & (2 * limit - 1);
			if (wide) writeInstruction(text, 0, OpCode.WIDE, 0, rawB >>> 9, rawC >>> 9);
			writeInstruction(text, wide ? 1 : 0, OpCode.ADD, 0, rawB & 63, rawC & 63,
				((rawB >>> 6) & 7) << 3 | ((rawC >>> 6) & 7));
			writeInstruction(text, wide ? 2 : 1, OpCode.HALT, 0, 0, 0);
			const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({ text,
				functions: [{ firstWord: 0, wordCount: wide ? 3 : 2, maxStack: limit }],
				constants: Array.from({ length: limit }, (_, i) => numberConstantFromHost(i + 0.25)),
			}, RAM_CODE_FIXTURE_BYTES));
			if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
			const registers = cpu.rootThread.frameAtDepth(0).registers;
			for (let i = 0; i < limit; i++) registers.setFloat(i, -(i + 0.75));
			const operand = (selector: number) => selector < 0 ? (-1 - selector) + 0.25 : -(selector + 0.75);
			assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.ADD]), RunResult.Yielded);
			assert.equal(cpu.instructionBudgetRemaining, 0);
			assert.equal(cpu.readFrameRegister(0, 0), valueFloat(operand(b) + operand(c)));
		}
	}
});

test('unsigned raw fields and signed RK values remain independent of mutable field predictions', () => {
	for (const instrumented of [false, true]) {
		const text = new Uint8Array(13 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.WIDE, 0, 63, 0);
		writeInstruction(text, 1, OpCode.MOV, 0, 63, 0, 56);
		writeInstruction(text, 2, OpCode.WIDE, 0, 63, 32);
		writeInstruction(text, 3, OpCode.SETI, 1, 63, 0, 56);
		writeInstruction(text, 4, OpCode.WIDE, 0, 0, 63);
		writeInstruction(text, 5, OpCode.GETI, 2, 1, 63, 7);
		writeInstruction(text, 6, OpCode.WIDE, 0, 63, 32);
		writeInstruction(text, 7, OpCode.SETFIELD, 1, 63, 0, 56);
		writeInstruction(text, 8, OpCode.WIDE, 0, 0, 63);
		writeInstruction(text, 9, OpCode.GETFIELD, 3, 1, 63, 7);
		writeInstruction(text, 10, OpCode.WIDE, 0, 0, 63);
		writeInstruction(text, 11, OpCode.SELF, 4, 1, 63, 7);
		writeInstruction(text, 12, OpCode.HALT, 0, 0, 0);
		const constants: Array<NumberConstant | string> = new Array(32768).fill(integerConstant(0));
		constants[16383] = numberConstantFromHost(101.5);
		constants[32767] = 'field-key';
		const image = linkRawTestSystemBlua32({ text,
			functions: [{ firstWord: 0, wordCount: 13, maxStack: 32768 }], constants }, RAM_CODE_FIXTURE_BYTES);
		const { cpu } = createTestSystemCpu(image);
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		// Keep growth work separate from the operand and inline-cache base charges.
		const table = cpu.createTable(0, 2);
		const registers = cpu.rootThread.frameAtDepth(0).registers;
		registers.setTable(1, table);
		registers.setFloat(32767, 91.5);
		const pc = cpu.readFramePc(0);
		for (let pass = 0; pass < 2; pass++) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.SETI] + BASE_CYCLES[OpCode.GETI]
				+ BASE_CYCLES[OpCode.SETFIELD] + BASE_CYCLES[OpCode.GETFIELD] + BASE_CYCLES[OpCode.SELF]), RunResult.Yielded);
			assert.equal(cpu.instructionBudgetRemaining, 0);
			assert.equal(cpu.readFrameRegister(0, 0), valueFloat(91.5));
			for (const destination of [2, 3, 4]) assert.equal(cpu.readFrameRegister(0, destination), valueFloat(101.5));
			assert.equal(cpu.readFrameRegister(0, 5), valueTable(table));
		}
	}
});

test('rewriting the same cached PC changes its signed, branch and field-cache payload interpretation', () => {
	for (const instrumented of [false, true]) {
		const text = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text,
			functions: [{ firstWord: 0, wordCount: 1, maxStack: 4 }], constants: ['field', numberConstantFromHost(73.5)] }, RAM_CODE_FIXTURE_BYTES);
		const { cpu, memory } = createTestSystemCpu(image);
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		cpu.rootThread.frameAtDepth(0).registers.setTable(1, cpu.createTable());
		cpu.rootThread.frameAtDepth(0).registers.setFloat(2, 81.5);
		const code = new Uint8Array(2 * INSTRUCTION_BYTES);
		for (const op of [OpCode.KSMI, OpCode.SETFIELD, OpCode.JMP, OpCode.GETFIELD, OpCode.LOADK, OpCode.KSMI]) {
			const raw = op === OpCode.KSMI ? MIN_SIGNED_BX & MAX_EXT_BX : op === OpCode.JMP ? 3 : 1;
			writeInstruction(code, 0, OpCode.WIDE, 0, raw >>> BASE_BX_BITS, 0);
			writeInstruction(code, 1, op, 0, (raw >>> MAX_OPERAND_BITS) & MAX_LOW_OPERAND,
				raw & MAX_LOW_OPERAND, (raw >>> MAX_BX_BITS) & 0xff);
			if (op === OpCode.SETFIELD) writeInstruction(code, 1, op, 1, 0, 2);
			if (op === OpCode.GETFIELD) writeInstruction(code, 1, op, 3, 1, 0);
			memory.writeBytes(DYNAMIC_RAM_BASE, code);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
			assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[op]), RunResult.Yielded);
			if (op === OpCode.KSMI) assert.equal(cpu.readFrameRegister(0, 0), valueInteger(MIN_SIGNED_BX));
			if (op === OpCode.GETFIELD) assert.equal(cpu.readFrameRegister(0, 3), valueFloat(81.5));
			if (op === OpCode.LOADK) assert.equal(cpu.readFrameRegister(0, 0), valueFloat(73.5));
			assert.equal(cpu.readFramePc(0), DYNAMIC_RAM_BASE + (op === OpCode.JMP ? 20 : 8));
		}
	}
});

test('WIDE displaced load retains twelve-bit register fields and uses EXT solely as displacement', () => {
	for (const instrumented of [false, true]) {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.WIDE, 63, 63, 0);
		writeInstruction(text, 1, OpCode.LOAD_MEM_D, 63, 63, MemoryAccessKind.U32LE, 255);
		const { cpu, memory } = createTestSystemCpu(linkRawTestSystemBlua32({ text,
			functions: [{ firstWord: 0, wordCount: 2, maxStack: 4096 }] }, RAM_CODE_FIXTURE_BYTES));
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const address = DYNAMIC_RAM_BASE + 0x1000;
		memory.writeMappedU32LE(address, 0x12345678);
		cpu.rootThread.frameAtDepth(0).registers.setInteger(4095, address - (255 << 2));
		assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.LOAD_MEM_D]), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(cpu.readFrameRegister(0, 4095), valueInteger(0x12345678));
	}
});

test('WIDE displaced counted store keeps its unsigned twelve-bit count and complete surcharge', () => {
	for (const instrumented of [false, true]) {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.WIDE, 0, 63, 63);
		writeInstruction(text, 1, OpCode.STORE_MEM_WORDS_D, 0, 63, 63, 255);
		const { cpu, memory } = createTestSystemCpu(linkRawTestSystemBlua32({ text,
			functions: [{ firstWord: 0, wordCount: 2, maxStack: 4096 }] }, RAM_CODE_FIXTURE_BYTES));
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const address = DYNAMIC_RAM_BASE + 0x4000;
		const registers = cpu.rootThread.frameAtDepth(0).registers;
		for (let i = 1; i < 4094; i++) registers.setInteger(i, i);
		registers.setInteger(0, 0x10203040);
		registers.setInteger(4094, 0xa1b2c3d4);
		registers.setInteger(4095, address - (255 << 2));
		const charge = BASE_CYCLES[OpCode.STORE_MEM_WORDS_D] + 4095;
		assert.equal(cpu.runUntilDepth(0, charge), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(memory.readMappedWord(address), 0x10203040);
		assert.equal(memory.readMappedWord(address + 4094 * 4), 0xa1b2c3d4);
		assert.equal(memory.readMappedWord(address + 4095 * 4), 0);
	}
});
