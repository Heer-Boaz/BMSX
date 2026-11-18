import assert from 'node:assert/strict';
import { test } from 'node:test';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { createDecodedInstructionPage, DecodedDispatchOp, DECODED_PAGE_WORDS, DECODED_REFRESH_DECODE, type DecodedInstructionPage } from '../../machine/ts/machine/cpu/execution_image';
import { mappedBusSignalsForCartridgeSlot } from '../../machine/ts/machine/memory/bus_signals';
import { asStringId, type Value, valueBool, valueFloat, valueFloatBits, valueInteger, valueNil, valueIsString, valueTable, valueString, ValueTag } from '../../machine/ts/machine/cpu/value';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { readLE16, readLE32, writeLE32 } from '../../machine/ts/common/endian';
import { CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, CPU_CAUSE_CODE_RESERVED_INSTRUCTION, CPU_CAUSE_CODE_TRAP, CPU_CAUSE_IRQ, LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { BASE_BX_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_EXT_BX, MAX_LOW_OPERAND, MAX_OPERAND_BITS, MAX_SIGNED_BX, MIN_SIGNED_BX, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { BUS_FAULT_ACCESS_READ, BUS_FAULT_ACCESS_U32, BUS_FAULT_UNMAPPED, IO_SYS_BUS_FAULT_ACCESS, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_CODE, IO_GX_GPU_GP0, IO_IRQ_MASK, IRQ_GPU, IO_CART_SELECT } from '../../machine/ts/spec/bmsx/io';
import { CART_RAM_BASE, DYNAMIC_RAM_BASE, RAM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { blua32TestFunctionAddress, createTestSystemCpu, createTestBlua32PairCpu, linkRawTestBlua32Pair, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';

function returnImage(op = OpCode.RET, a = 0, b = 2, c = 0) {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, op, a, b, c);
	return linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }], constants: [integerConstant(11), integerConstant(29)] });
}

test('string.byte uses signed word positions in a builtin CALL', () => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		for (const [source, position, expected] of [
			['Aé雪\0😀Z', undefined, 65], ['Aé雪\0😀Z', valueNil(), 65],
			['Aé雪\0😀Z', valueInteger(2), 233], ['Aé雪\0😀Z', valueInteger(3), 0x96ea],
			['Aé雪\0😀Z', valueInteger(4), 0], ['Aé雪\0😀Z', valueInteger(5), 0x1f600], ['Aé雪\0😀Z', valueInteger(6), 90],
			['Aé雪\0😀Z', valueInteger(7), null], ['', undefined, null], ['abc', valueInteger(0), null],
			['abc', valueInteger(-1), null], ['abc', valueFloat(2.9), 98], ['abc', valueFloat(2 ** 31), null],
			['a'.repeat(511) + 'Z', valueFloat(2 ** 32 + 512), 90], ['a'.repeat(4096), valueInteger(4096), 97],
			['abc', valueFloatBits(0xffa12345), 'fault'], ['abc', valueFloat(Infinity), 'fault'],
			['abc', valueFloat(-Infinity), 'fault'], ['abc', valueBool(false), 'fault'],
		] as const) {
			writeInstruction(text, 0, OpCode.CALL, 0, position === undefined ? 2 : 3, 2);
			const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({
				text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 3 }, { firstWord: 1, wordCount: 1 }],
				exceptionFunctionIndex: 1,
			}), backend);
			const registers = cpu.rootThread.frameAtDepth(0).registers;
			registers.setBuiltinFunction(0, BuiltinFunctionId.StringByte);
			registers.setString(1, cpu.stringPool.intern(source));
			if (position !== undefined) registers.set(2, position);
			const pc = cpu.readFramePc(0);
			const callee = registers.get(0);
			assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
			if (expected === 'fault') {
				assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
				assert.equal(cpu.readEpcWord(), pc);
				assert.equal(cpu.readFrameRegister(0, 0), callee);
			} else {
				assert.equal(cpu.readCauseWord(), 0);
				assert.equal(cpu.readFrameRegister(0, 0), expected === null ? valueNil() : valueInteger(expected));
			}
		}
	}
});

test('LOADKR converts its Number index to U32 and faults outside the constant pool', () => {
	for (const [input, expected] of [[valueInteger(0), 11], [valueFloat(1.9), 29], [valueFloat(2 ** 32), 11], [valueFloat(-0), 11]] as const) {
		const image = returnImage(OpCode.LOADKR, 0, 0, 0);
		const { cpu } = createTestSystemCpu(image);
		cpu.rootThread.frameAtDepth(0).registers.set(0, input);
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readFrameRegister(0, 0), valueInteger(expected));
	}
	for (const input of [valueInteger(2), valueInteger(-1), valueFloat(NaN), valueFloat(Infinity), valueFloat(-Infinity)]) {
		const image = returnImage(OpCode.LOADKR, 0, 0, 0);
		const { cpu } = createTestSystemCpu(image);
		cpu.rootThread.frameAtDepth(0).registers.set(0, input);
		const pc = cpu.readFramePc(0);
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_TRAP);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
		assert.equal(cpu.readEpcWord(), pc);
	}
});

test('BOR accepts exact signed Integers and never truncates a Float as a word operand', () => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.BOR, 0, 1, 2);
	writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 3 }] });
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		for (const [input, expected] of [
			[valueInteger(0x7fffffff), 0x7fffffff], [valueFloat(-0), 0], [valueFloat(-(2 ** 31)), -(2 ** 31)],
			[valueFloat(0.75), null], [valueFloat(-1.75), null], [valueFloat(2 ** 31), null],
			[valueFloat(2 ** 32), null], [valueFloatBits(1), null], [valueFloatBits(0xffa12345), null],
			[valueFloat(Infinity), null], [valueFloat(-Infinity), null],
		] as const) {
			const { cpu } = createTestSystemCpu(image, backend);
			const pc = cpu.readFramePc(0);
			const registers = cpu.rootThread.frameAtDepth(0).registers;
			registers.setInteger(0, 91); registers.set(1, input); registers.setInteger(2, 0);
			cpu.runUntilDepth(0, 1);
			if (expected === null) {
				assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
				assert.equal(cpu.readEpcWord(), pc);
				assert.equal(cpu.readFrameRegister(0, 0), valueInteger(91));
			} else {
				assert.equal(cpu.readCauseWord(), 0);
				assert.equal(cpu.readFrameRegister(0, 0), valueInteger(expected));
			}
		}
	}
});

test('zero-count LOADNIL neither writes a slot nor extends the frame top', () => {
	const image = returnImage(OpCode.LOADNIL, 6, 0, 0);
	const { cpu } = createTestSystemCpu(image);
	cpu.runUntilDepth(0, 1);
	assert.equal(cpu.getFrameRegisterCount(0), 0);
});

test('WIDE signed immediates retain their complete range independently of instruction length', () => {
	for (const instrumented of [false, true]) for (const immediate of [MIN_SIGNED_BX, MIN_SIGNED_BX + 1, -524288, -1, 0, 524287, 524288, MAX_SIGNED_BX]) {
		const text = new Uint8Array(3 * INSTRUCTION_BYTES);
		const raw = immediate & MAX_EXT_BX;
		writeInstruction(text, 0, OpCode.WIDE, 0, raw >>> BASE_BX_BITS, 0);
		writeInstruction(text, 1, OpCode.KSMI, 0, (raw >>> MAX_OPERAND_BITS) & MAX_LOW_OPERAND, raw & MAX_LOW_OPERAND, (raw >>> MAX_BX_BITS) & 0xff);
		writeInstruction(text, 2, OpCode.RET, 0, 2, 0);
		const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3 }] }));
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const pc = cpu.readFramePc(0);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.readFrameRegister(0, 0), valueInteger(immediate));
		assert.equal(cpu.readFramePc(0), pc + 2 * INSTRUCTION_BYTES);
		assert.equal(cpu.lastPc, pc + INSTRUCTION_BYTES);
		assert.equal(cpu.runUntilDepth(0, 2), RunResult.Halted);
		const values: Value[] = [];
		cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueInteger(immediate)]);
	}
});

test('return ranges preserve shifted source slots when growing the caller stack', () => {
	for (const instrumented of [false, true]) for (const openReturn of [false, true]) {
		for (const produced of [0, 1, 3, 61]) for (const requested of [0, 1, 4, 48]) {
			const text = new Uint8Array(5 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, 1, OpCode.CLOSURE, 2, 0, 0);
			writeInstruction(text, 2, OpCode.CALL, 2, 1, requested === 0 ? 0 : requested + 1);
			writeInstruction(text, 3, OpCode.HALT, 0, 0, 0);
			writeInstruction(text, 4, OpCode.RET, 5, openReturn ? 0 : produced + 1, 0);
			const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({ text,
				functions: [{ firstWord: 0, wordCount: 4, maxStack: 3 },
					{ firstWord: 4, wordCount: 1, maxStack: 5 + Math.max(produced, 1) }],
				closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }],
			}));
			if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
			const table = cpu.createTable(0, 0);
			cpu.rootThread.frameAtDepth(0).registers.setInteger(0, 91);
			cpu.rootThread.frameAtDepth(0).registers.setTable(1, cpu.gc.reference(table));
			assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.CLOSURE] + BASE_CYCLES[OpCode.CALL]), RunResult.Yielded);
			assert.equal(cpu.getFrameDepth(), 2);
			const callee = cpu.rootThread.frameAtDepth(1);
			const samples: Value[] = [valueFloat(-0), valueNil(), valueBool(false), valueString(cpu.stringPool.intern('result')), valueTable(cpu.gc.reference(table))];
			for (let i = 0; i < produced; ++i) callee.registers.set(5 + i, samples[i % 5]);
			callee.top = 5 + produced;
			assert.equal(cpu.runUntilDepth(1, 2), RunResult.Halted);
			assert.equal(cpu.getFrameDepth(), 1);
			const targetCount = requested === 0 ? produced : requested;
			assert.equal(cpu.getFrameRegisterCount(0), 2 + targetCount);
			assert.equal(cpu.readFrameRegister(0, 0), valueInteger(91));
			assert.equal(cpu.readFrameRegister(0, 1), valueTable(cpu.gc.reference(table)));
			for (let i = 0; i < targetCount; ++i) assert.equal(cpu.readFrameRegister(0, 2 + i), i < produced ? samples[i % 5] : valueNil());
			const caller = cpu.rootThread.frameAtDepth(0);
			assert.equal(cpu.rootThread.stackTop, caller.stackBase + caller.stackCapacity);
		}
	}
});

test('builtin-owned result ranges survive destination growth with exact open/fixed top', () => {
	for (const instrumented of [false, true]) for (const requested of [0, 1, 4, 48]) for (const kind of [0, 1, 2]) {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.CALL, 2, kind === 0 ? 2 : 3, requested === 0 ? 0 : requested + 1);
		writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
		const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({ text,
			functions: [{ firstWord: 0, wordCount: 2, maxStack: 5 }],
		}));
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const table = cpu.createTable(1, 0);
		const result = valueString(cpu.stringPool.intern('result'));
		if (kind === 2) table.setInteger(1, result);
		const registers = cpu.rootThread.frameAtDepth(0).registers;
		registers.setInteger(0, 91); registers.setBoolean(1, true);
		registers.setBuiltinFunction(2, kind === 0 ? BuiltinFunctionId.Select : BuiltinFunctionId.Next);
		registers.set(3, kind === 0 ? valueInteger(1) : valueTable(cpu.gc.reference(table)));
		registers.setNil(4);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assert.equal(cpu.readCauseWord(), 0);
		const targetCount = requested === 0 ? kind : requested;
		assert.equal(cpu.getFrameRegisterCount(0), 2 + targetCount);
		assert.equal(cpu.readFrameRegister(0, 0), valueInteger(91));
		assert.equal(cpu.readFrameRegister(0, 1), valueBool(true));
		for (let i = 0; i < targetCount; ++i) assert.equal(cpu.readFrameRegister(0, 2 + i), kind === 2 && i < 2 ? (i === 0 ? valueInteger(1) : result) : valueNil());
	}
});

test('an observation edge waits for the instruction; MMIO instruction fetch faults before reading the device', () => {
	for (const instrumented of [false, true]) for (const mappedFetch of [false, true]) {
		const text = new Uint8Array(4 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.MOV, 6, 7, 0);
		writeInstruction(text, 1, OpCode.K0, 6, 0, 0);
		writeInstruction(text, 2, OpCode.K1, 0, 0, 0);
		writeInstruction(text, 3, OpCode.HALT, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text,
			functions: [{ firstWord: 0, wordCount: 2, maxStack: 8 }, { firstWord: 2, wordCount: 2 }],
			irqFunctionIndex: 1, exceptionFunctionIndex: 1,
		});
		const memory = new Memory({ systemRom: image.romBytes, cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
		const irq = new IrqController(memory), cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory));
		cpu.reset();
		cpu.rootThread.frameAtDepth(0).registers.setInteger(6, 0);
		cpu.rootThread.frameAtDepth(0).registers.setInteger(7, 99);
		let pc = cpu.readFramePc(0), edges = 0;
		if (mappedFetch) {
			pc = IO_GX_GPU_GP0;
			memory.mapIoRead(pc, irq, controller => { edges += 1; controller.raise(IRQ_GPU); return readLE32(text, 0); });
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		} else {
			cpu.setInstructionObserver({ points: [new Set([pc]), new Set(), new Set()],
				observe: () => { edges += 1; irq.raise(IRQ_GPU); } });
		}
		memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_GPU);
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		if (mappedFetch) {
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			assert.equal(edges, 0);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR);
			assert.equal(cpu.readEpcWord(), pc);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), pc);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS), BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32);
			assert.equal(cpu.activeThread.frameAtDepth(0).registers.getInteger(6), 0);
			continue;
		}
		assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.K1]), RunResult.Yielded);
		assert.equal(edges, 1);
		assert.equal(cpu.activeThread.frameDepth, 2);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_IRQ);
		assert.equal(cpu.readEpcWord(), pc + INSTRUCTION_BYTES);
		assert.equal(cpu.activeThread.frameAtDepth(0).registers.getInteger(6), 99);
		assert.equal(cpu.activeThread.frameAtDepth(1).registers.getInteger(0), 1);
	}
});

test('cached fetch crosses WIDE pages and observes code writes between guest grants', () => {
	for (const instrumented of [false, true]) {
		const text = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text,
			functions: [{ firstWord: 0, wordCount: 1, maxStack: 3 }] });
		const { cpu, memory } = createTestSystemCpu(image);
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const code = new Uint8Array(5 * INSTRUCTION_BYTES);
		writeInstruction(code, 0, OpCode.K1, 0, 0, 0);
		writeInstruction(code, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(code, 2, OpCode.KSMI, 1, 1, 2);
		writeInstruction(code, 3, OpCode.K1, 2, 0, 0);
		writeInstruction(code, 4, OpCode.JMP, 0, 63, 59, 255);
		const pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 2 * INSTRUCTION_BYTES;
		memory.writeBytes(pc, code);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		for (const phase of [0, 1, 2]) {
			if (phase === 1) {
				writeInstruction(code, 2, OpCode.KSMI, 1, 1, 15);
				memory.writeBytes(pc + 2 * INSTRUCTION_BYTES, code.subarray(2 * INSTRUCTION_BYTES, 3 * INSTRUCTION_BYTES));
			} else if (phase === 2) {
				writeInstruction(code, 0, OpCode.KM1, 0, 0, 0);
				memory.writeBytes(pc, code.subarray(0, INSTRUCTION_BYTES));
			}
			assert.equal(cpu.runUntilDepth(0, 8), RunResult.Yielded);
			assert.equal(cpu.instructionBudgetRemaining, 0);
			assert.equal(cpu.readCauseWord(), 0);
			assert.equal(cpu.readFramePc(0), pc);
			assert.equal(cpu.lastPc, pc + 4 * INSTRUCTION_BYTES);
			assert.equal(cpu.readFrameRegister(0, 0), valueInteger(phase === 2 ? -1 : 1));
			assert.equal(cpu.readFrameRegister(0, 1), valueInteger(phase === 0 ? 66 : 79));
			assert.equal(cpu.readFrameRegister(0, 2), valueInteger(1));
		}
	}
});

test('rewriting a cached instruction replaces its cycle charge in normal, observed and instrumented execution', () => {
	for (const instrumented of [false, true]) for (const observed of [false, true]) {
		const text = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text,
			functions: [{ firstWord: 0, wordCount: 1, maxStack: 2 }] });
		const { cpu, memory } = createTestSystemCpu(image);
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const pc = DYNAMIC_RAM_BASE + 0x4000;
		const destination = pc + 0x100;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.rootThread.frameAtDepth(0).registers.setInteger(1, destination);
		let observations = 0;
		if (observed) cpu.setInstructionObserver({
			points: [new Set([pc]), new Set(), new Set()],
			observe: () => { observations += 1; },
		});
		const code = new Uint8Array(INSTRUCTION_BYTES);
		for (const op of [OpCode.K1, OpCode.STORE_MEM_D, OpCode.K1]) {
			writeInstruction(code, 0, op, 0, 1, MemoryAccessKind.U32LE);
			memory.writeBytes(pc, code);
			cpu.rootThread.frameAtDepth(0).pc = pc;
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[op]);
			assert.equal(cpu.readFramePc(0), pc + INSTRUCTION_BYTES);
			assert.equal(cpu.lastPc, pc);
		}
		assert.equal(memory.readMappedU32LE(destination), 1);
		assert.equal(observations, observed ? 3 : 0);
	}
});

test('partial code writes retain unrelated decoded starts and the page watch', () => {
	for (const instrumented of [false, true]) {
		const text = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 2 }] });
		const { cpu, memory } = createTestSystemCpu(image);
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const code = new Uint8Array(10 * INSTRUCTION_BYTES);
		for (let word = 0; word < 10; word++) writeInstruction(code, word, OpCode.MOV, 0, 0, 0);
		writeInstruction(code, 0, OpCode.K1, 0, 0, 0);
		writeInstruction(code, 8, OpCode.K1, 1, 0, 0);
		writeInstruction(code, 9, OpCode.JMP, 0, 63, 54, 255);
		const pc = DYNAMIC_RAM_BASE + 0x5000;
		memory.writeBytes(pc, code);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		assert.equal(cpu.runUntilDepth(0, 9 * BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP]), RunResult.Yielded);
		assert.equal(cpu.readFramePc(0), pc);
		const page = cpu.rootThread.frameAtDepth(0).decodedPage!;
		assert.equal(page.refreshState[0], 0);
		assert.equal(page.refreshState[8], 0);
		writeInstruction(code, 0, OpCode.K0, 0, 0, 0);
		memory.writeMappedU8(pc + 2, code[2]);
		assert.equal(page.refreshState[0], DECODED_REFRESH_DECODE);
		assert.equal(page.refreshState[8], 0, 'unrelated cached start remains usable');
		writeInstruction(code, 8, OpCode.KM1, 1, 0, 0);
		memory.writeMappedU16LE(pc + 8 * INSTRUCTION_BYTES + 2, readLE16(code, 8 * INSTRUCTION_BYTES + 2));
		assert.equal(page.refreshState[8], DECODED_REFRESH_DECODE, 'second write before re-decode must remain watched');
		assert.equal(page.refreshState[4], 0);
		assert.equal(cpu.runUntilDepth(0, 9 * BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP]), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(cpu.readFrameRegister(0, 0), valueInteger(0));
		assert.equal(cpu.readFrameRegister(0, 1), valueInteger(-1));
	}
});

test('the fourth word of a cross-page WIDE fusion invalidates its head', () => {
	for (const instrumented of [false, true]) {
		const text = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 5 }] });
		const { cpu, memory } = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const code = new Uint8Array(5 * INSTRUCTION_BYTES);
		writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0);
		writeInstruction(code, 1, OpCode.ADD, 3, 0, 1);
		writeInstruction(code, 2, OpCode.WIDE, 0, 0, 0);
		writeInstruction(code, 3, OpCode.SHL, 4, 3, 2);
		writeInstruction(code, 4, OpCode.JMP, 0, 63, 59, 255);
		const pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 2 * INSTRUCTION_BYTES;
		memory.writeBytes(pc, code);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(0, 2);
		frame.registers.setInteger(1, 3);
		frame.registers.setInteger(2, 1);
		assert.equal(cpu.runUntilDepth(0, 2 * (BASE_CYCLES[OpCode.ADD] + BASE_CYCLES[OpCode.SHL] + BASE_CYCLES[OpCode.JMP])), RunResult.Yielded);
		assert.equal(cpu.readFrameRegister(0, 4), valueInteger(10));
		if (!instrumented) {
			const page = frame.executionImage.decodedPages.get(pc & ~(MAPPED_PAGE_BYTE_SIZE - 1))!;
			assert.equal(page.dispatchOps[DECODED_PAGE_WORDS - 2], DecodedDispatchOp.FusedAddShl);
		}
		writeInstruction(code, 3, OpCode.BXOR, 4, 3, 2);
		memory.writeMappedU8(pc + 3 * INSTRUCTION_BYTES + 2, code[3 * INSTRUCTION_BYTES + 2]);
		assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.ADD] + BASE_CYCLES[OpCode.BXOR] + BASE_CYCLES[OpCode.JMP]), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(cpu.readFrameRegister(0, 4), valueInteger(4));
	}
});

test('writable code watches belong to the physical cartridge socket', () => {
	for (const instrumented of [false, true]) {
		const text = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.RET, 0, 2, 0);
		const source = { text, functions: [{ firstWord: 0, wordCount: 1 }] };
		const system = linkRawTestSystemBlua32(source);
		const memory = new Memory({ systemRom: system.romBytes, cartridgeSlots: [
			{ rom: null, ramByteCount: 2 * MAPPED_PAGE_BYTE_SIZE, mailboxPresent: false },
			{ rom: null, ramByteCount: 2 * MAPPED_PAGE_BYTE_SIZE, mailboxPresent: false },
		] }, PSX_MACHINE_SPEC.ramBytes);
		const irq = new IrqController(memory), cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory));
		const scheduler = new DeviceScheduler(cpu);
		const dma = new DmaController(memory, cpu, irq, scheduler);
		memory.cartridgeController.connect(memory, irq, dma);
		cpu.reset();
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const code = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(code, 0, OpCode.K1, 0, 0, 0);
		writeInstruction(code, 1, OpCode.JMP, 0, 63, 62, 255);
		const pages: DecodedInstructionPage[] = [];
		for (const slot of [0, 1] as const) {
			for (let word = 0; word < 2; word++) memory.cartridgeController.writeU32(
				CART_RAM_BASE + word * INSTRUCTION_BYTES, readLE32(code, word * INSTRUCTION_BYTES), mappedBusSignalsForCartridgeSlot(slot),
			);
			memory.writeMappedU32LE(IO_CART_SELECT, slot);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, system.symbols.functionAddresses[0], CART_RAM_BASE);
			assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded);
			assert.equal(cpu.readFrameRegister(0, 0), valueInteger(1));
			pages.push(cpu.rootThread.frameAtDepth(0).decodedPage!);
		}
		writeInstruction(code, 0, OpCode.K0, 0, 0, 0);
		memory.cartridgeController.writeU8(CART_RAM_BASE + 2, code[2], mappedBusSignalsForCartridgeSlot(1));
		assert.equal(pages[0].refreshState[0], 0);
		assert.equal(pages[1].refreshState[0], DECODED_REFRESH_DECODE);
		writeInstruction(code, 0, OpCode.KM1, 0, 0, 0);
		memory.cartridgeController.writeU16(CART_RAM_BASE + 2, readLE16(code, 2), mappedBusSignalsForCartridgeSlot(0));
		for (const slot of [0, 1] as const) {
			memory.writeMappedU32LE(IO_CART_SELECT, slot);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, system.symbols.functionAddresses[0], CART_RAM_BASE);
			assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded);
			assert.equal(cpu.readFrameRegister(0, 0), valueInteger(slot === 0 ? -1 : 0));
		}
	}
});

test('closure call and return preserve grants, depth, register bases and call-side device/observer edges', () => {
	for (const instrumented of [false, true]) for (const edgeKind of [0, 1, 2, 4, 5]) {
		const mappedRecord = IO_GX_GPU_GP0 & ~(BLUA32_FUNCTION_ALIGNMENT - 1);
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 1, OpCode.CLOSURE, 3, 0, 0);
		writeInstruction(text, 2, OpCode.CALL, 3, 1, 2);
		writeInstruction(text, 3, OpCode.K1, 2, 0, 0);
		writeInstruction(text, 4, OpCode.RET, 3, 2, 0);
		writeInstruction(text, 5, OpCode.K1, 0, 0, 0);
		writeInstruction(text, 6, OpCode.RET, 0, 2, 0);
		writeInstruction(text, 7, OpCode.K1, 0, 0, 0);
		writeInstruction(text, 8, OpCode.HALT, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text,
			functions: [{ firstWord: 0, wordCount: 5, maxStack: 4 },
				{ firstWord: 5, wordCount: 2 }, { firstWord: 7, wordCount: 2 }],
			closureRelocations: [{ wordIndex: 1, functionAddress: edgeKind === 1 ? mappedRecord : blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }], irqFunctionIndex: 2, exceptionFunctionIndex: 2 });
		const memory = new Memory({ systemRom: image.romBytes, cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
		const irq = new IrqController(memory), cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory));
		cpu.reset();
		const record = image.symbols.functionAddresses[1];
		const calleePc = image.image.functions[1].codeAddress;
		let edges = 0, armed = false;
		if (edgeKind === 1) {
			for (let offset = 0; offset <= BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET; offset += 4) {
				memory.mapIoRead(mappedRecord + offset, irq, (controller, address) => {
					const offset = address - mappedRecord;
					if (armed && offset === BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET) { edges += 1; controller.raise(IRQ_GPU); }
					return readLE32(image.romBytes, record + offset);
				});
			}
		}
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		cpu.rootThread.frameAtDepth(0).registers.setInteger(2, 99);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		const callPc = cpu.readFramePc(0);
		if (edgeKind === 4 || edgeKind === 5) {
			if (edgeKind === 5) assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.CALL] + BASE_CYCLES[OpCode.K1]), RunResult.Yielded);
			const state = cpu.captureRuntimeState();
			state.haltedUntilIrqFrameDepth = edgeKind === 4 ? 2 : 1;
			state.haltedUntilIrqThreadRef = state.activeThreadRef;
			cpu.restoreRuntimeState(state);
			assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[edgeKind === 4 ? OpCode.CALL : OpCode.RET] + 1), RunResult.Halted);
			assert.equal(cpu.instructionBudgetRemaining, edgeKind === 5 ? 0 : 1);
			assert.equal(cpu.readFrameRegister(0, 2), valueInteger(99));
			if (edgeKind === 4) assert.equal(cpu.activeThread.frameAtDepth(1).registers.getTag(0), ValueTag.Nil);
			continue;
		}
		if (edgeKind === 2) cpu.setInstructionObserver({ points: [new Set([callPc]), new Set(), new Set()],
			observe: () => { edges += 1; irq.raise(IRQ_GPU); } });
		armed = true;
		memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_GPU);
		assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.CALL] + BASE_CYCLES[OpCode.K1]), RunResult.Yielded);
		if (edgeKind === 2) {
			assert.equal(edges, 1);
			assert.equal(cpu.activeThread.frameDepth, 3);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_IRQ);
			assert.equal(cpu.readEpcWord(), calleePc);
			assert.equal(cpu.activeThread.frameAtDepth(1).registers.getTag(0), ValueTag.Nil);
			assert.equal(cpu.activeThread.frameAtDepth(2).registers.getInteger(0), 1);
			continue;
		}
		if (edgeKind === 1) assert.equal(edges, 0, 'CALL does not reread the mapped function record');
		assert.equal(cpu.activeThread.frameDepth, 2);
		assert.equal(cpu.readFramePc(1), calleePc + INSTRUCTION_BYTES);
		assert.equal(cpu.runUntilDepth(1, 20), RunResult.Halted);
		assert.equal(cpu.instructionBudgetRemaining, 20 - BASE_CYCLES[OpCode.RET] - 1);
		assert.equal(cpu.readFrameRegister(0, 3), valueInteger(1));
		assert.equal(cpu.readFrameRegister(0, 2), valueInteger(99));
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.readFrameRegister(0, 2), valueInteger(1));
	}
});

test('numeric lookahead cannot take a successor fetch fault before current effects and budget', () => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text,
		functions: [{ firstWord: 0, wordCount: 1, maxStack: 3 }, { firstWord: 1, wordCount: 1 }],
		exceptionFunctionIndex: 1,
	});
	// Also exercise a partial backing page: cacheability does not guarantee a readable successor.
	for (const ramBytes of [PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.ramBytes - 16]) {
		for (const [op, expected] of [[OpCode.ADD, 4], [OpCode.SHL, 6], [OpCode.SHR, 1]]) {
			for (const wideSuccessor of [false, true]) {
				for (const dispatch of ['normal', 'observe-current', 'observe-successor', 'instrumented']) {
					for (const warm of [false, true]) {
						const memory = new Memory({ systemRom: image.romBytes, cartridgeSlots: cartridgeSlots() }, ramBytes);
						const irq = new IrqController(memory);
						const cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory));
						cpu.reset();
						const faultAddress = RAM_BASE + ramBytes;
						const currentPc = faultAddress - (wideSuccessor ? 2 : 1) * INSTRUCTION_BYTES;
						const successorPc = currentPc + INSTRUCTION_BYTES;
						const instructions = new Uint8Array((wideSuccessor ? 2 : 1) * INSTRUCTION_BYTES);
						writeInstruction(instructions, 0, op, 2, 0, 1);
						if (wideSuccessor) writeInstruction(instructions, 1, OpCode.WIDE, 0, 0, 0);
						memory.writeBytes(currentPc, instructions);
						const functionAddress = image.symbols.functionAddresses[0];
						cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, currentPc);
						const registers = cpu.rootThread.frameAtDepth(0).registers;
						registers.setInteger(0, 3);
						registers.setInteger(1, 1);
						let observations = 0;
						if (dispatch === 'observe-current' || dispatch === 'observe-successor') {
							cpu.setInstructionObserver({
								points: [new Set([dispatch === 'observe-current' ? currentPc : successorPc]), new Set(), new Set()],
								observe: () => { observations += 1; },
							});
						}
						if (warm) {
							cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
							assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
							cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, currentPc);
							observations = 0;
						}
						cpu.setExecutionHook(dispatch === 'instrumented' ? () => false : null, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
						registers.setInteger(2, -1);
						const faultSequence = memory.readBusFaultSequence();
						assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[op]), RunResult.Yielded);
						assert.equal(cpu.readFrameRegister(0, 2), valueInteger(expected));
						assert.equal(cpu.readFramePc(0), successorPc);
						assert.equal(cpu.lastPc, currentPc);
						assert.equal(cpu.instructionBudgetRemaining, 0);
						assert.equal(cpu.getFrameDepth(), 1);
						assert.equal(memory.readBusFaultSequence(), faultSequence);
						assert.equal(observations, dispatch === 'observe-current' ? 1 : 0);
						assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
						assert.equal(cpu.readFrameRegister(0, 2), valueInteger(expected));
						assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR);
						assert.equal(cpu.readEpcWord(), successorPc);
						assert.equal(cpu.readBadAddressWord(), 0);
						assert.equal(cpu.instructionBudgetRemaining, 0);
						assert.equal(cpu.getFrameDepth(), 2);
						assert.equal(memory.readBusFaultSequence(), faultSequence + 1);
						assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
						assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), faultAddress);
						assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS), BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32);
						assert.equal(observations, dispatch === 'observe-current' ? 1 : 0);
					}
				}
			}
		}
	}
});

test('all scalar memory instructions decode reserved kinds into an architectural exception', () => {
	for (const op of [OpCode.LOAD_MEM, OpCode.STORE_MEM, OpCode.LOAD_MEM_D, OpCode.STORE_MEM_D]) {
		for (const kind of [6, 63]) {
			for (const instrumented of [false, true]) {
				const text = new Uint8Array(2 * INSTRUCTION_BYTES);
				writeInstruction(text, 0, op, 0, 0, kind);
				writeInstruction(text, 1, OpCode.RET, 0, 0, 0);
				const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }, { firstWord: 1, wordCount: 1 }], exceptionFunctionIndex: 1 });
				const { cpu, memory } = createTestSystemCpu(image);
				const pc = cpu.readFramePc(0);
				let observations = 0;
				cpu.setInstructionObserver({ points: [new Set([pc]), new Set(), new Set()], observe: () => { observations += 1; } });
				if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
				const busSequence = memory.readBusFaultSequence();
				assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
				assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
				assert.equal(cpu.readEpcWord(), pc);
				assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[op]);
				assert.equal(memory.readBusFaultSequence(), busSequence);
				assert.equal(observations, 1);
			}
		}
	}
});

test('zero-maxStack calls produce true zero results and only requested padding is nil', () => {
	const text = new Uint8Array(10 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.CALL, 0, 1, 0);
	writeInstruction(text, 3, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 4, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 5, OpCode.CALL, 0, 1, 2);
	writeInstruction(text, 6, OpCode.RET, 0, 2, 0);
	writeInstruction(text, 7, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 8, OpCode.RET, 0, 0, 0);
	writeInstruction(text, 9, OpCode.RET, 0, 1, 0);
	const image = linkRawTestSystemBlua32({
		text,
		functions: [{ firstWord: 0, wordCount: 7 }, { firstWord: 7, wordCount: 2 }, { firstWord: 9, wordCount: 1, maxStack: 0 }],
		closureRelocations: [{ wordIndex: 1, functionAddress: 0x180 }, { wordIndex: 4, functionAddress: 0x1a0 }],
	});
	const { cpu } = createTestSystemCpu(image);
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const results: Value[] = [];
	cpu.readCompletionValues(results);
	assert.deepEqual(results, [valueNil()]);
	cpu.rootThread.stackRegisters.setInteger(0, 91);
	cpu.beginCompletionCallInExecutionDomain(-1, 0x1a0);
	assert.equal(cpu.readFrameRegister(0, 0), valueInteger(91), 'scratch storage is not cleared at activation');
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	cpu.readCompletionValues(results);
	assert.deepEqual(results, []);
});

test('halt and blocked states retain a concurrent yield request in both dispatch modes', () => {
	for (const instrumented of [false, true]) {
		for (const latch of ['hardHalted', 'memoryWriteBlocked', 'halt'] as const) {
			const { cpu } = createTestSystemCpu(returnImage());
			if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
			if (latch === 'halt') cpu.haltUntilIrq();
			else {
				const state = cpu.captureRuntimeState();
				state[latch] = true;
				cpu.restoreRuntimeState(state);
			}
			cpu.requestYield();
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Halted);
			assert.equal(cpu.captureRuntimeState().yieldRequested, true);
		}
	}
});

test('cached sequential, wide, skip and fused dispatch keep PC as a wrapping word', () => {
	for (const instrumented of [false, true]) {
		for (const width of [1, 2]) {
			for (const skip of [false, true]) {
				const { cpu } = createTestSystemCpu(returnImage());
				if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
				const frame = cpu.rootThread.frameAtDepth(0);
				const page = createDecodedInstructionPage(true, null, 0);
				page.refreshState.fill(0);
				frame.pc = skip ? 0xfffffff8 : 0xfffffffc;
				frame.decodedPage = page;
				frame.decodedPageAddress = 0xfffffc00;
				frame.decodedPageBusSignals = mappedBusSignalsForCartridgeSlot(0);
				page.widths[255] = width;
				page.ops[255] = page.dispatchOps[255] = OpCode.K1;
				page.dispatchCycles[255] = BASE_CYCLES[OpCode.K1];
				page.widths[254] = 1;
				page.ops[254] = page.dispatchOps[254] = OpCode.EQ;
				page.dispatchCycles[254] = BASE_CYCLES[OpCode.EQ];
				cpu.runUntilDepth(0, 1);
				assert.equal(frame.pc, (width - 1) * INSTRUCTION_BYTES);
			}
		}
	}
	const { cpu } = createTestSystemCpu(returnImage());
	const frame = cpu.rootThread.frameAtDepth(0);
	const page = createDecodedInstructionPage(true, null, 0);
	page.refreshState.fill(0);
	frame.pc = 0xfffffff8;
	frame.registers.setInteger(0, 1);
	frame.decodedPage = page;
	frame.decodedPageAddress = 0xfffffc00;
	frame.decodedPageBusSignals = mappedBusSignalsForCartridgeSlot(0);
	page.widths[254] = page.widths[255] = 1;
	page.ops[254] = OpCode.SHL;
	page.dispatchOps[254] = DecodedDispatchOp.FusedShlBxor;
	page.dispatchCycles[254] = BASE_CYCLES[OpCode.SHL];
	page.ops[255] = page.dispatchOps[255] = OpCode.BXOR;
	page.dispatchCycles[255] = BASE_CYCLES[OpCode.BXOR];
	cpu.runUntilDepth(0, BASE_CYCLES[OpCode.SHL] + BASE_CYCLES[OpCode.BXOR]);
	assert.equal(frame.pc, 0);
});

test('image text preserves an initial U+FEFF and rejects non-scalar or incomplete UTF8', () => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(text, 1, OpCode.RET, 0, 2, 0);
	const source = { text, functions: [{ firstWord: 0, wordCount: 2 }], constants: ['\ufeffA'] };
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source));
	cpu.runUntilDepth(0, 100);
	const results: Value[] = [];
	cpu.readCompletionValues(results);
	assert.ok(valueIsString(results[0]));
	assert.equal(cpu.stringPool.toString(asStringId(results[0])), '\ufeffA');
	for (const bytes of [[0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82], [0x80], [0xe2, 0x28, 0xa1]]) {
		const image = linkRawTestSystemBlua32(source);
		const table = readLE32(image.romBytes, 0x100 + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET);
		const address = readLE32(image.romBytes, table + 4);
		image.romBytes.set(bytes, address);
		writeLE32(image.romBytes, table + 8, bytes.length);
		assert.throws(() => createTestSystemCpu(image));
	}
});

test('cartridge image address addition wraps at the boot-address boundary', () => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.RET, 0, 0, 0);
	const source = { text, functions: [{ firstWord: 0, wordCount: 1 }] };
	const pair = linkRawTestBlua32Pair(source, source);
	writeLE32(pair.cartRomBytes, BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, 0xfffffff0);
	const { executionAddressSpace } = createTestBlua32PairCpu(pair);
	assert.equal(executionAddressSpace.resolveDomain(0)!.imageAddress, 0x0ffffff0);
});
