import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createBuiltinFunction, StringValue, ValueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { BUS_FAULT_NONE, BUS_FAULT_UNMAPPED, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createTestSystemCpu, linkRawTestSystemBlua32, type TestBlua32Source } from '../helpers/blua32';

function comparisonImage(op: OpCode, expected: boolean, left = 0, right = 1, constants: TestBlua32Source['constants'] = []) {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K0, 3, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, expected ? 3 : 0, (left >>> 9) & 63, (right >>> 9) & 63);
	writeInstruction(text, 2, op, 0, left & 63, right & 63, ((left >>> 6) & 7) << 3 | ((right >>> 6) & 7));
	writeInstruction(text, 3, OpCode.K1, 3, 0, 0);
	writeInstruction(text, 4, OpCode.MOV, 4, 3, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	writeInstruction(text, 6, OpCode.HALT, 0, 0, 0);
	return linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 6, maxStack: 8 }, { firstWord: 6, wordCount: 1 },
	], constants, exceptionFunctionIndex: 1 });
}

function values(cpu: CPU): Value[] {
	const closure = cpu.rootThread.frames[0].closure;
	return [null, false, true, 0, -0, 1, -1, 0.25, NaN, Infinity, -Infinity,
		...['', 'a', 'a\0b', '\ue000', '\u{10000}', 'é'].map(text => StringValue.fromId(cpu.stringPool.intern(text))),
		cpu.createTable(0, 0), cpu.createTable(0, 0), closure, cpu.rootThread, cpu.createThread(closure),
		createBuiltinFunction(BuiltinFunctionId.Type), createBuiltinFunction(BuiltinFunctionId.Next)];
}

for (const op of [OpCode.EQ, OpCode.LT, OpCode.LE]) for (const expected of [false, true]) {
	test(`generated comparison ${op}, expected ${expected}: kinds, reference identities, NaNs and UTF-8 order`, () => {
		const image = comparisonImage(op, expected);
		const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
		const inputs = machines.map(({ cpu }) => values(cpu));
		const entry = image.image.functions[0].codeAddress;
		for (const { cpu } of machines) cpu.runUntilDepth(0, 800);
		const frame = machines[0].cpu.rootThread.frames[0], page = frame.decodedPage!;
		const block = page.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
		assert.equal(block.sourceWords, 4, 'the fixed skip retains its fetched successor as a source dependency');
		assert.equal(block.terminal.currentPc, entry + INSTRUCTION_BYTES);
		assert.equal(block.terminal.lastPc, entry + 2 * INSTRUCTION_BYTES);
		assert.equal(block.terminal.exitA, expected ? 0x300 : 0);
		assert.ok(block.exits.some(exit => exit.exit === CompiledBlockExit.Continue && exit.nextPc === entry + 4 * INSTRUCTION_BYTES));
		for (let left = 0; left < inputs[0].length; ++left) for (let right = 0; right < inputs[0].length; ++right) {
			for (const [index, { cpu }] of machines.entries()) {
				const current = cpu.rootThread.frames[0];
				current.registers.set(0, inputs[index][left]); current.registers.set(1, inputs[index][right]); current.top = 0;
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
				assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded);
				assert.equal(current.top, 4, 'expected truth is not a register destination, including wide nonzero A');
			}
			assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState(), `pair ${left},${right}`);
			assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
		}
	});
}

test('comparison RK constants and every short grant agree with scalar execution', () => {
	const constants = [null, false, true, -0, NaN, Infinity, 0.25, '', 'a\0b', '\ue000', '\u{10000}'];
	for (const op of [OpCode.EQ, OpCode.LT, OpCode.LE]) for (const selectors of [[-1, 1], [0, -2], [-10, -11]]) {
		const image = comparisonImage(op, true, selectors[0], selectors[1], constants);
		const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
		const entry = image.image.functions[0].codeAddress;
		for (const { cpu } of machines) cpu.runUntilDepth(0, 800);
		for (let grant = 1; grant <= 31; ++grant) for (const value of [null, false, NaN, -0, 0.25, Infinity]) {
			for (const { cpu } of machines) {
				const current = cpu.rootThread.frames[0]; current.registers.set(0, value); current.registers.set(1, value);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
				cpu.runUntilDepth(0, grant);
			}
			assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
			assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
		}
	}
});

test('EQ ignores unused Nil/boolean scalar payloads without rewriting either source slot', () => {
	const image = comparisonImage(OpCode.EQ, false);
	for (const backend of [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter]) {
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.runUntilDepth(0, 800);
		for (const kind of [ValueTag.Nil, ValueTag.False, ValueTag.True]) {
			const frame = cpu.rootThread.frames[0];
			frame.registers.setEncoded(0, kind, 1, null); frame.registers.setEncoded(1, kind, 2, null);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
			cpu.runUntilDepth(0, 2);
			assert.equal(frame.pc, image.image.functions[0].codeAddress + 4 * INSTRUCTION_BYTES);
			assert.equal(frame.registers.getScalar(0), 1); assert.equal(frame.registers.getScalar(1), 2);
		}
	}
});

test('resolved comparison skips retire when their fetched WIDE width changes', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.ADD, 3, 6, 6);
	writeInstruction(text, 1, OpCode.EQ, 1, 0, 1);
	writeInstruction(text, 2, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 3, OpCode.K1, 2, 0, 0);
	writeInstruction(text, 4, OpCode.MOV, 5, 2, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 8 }] });
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(0, 0); frame.registers.setNumber(1, 1); frame.registers.setNumber(2, 73);
		frame.registers.setNumber(6, 1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 800);
	}
	const page = machines[0].cpu.rootThread.frames[0].decodedPage!, block = page.compiledBlocks!.entries[0];
	assert.ok(block); assert.equal(block.sourceWords, 4);
	assert.ok(block.exits.some(exit => exit.exit === CompiledBlockExit.Continue && exit.nextPc === DYNAMIC_RAM_BASE + 4 * INSTRUCTION_BYTES));
	for (const wide of [false, true, false]) {
		const replacement = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(replacement, 0, wide ? OpCode.WIDE : OpCode.K0, 0, 0, 0);
		for (const { cpu, memory } of machines) {
			memory.writeBytes(DYNAMIC_RAM_BASE + 2 * INSTRUCTION_BYTES, replacement);
			const frame = cpu.rootThread.frames[0]; frame.top = 0; frame.registers.setNumber(2, 73);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
			cpu.runUntilDepth(0, 2);
			assert.equal(frame.pc, DYNAMIC_RAM_BASE + (wide ? 4 : 3) * INSTRUCTION_BYTES);
			assert.equal(frame.registers.getNumber(2), 73); assert.equal(frame.top, 4);
		}
		assert.equal(page.compiledBlocks!.entries[0], null, 'the resolved edge must not retain its old width');
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		for (const { cpu } of machines) cpu.runUntilDepth(0, 800);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.ok(page.compiledBlocks!.entries[0], 'the changed comparison warms and compiles again');
	}
});

test('a maximum-length compiled comparison retains both words of its skipped WIDE dependency', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	for (let instruction = 0; instruction < 63; ++instruction) {
		writeInstruction(text, instruction * 2, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, instruction * 2 + 1, OpCode.MOV, 3, 3, 0);
	}
	writeInstruction(text, 126, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 127, OpCode.EQ, 1, 0, 1);
	writeInstruction(text, 128, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 129, OpCode.K1, 2, 0, 0);
	writeInstruction(text, 130, OpCode.JMP, 0, 61, 61, 255); // -131 words, back to the first prefix.
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 131, maxStack: 4 }] });
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(0, 0); frame.registers.setNumber(1, 1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 8192);
	}
	const cache = machines[0].cpu.rootThread.frames[0].decodedPage!.compiledBlocks!;
	assert.equal(cache.entries[0]!.sourceWords, 130);
	const replacement = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(replacement, 0, OpCode.K0, 2, 0, 0);
	for (const { memory } of machines) memory.writeBytes(DYNAMIC_RAM_BASE + 129 * INSTRUCTION_BYTES, replacement);
	assert.equal(cache.entries[0], null, 'the final dependent word lies beyond the ordinary 128-word body span');
	for (const { cpu } of machines) cpu.runUntilDepth(0, 8192);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

test('both resolved comparison paths link directly and stop at every short grant', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.EQ, 1, 0, 2);
	writeInstruction(text, 1, OpCode.JMP, 0, 0, 2);
	writeInstruction(text, 2, OpCode.ADD, 3, 3, 1);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 4, OpCode.ADD, 4, 4, 1);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 5 }] });
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const registers = cpu.rootThread.frames[0].registers;
		for (let i = 0; i < 5; ++i) registers.setNumber(i, i === 1 ? 1 : 0);
	}
	for (const value of [0, 1]) for (const { cpu } of machines) {
		cpu.rootThread.frames[0].registers.setNumber(0, value);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 2048);
	}
	const cache = machines[0].cpu.rootThread.frames[0].decodedPage!.compiledBlocks!, root = cache.entries[0]!;
	assert.equal(root.sourceWords, 2);
	assert.equal(root.terminal.linkedBlock, cache.entries[1]); assert.ok(root.terminal.linkedBlock);
	const skipped = root.exits.find(exit => exit.nextPc === DYNAMIC_RAM_BASE + 2 * INSTRUCTION_BYTES)!;
	assert.equal(skipped.exit, CompiledBlockExit.Continue);
	assert.equal(skipped.linkedBlock, cache.entries[2]); assert.ok(skipped.linkedBlock);
	for (const value of [0, 1]) for (let grant = 1; grant <= 32; ++grant) {
		for (const { cpu } of machines) {
			cpu.rootThread.frames[0].registers.setNumber(0, value);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
			cpu.runUntilDepth(0, grant);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
	}
});

for (const [currentWide, skippedWide] of [[false, false], [true, false], [false, true]]) {
	test(`comparison skip fetch boundary: current WIDE ${currentWide}, skipped WIDE ${skippedWide}`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.HALT, 0, 0, 0); writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 4 }, { firstWord: 1, wordCount: 1 }], exceptionFunctionIndex: 1 });
		const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
		const end = RAM_BASE + PSX_MACHINE_SPEC.ramBytes, nextPc = end - (skippedWide ? INSTRUCTION_BYTES : 0);
		const pc = nextPc - (currentWide ? 2 : 1) * INSTRUCTION_BYTES;
		const code = new Uint8Array((currentWide || skippedWide ? 2 : 1) * INSTRUCTION_BYTES);
		let word = 0;
		if (currentWide) writeInstruction(code, word++, OpCode.WIDE, 0, 0, 0);
		writeInstruction(code, word++, OpCode.EQ, 1, 0, 1);
		if (skippedWide) writeInstruction(code, word, OpCode.WIDE, 0, 0, 0);
		for (const { cpu, memory } of machines) {
			memory.writeBytes(pc, code);
			const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(0, 0); frame.registers.setNumber(1, 0);
			for (let visit = 0; visit < 10; ++visit) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
				assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
				assert.equal(frame.pc, nextPc); assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_NONE);
			}
		}
		const page = machines[0].cpu.rootThread.frames[0].decodedPage!;
		assert.ok(page.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2], 'the boundary comparison really executed generated code');
		for (const { cpu, memory } of machines) {
			cpu.rootThread.frames[0].registers.setNumber(1, 1);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			assert.equal(cpu.readEpcWord(), nextPc);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), end);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
	});
}
