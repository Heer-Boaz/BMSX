import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCpuParity } from '../helpers/cpu_execution';
import { isDeepStrictEqual } from 'node:util';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CompiledBlockExit, CpuExecutionBackend, compiledBlockSupports } from '../../machine/ts/machine/cpu/compiled_block';
import { JavaScriptRegisterCache } from '../../machine/ts/machine/cpu/compiled_block_registers';
import { valueBool, valueFloat, valueFloatBits, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { readLE32 } from '../../machine/ts/common/endian';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { OPCODE_COUNT, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { LUA_FAULT_REASON_INVALID_ARGUMENT, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, CPU_CAUSE_CODE_DATA_BUS_ERROR } from '../../machine/ts/spec/blua32/cop0';
import { DYNAMIC_RAM_BASE, IO_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { BUS_FAULT_NONE, BUS_FAULT_UNMAPPED, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

function assertParity(a: CPU, b: CPU): void {
	assert.ok(isDeepStrictEqual(a.captureRuntimeState(), b.captureRuntimeState()), 'full value graph, roots, frame/control state and heap accounting');
	assert.equal(a.readCurrentInstructionPc(), b.readCurrentInstructionPc()); assert.equal(a.lastPc, b.lastPc);
}

function wordLoop(count: number, displaced = false) {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 6, 0, 0); writeInstruction(text, 1, OpCode.MOV, 8, 12, 0);
	writeInstruction(text, 2, OpCode.K1, 9, 0, 0);
	writeInstruction(text, 3, OpCode.WIDE, 0, 0, count >> (displaced ? 6 : 9));
	writeInstruction(text, 4, displaced ? OpCode.STORE_MEM_WORDS_D : OpCode.STORE_MEM_WORDS, 8, 0, count & 63,
		displaced ? 255 : (count >> 6) & 7);
	writeInstruction(text, 5, OpCode.ADD, 7, 6, 9); writeInstruction(text, 6, OpCode.JMP, 0, 63, 57, 255);
	writeInstruction(text, 32, OpCode.HALT, 0, 0, 0); writeInstruction(text, 33, OpCode.HALT, 0, 0, 0);
	return linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 7, maxStack: Math.max(16, 8 + count) },
		{ firstWord: 32, wordCount: 2 }], exceptionFunctionIndex: 1 });
}

test('generated execution admits every executable BLua32 opcode; WIDE remains a decode prefix', () => {
	assert.equal(compiledBlockSupports(OpCode.WIDE, 0), false);
	for (let op = 1; op < OPCODE_COUNT; ++op) assert.equal(compiledBlockSupports(op, 0), true, `opcode ${op}`);
});

for (const layout of ['last-word', 'wide-exact-end', 'wide-straddle'] as const) test(`a standalone ${layout} arithmetic entry compiles without fetching its successor`, () => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 4 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const width = layout === 'last-word' ? 1 : 2;
	const pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - (layout === 'wide-exact-end' ? 2 : 1) * INSTRUCTION_BYTES;
	const bodyPc = pc + (width - 1) * INSTRUCTION_BYTES;
	const code = new Uint8Array(width * INSTRUCTION_BYTES);
	if (width === 2) writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, width - 1, OpCode.ADD, 3, 0, 1);
	for (const { memory } of [js, ref]) memory.writeBytes(pc, code);
	for (const expected of [42, 34]) {
		for (let visit = 0; visit < 12; ++visit) {
			for (const { cpu } of [js, ref]) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
				const frame = cpu.rootThread.frameAtDepth(0);
				frame.registers.setInteger(0, 38); frame.registers.setInteger(1, 4); frame.registers.setInteger(3, 7);
			}
			runCpuParity(js.cpu, ref.cpu, 1); assertParity(js.cpu, ref.cpu);
			assert.equal(js.cpu.readFrameRegister(0, 3), valueInteger(expected));
			assert.equal(js.cpu.readFramePc(0), pc + width * INSTRUCTION_BYTES);
			assert.equal(js.cpu.lastPc, bodyPc);
		}
		const index = (pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
		const page = [...js.cpu.rootThread.frameAtDepth(0).executionImage.decodedPages.values()]
			.find(candidate => candidate.compiledBlocks?.entries[index]?.terminal.currentPc === pc)!;
		assert.ok(page, 'the hot page-tail instruction has its own generated entry');
		assert.equal(page.compiledBlocks!.entries[index]!.sourceWords, width);
		if (expected === 42) {
			writeInstruction(code, width - 1, OpCode.SUB, 3, 0, 1);
			for (const { memory } of [js, ref]) memory.writeBytes(bodyPc, code.subarray((width - 1) * INSTRUCTION_BYTES));
			assert.equal(page.compiledBlocks!.entries[index], null, 'rewriting the body retires its owner, including a second-page WIDE body');
		} else {
			const observations = [0, 0];
			for (const [i, { cpu }] of [js, ref].entries()) {
				cpu.setInstructionObserver({ points: [new Set([pc]), new Set(), new Set()], observe: () => { ++observations[i]; } });
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			}
			assert.equal(page.compiledBlocks!.entries[index], null, 'installing an observer retires the page-tail body');
			runCpuParity(js.cpu, ref.cpu, 1); assertParity(js.cpu, ref.cpu);
			assert.deepEqual(observations, [1, 1]);
		}
	}
});

for (const wide of [false, true]) test(`a compiled nonterminal at the RAM end faults only when its successor is fetched (WIDE=${wide})`, () => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0); writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 4 },
		{ firstWord: 1, wordCount: 1 }], exceptionFunctionIndex: 1 });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const end = RAM_BASE + PSX_MACHINE_SPEC.ramBytes, width = wide ? 2 : 1, pc = end - width * INSTRUCTION_BYTES;
	const code = new Uint8Array(width * INSTRUCTION_BYTES);
	if (wide) writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, width - 1, OpCode.K1, 3, 0, 0);
	for (const { memory } of [js, ref]) memory.writeBytes(pc, code);
	for (let visit = 0; visit < 12; ++visit) {
		for (const { cpu } of [js, ref]) cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		runCpuParity(js.cpu, ref.cpu, 1); assertParity(js.cpu, ref.cpu);
		assert.equal(js.cpu.readFrameRegister(0, 3), valueInteger(1)); assert.equal(js.cpu.readFramePc(0), end);
		assert.equal(js.memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_NONE);
	}
	const index = (pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.ok(js.cpu.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries[index], 'the last backed instruction is generated');
	runCpuParity(js.cpu, ref.cpu, 1); assertParity(js.cpu, ref.cpu);
	assert.equal(js.cpu.readEpcWord(), end);
	assert.equal(js.memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	assert.equal(js.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), end);
});

for (const displaced of [false, true]) for (const count of [0, 5, 1025]) test(`generated word span preserves conversions, cached sources and complete segment charges (count=${count}, displaced=${displaced})`, () => {
	const image = wordLoop(count, displaced), pc = image.image.functions[0].codeAddress, target = DYNAMIC_RAM_BASE + 0x2ffc;
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const surcharge = count;
	for (const { cpu } of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers; r.setInteger(0, target - (displaced ? 1020 : 0)); r.setInteger(12, 73);
		for (let i = 0; i < count; ++i) if (i !== 4) r.setInteger(8 + i, i + 100);
		cpu.runUntilDepth(0, 20 * (7 + surcharge));
	}
	const frame = js.cpu.rootThread.frameAtDepth(0), page = frame.decodedPage!, block = page.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	assert.equal(block.sourceWords, 5);
	assert.equal(block.exits[0].exit, CompiledBlockExit.WriteWords); assert.equal(block.exits[0].cycles, 9);
	for (const value of [valueFloat(-0), valueFloat(-1.75), valueFloat(2 ** 32 + 512), valueFloat(3.4028234663852886e38), valueInteger(-1)]) {
		for (const grant of [1, 3, 4, 5, 5 + surcharge, 6 + surcharge, 7 + surcharge, 4 * (7 + surcharge)]) {
			for (const { cpu } of [js, ref]) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
				cpu.rootThread.frameAtDepth(0).registers.set(12, value); cpu.rootThread.frameAtDepth(0).top = 0;
			}
			runCpuParity(js.cpu, ref.cpu, grant);
			assertParity(js.cpu, ref.cpu); assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
		}
	}
	assert.equal(frame.top, 10, 'the counted source range does not extend top');
	assert.equal(frame.registers.getInteger(7), 2, 'clean cached sources remain live after the bulk call');
});

test('an invalid word after a valid prefix faults at WIDE, without undoing the prefix or writing the suffix', () => {
	const image = wordLoop(3), pc = image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES;
	for (const invalid of [valueFloatBits(0xffc01234), valueFloat(Infinity), valueNil(), valueBool(true)]) {
		const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
		for (const { cpu, memory } of [js, ref]) {
			const r = cpu.rootThread.frameAtDepth(0).registers;
			r.setInteger(0, DYNAMIC_RAM_BASE); r.set(8, valueFloat(-1.75)); r.setInteger(9, 92); r.setInteger(10, 93);
			for (let i = 0; i < 12; ++i) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
				cpu.runUntilDepth(0, 1);
			}
			if (cpu === js.cpu) assert.ok(cpu.rootThread.currentFrame!.decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]);
			for (const offset of [0, 4, 8]) memory.writeMappedWord(DYNAMIC_RAM_BASE + offset, 0x87654321);
			r.set(9, invalid);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		}
		runCpuParity(js.cpu, ref.cpu, 1); assertParity(js.cpu, ref.cpu);
		for (const { cpu, memory } of [js, ref]) {
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT); assert.equal(cpu.readEpcWord(), pc);
			assert.equal(cpu.instructionBudgetRemaining, 1 - 3 - 3);
			assert.deepEqual([0, 4, 8].map(offset => memory.readMappedWord(DYNAMIC_RAM_BASE + offset)),
				[0xffffffff, 0x87654321, 0x87654321]);
		}
	}
});

test('a WIDE counted store retains a signed RK address and the full source register range', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE), target = DYNAMIC_RAM_BASE + 0x4000;
	writeInstruction(text, 0, OpCode.WIDE, 2, 63, 1);
	writeInstruction(text, 1, OpCode.STORE_MEM_WORDS, 0, 63, 1, 56); // R512..1024, K[0], C=513.
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 1025 }], constants: [integerConstant(target)] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	for (const { cpu } of [js, ref]) { for (let i = 0; i < 513; ++i) cpu.rootThread.frameAtDepth(0).registers.setInteger(512 + i, i - 1); cpu.runUntilDepth(0, 20 * (3 + 513 + 2)); }
	assertParity(js.cpu, ref.cpu); assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
	const frame = js.cpu.rootThread.frameAtDepth(0), pc = image.image.functions[0].codeAddress;
	const exit = frame.decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!.exits[0];
	assert.equal(exit.exitA, 512); assert.equal(exit.exitB, -1); assert.equal(exit.exitC, 513);
	assert.equal(js.memory.readMappedWord(target), 0xffffffff); assert.equal(js.memory.readMappedWord(target + 512 * 4), 511);
	assert.equal(frame.top, 0);
});

for (const unaligned of [false, true]) test(`a zero-count store checks only alignment, without an IO or mapping preflight (unaligned=${unaligned})`, () => {
	const image = wordLoop(0), pc = image.image.functions[0].codeAddress;
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	for (const { cpu } of [js, ref]) { cpu.rootThread.frameAtDepth(0).registers.setInteger(0, DYNAMIC_RAM_BASE); cpu.runUntilDepth(0, 140); }
	for (const address of unaligned ? [IO_BASE + 0x5001] : [0, 0xfffffffc, IO_BASE + 0x5000]) {
		const probes: number[] = [];
		for (const { cpu, memory } of [js, ref]) {
			memory.mapIoWrite(IO_BASE + 0x5000, probes, () => assert.fail('empty stores do not write'));
			memory.mapIoWriteReady(IO_BASE + 0x5000, () => { probes.push(1); return false; });
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			cpu.rootThread.frameAtDepth(0).registers.setInteger(0, address);
		}
		runCpuParity(js.cpu, ref.cpu, 20);
		assertParity(js.cpu, ref.cpu); assert.equal(probes.length, 0); assert.equal(js.memory.readBusFaultSequence(), 0);
		assert.equal(js.cpu.captureRuntimeState().memoryWriteBlocked, false);
		if (unaligned) { assert.equal(js.cpu.readCauseWord(), CPU_CAUSE_CODE_ADDRESS_ERROR_STORE); assert.equal(js.cpu.readBadAddressWord(), address); assert.equal(js.cpu.readEpcWord(), pc + 3 * INSTRUCTION_BYTES); }
		else assert.equal(js.cpu.readCauseWord(), 0);
	}
});

test('counted preflight blocks on a later IO word before an earlier bus fault or sequence charge', () => {
	const image = wordLoop(3), pc = image.image.functions[0].codeAddress;
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	for (const { cpu } of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers; r.setInteger(0, DYNAMIC_RAM_BASE);
		for (let i = 8; i <= 12; ++i) r.setInteger(i, 0);
		cpu.runUntilDepth(0, 160);
	}
	const devices = [];
	for (const { cpu, memory } of [js, ref]) {
		const device = { ready: false, probes: [] as number[], writes: 0 }; devices.push(device);
		for (let i = 0; i < 2; ++i) {
			memory.mapIoWrite(IO_BASE + i * 4, device, state => { ++state.writes; });
			memory.mapIoWriteReady(IO_BASE + i * 4, (state: typeof device, address) => { state.probes.push(address); return address === IO_BASE || state.ready; });
		}
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.rootThread.frameAtDepth(0).registers.setInteger(0, IO_BASE - 4);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
		assert.equal(cpu.instructionBudgetRemaining, 11); assert.equal(memory.readBusFaultSequence(), 0);
		assert.equal(cpu.readFramePc(0), pc + 3 * INSTRUCTION_BYTES); assert.equal(cpu.stalledMemoryWriteAddress(), IO_BASE + 4);
		assert.deepEqual(device.probes, [IO_BASE, IO_BASE + 4]); assert.equal(device.writes, 0);
		cpu.resumeMemoryWrite(IO_BASE); assert.equal(cpu.captureRuntimeState().memoryWriteBlocked, true);
		device.ready = true; cpu.resumeMemoryWrite(IO_BASE + 4); cpu.runUntilDepth(0, 2);
		assert.equal(cpu.instructionBudgetRemaining, -1, 'resuming the latched store does not charge its base twice'); assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_DATA_BUS_ERROR);
		assert.equal(cpu.readEpcWord(), pc + 3 * INSTRUCTION_BYTES); assert.equal(device.writes, 0);
	}
	assertParity(js.cpu, ref.cpu); assert.deepEqual(devices[0], devices[1]);
});

test('counted stores commit their RAM prefix before faulting beyond installed RAM', () => {
	const image = wordLoop(5);
	const end = RAM_BASE + PSX_MACHINE_SPEC.ramBytes;
	const target = end - 3 * 4;
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const scalar = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	for (const { cpu, memory } of [js, scalar]) {
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(0, DYNAMIC_RAM_BASE);
		for (let i = 8; i <= 12; ++i) frame.registers.setInteger(i, 0);
		cpu.runUntilDepth(0, 180);
		for (let i = 0; i < 3; ++i) memory.writeMappedU32LE(target + i * 4, 0xfeedface);
		frame.registers.setInteger(0, target);
		frame.registers.setInteger(12, 42);
		frame.registers.setInteger(10, 73);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
		cpu.runUntilDepth(0, 20);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), end);
		assert.deepEqual([0, 1, 2].map(i => memory.readMappedU32LE(target + i * 4)), [42, 1, 73]);
	}
	assertParity(js.cpu, scalar.cpu);
});

test('counted IO writes preflight once, preserve the completed fault prefix, and charge the whole sequence', () => {
	const image = wordLoop(5), pc = image.image.functions[0].codeAddress, target = IO_BASE + 0x5000;
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter), devices = [];
	for (const { cpu } of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers; r.setInteger(0, DYNAMIC_RAM_BASE);
		for (let i = 8; i <= 12; ++i) r.setInteger(i, 0);
		cpu.runUntilDepth(0, 180);
	}
	for (const { cpu, memory } of [js, ref]) {
		const device = { ready: true, trace: [] as string[], values: [] as number[] }; devices.push(device);
		for (let i = 0; i < 5; ++i) {
			memory.mapIoWrite(target + i * 4, device, (state, address, value) => {
				state.trace.push(`w${i}`); state.values.push(value); state.ready = false;
				if (address === target + 8) memory.writeMappedWord(0xdead0000, value);
			});
			memory.mapIoWriteReady(target + i * 4, (state: typeof device) => { state.trace.push(`r${i}`); return state.ready; });
		}
		const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(0, target); frame.registers.setInteger(12, 42); frame.registers.setInteger(10, 73); frame.registers.setInteger(7, 99);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc); cpu.runUntilDepth(0, 20);
		assert.deepEqual(device.trace, ['r0', 'r1', 'r2', 'r3', 'r4', 'w0', 'w1', 'w2']); assert.deepEqual(device.values, [42, 1, 73]);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_DATA_BUS_ERROR); assert.equal(cpu.readEpcWord(), pc + 3 * INSTRUCTION_BYTES);
		assert.equal(frame.registers.getInteger(7), 99); assert.equal(cpu.captureRuntimeState().memoryWriteBlocked, false);
	}
	assertParity(js.cpu, ref.cpu); assert.deepEqual(devices[0], devices[1]); assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
});

test('a counted span checks middle watch pages and can retire its own native source during ordered writes', () => {
	const count = MAPPED_PAGE_BYTE_SIZE / 2 + 1, image = wordLoop(count), romPc = image.image.functions[0].codeAddress;
	const pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE, cycles = 13 + (count);
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const halt = new Uint8Array(4); writeInstruction(halt, 0, OpCode.HALT, 0, 0, 0);
	for (const { cpu, memory } of [js, ref]) {
		memory.writeBytes(pc, image.romBytes.subarray(romPc, romPc + MAPPED_PAGE_BYTE_SIZE));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		for (let i = 0; i < count; ++i) cpu.rootThread.frameAtDepth(0).registers.setInteger(8 + i, 0);
		cpu.rootThread.frameAtDepth(0).registers.setInteger(0, pc + 8 * MAPPED_PAGE_BYTE_SIZE); cpu.runUntilDepth(0, 20 * cycles);
	}
	const page = js.cpu.rootThread.frameAtDepth(0).decodedPage!; assert.ok(page.compiledBlocks!.entries[0]);
	for (const { cpu } of [js, ref]) {
		const frame = cpu.rootThread.frameAtDepth(0); for (let i = 0; i < count; ++i) frame.registers.setInteger(8 + i, 0);
		frame.registers.setInteger(8 + MAPPED_PAGE_BYTE_SIZE / 4 + 5, readLE32(halt, 0)); frame.registers.setInteger(7, 99); frame.registers.setInteger(0, DYNAMIC_RAM_BASE);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Halted); assert.equal(frame.registers.getInteger(7), 99); assert.equal(frame.pc, pc + 6 * INSTRUCTION_BYTES);
	}
	assert.equal(page.compiledBlocks!.entries[0], null); assertParity(js.cpu, ref.cpu); assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
});

for (const blocked of [false, true]) test(`later counted blocks retain earlier cycle debits, but exclude their own blocked surcharge (blocked=${blocked})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 6, 0, 0); writeInstruction(text, 1, OpCode.STORE_MEM_WORDS, 8, 0, 5);
	writeInstruction(text, 2, OpCode.STORE_MEM_WORDS, 20, 1, 3); writeInstruction(text, 3, OpCode.MOV, 7, 6, 0);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255); writeInstruction(text, 32, OpCode.HALT, 0, 0, 0); writeInstruction(text, 33, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 32 }, { firstWord: 32, wordCount: 2 }], exceptionFunctionIndex: 1 });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter), pc = image.image.functions[0].codeAddress;
	for (const { cpu } of [js, ref]) { const r = cpu.rootThread.frameAtDepth(0).registers;
		for (let i = 8; i < 23; ++i) r.setInteger(i, 0);
		r.setInteger(0, DYNAMIC_RAM_BASE); r.setInteger(1, DYNAMIC_RAM_BASE + 64); cpu.runUntilDepth(0, 200); }
	const block = js.cpu.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / 4]!;
	assert.equal(block.exits[0].cycles, 5);
	const second = block.page.compiledBlocks!.entries[(block.terminal.nextPc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	assert.ok(second); assert.equal(second.region, block.region); assert.equal(second.exits[0].cycles, 3);
	for (const { cpu, memory } of [js, ref]) {
		memory.mapIoWrite(IO_BASE + 0x5000, null, () => assert.fail('not ready')); memory.mapIoWriteReady(IO_BASE + 0x5000, () => false);
		const frame = cpu.rootThread.frameAtDepth(0); frame.top = 0; frame.registers.setInteger(1, blocked ? IO_BASE + 0x5000 : RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 4);
		frame.registers.setInteger(7, 99); frame.registers.setInteger(20, 73);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc); cpu.runUntilDepth(0, 20);
		assert.equal(frame.registers.getInteger(7), 99); assert.equal(frame.top, 7);
		if (blocked) assert.equal(cpu.instructionBudgetRemaining, 7);
		else { assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_DATA_BUS_ERROR); assert.equal(memory.readMappedWord(RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 4), 73); }
	}
	assertParity(js.cpu, ref.cpu); assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
});

test('bulk source publication neither discards clean SSA values nor repeats their writeback', () => {
	const { cpu } = createTestSystemCpu(wordLoop(0), CpuExecutionBackend.JavaScript);
	const frame = cpu.rootThread.frameAtDepth(0), r = frame.registers;
	const cache = new JavaScriptRegisterCache(frame.executionImage, new Map(), new Set()), writes = new Uint32Array(8), set = r.setEncoded.bind(r);
	const source = [cache.writeInteger(0, '1'), cache.writeInteger(7, '1'), cache.publishRange(0, 1),
		'observed.push(r.getInteger(0));', cache.copy(0, 0),
		cache.writeInteger(2, `${cache.wordOperand(0)}+${cache.wordOperand(7)}`), cache.publishRange(0, 1),
		'observed.push(r.getInteger(0));', cache.writeBack()];
	const observed: number[] = [];
	r.setEncoded = (index, tag, word) => { ++writes[index]; set(index, tag, word); };
	new Function('r', 'observed', cache.declarations() + source.join('\n'))(r, observed);
	assert.equal(writes[0], 1); assert.equal(writes[7], 1); assert.equal(writes[2], 1);
	assert.equal(r.getInteger(2), 2); assert.deepEqual(observed, [1, 1]);
});

for (const displaced of [false, true]) for (const count of [0, 1, 4, 5, 1025, displaced ? 4095 : 32767]) test(`a terminal word span starts with one cycle and never starts its successor (count=${count}, displaced=${displaced})`, () => {
	const image = wordLoop(count, displaced), start = image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES;
	const target = DYNAMIC_RAM_BASE + 0x4000, charge = 3 + (count);
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	for (let attempt = 0; attempt < 12; ++attempt) for (const { cpu } of [js, ref]) {
		const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(0, target - (displaced ? 1020 : 0)); frame.registers.setInteger(7, 99);
		for (let i = 0; i < count; ++i) frame.registers.setInteger(8 + i, 0x20000000 | i);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - charge); assert.equal(frame.pc, start + 2 * INSTRUCTION_BYTES);
		assert.equal(cpu.lastPc, start + INSTRUCTION_BYTES); assert.equal(frame.registers.getInteger(7), 99);
	}
	assertParity(js.cpu, ref.cpu); assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
	const frame = js.cpu.rootThread.frameAtDepth(0), block = frame.decodedPage!.compiledBlocks!.entries[(start & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	assert.ok(block); assert.equal(block.sourceWords, 2);
	if (count > 0) {
		assert.equal(js.memory.readMappedWord(target), 0x20000000);
		assert.equal(js.memory.readMappedWord(target + (count - 1) * 4), 0x20000000 | (count - 1));
	}
});
