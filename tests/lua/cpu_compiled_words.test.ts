import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CompiledBlockExit, CpuExecutionBackend, compiledBlockSupports } from '../../machine/ts/machine/cpu/compiled_block';
import { JavaScriptRegisterCache } from '../../machine/ts/machine/cpu/compiled_block_registers';
import { valueFromNumber } from '../../machine/ts/machine/cpu/value';
import { readLE32 } from '../../machine/ts/common/endian';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { OPCODE_COUNT, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, CPU_CAUSE_CODE_DATA_BUS_ERROR } from '../../machine/ts/spec/blua32/cop0';
import { DYNAMIC_RAM_BASE, IO_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

function assertParity(a: CPU, b: CPU): void {
	assert.ok(isDeepStrictEqual(a.captureRuntimeState(), b.captureRuntimeState()), 'full value graph, roots, frame/control state and heap accounting');
	assert.equal(a.instructionBudgetRemaining, b.instructionBudgetRemaining);
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
	assert.equal(compiledBlockSupports(OpCode.WIDE), false);
	for (let op = 1; op < OPCODE_COUNT; ++op) assert.equal(compiledBlockSupports(op), true, `opcode ${op}`);
});

for (const displaced of [false, true]) for (const count of [0, 5, 1025]) test(`generated word span preserves conversions, cached sources and every cycle boundary (count=${count}, displaced=${displaced})`, () => {
	const image = wordLoop(count, displaced), pc = image.image.functions[0].codeAddress, target = DYNAMIC_RAM_BASE + 0x2ffc;
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const surcharge = (count + 3) >> 2;
	for (const { cpu } of [js, ref]) {
		const r = cpu.rootThread.frames[0].registers; r.setNumber(0, target - (displaced ? 1020 : 0)); r.setNumber(12, 73);
		for (let i = 0; i < count; ++i) if (i !== 4) r.setNumber(8 + i, i + 100);
		cpu.runUntilDepth(0, 20 * (7 + surcharge));
	}
	const frame = js.cpu.rootThread.frames[0], page = frame.decodedPage!, block = page.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	assert.equal(block.sourceWords, 5); assert.equal(block.terminal.cycles, 5 + surcharge); assert.equal(block.entryCycles, 4);
	assert.equal(block.exits[0].exit, CompiledBlockExit.WriteWords); assert.equal(block.exits[0].cycles, 5);
	for (const value of [-0, -1.75, 4294967296.25, 1e100, Infinity, NaN, null, true]) {
		for (const grant of [1, 3, 4, 5, 5 + surcharge, 6 + surcharge, 7 + surcharge, 4 * (7 + surcharge)]) {
			for (const { cpu } of [js, ref]) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
				cpu.rootThread.frames[0].registers.set(12, value); cpu.rootThread.frames[0].top = 0;
				cpu.runUntilDepth(0, grant);
			}
			assertParity(js.cpu, ref.cpu); assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
		}
	}
	assert.equal(frame.top, 10, 'the counted source range does not extend top');
	assert.equal(frame.registers.getNumber(7), 2, 'clean cached sources remain live after the bulk call');
});

test('a WIDE counted store retains a signed RK address and the full source register range', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE), target = DYNAMIC_RAM_BASE + 0x4000;
	writeInstruction(text, 0, OpCode.WIDE, 2, 63, 1);
	writeInstruction(text, 1, OpCode.STORE_MEM_WORDS, 0, 63, 1, 56); // R512..1024, K[0], C=513.
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 1025 }], constants: [target] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	for (const { cpu } of [js, ref]) { for (let i = 0; i < 513; ++i) cpu.rootThread.frames[0].registers.setNumber(512 + i, i - 1); cpu.runUntilDepth(0, 20 * 132); }
	assertParity(js.cpu, ref.cpu); assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
	const frame = js.cpu.rootThread.frames[0], pc = image.image.functions[0].codeAddress;
	const exit = frame.decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!.exits[0];
	assert.equal(exit.exitA, 512); assert.equal(exit.exitB, -1); assert.equal(exit.exitC, 513);
	assert.equal(js.memory.readMappedWord(target), 0xffffffff); assert.equal(js.memory.readMappedWord(target + 512 * 4), 511);
	assert.equal(frame.top, 0);
});

for (const unaligned of [false, true]) test(`a zero-count store checks only alignment, without an IO or mapping preflight (unaligned=${unaligned})`, () => {
	const image = wordLoop(0), pc = image.image.functions[0].codeAddress;
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	for (const { cpu } of [js, ref]) { cpu.rootThread.frames[0].registers.setNumber(0, DYNAMIC_RAM_BASE); cpu.runUntilDepth(0, 140); }
	for (const address of unaligned ? [IO_BASE + 0x5001] : [0, 0xfffffffc, IO_BASE + 0x5000]) {
		const probes: number[] = [];
		for (const { cpu, memory } of [js, ref]) {
			memory.mapIoWrite(IO_BASE + 0x5000, probes, () => assert.fail('empty stores do not write'));
			memory.mapIoWriteReady(IO_BASE + 0x5000, () => { probes.push(1); return false; });
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			cpu.rootThread.frames[0].registers.setNumber(0, address); cpu.runUntilDepth(0, 20);
		}
		assertParity(js.cpu, ref.cpu); assert.equal(probes.length, 0); assert.equal(js.memory.readBusFaultSequence(), 0);
		assert.equal(js.cpu.captureRuntimeState().memoryWriteBlocked, false);
		if (unaligned) { assert.equal(js.cpu.readCauseWord(), CPU_CAUSE_CODE_ADDRESS_ERROR_STORE); assert.equal(js.cpu.readBadAddressWord(), address); assert.equal(js.cpu.readEpcWord(), pc + 3 * INSTRUCTION_BYTES); }
		else assert.equal(js.cpu.readCauseWord(), 0);
	}
});

test('counted preflight blocks on a later IO word before an earlier bus fault or sequence charge', () => {
	const image = wordLoop(3), pc = image.image.functions[0].codeAddress;
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	for (const { cpu } of [js, ref]) { cpu.rootThread.frames[0].registers.setNumber(0, DYNAMIC_RAM_BASE); cpu.runUntilDepth(0, 160); }
	const devices = [];
	for (const { cpu, memory } of [js, ref]) {
		const device = { ready: false, probes: [] as number[], writes: 0 }; devices.push(device);
		for (let i = 0; i < 2; ++i) {
			memory.mapIoWrite(IO_BASE + i * 4, device, state => { ++state.writes; });
			memory.mapIoWriteReady(IO_BASE + i * 4, (state: typeof device, address) => { state.probes.push(address); return address === IO_BASE || state.ready; });
		}
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.rootThread.frames[0].registers.setNumber(0, IO_BASE - 4);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
		assert.equal(cpu.instructionBudgetRemaining, 15); assert.equal(memory.readBusFaultSequence(), 0);
		assert.equal(cpu.readFramePc(0), pc + 3 * INSTRUCTION_BYTES); assert.equal(cpu.stalledMemoryWriteAddress(), IO_BASE + 4);
		assert.deepEqual(device.probes, [IO_BASE, IO_BASE + 4]); assert.equal(device.writes, 0);
		cpu.resumeMemoryWrite(IO_BASE); assert.equal(cpu.captureRuntimeState().memoryWriteBlocked, true);
		device.ready = true; cpu.resumeMemoryWrite(IO_BASE + 4); cpu.runUntilDepth(0, 2);
		assert.equal(cpu.instructionBudgetRemaining, -1); assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_DATA_BUS_ERROR);
		assert.equal(cpu.readEpcWord(), pc + 3 * INSTRUCTION_BYTES); assert.equal(device.writes, 0);
	}
	assertParity(js.cpu, ref.cpu); assert.deepEqual(devices[0], devices[1]);
});

test('counted IO writes preflight once, preserve the completed fault prefix, and charge the whole sequence', () => {
	const image = wordLoop(5), pc = image.image.functions[0].codeAddress, target = IO_BASE + 0x5000;
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter), devices = [];
	for (const { cpu } of [js, ref]) { cpu.rootThread.frames[0].registers.setNumber(0, DYNAMIC_RAM_BASE); cpu.runUntilDepth(0, 180); }
	for (const { cpu, memory } of [js, ref]) {
		const device = { ready: true, trace: [] as string[], values: [] as number[] }; devices.push(device);
		for (let i = 0; i < 5; ++i) {
			memory.mapIoWrite(target + i * 4, device, (state, address, value) => {
				state.trace.push(`w${i}`); state.values.push(value); state.ready = false;
				if (address === target + 8) memory.writeMappedWord(0xdead0000, value);
			});
			memory.mapIoWriteReady(target + i * 4, (state: typeof device) => { state.trace.push(`r${i}`); return state.ready; });
		}
		const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(0, target); frame.registers.setNumber(12, 42); frame.registers.setNumber(10, 73); frame.registers.setNumber(7, 99);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc); cpu.runUntilDepth(0, 20);
		assert.deepEqual(device.trace, ['r0', 'r1', 'r2', 'r3', 'r4', 'w0', 'w1', 'w2']); assert.deepEqual(device.values, [42, 1, 73]);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_DATA_BUS_ERROR); assert.equal(cpu.readEpcWord(), pc + 3 * INSTRUCTION_BYTES);
		assert.equal(frame.registers.getNumber(7), 99); assert.equal(cpu.captureRuntimeState().memoryWriteBlocked, false);
	}
	assertParity(js.cpu, ref.cpu); assert.deepEqual(devices[0], devices[1]); assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
});

test('a counted span checks middle watch pages and can retire its own native source during ordered writes', () => {
	const count = MAPPED_PAGE_BYTE_SIZE / 2 + 1, image = wordLoop(count), romPc = image.image.functions[0].codeAddress;
	const pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE, cycles = 7 + ((count + 3) >> 2);
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const halt = new Uint8Array(4); writeInstruction(halt, 0, OpCode.HALT, 0, 0, 0);
	for (const { cpu, memory } of [js, ref]) {
		memory.writeBytes(pc, image.romBytes.subarray(romPc, romPc + MAPPED_PAGE_BYTE_SIZE));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.rootThread.frames[0].registers.setNumber(0, pc + 8 * MAPPED_PAGE_BYTE_SIZE); cpu.runUntilDepth(0, 20 * cycles);
	}
	const page = js.cpu.rootThread.frames[0].decodedPage!; assert.ok(page.compiledBlocks!.entries[0]);
	for (const { cpu } of [js, ref]) {
		const frame = cpu.rootThread.frames[0]; for (let i = 0; i < count; ++i) frame.registers.setNumber(8 + i, 0);
		frame.registers.setNumber(8 + MAPPED_PAGE_BYTE_SIZE / 4 + 5, readLE32(halt, 0)); frame.registers.setNumber(7, 99); frame.registers.setNumber(0, DYNAMIC_RAM_BASE);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Halted); assert.equal(frame.registers.getNumber(7), 99); assert.equal(frame.pc, pc + 6 * INSTRUCTION_BYTES);
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
	for (const { cpu } of [js, ref]) { const r = cpu.rootThread.frames[0].registers; r.setNumber(0, DYNAMIC_RAM_BASE); r.setNumber(1, DYNAMIC_RAM_BASE + 64); cpu.runUntilDepth(0, 200); }
	const block = js.cpu.rootThread.frames[0].decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / 4]!;
	assert.equal(block.terminal.cycles, 5); assert.equal(block.exits[0].cycles, 3);
	const second = block.terminal.linkedBlock!;
	assert.ok(second); assert.equal(second.entryCycles, 1); assert.equal(second.terminal.cycles, 3); assert.equal(second.exits[0].cycles, 2);
	for (const { cpu, memory } of [js, ref]) {
		memory.mapIoWrite(IO_BASE + 0x5000, null, () => assert.fail('not ready')); memory.mapIoWriteReady(IO_BASE + 0x5000, () => false);
		const frame = cpu.rootThread.frames[0]; frame.top = 0; frame.registers.setNumber(1, blocked ? IO_BASE + 0x5000 : RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 4);
		frame.registers.setNumber(7, 99); frame.registers.setNumber(20, 73);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc); cpu.runUntilDepth(0, 20);
		assert.equal(frame.registers.getNumber(7), 99); assert.equal(frame.top, 7);
		if (blocked) assert.equal(cpu.instructionBudgetRemaining, 13);
		else { assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_DATA_BUS_ERROR); assert.equal(memory.readMappedWord(RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 4), 73); }
	}
	assertParity(js.cpu, ref.cpu); assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
});

test('bulk source publication neither discards clean SSA values nor repeats their writeback', () => {
	const { cpu } = createTestSystemCpu(wordLoop(0), CpuExecutionBackend.JavaScript);
	const frame = cpu.rootThread.frames[0], r = frame.registers;
	const cache = new JavaScriptRegisterCache(frame.executionImage), writes = new Uint32Array(8), set = r.setEncoded.bind(r);
	const source = [cache.writeNumber(0, '1'), cache.writeNumber(7, '1'), cache.publishRange(0, 1),
		'observed.push(r.getNumber(0));', cache.copy(0, 0),
		cache.writeNumber(2, `${cache.numberOperand(0)}+${cache.numberOperand(7)}`), cache.publishRange(0, 1),
		'observed.push(r.getNumber(0));', cache.writeBack()];
	const observed: number[] = [];
	r.setEncoded = (index, tag, scalar, reference) => { ++writes[index]; set(index, tag, scalar, reference); };
	new Function('r', 'f', 'observed', source.join('\n'))(r, valueFromNumber, observed);
	assert.equal(writes[0], 1); assert.equal(writes[7], 1); assert.equal(writes[2], 1);
	assert.equal(r.getNumber(2), 2); assert.deepEqual(observed, [1, 1]);
});

for (const displaced of [false, true]) for (const count of [0, 1025, displaced ? 4095 : 32767]) test(`a terminal word span starts with one cycle and never starts its successor (count=${count}, displaced=${displaced})`, () => {
	const image = wordLoop(count, displaced), start = image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES;
	const target = DYNAMIC_RAM_BASE + 0x4000, charge = 2 + ((count + 3) >> 2);
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	for (let attempt = 0; attempt < 12; ++attempt) for (const { cpu } of [js, ref]) {
		const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(0, target - (displaced ? 1020 : 0)); frame.registers.setNumber(7, 99);
		for (let i = 0; i < count; ++i) frame.registers.setNumber(8 + i, 0x20000000 | i);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - charge); assert.equal(frame.pc, start + 2 * INSTRUCTION_BYTES);
		assert.equal(cpu.lastPc, start + INSTRUCTION_BYTES); assert.equal(frame.registers.getNumber(7), 99);
	}
	assertParity(js.cpu, ref.cpu); assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
	const frame = js.cpu.rootThread.frames[0], block = frame.decodedPage!.compiledBlocks!.entries[(start & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	assert.ok(block); assert.equal(block.entryCycles, 1); assert.equal(block.sourceWords, 2); assert.equal(block.terminal.cycles, charge);
	if (count > 0) {
		assert.equal(js.memory.readMappedWord(target), 0x20000000);
		assert.equal(js.memory.readMappedWord(target + (count - 1) * 4), 0x20000000 | (count - 1));
	}
});
