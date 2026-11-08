import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { createDecodedInstructionPage, DecodedDispatchOp } from '../../machine/ts/machine/cpu/execution_image';
import { type Value, valueIsString, ValueTag } from '../../machine/ts/machine/cpu/value';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { readLE32, writeLE32 } from '../../machine/ts/common/endian';
import { CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, CPU_CAUSE_CODE_RESERVED_INSTRUCTION, CPU_CAUSE_CODE_TRAP, CPU_CAUSE_IRQ, LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { BUS_FAULT_ACCESS_READ, BUS_FAULT_ACCESS_U32, BUS_FAULT_UNMAPPED, IO_SYS_BUS_FAULT_ACCESS, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_CODE, IO_GX_GPU_GP0, IO_IRQ_MASK, IRQ_GPU } from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createTestSystemCpu, createTestBlua32PairCpu, linkRawTestBlua32Pair, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';

function returnImage(op = OpCode.RET, a = 0, b = 1, c = 0) {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, op, a, b, c);
	return linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }], constants: [11, 29] });
}

test('string.byte preserves codepoint, default and signed-word position semantics in both dispatch modes', () => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	for (const instrumented of [false, true]) {
		for (const [source, position, expected] of [
			['Aé雪\0😀Z', undefined, 65], ['Aé雪\0😀Z', null, 65],
			['Aé雪\0😀Z', 2, 233], ['Aé雪\0😀Z', 3, 0x96ea],
			['Aé雪\0😀Z', 4, 0], ['Aé雪\0😀Z', 5, 0x1f600], ['Aé雪\0😀Z', 6, 90],
			['Aé雪\0😀Z', 7, null], ['', undefined, null], ['abc', 0, null],
			['abc', -1, null], ['abc', 2.9, 98], ['abc', 0x100000002, 98],
			['abc', NaN, null], ['abc', Infinity, null], ['a'.repeat(4096), 4096, 97],
		] as const) {
			writeInstruction(text, 0, OpCode.CALL, 0, position === undefined ? 2 : 3, 1);
			const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({
				text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 3 }],
			}));
			if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
			const registers = cpu.rootThread.frames[0].registers;
			registers.setEncoded(0, ValueTag.BuiltinFunction, BuiltinFunctionId.StringByte, null);
			registers.setStringId(1, cpu.stringPool.intern(source));
			if (position === null) registers.setNil(2);
			else if (position !== undefined) registers.setNumber(2, position);
			assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
			assert.equal(cpu.readFrameRegister(0, 0), expected);
		}
	}
});

test('LOADKR converts its Number index to U32 and faults outside the constant pool', () => {
	for (const [input, expected] of [[0, 11], [1.9, 29], [4294967296, 11], [NaN, 11], [Infinity, 11], [-Infinity, 11], [-0, 11]]) {
		const image = returnImage(OpCode.LOADKR, 0, 0, 0);
		const { cpu } = createTestSystemCpu(image);
		cpu.rootThread.frames[0].registers.setNumber(0, input);
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readFrameRegister(0, 0), expected);
	}
	for (const input of [2, -1, 4294967295]) {
		const image = returnImage(OpCode.LOADKR, 0, 0, 0);
		const { cpu } = createTestSystemCpu(image);
		cpu.rootThread.frames[0].registers.setNumber(0, input);
		const pc = cpu.readFramePc(0);
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_TRAP);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
		assert.equal(cpu.readEpcWord(), pc);
	}
});

test('word operands truncate and wrap at host conversion edges rather than saturating', () => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.BOR, 0, 1, 2);
	writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 3 }] });
	for (const instrumented of [false, true]) {
		const { cpu } = createTestSystemCpu(image);
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const pc = cpu.readFramePc(0);
		const registers = cpu.rootThread.frames[0].registers;
		registers.setNumber(2, 0);
		for (const [input, expected] of [
			[0, 0], [-0, 0], [0.75, 0], [-0.75, 0], [-1.75, -1],
			[2147483647.75, 2147483647], [2147483648, -2147483648],
			[4294967295.75, -1], [4294967296, 0], [4294967297.75, 1],
			[-4294967295.75, 1], [-4294967296, 0], [-4294967297.75, -1],
			[9007199254740991, -1], [-9007199254740991, 1], [2 ** 84, 0],
			[Number.MIN_VALUE, 0], [Number.MAX_VALUE, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0],
		]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			registers.setNumber(1, input);
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			assert.equal(cpu.readFrameRegister(0, 0), expected);
		}
	}
});

test('zero-count LOADNIL neither writes a slot nor extends the frame top', () => {
	const image = returnImage(OpCode.LOADNIL, 6, 0, 0);
	const { cpu } = createTestSystemCpu(image);
	cpu.runUntilDepth(0, 1);
	assert.equal(cpu.getFrameRegisterCount(0), 0);
});

test('a device edge during instruction fetch or observation is accepted at the next instruction boundary', () => {
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
		cpu.rootThread.frames[0].registers.setNumber(6, 0);
		cpu.rootThread.frames[0].registers.setNumber(7, 99);
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
		assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded);
		assert.equal(edges, 1);
		assert.equal(cpu.activeThread.frames.length, 2);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_IRQ);
		assert.equal(cpu.readEpcWord(), pc + INSTRUCTION_BYTES);
		assert.equal(cpu.activeThread.frames[0].registers.getNumber(6), 99);
		assert.equal(cpu.activeThread.frames[1].registers.getNumber(0), 1);
	}
});

test('cached fetch crosses WIDE pages and observes code writes between guest grants', () => {
	for (const instrumented of [false, true]) {
		const text = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.RET, 0, 1, 0);
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
			assert.equal(cpu.readFrameRegister(0, 0), phase === 2 ? -1 : 1);
			assert.equal(cpu.readFrameRegister(0, 1), phase === 0 ? 66 : 79);
			assert.equal(cpu.readFrameRegister(0, 2), 1);
		}
	}
});

test('rewriting a cached instruction replaces its cycle charge in normal, observed and instrumented execution', () => {
	for (const instrumented of [false, true]) for (const observed of [false, true]) {
		const text = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.RET, 0, 1, 0);
		const image = linkRawTestSystemBlua32({ text,
			functions: [{ firstWord: 0, wordCount: 1, maxStack: 2 }] });
		const { cpu, memory } = createTestSystemCpu(image);
		if (instrumented) cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
		const pc = DYNAMIC_RAM_BASE + 0x4000;
		const destination = pc + 0x100;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.rootThread.frames[0].registers.setNumber(1, destination);
		let observations = 0;
		if (observed) cpu.setInstructionObserver({
			points: [new Set([pc]), new Set(), new Set()],
			observe: () => { observations += 1; },
		});
		const code = new Uint8Array(INSTRUCTION_BYTES);
		for (const op of [OpCode.K1, OpCode.STORE_MEM_D, OpCode.K1]) {
			writeInstruction(code, 0, op, 0, 1, MemoryAccessKind.U32LE);
			memory.writeBytes(pc, code);
			cpu.rootThread.frames[0].pc = pc;
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[op]);
			assert.equal(cpu.readFramePc(0), pc + INSTRUCTION_BYTES);
			assert.equal(cpu.lastPc, pc);
		}
		assert.equal(memory.readMappedU32LE(destination), 1);
		assert.equal(observations, observed ? 3 : 0);
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
						const registers = cpu.rootThread.frames[0].registers;
						registers.setNumber(0, 3);
						registers.setNumber(1, 1);
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
						registers.setNumber(2, -1);
						const faultSequence = memory.readBusFaultSequence();
						assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
						assert.equal(cpu.readFrameRegister(0, 2), expected);
						assert.equal(cpu.readFramePc(0), successorPc);
						assert.equal(cpu.lastPc, currentPc);
						assert.equal(cpu.instructionBudgetRemaining, 0);
						assert.equal(cpu.getFrameDepth(), 1);
						assert.equal(memory.readBusFaultSequence(), faultSequence);
						assert.equal(observations, dispatch === 'observe-current' ? 1 : 0);
						assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
						assert.equal(cpu.readFrameRegister(0, 2), expected);
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
				assert.equal(cpu.instructionBudgetRemaining, -1);
				assert.equal(memory.readBusFaultSequence(), busSequence);
				assert.equal(observations, 1);
			}
		}
	}
});

test('a reused zero-maxStack call clears the reserved slot for ordinary and completion calls', () => {
	const text = new Uint8Array(10 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.CALL, 0, 1, 0);
	writeInstruction(text, 3, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 4, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 5, OpCode.CALL, 0, 1, 1);
	writeInstruction(text, 6, OpCode.RET, 0, 1, 0);
	writeInstruction(text, 7, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 8, OpCode.RET, 0, 0, 0);
	writeInstruction(text, 9, OpCode.RET, 0, 1, 0);
	const image = linkRawTestSystemBlua32({
		text,
		functions: [{ firstWord: 0, wordCount: 7 }, { firstWord: 7, wordCount: 2 }, { firstWord: 9, wordCount: 1, maxStack: 0 }],
		closureRelocations: [{ wordIndex: 1, functionAddress: 0x180 }, { wordIndex: 4, functionAddress: 0x1a0 }],
	});
	const { cpu } = createTestSystemCpu(image);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const results: Value[] = [];
	cpu.readCompletionValues(results);
	assert.deepEqual(results, [null]);
	cpu.rootThread.stackRegisters.setNumber(0, 91);
	cpu.beginCompletionCallInExecutionDomain(-1, 0x1a0);
	assert.equal(cpu.readFrameRegister(0, 0), null);
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
				const frame = cpu.rootThread.frames[0];
				const page = createDecodedInstructionPage(true, null, 0);
				page.refreshState.fill(0);
				frame.pc = skip ? 0xfffffff8 : 0xfffffffc;
				frame.decodedPage = page;
				frame.decodedPageAddress = 0xfffffc00;
				page.widths[255] = width;
				page.ops[255] = page.dispatchOps[255] = OpCode.K1;
				page.widths[254] = 1;
				page.ops[254] = page.dispatchOps[254] = OpCode.EQ;
				cpu.runUntilDepth(0, 1);
				assert.equal(frame.pc, (width - 1) * INSTRUCTION_BYTES);
			}
		}
	}
	const { cpu } = createTestSystemCpu(returnImage());
	const frame = cpu.rootThread.frames[0];
	const page = createDecodedInstructionPage(true, null, 0);
	page.refreshState.fill(0);
	frame.pc = 0xfffffff8;
	frame.decodedPage = page;
	frame.decodedPageAddress = 0xfffffc00;
	page.widths[254] = page.widths[255] = 1;
	page.ops[254] = OpCode.SHL;
	page.dispatchOps[254] = DecodedDispatchOp.FusedShlBxor;
	page.ops[255] = page.dispatchOps[255] = OpCode.BXOR;
	cpu.runUntilDepth(0, 2);
	assert.equal(frame.pc, 0);
});

test('image text preserves an initial U+FEFF and rejects non-scalar or incomplete UTF8', () => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(text, 1, OpCode.RET, 0, 1, 0);
	const source = { text, functions: [{ firstWord: 0, wordCount: 2 }], constants: ['\ufeffA'] };
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source));
	cpu.runUntilDepth(0, 100);
	const results: Value[] = [];
	cpu.readCompletionValues(results);
	assert.ok(valueIsString(results[0]));
	assert.equal(cpu.stringPool.toString(results[0].id), '\ufeffA');
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
