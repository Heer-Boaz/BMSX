import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createDecodedInstructionPage, DecodedDispatchOp } from '../../machine/ts/machine/cpu/execution_image';
import { type Value, valueIsString } from '../../machine/ts/machine/cpu/value';
import { readLE32, writeLE32 } from '../../machine/ts/common/endian';
import { CPU_CAUSE_CODE_RESERVED_INSTRUCTION, CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { createTestSystemCpu, createTestBlua32PairCpu, linkRawTestBlua32Pair, linkRawTestSystemBlua32 } from '../helpers/blua32';

function returnImage(op = OpCode.RET, a = 0, b = 1, c = 0) {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, op, a, b, c);
	return linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }], constants: [11, 29] });
}

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

test('zero-count LOADNIL neither writes a slot nor extends the frame top', () => {
	const image = returnImage(OpCode.LOADNIL, 6, 0, 0);
	const { cpu } = createTestSystemCpu(image);
	cpu.runUntilDepth(0, 1);
	assert.equal(cpu.getFrameRegisterCount(0), 0);
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
