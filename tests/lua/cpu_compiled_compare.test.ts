import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCpuParity } from '../helpers/cpu_execution';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Blua32ExecutionImage } from '../../machine/ts/machine/cpu/execution_image';
import { valueBool, valueBuiltinFunction, valueClosure, valueFloat, valueFloatBits, valueInteger, valueNil, valueString, valueTable, valueThread, ValueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { integerConstant, numberConstantFromHost } from '../../toolchain/ts/lua/number';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { BUS_FAULT_NONE, BUS_FAULT_UNMAPPED, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE, SYSTEM_ROM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { RAM_CODE_FIXTURE_BYTES, createTestBlua32PairCpu, createTestSystemCpu, linkRawTestBlua32Pair, linkRawTestSystemBlua32, type TestBlua32Source } from '../helpers/blua32';

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
	], constants, exceptionFunctionIndex: 1 }, RAM_CODE_FIXTURE_BYTES);
}

function values(cpu: CPU): Value[] {
	const closure = cpu.rootThread.frameAtDepth(0).closure;
	return [valueNil(), valueBool(false), valueBool(true), valueInteger(0), valueFloat(-0), valueInteger(1), valueInteger(-1),
		valueInteger(16777217), valueFloat(16777216), valueFloat(1), valueFloat(0.25), valueFloatBits(0xffc01234), valueFloat(Infinity), valueFloat(-Infinity),
		...['', 'a', 'a\0b', '\ue000', '\u{10000}', 'é'].map(text => valueString(cpu.stringPool.intern(text))),
		valueTable(cpu.createTable()), valueTable(cpu.createTable()), valueClosure(cpu.gc.reference(closure)),
		valueThread(cpu.gc.reference(cpu.rootThread)), valueThread(cpu.gc.reference(cpu.createThread(closure))),
		valueBuiltinFunction(BuiltinFunctionId.Type), valueBuiltinFunction(BuiltinFunctionId.Next)];
}

for (const op of [OpCode.EQ, OpCode.LT, OpCode.LE]) for (const expected of [false, true]) {
	test(`generated comparison ${op}, expected ${expected}: kinds, reference identities, NaNs and UTF-8 order`, () => {
		const image = comparisonImage(op, expected);
		const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
		const inputs = machines.map(({ cpu }) => values(cpu));
		const entry = image.image.functions[0].codeAddress;
		runCpuParity(machines[0].cpu, machines[1].cpu, 800);
		const frame = machines[0].cpu.rootThread.frameAtDepth(0), page = frame.decodedPage!;
		const block = page.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
		assert.equal(block.sourceWords, 4, 'the fixed skip retains its fetched successor as a source dependency');
		assert.equal(block.terminal.currentPc, entry + INSTRUCTION_BYTES);
		assert.equal(block.terminal.lastPc, entry + 2 * INSTRUCTION_BYTES);
		assert.equal(block.terminal.exitA, expected ? 0x300 : 0);
		assert.ok(block.exits.some(exit => exit.exit === CompiledBlockExit.Continue && exit.nextPc === entry + 4 * INSTRUCTION_BYTES));
		for (let left = 0; left < inputs[0].length; ++left) for (let right = 0; right < inputs[0].length; ++right) {
			for (const [index, { cpu }] of machines.entries()) {
				const current = cpu.rootThread.frameAtDepth(0);
				current.registers.set(0, inputs[index][left]); current.registers.set(1, inputs[index][right]); current.top = 0;
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
				assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.K0] + BASE_CYCLES[op]), RunResult.Yielded);
				assert.equal(current.top, 4, 'expected truth is not a register destination, including wide nonzero A');
			}
			assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState(), `pair ${left},${right}`);
		}
	});
}

test('comparison RK constants agree after each admitted segment, including short grants', () => {
	const constants = [null, false, true, ...[-0, NaN, Infinity, 0.25].map(numberConstantFromHost), '', 'a\0b', '\ue000', '\u{10000}'];
	for (const op of [OpCode.EQ, OpCode.LT, OpCode.LE]) for (const selectors of [[-1, 1], [0, -2], [-10, -11]]) {
		const image = comparisonImage(op, true, selectors[0], selectors[1], constants);
		const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
		const entry = image.image.functions[0].codeAddress;
		runCpuParity(machines[0].cpu, machines[1].cpu, 800);
		for (let grant = 1; grant <= 31; ++grant) for (const value of [valueNil(), valueBool(false), valueFloatBits(0xffc01234), valueFloat(-0), valueFloat(0.25), valueFloat(Infinity)]) {
			for (const { cpu } of machines) {
				const current = cpu.rootThread.frameAtDepth(0); current.registers.set(0, value); current.registers.set(1, value);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
			}
			runCpuParity(machines[0].cpu, machines[1].cpu, grant);
			assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		}
	}
});

test('warmed RK comparisons at one RAM PC belong to each execution image and retire with its constant pool', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.EQ, 1, 0, 63, 7); // R0 == K0
	writeInstruction(text, 1, OpCode.JMP, 0, 0, 2);
	writeInstruction(text, 2, OpCode.KFALSE, 1, 0, 0);
	writeInstruction(text, 3, OpCode.JMP, 0, 0, 1);
	writeInstruction(text, 4, OpCode.KTRUE, 1, 0, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	const source = { text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 4 }] };
	const images = linkRawTestBlua32Pair({ ...source, constants: [integerConstant(0)] }, { ...source, constants: ['same-slot'] }, RAM_CODE_FIXTURE_BYTES);
	const replacement = linkRawTestSystemBlua32({ ...source, constants: ['same-slot'] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestBlua32PairCpu(images, CpuExecutionBackend.JavaScript),
		createTestBlua32PairCpu(images, CpuExecutionBackend.Interpreter)];
	for (const { memory } of machines) memory.writeBytes(DYNAMIC_RAM_BASE, text);
	const owners = new Map<number, Blua32ExecutionImage>();
	for (const domain of [SYSTEM_EXECUTION_DOMAIN_ID, 0, SYSTEM_EXECUTION_DOMAIN_ID, 0] as const) {
		for (const { cpu } of machines) {
			cpu.writeFrameExecution(0, domain, domain === SYSTEM_EXECUTION_DOMAIN_ID
				? images.systemSymbols.functionAddresses[0] : images.cartSymbols.functionAddresses[0], DYNAMIC_RAM_BASE);
			cpu.rootThread.frameAtDepth(0).registers.set(0, valueString(cpu.stringPool.intern('same-slot')));
		}
		runCpuParity(machines[0].cpu, machines[1].cpu, 1024);
		const frame = machines[0].cpu.rootThread.frameAtDepth(0);
		assert.equal(frame.registers.get(1), valueBool(domain === 0),
			'the same physical RAM instruction and RK index consume the activation-owned Number or String pool');
		assert.equal(frame.pc, DYNAMIC_RAM_BASE);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.ok(frame.decodedPage!.compiledBlocks!.entries[0], 'both image-local comparisons actually execute generated code');
		owners.set(domain, frame.executionImage);
	}
	const systemOwner = owners.get(SYSTEM_EXECUTION_DOMAIN_ID)!, cartOwner = owners.get(0)!;
	assert.notEqual(systemOwner, cartOwner);
	const systemPage = systemOwner.compiledCodeLookup!.find(DYNAMIC_RAM_BASE, 0)!;
	const cartPage = cartOwner.compiledCodeLookup!.find(DYNAMIC_RAM_BASE, 0)!;
	const systemBlock = systemPage.compiledBlocks!.entries[0], cartBlock = cartPage.compiledBlocks!.entries[0];
	assert.notEqual(systemPage, cartPage, 'image ownership is distinct even when executable bytes have one physical backing');
	for (const { cpu, memory } of machines) {
		memory.installSystemRom(replacement.romBytes);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, replacement.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.rootThread.frameAtDepth(0).registers.set(0, valueString(cpu.stringPool.intern('same-slot')));
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 4);
	assert.equal(machines[0].cpu.rootThread.frameAtDepth(0).registers.get(1), valueBool(false),
		'replacing ROM bytes does not mutate an activated Number constant pool');
	assert.equal(systemPage.compiledBlocks!.entries[0], systemBlock);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	for (const { cpu, executionAddressSpace } of machines) {
		cpu.replaceExecutionImages(executionAddressSpace.resolveSystemDomain());
		// The revision producer relocates suspended activations after replacing
		// their image, before any further instruction is allowed to execute.
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, replacement.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	assert.equal(systemPage.compiledBlocks!.entries[0], null, 'image replacement retires the old numeric comparison');
	runCpuParity(machines[0].cpu, machines[1].cpu, 1024);
	const frame = machines[0].cpu.rootThread.frameAtDepth(0);
	assert.notEqual(frame.executionImage, systemOwner);
	assert.equal(frame.registers.get(1), valueBool(true), 'the recompiled comparison consumes String K0 rather than the old numeric specialization');
	assert.ok(frame.decodedPage!.compiledBlocks!.entries[0]);
	assert.equal(cartPage.compiledBlocks!.entries[0], cartBlock, 'the unrelated image retains its warmed RAM code');
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

test('EQ ignores unused Nil/boolean scalar payloads without rewriting either source slot', () => {
	const image = comparisonImage(OpCode.EQ, false);
	for (const backend of [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter]) {
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.runUntilDepth(0, 800);
		for (const kind of [ValueTag.Nil, ValueTag.False, ValueTag.True]) {
			const frame = cpu.rootThread.frameAtDepth(0);
			frame.registers.setEncoded(0, kind, 1); frame.registers.setEncoded(1, kind, 2);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
			cpu.runUntilDepth(0, BASE_CYCLES[OpCode.K0] + BASE_CYCLES[OpCode.EQ]);
			assert.equal(frame.pc, image.image.functions[0].codeAddress + 4 * INSTRUCTION_BYTES);
			assert.equal(frame.registers.getPayload(0), 1); assert.equal(frame.registers.getPayload(1), 2);
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
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 8 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(0, 0); frame.registers.setInteger(1, 1); frame.registers.setInteger(2, 73);
		frame.registers.setInteger(6, 1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 800);
	}
	const page = machines[0].cpu.rootThread.frameAtDepth(0).decodedPage!, block = page.compiledBlocks!.entries[0];
	assert.ok(block); assert.equal(block.sourceWords, 4);
	assert.ok(block.exits.some(exit => exit.exit === CompiledBlockExit.Continue && exit.nextPc === DYNAMIC_RAM_BASE + 4 * INSTRUCTION_BYTES));
	for (const wide of [false, true, false]) {
		const replacement = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(replacement, 0, wide ? OpCode.WIDE : OpCode.K0, 0, 0, 0);
		for (const { cpu, memory } of machines) {
			memory.writeBytes(DYNAMIC_RAM_BASE + 2 * INSTRUCTION_BYTES, replacement);
			const frame = cpu.rootThread.frameAtDepth(0); frame.top = 0; frame.registers.setInteger(2, 73);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
			cpu.runUntilDepth(0, BASE_CYCLES[OpCode.ADD] + BASE_CYCLES[OpCode.EQ]);
			assert.equal(frame.pc, DYNAMIC_RAM_BASE + (wide ? 4 : 3) * INSTRUCTION_BYTES);
			assert.equal(frame.registers.getInteger(2), 73); assert.equal(frame.top, 4);
		}
		assert.equal(page.compiledBlocks!.entries[0], null, 'the resolved edge must not retain its old width');
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		runCpuParity(machines[0].cpu, machines[1].cpu, 800);
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
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 131, maxStack: 4 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(0, 0); frame.registers.setInteger(1, 1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 8192);
	const cache = machines[0].cpu.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!;
	assert.equal(cache.entries[0]!.sourceWords, 130);
	const replacement = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(replacement, 0, OpCode.K0, 2, 0, 0);
	for (const { memory } of machines) memory.writeBytes(DYNAMIC_RAM_BASE + 129 * INSTRUCTION_BYTES, replacement);
	assert.equal(cache.entries[0], null, 'the final dependent word lies beyond the ordinary 128-word body span');
	runCpuParity(machines[0].cpu, machines[1].cpu, 8192);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

test('both resolved comparison paths stay in one region and return their full cycle charge', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.EQ, 1, 0, 2);
	writeInstruction(text, 1, OpCode.JMP, 0, 0, 2);
	writeInstruction(text, 2, OpCode.ADD, 3, 3, 1);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 4, OpCode.ADD, 4, 4, 1);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 5 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const registers = cpu.rootThread.frameAtDepth(0).registers;
		for (let i = 0; i < 5; ++i) registers.setInteger(i, i === 1 ? 1 : 0);
	}
	for (const value of [0, 1]) {
		for (const { cpu } of machines) {
			cpu.rootThread.frameAtDepth(0).registers.setInteger(0, value);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		runCpuParity(machines[0].cpu, machines[1].cpu, 2048);
	}
	const cache = machines[0].cpu.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!, root = cache.entries[0]!;
	assert.equal(root.sourceWords, 2);
	assert.ok(cache.entries[2]?.region === root.region && cache.entries[4]?.region === root.region,
		'both comparison targets are entries of one generated function');
	assert.equal(cache.entries[1], null, 'the folded JMP itself needs no separate entry');
	assert.equal(root.terminal.linkedBlock, null);
	const skipped = root.exits.find(exit => exit.nextPc === DYNAMIC_RAM_BASE + 2 * INSTRUCTION_BYTES)!;
	assert.equal(skipped.exit, CompiledBlockExit.Continue);
	assert.equal(skipped.linkedBlock, null);
	for (const value of [0, 1]) for (let grant = 1; grant <= 32; ++grant) {
		for (const { cpu } of machines) {
			cpu.rootThread.frameAtDepth(0).registers.setInteger(0, value);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		runCpuParity(machines[0].cpu, machines[1].cpu, grant);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	const observations = [0, 0];
	for (const [index, { cpu }] of machines.entries()) {
		cpu.setInstructionObserver({ points: [new Set([DYNAMIC_RAM_BASE + INSTRUCTION_BYTES]), new Set(), new Set()],
			observe: () => { ++observations[index]; } });
		cpu.rootThread.frameAtDepth(0).registers.setInteger(0, 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	assert.equal(cache.entries[0], null, 'adding an observer retires the region that consumed the JMP');
	runCpuParity(machines[0].cpu, machines[1].cpu, 512);
	assert.ok(observations[0] > 0); assert.equal(observations[0], observations[1]);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	assert.equal(cache.entries[0]!.terminal.currentPc, DYNAMIC_RAM_BASE, 'an observed JMP is not consumed by the comparison');
});

for (const [currentWide, skippedWide] of [[false, false], [true, false], [false, true]]) {
	test(`comparison skip fetch boundary: current WIDE ${currentWide}, skipped WIDE ${skippedWide}`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.HALT, 0, 0, 0); writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 4 }, { firstWord: 1, wordCount: 1 }], exceptionFunctionIndex: 1 }, RAM_CODE_FIXTURE_BYTES);
		const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
		const end = machines[0].memory.ramInstructionEnd(), nextPc = end - (skippedWide ? INSTRUCTION_BYTES : 0);
		const pc = nextPc - (currentWide ? 2 : 1) * INSTRUCTION_BYTES;
		const code = new Uint8Array((currentWide || skippedWide ? 2 : 1) * INSTRUCTION_BYTES);
		let word = 0;
		if (currentWide) writeInstruction(code, word++, OpCode.WIDE, 0, 0, 0);
		writeInstruction(code, word++, OpCode.EQ, 1, 0, 1);
		if (skippedWide) writeInstruction(code, word, OpCode.WIDE, 0, 0, 0);
		for (const { cpu, memory } of machines) {
			memory.writeBytes(pc, code);
			const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(0, 0); frame.registers.setInteger(1, 0);
			for (let visit = 0; visit < 10; ++visit) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
				assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
				assert.equal(frame.pc, nextPc); assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_NONE);
			}
		}
		const page = machines[0].cpu.rootThread.frameAtDepth(0).decodedPage!;
		assert.ok(page.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2], 'the boundary comparison really executed generated code');
		for (const { cpu, memory } of machines) {
			cpu.rootThread.frameAtDepth(0).registers.setInteger(1, 1);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			assert.equal(cpu.readEpcWord(), nextPc);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), end);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	});
}

for (const comparisonWide of [false, true]) for (const jumpWide of [false, true]) {
	test(`paired comparison/JMP retains per-path charges and mutable targets (comparison WIDE=${comparisonWide}, JMP WIDE=${jumpWide})`, () => {
		for (const op of [OpCode.EQ, OpCode.LT, OpCode.LE]) for (const expected of [false, true]) {
			const text = new Uint8Array(2 * MAPPED_PAGE_BYTE_SIZE);
			let word = 0;
			if (comparisonWide) writeInstruction(text, word++, OpCode.WIDE, expected ? 3 : 0, 0, 0);
			writeInstruction(text, word++, op, comparisonWide ? 0 : expected ? 1 : 0, 0, 2);
			const jumpWord = word;
			if (jumpWide) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
			const jumpBody = word;
			writeInstruction(text, word, OpCode.JMP, 0, 0, 15 - word); ++word;
			writeInstruction(text, word++, OpCode.ADD, 3, 3, 1);
			writeInstruction(text, word, OpCode.JMP, 0, 63, 63 - word, 255);
			for (const [start, reg] of [[16, 4], [20, 6]]) {
				writeInstruction(text, start, OpCode.ADD, reg, reg, 1);
				writeInstruction(text, start + 1, OpCode.JMP, 0, 63, 62 - start, 255);
			}
			writeInstruction(text, 24, OpCode.JMP, 0, 63, 39, 255);
			const crossPageWord = MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES, delta = -crossPageWord - 1;
			writeInstruction(text, crossPageWord, OpCode.JMP, 0, (delta >>> 6) & 63, delta & 63, (delta >>> 12) & 255);
			const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: crossPageWord + 1, maxStack: 8 }] }, RAM_CODE_FIXTURE_BYTES);
			const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
			for (const { cpu, memory } of machines) {
				memory.writeBytes(DYNAMIC_RAM_BASE, text);
				const r = cpu.rootThread.frameAtDepth(0).registers;
				for (let reg = 0; reg < 8; ++reg) r.setInteger(reg, reg === 1 ? 1 : reg === 2 ? 7 : 0);
			}
			for (const value of [6, 7, 8]) {
				for (const { cpu } of machines) {
					cpu.rootThread.frameAtDepth(0).registers.setInteger(0, value);
					cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
				}
				runCpuParity(machines[0].cpu, machines[1].cpu, 1024);
			}
			const cache = machines[0].cpu.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!;
			const root = cache.entries[0]!, jumped = root.exits.find(exit => exit.currentPc === DYNAMIC_RAM_BASE + jumpWord * INSTRUCTION_BYTES)!;
			assert.ok(jumped); assert.equal(jumped.nextPc, DYNAMIC_RAM_BASE + 16 * INSTRUCTION_BYTES);
			assert.equal(jumped.lastPc, DYNAMIC_RAM_BASE + jumpBody * INSTRUCTION_BYTES);
			assert.equal(root.terminal, jumped);
			assert.equal(root.exits.length, 3, 'an exhausted compare has its own deferred-JMP exit');
			assert.equal(jumped.cycles, BASE_CYCLES[op] + BASE_CYCLES[OpCode.JMP]); assert.equal(root.exits.find(exit => exit !== jumped)!.cycles, BASE_CYCLES[op]);
			assert.equal(cache.entries[jumpWord], null, 'a JMP reached only through its fused comparison has no redundant body');
			for (const linked of [0, 1, 2]) {
				const entryWord = linked === 1 ? 24 : linked === 2 ? crossPageWord : 0;
				if (linked !== 0) {
					for (let visit = 0; visit < 12; ++visit) for (const { cpu } of machines) {
						cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE + entryWord * INSTRUCTION_BYTES);
						cpu.runUntilDepth(0, 128);
					}
					const lookup = machines[0].cpu.rootThread.frameAtDepth(0).executionImage.compiledCodeLookup!;
					const predecessor = lookup.find(DYNAMIC_RAM_BASE + entryWord * INSTRUCTION_BYTES, 0)!.compiledBlocks!.entries[entryWord % crossPageWord]!;
					assert.ok(predecessor, 'the predecessor really compiles before checking its linked successor');
					assert.ok(predecessor.region === cache.entries[0]!.region
						|| predecessor.terminal.linkedBlock === cache.entries[0], 'the predecessor really links to the comparison');
				}
				for (const strings of [false, true]) {
					for (const { cpu } of machines) {
						const r = cpu.rootThread.frameAtDepth(0).registers;
						if (strings) {
							r.setString(0, cpu.stringPool.intern(expected ? 'aaaaaa' : 'zzzzzz'));
							r.setString(2, cpu.stringPool.intern(op === OpCode.EQ && expected ? 'aaaaaa' : 'mmmmmm'));
						} else {
							r.setInteger(0, op === OpCode.EQ ? (expected ? 7 : 6) : (expected ? 6 : 8));
							r.setInteger(2, 7);
						}
						cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0],
							DYNAMIC_RAM_BASE + entryWord * INSTRUCTION_BYTES);
						assert.equal(cpu.runUntilDepth(0, linked !== 0 ? BASE_CYCLES[OpCode.JMP] + BASE_CYCLES[op] : BASE_CYCLES[op]), RunResult.Yielded);
					}
					const [js, scalar] = machines.map(machine => machine.cpu);
					assert.equal(js.readFramePc(0), DYNAMIC_RAM_BASE + jumpWord * INSTRUCTION_BYTES);
					assert.equal(js.readFramePc(0), scalar.readFramePc(0));
					assert.equal(js.lastPc, scalar.lastPc);
					assert.equal(js.instructionBudgetRemaining, scalar.instructionBudgetRemaining);
					assert.equal(js.instructionBudgetRemaining, strings && op !== OpCode.EQ ? -6 : 0,
						'ordered string comparison charges all six codepoints before deciding whether JMP can start');
				}
			}
			for (const { cpu } of machines) cpu.rootThread.frameAtDepth(0).registers.setInteger(2, 7);
			for (const value of [6, 7, 8]) for (let grant = 1; grant <= 16; ++grant) {
				for (const { cpu } of machines) {
					cpu.rootThread.frameAtDepth(0).registers.setInteger(0, value);
					cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
				}
				runCpuParity(machines[0].cpu, machines[1].cpu, grant);
				assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
				assert.equal(machines[0].cpu.readCurrentInstructionPc(), machines[1].cpu.readCurrentInstructionPc());
				assert.equal(machines[0].cpu.lastPc, machines[1].cpu.lastPc);
			}
			for (const entered of jumpWide ? [jumpWord, jumpBody] : [jumpWord]) {
				for (let visit = 0; visit < 16; ++visit) {
					for (const { cpu } of machines) cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
						image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE + entered * INSTRUCTION_BYTES);
					runCpuParity(machines[0].cpu, machines[1].cpu, 64);
					assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
				}
				assert.ok(cache.entries[entered], 'an independently entered JMP prefix or body acquires its own native entry');
				assert.ok(cache.entries[0], 'the comparison remains compiled when an interior entry is added');
			}
			const replacement = new Uint8Array(INSTRUCTION_BYTES);
			writeInstruction(replacement, 0, OpCode.JMP, 0, 0, 19 - jumpBody);
			for (const { cpu, memory } of machines) {
				memory.writeBytes(DYNAMIC_RAM_BASE + jumpBody * INSTRUCTION_BYTES, replacement);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
			}
			assert.equal(cache.entries[0], null, 'changing the paired target retires the comparison, including a WIDE JMP body');
			runCpuParity(machines[0].cpu, machines[1].cpu, 1024);
			assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
			assert.equal(cache.entries[0]!.exits.find(exit => exit.currentPc === DYNAMIC_RAM_BASE + jumpWord * INSTRUCTION_BYTES)!.nextPc,
				DYNAMIC_RAM_BASE + 20 * INSTRUCTION_BYTES);
		}
	});
}

test('a paired JMP chains to another physical page and unlinks when that target changes', () => {
	const text = new Uint8Array(2 * MAPPED_PAGE_BYTE_SIZE), second = MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES;
	writeInstruction(text, 0, OpCode.EQ, 1, 0, 2);
	writeInstruction(text, 1, OpCode.JMP, 0, (second - 2) >>> 6, (second - 2) & 63);
	writeInstruction(text, 2, OpCode.ADD, 3, 3, 1); writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, second, OpCode.ADD, 4, 4, 1);
	writeInstruction(text, second + 1, OpCode.JMP, 0, (-(second + 2) >>> 6) & 63, -(second + 2) & 63, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: second + 2, maxStack: 5 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		for (let reg = 0; reg < 5; ++reg) cpu.rootThread.frameAtDepth(0).registers.setInteger(reg, reg === 1 ? 1 : 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 2048);
	const lookup = machines[0].cpu.rootThread.frameAtDepth(0).executionImage.compiledCodeLookup!;
	const page = lookup.find(DYNAMIC_RAM_BASE, 0)!, target = lookup.find(DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE, 0)!;
	const root = page.compiledBlocks!.entries[0]!, jumped = root.exits.find(exit => exit.currentPc === DYNAMIC_RAM_BASE + INSTRUCTION_BYTES)!;
	assert.ok(jumped.linkedBlock); assert.equal(jumped.linkedBlock, target.compiledBlocks!.entries[0]);
	const replacement = new Uint8Array(INSTRUCTION_BYTES); writeInstruction(replacement, 0, OpCode.SUB, 4, 4, 1);
	for (const { memory } of machines) memory.writeBytes(DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE, replacement);
	assert.equal(page.compiledBlocks!.entries[0], root); assert.equal(jumped.linkedBlock, null);
	for (const { cpu } of machines) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 2048);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	assert.ok(jumped.linkedBlock); assert.equal(jumped.linkedBlock, target.compiledBlocks!.entries[0]);
});

test('a paired JMP defers the target fetch until positive budget remains', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.EQ, 1, 0, 2);
	const jumpWords = MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES - 2;
	writeInstruction(text, 1, OpCode.JMP, 0, jumpWords >>> 6, jumpWords & 63);
	writeInstruction(text, 2, OpCode.ADD, 3, 3, 1); writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 8, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 4 },
		{ firstWord: 8, wordCount: 1 }], exceptionFunctionIndex: 1 }, RAM_CODE_FIXTURE_BYTES);
	const end = SYSTEM_ROM_SIZE, start = end - MAPPED_PAGE_BYTE_SIZE;
	const rom = new Uint8Array(end);
	rom.set(image.romBytes); rom.set(text, start);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.installSystemRom(rom);
		const r = cpu.rootThread.frameAtDepth(0).registers;
		r.setInteger(0, 1); r.setInteger(1, 1); r.setInteger(2, 0); r.setInteger(3, 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 1024);
	for (const { cpu } of machines) {
		cpu.rootThread.frameAtDepth(0).registers.setInteger(0, 0); cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
	}
	for (const { cpu } of machines) {
		assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.EQ]), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 0, 'the compare consumes only its own grant');
		assert.equal(cpu.readFramePc(0), start + INSTRUCTION_BYTES);
		assert.equal(cpu.readCurrentInstructionPc(), start);
		assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.JMP]), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 0, 'the deferred JMP consumes the next grant');
		assert.equal(cpu.readFramePc(0), end); assert.equal(cpu.readCurrentInstructionPc(), start + INSTRUCTION_BYTES);
		assert.equal(cpu.rootThread.frameDepth, 1);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	for (const { cpu, memory } of machines) {
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readEpcWord(), end); assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), end);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});
