import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SHIFT, MAPPED_PAGE_BYTE_SIZE, MappedPageWriteWatches } from '../../machine/ts/machine/memory/mapped_page';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR } from '../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BUS_FAULT_UNMAPPED, IO_SYS_BUS_FAULT_CODE, IO_SYS_BUS_FAULT_ADDR } from '../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { RAM_CODE_FIXTURE_BYTES, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';

test('shrinking public RAM retires code watches without disarming history', () => {
	const memory = new Memory({ systemRom: new Uint8Array(4), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	let codeWrites = 0;
	const ranges: number[][] = [];
	memory.attachMappedPageInvalidator({
		invalidateMappedWords: () => { ++codeWrites; },
		invalidateMappedRange: (first, end) => { ranges.push([first, end]); },
	});
	const watches = memory.ramWriteWatches(), first = DYNAMIC_RAM_BASE - RAM_BASE;
	const retired = first + MAPPED_PAGE_BYTE_SIZE;
	watches.armCodeRange(first, 4); watches.armCodeRange(retired, 8); watches.armHistoryWrites();
	memory.setRamBusEnd(RAM_BASE + retired);
	assert.deepEqual(ranges, [[RAM_BASE + retired, RAM_BASE + MAIN_RAM_SIZE]]);
	assert.equal(watches.anyWatched(first, 4), true);
	assert.equal(watches.anyWatched(retired, 8), false);
	assert.equal(watches.historyPageDirty(retired >>> MAPPED_PAGE_BYTE_SHIFT, (retired >>> MAPPED_PAGE_BYTE_SHIFT) + 1), false);
	memory.writeRamRecordWord(retired, 7);
	assert.equal(codeWrites, 0, 'a private record write has no obsolete fetch watch');
	assert.equal(watches.historyPageDirty(retired >>> MAPPED_PAGE_BYTE_SHIFT, (retired >>> MAPPED_PAGE_BYTE_SHIFT) + 1), true);
	memory.writeRamRecordWord(first, 9); assert.equal(codeWrites, 1);
});

test('retirement clears exactly its code-word range across watch groups and pages', () => {
	const watches = new MappedPageWriteWatches(3 * MAPPED_PAGE_BYTE_SIZE);
	watches.armCodeRange(0, 3 * MAPPED_PAGE_BYTE_SIZE); watches.armHistoryWrites();
	const first = 31 * 4, end = 2 * MAPPED_PAGE_BYTE_SIZE + 4;
	watches.clearCodeRange(first, end - first);
	for (let word = 0; word < 3 * MAPPED_PAGE_BYTE_SIZE / 4; ++word)
		assert.equal(watches.anyWatched(word * 4, 4), word * 4 < first || word * 4 >= end);
	assert.equal(watches.historyPageDirty(0, 3), false);
});

test('ordinary writes cannot mutate private image maps or embedded constants', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.GETGL, 0, 0, 0);
	writeInstruction(text, 1, OpCode.LOADK, 1, 0, 0);
	writeInstruction(text, 2, OpCode.ADD, 2, 0, 1);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 3 }],
		constants: [integerConstant(7)], globalNames: ['first', 'second'] });
	const { cpu, memory } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const frame = cpu.rootThread.frameAtDepth(0), execution = frame.executionImage;
	cpu.setGlobalByKey(cpu.stringPool.find('first')!, valueInteger(10));
	cpu.setGlobalByKey(cpu.stringPool.find('second')!, valueInteger(20));
	assert.equal(cpu.runUntilDepth(0, 4096), RunResult.Yielded);
	assert.equal(frame.registers.getInteger(2), 17);
	assert.ok(frame.decodedPage!.compiledBlocks!.entries[(image.image.functions[0].codeAddress & MAPPED_PAGE_BYTE_MASK) >>> 2], 'the fixture exercises a real compiled region');
	const address = execution.imageBindingBase, before = memory.readRamRecordWord(address);
	assert.ok(address >= memory.ramBusEnd());
	memory.clearBusFault();
	memory.writeMappedU32LE(address, memory.readRamRecordWord(address + 4));
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), address);
	assert.equal(memory.readRamRecordWord(address), before, 'private image bindings are not a public mutation interface');
	cpu.runUntilDepth(0, 128);
	assert.equal(frame.registers.getInteger(2), 17, 'compiled guest lookup and constants retain their original semantics');
});

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`a WIDE predecessor is retired when its body becomes NX (${backend})`, () => {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }] }, RAM_CODE_FIXTURE_BYTES);
		const { cpu, memory } = createTestSystemCpu(image, backend);
		const end = memory.ramBusEnd() - MAPPED_PAGE_BYTE_SIZE, pc = end - INSTRUCTION_BYTES;
		const code = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0);
		writeInstruction(code, 1, OpCode.K1, 0, 0, 0);
		memory.writeBytes(pc, code);
		const frame = cpu.rootThread.frameAtDepth(0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.runUntilDepth(0, 1);
		assert.equal(frame.registers.getInteger(0), 1);
		assert.equal(memory.ramWriteWatches().anyWatched(end - RAM_BASE, 4), true);
		memory.setRamBusEnd(end);
		assert.equal(memory.ramWriteWatches().anyWatched(end - RAM_BASE, 4), false);
		writeInstruction(code, 1, OpCode.K0, 0, 0, 0);
		memory.writeBytes(end, code.subarray(INSTRUCTION_BYTES));
		frame.registers.setInteger(0, 71);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR);
		assert.equal(cpu.readEpcWord(), pc);
		assert.equal(frame.registers.getInteger(0), 71, 'the old decoded WIDE body cannot execute after aperture retirement');
	});
}
