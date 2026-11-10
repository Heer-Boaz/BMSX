import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE, IO_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

test('linked physical-page blocks preserve every grant and disconnect rewritten targets', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.ADD, 8, 8, 1);
	writeInstruction(text, 1, OpCode.JMPIF, 2, 0, 2);
	writeInstruction(text, 2, OpCode.UNM, 0, 0, 0);
	writeInstruction(text, 3, OpCode.JMP, 0, 0, 2);
	writeInstruction(text, 4, OpCode.SHL, 0, 0, 1);
	writeInstruction(text, 5, OpCode.MOV, 3, 8, 0);
	writeInstruction(text, 6, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 7, OpCode.ADD, 4, 0, 8);
	writeInstruction(text, 8, OpCode.JMP, 0, 63, 55, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 9, maxStack: 12 }] });
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frames[0];
		frame.registers.setNumber(0, 2); frame.registers.setNumber(1, 1); frame.registers.setNumber(8, 0);
	}
	for (const flag of [true, false]) for (const { cpu } of machines) {
		const frame = cpu.rootThread.frames[0]; frame.registers.setBool(2, flag);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		assert.equal(cpu.runUntilDepth(0, 2048), RunResult.Yielded);
	}
	const page = machines[0].cpu.rootThread.frames[0].decodedPage!, cache = page.compiledBlocks!;
	const root = cache.entries[0]!, taken = root.exits.find(exit => exit.nextPc === DYNAMIC_RAM_BASE + 4 * INSTRUCTION_BYTES)!;
	assert.equal(root.terminal.linkedBlock, cache.entries[2]); assert.ok(root.terminal.linkedBlock);
	assert.equal(taken.linkedBlock, cache.entries[4]); assert.ok(taken.linkedBlock);
	assert.equal(taken.exit, CompiledBlockExit.Continue);
	for (const flag of [true, false, 0, NaN]) for (let grant = 1; grant <= 96; ++grant) {
		for (const { cpu } of machines) {
			const frame = cpu.rootThread.frames[0]; frame.registers.set(2, flag); frame.top = 0;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
			assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
	}
	const replacement = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(replacement, 0, OpCode.SUB, 4, 0, 8);
	for (const { memory } of machines) memory.writeBytes(DYNAMIC_RAM_BASE + 7 * INSTRUCTION_BYTES, replacement);
	assert.equal(cache.entries[0], root, 'rewriting a target does not discard its independent predecessor');
	assert.equal(cache.entries[4], null); assert.equal(taken.linkedBlock, null);
	assert.equal(root.terminal.linkedBlock, cache.entries[2], 'the other outgoing edge remains live');
	for (const { cpu } of machines) {
		cpu.rootThread.frames[0].registers.setBool(2, true);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 2048);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	assert.equal(taken.linkedBlock, cache.entries[4]); assert.ok(taken.linkedBlock);
	// A large hot chain must use bounded JS stack, rather than recursive tail calls.
	for (const { cpu } of machines) cpu.runUntilDepth(0, 600002);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	machines[0].cpu.reset();
	assert.equal(taken.linkedBlock, null); assert.equal(root.terminal.linkedBlock, null);
});

test('cross-page chains retain successor page ownership and disconnect rewritten targets', () => {
	const text = new Uint8Array(2 * MAPPED_PAGE_BYTE_SIZE), second = MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES;
	writeInstruction(text, 0, OpCode.ADD, 8, 8, 1);
	writeInstruction(text, 1, OpCode.JMP, 0, 3, 62);
	writeInstruction(text, second, OpCode.MUL, 0, 0, 1);
	writeInstruction(text, second + 1, OpCode.MOV, 3, 8, 0);
	writeInstruction(text, second + 2, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, second + 3, OpCode.ADD, 4, 0, 8);
	writeInstruction(text, second + 4, OpCode.JMP, 0, 59, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: second + 5, maxStack: 12 }] });
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frames[0];
		frame.registers.setNumber(0, 2); frame.registers.setNumber(1, 1); frame.registers.setNumber(8, 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 2048);
	}
	const lookup = machines[0].cpu.rootThread.frames[0].executionImage.compiledCodeLookup!;
	const firstPage = lookup.find(DYNAMIC_RAM_BASE, 0)!, secondPage = lookup.find(DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE, 0)!;
	const root = firstPage.compiledBlocks!.entries[0]!, target = secondPage.compiledBlocks!.entries[0]!;
	assert.ok(root); assert.ok(target);
	assert.equal(root.terminal.linkedBlock, target); assert.equal(target.terminal.linkedBlock, root);
	assert.equal(root.page, firstPage); assert.equal(target.page, secondPage, 'a linked body carries its own page, not the predecessor page');
	for (let grant = 1; grant <= 128; ++grant) {
		for (const { cpu } of machines) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
			cpu.runUntilDepth(0, grant);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
	}
	const replacement = new Uint8Array(INSTRUCTION_BYTES); writeInstruction(replacement, 0, OpCode.SUB, 4, 0, 8);
	for (const { memory } of machines) memory.writeBytes(DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE + 3 * INSTRUCTION_BYTES, replacement);
	assert.equal(firstPage.compiledBlocks!.entries[0], root); assert.equal(root.terminal.linkedBlock, null);
	for (const { cpu } of machines) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 2048);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	assert.equal(root.terminal.linkedBlock, secondPage.compiledBlocks!.entries[0]); assert.ok(root.terminal.linkedBlock);
	for (const { cpu } of machines) cpu.runUntilDepth(0, 600002);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	machines[0].cpu.reset(); assert.equal(root.terminal.linkedBlock, null);
});

test('linked counted stores need only one cycle, then stop or block before the following instruction', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 6, 0, 0); writeInstruction(text, 1, OpCode.JMP, 0, 0, 2);
	writeInstruction(text, 4, OpCode.WIDE, 0, 0, 0); writeInstruction(text, 5, OpCode.STORE_MEM_WORDS, 8, 0, 5);
	writeInstruction(text, 6, OpCode.K1, 7, 0, 0); writeInstruction(text, 7, OpCode.JMP, 0, 63, 56, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 8, maxStack: 13 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const pc = image.image.functions[0].codeAddress, address = DYNAMIC_RAM_BASE + 0x4000;
	for (const { cpu } of [js, ref]) {
		const r = cpu.rootThread.frames[0].registers; r.setNumber(0, address);
		for (let i = 0; i < 5; ++i) r.setNumber(8 + i, 73 + i);
		cpu.runUntilDepth(0, 1024);
	}
	const cache = js.cpu.rootThread.frames[0].decodedPage!.compiledBlocks!, first = cache.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	assert.equal(first.entryCycles, 2);
	const store = first.terminal.linkedBlock!;
	assert.ok(store); assert.equal(store.entryCycles, 1); assert.equal(store.terminal.cycles, 4); assert.ok(store.terminal.linkedBlock);
	for (const grant of [2, 3, 6, 7, 8, 9]) {
		for (const { cpu } of [js, ref]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			const frame = cpu.rootThread.frames[0]; frame.top = 0; frame.registers.setNumber(7, 99);
			assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
			assert.equal(frame.registers.getNumber(7), grant < 7 ? 99 : 1);
		}
		assert.deepEqual(js.cpu.captureRuntimeState(), ref.cpu.captureRuntimeState());
		assert.equal(js.cpu.instructionBudgetRemaining, ref.cpu.instructionBudgetRemaining);
	}
	const endpoints = [];
	for (const { cpu, memory } of [js, ref]) {
		const port = { ready: false, writes: [] as number[] }; endpoints.push(port);
		for (let i = 0; i < 5; ++i) {
			memory.mapIoWrite(IO_BASE + 0x5000 + i * 4, port, (state, _address, word) => state.writes.push(word));
			memory.mapIoWriteReady<typeof port>(IO_BASE + 0x5000 + i * 4, state => state.ready);
		}
		const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(0, IO_BASE + 0x5000); frame.registers.setNumber(7, 99);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		assert.equal(cpu.runUntilDepth(0, 3), RunResult.Halted); assert.equal(cpu.instructionBudgetRemaining, -1);
		assert.equal(frame.pc, pc + 4 * INSTRUCTION_BYTES); assert.equal(cpu.stalledMemoryWriteAddress(), IO_BASE + 0x5000); assert.deepEqual(port.writes, []);
		port.ready = true; cpu.resumeMemoryWrite(IO_BASE + 0x5000);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded); assert.equal(cpu.instructionBudgetRemaining, -3);
		assert.equal(frame.pc, pc + 6 * INSTRUCTION_BYTES); assert.equal(frame.registers.getNumber(7), 99);
		assert.deepEqual(port.writes, [73, 74, 75, 76, 77]);
	}
	assert.deepEqual(js.cpu.captureRuntimeState(), ref.cpu.captureRuntimeState());
	assert.deepEqual(endpoints[0], endpoints[1]);
});

test('linked memory side exits retain predecessor state before MMIO and synchronous faults', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.ADD, 9, 9, 1);
	writeInstruction(text, 1, OpCode.JMP, 0, 0, 2);
	writeInstruction(text, 4, OpCode.LOAD_MEM, 3, 0, MemoryAccessKind.U32LE);
	writeInstruction(text, 5, OpCode.ADD, 2, 2, 3);
	writeInstruction(text, 6, OpCode.JMP, 0, 63, 57, 255);
	writeInstruction(text, 7, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 7, maxStack: 12 }, { firstWord: 7, wordCount: 1 },
	], exceptionFunctionIndex: 1 });
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text); memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 0x800, 5);
		const frame = cpu.rootThread.frames[0];
		frame.registers.setNumber(0, DYNAMIC_RAM_BASE + 0x800); frame.registers.setNumber(1, 1);
		frame.registers.setNumber(2, 0); frame.registers.setNumber(9, 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1200);
	}
	const page = machines[0].cpu.rootThread.frames[0].decodedPage!, root = page.compiledBlocks!.entries[0]!;
	assert.ok(root.terminal.linkedBlock); assert.equal(root.terminal.linkedBlock, page.compiledBlocks!.entries[4]);
	for (const address of [IO_SYS_BUS_FAULT_CODE, 0x01000000]) {
		for (const { cpu } of machines) {
			const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(0, address); frame.top = 0;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
			cpu.runUntilDepth(0, 6);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
	}
	assert.equal(machines[0].cpu.readEpcWord(), DYNAMIC_RAM_BASE + 4 * INSTRUCTION_BYTES);
});
