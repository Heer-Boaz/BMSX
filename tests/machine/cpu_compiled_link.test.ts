import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeRegisterStores, runCpuParity } from '../helpers/cpu_execution';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { CompiledBlockPage, CompiledCodeCache, linkCompiledBlock } from '../../machine/ts/machine/cpu/compiled_code_cache';
import { compileJavaScriptRegion, type CompiledRegion } from '../../machine/ts/machine/cpu/compiled_region';
import { createDecodedInstructionPage } from '../../machine/ts/machine/cpu/execution_image';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { ValueTag, valueInteger, valueFloatBits, valueBool, valueTable, valueNil, valueString } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE, IO_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { RAM_CODE_FIXTURE_BYTES, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { runGuestToHalt } from '../helpers/cpu_test_harness';

test('helper continuations are predeclared entries and read their own current Value bank', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 8, 0, 0);
	writeInstruction(text, 1, OpCode.LOAD_MEM, 0, 1, MemoryAccessKind.U32LE);
	writeInstruction(text, 2, OpCode.MOV, 4, 8, 0);
	writeInstruction(text, 3, OpCode.STORE_MEM, 4, 1, MemoryAccessKind.U32LE);
	writeInstruction(text, 4, OpCode.MOV, 5, 0, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 9 }] }, RAM_CODE_FIXTURE_BYTES);
	const { cpu, memory } = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), frame = cpu.rootThread.frameAtDepth(0);
	frame.registers.setInteger(1, DYNAMIC_RAM_BASE); cpu.runUntilDepth(0, 1024);
	const page = frame.decodedPage!, first = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const entries = [0, 2, 4].map(word => page.compiledBlocks!.entries[first + word]!);
	assert.ok(entries.every(entry => entry.region === entries[0].region), 'all helper returns are known before a slow helper is taken');
	assert.deepEqual(entries.map(entry => entry.sourceWords), [6, 4, 2]);
	const table = createReferenceTable(cpu);
	for (let iteration = 0; iteration < 32; ++iteration) for (let start = 0; start < entries.length; ++start) {
		const registers = new ValueSlots(9), block = entries[start];
		registers.setEncoded(0, ValueTag.False, 37); registers.setInteger(1, DYNAMIC_RAM_BASE); registers.set(8, start === 1 ? valueInteger(31) : valueTable(table));
		memory.writeMappedWord(DYNAMIC_RAM_BASE, 17);
		const run = { remainingCycles: 1, registerTop: 0, memoryAddress: 0 };
		const exit = block.region.exits[block.region.execute(registers, frame.executionImage.constWords, page, frame, block.entry, run)];
		assert.ok(exit === entries[2].terminal, 'one generated invocation executes the complete suffix');
		const suffixes = [
			BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.LOAD_MEM] + BASE_CYCLES[OpCode.MOV]
				+ BASE_CYCLES[OpCode.STORE_MEM] + BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP],
			BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.STORE_MEM] + BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP],
			BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP],
		];
		assert.deepEqual(run, { remainingCycles: 1 - suffixes[start], registerTop: start === 0 ? 9 : 6, memoryAddress: 0 });
		if (start === 0) {
			assert.equal(registers.getInteger(0), 17); assert.equal(registers.getInteger(4), 1);
			assert.equal(registers.getInteger(5), 17); assert.equal(registers.getInteger(8), 1);
			assert.equal(memory.readMappedWord(DYNAMIC_RAM_BASE), 1);
		} else {
			for (const register of [0, 5]) { assert.equal(registers.getTag(register), ValueTag.False); assert.equal(registers.getPayload(register), 37); }
			assert.equal(registers.get(8), start === 1 ? valueInteger(31) : valueTable(table));
			assert.equal(registers.get(4), start === 1 ? valueInteger(31) : valueNil());
			assert.equal(memory.readMappedWord(DYNAMIC_RAM_BASE), start === 1 ? 31 : 17);
		}
	}
});

test('helper-success fallthrough does not execute a later store without a grant', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 8, 0, 0);
	writeInstruction(text, 1, OpCode.LOAD_MEM, 0, 1, MemoryAccessKind.U32LE);
	writeInstruction(text, 2, OpCode.MOV, 4, 8, 0);
	writeInstruction(text, 3, OpCode.STORE_MEM, 4, 1, MemoryAccessKind.U32LE);
	writeInstruction(text, 4, OpCode.MOV, 5, 0, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 9 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu } of machines) {
		cpu.rootThread.frameAtDepth(0).registers.setInteger(1, DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 2048);
	}
	const frame = machines[0].cpu.rootThread.frameAtDepth(0), page = frame.decodedPage!;
	const first = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.ok(page.compiledBlocks!.entries[first], 'the starting entry is compiled before the grant sweep');
	assert.ok(page.compiledBlocks!.entries[first + 2], 'the load continuation is compiled in the same region');
	for (let grant = 1; grant <= 20; ++grant) {
		for (const { cpu, memory } of machines) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
			memory.writeU32(DYNAMIC_RAM_BASE, 17);
		}
		assert.equal(machines[0].cpu.runUntilDepth(0, grant), machines[1].cpu.runUntilDepth(0, grant));
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.equal(machines[0].memory.readU32(DYNAMIC_RAM_BASE), machines[1].memory.readU32(DYNAMIC_RAM_BASE));
		if (grant === 7) assert.equal(machines[0].memory.readU32(DYNAMIC_RAM_BASE), 17, 'the store has not been admitted');
		if (grant === 8) assert.equal(machines[0].memory.readU32(DYNAMIC_RAM_BASE), 1, 'the admitted store finishes even if its cost exceeds the grant');
	}
});

for (const kind of ['Integer', 'String'] as const) test(`resident Values cross internal ${kind} branches`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.MOV, 7, 8, 0);
	writeInstruction(text, 1, OpCode.LT, 0, 0, 1);
	writeInstruction(text, 2, OpCode.JMP, 0, 0, 2);
	writeInstruction(text, 3, OpCode.MOV, 3, 7, 0);
	writeInstruction(text, 4, OpCode.MOV, 9, 8, 0);
	writeInstruction(text, 5, OpCode.MOV, 6, 7, 0);
	writeInstruction(text, 6, OpCode.MOV, 10, 8, 0);
	writeInstruction(text, 7, OpCode.ADD, 4, 4, -1, 7);
	writeInstruction(text, 8, OpCode.MOV, 5, 4, 0);
	writeInstruction(text, 9, OpCode.JMP, 0, 63, 54, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 10, maxStack: 11 }], constants: [integerConstant(1)] }, RAM_CODE_FIXTURE_BYTES);
	const { cpu } = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), frame = cpu.rootThread.frameAtDepth(0);
	const lower = kind === 'Integer' ? valueInteger(0) : valueString(cpu.stringPool.intern('alpha'));
	const higher = kind === 'Integer' ? valueInteger(1) : valueString(cpu.stringPool.intern('omega'));
	frame.registers.set(0, lower); frame.registers.set(1, higher); frame.registers.setInteger(4, 0);
	frame.registers.setEncoded(8, ValueTag.False, 37); cpu.runUntilDepth(0, 1024);
	const page = frame.decodedPage!, first = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = page.compiledBlocks!.entries[first]!, table = createReferenceTable(cpu);
	for (const less of [false, true]) for (const tag of [ValueTag.False, ValueTag.Table, ValueTag.Float]) for (const grant of [32, 63, 128, 257]) {
		const r = new ValueSlots(11), writes = new Uint32Array(11);
		r.set(0, less ? lower : higher); r.set(1, less ? higher : lower);
		r.setInteger(3, 73); r.setInteger(4, 0);
		r.setEncoded(8, tag, tag === ValueTag.False ? 37 : tag === ValueTag.Float ? 0x80000000 : table);
		observeRegisterStores(r, register => { ++writes[register]; });
		const run = { remainingCycles: grant, registerTop: 0, memoryAddress: 0 };
		block.region.execute(r, frame.executionImage.constWords, page, frame, block.entry, run);
		assert.ok(r.getInteger(4) > 0); assert.equal(r.getInteger(5), r.getInteger(4)); assert.equal(run.registerTop, 11);
		if (!less) { assert.equal(r.getInteger(3), 73); assert.equal(r.getTag(9), ValueTag.Nil); }
		for (const register of less ? [3, 6, 7, 9, 10] : [6, 7, 10]) {
			assert.equal(r.getTag(register), r.getTag(8)); assert.equal(r.getPayload(register), r.getPayload(8));
		}
		// String ordering can observe dirty slots through its RAM-backed
		// records. Operand-only Integer ordering need not publish early.
		if (kind === 'Integer') assert.ok(writes[4] <= 1, 'the accumulator stays resident across operand-only internal branches');
		assert.equal(writes[8], 0, 'the read-only resident is never redundantly published');
	}
});

for (const [label, op, a, b, c, slots] of [
	['LOADNIL range', OpCode.LOADNIL, 12, 4, 0, 16],
	['fixed VARARG range', OpCode.VARARG, 12, 5, 0, 16],
	['SELF receiver', OpCode.SELF, 14, 3, 0, 16],
	['counted store range', OpCode.STORE_MEM_WORDS, 12, 1, 4, 16],
	['empty counted store address', OpCode.STORE_MEM_WORDS, 31, 15, 0, 16],
	['binary arithmetic operands', OpCode.ADD, 0, 14, 15, 16],
] as const) test(`compiled register admission counts ${label}`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 1, op, a, b, c);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 16 }],
		constants: ['method'] }, RAM_CODE_FIXTURE_BYTES);
	const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const scalar = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, scalar]) {
		const r = cpu.rootThread.frameAtDepth(0).registers;
		const table = createReferenceTable(cpu, 0, 1);
		cpu.gc.tables.storeStringKey(table, cpu.stringPool.intern('method'), ValueTag.Integer, 73);
		r.setTable(3, table);
		r.setInteger(1, DYNAMIC_RAM_BASE);
		for (let index = 12; index < 16; ++index) r.setInteger(index, index);
		if (op === OpCode.STORE_MEM_WORDS && c === 0) r.setInteger(15, DYNAMIC_RAM_BASE);
	}
	const warm = 2048;
	runCpuParity(js, scalar, warm);
	const frame = js.rootThread.frameAtDepth(0), start = image.image.functions[0].codeAddress;
	const first = (start & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = frame.decodedPage!.compiledBlocks!.entries[first]!;
	assert.equal(block.region.requiredSlots, slots);
	assert.equal(frame.stackCapacity, 16);
	for (const cpu of [js, scalar]) {
		cpu.rootThread.frameAtDepth(0).top = 4;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
	}
	runCpuParity(js, scalar, 90);
	assert.deepEqual(js.captureRuntimeState(), scalar.captureRuntimeState());
	assert.equal(Buffer.compare(js.memory.ramData(), scalar.memory.ramData()), 0);
});

test('linked physical-page segments retain complete charges and disconnect rewritten targets', () => {
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
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 9, maxStack: 12 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(0, 2); frame.registers.setInteger(1, 1); frame.registers.setInteger(8, 0);
	}
	for (const flag of [true, false]) {
		for (const { cpu } of machines) {
			const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setBoolean(2, flag);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		assert.equal(runCpuParity(machines[0].cpu, machines[1].cpu, 2048), RunResult.Yielded);
	}
	const page = machines[0].cpu.rootThread.frameAtDepth(0).decodedPage!, cache = page.compiledBlocks!;
	const root = cache.entries[0]!, taken = root.exits.find(exit => exit.nextPc === DYNAMIC_RAM_BASE + 4 * INSTRUCTION_BYTES)!;
	assert.ok(cache.entries[2]?.region === root.region && cache.entries[4]?.region === root.region,
		'both conditional targets are local entries of one generated function');
	assert.equal(root.terminal.linkedBlock, null); assert.equal(taken.linkedBlock, null);
	assert.equal(taken.exit, CompiledBlockExit.Continue);
	for (const flag of [false, true]) for (const start of [0, 2, 4, 6]) for (let grant = 2; grant <= 64; ++grant) {
		const frame = machines[0].cpu.rootThread.frameAtDepth(0), registers = new ValueSlots(12);
		for (let index = 0; index < 12; ++index) registers.setInteger(index, 0);
		registers.setInteger(0, 2); registers.setInteger(1, 1); registers.setBoolean(2, flag);
		const expected = new Array<number | boolean>(12).fill(0); expected[0] = 2; expected[1] = 1; expected[2] = flag;
		let remaining = grant, top = 0, segment = start;
		let expectedExit = root.terminal;
		for (;;) {
			const current = cache.entries[segment]!;
			expectedExit = current.terminal;
			if (segment === 0) {
				expected[8] = (expected[8] as number) + 1; top = Math.max(top, 9);
				if (flag) expectedExit = current.exits.find(exit => exit.nextPc === DYNAMIC_RAM_BASE + 4 * INSTRUCTION_BYTES)!;
				segment = flag ? 4 : 2;
			} else if (segment === 2) {
				expected[0] = -(expected[0] as number); top = Math.max(top, 1); segment = 6;
			} else if (segment === 4) {
				expected[0] = (expected[0] as number) << 1;
				expected[3] = expected[8]; top = Math.max(top, 4); segment = 6;
			} else {
				expected[4] = (expected[0] as number) + (expected[8] as number); top = Math.max(top, 5); segment = 0;
			}
			remaining -= 2 * BASE_CYCLES[OpCode.MOV];
			const next = cache.entries[segment]!;
			if (remaining <= next.admissionCycles + next.admissionVarargs * frame.varargCount) break;
		}
		const run = { remainingCycles: grant, registerTop: 0, memoryAddress: 0 }, block = cache.entries[start]!;
		const exit = block.region.exits[block.region.execute(registers, frame.executionImage.constWords, page, frame, block.entry, run)];
		assert.ok(exit === expectedExit, 'one function call executes all admitted internal edges');
		assert.deepEqual(run, { remainingCycles: remaining, registerTop: top, memoryAddress: 0 });
		assert.deepEqual(Array.from({ length: 12 }, (_, index) => registers.get(index)), expected.map((v, i) => i === 2 ? valueBool(flag) : valueInteger(v as number)));
	}

	for (const flag of [valueBool(true), valueBool(false), valueInteger(0), valueFloatBits(0x7fc00000)]) for (let grant = 1; grant <= 96; ++grant) {
		for (const { cpu } of machines) {
			const frame = cpu.rootThread.frameAtDepth(0); frame.registers.set(2, flag); frame.top = 0;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		assert.equal(machines[0].cpu.runUntilDepth(0, grant), RunResult.Yielded);
		assert.equal(machines[1].cpu.runUntilDepth(0, grant), RunResult.Yielded);
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining,
			`internal branch charges the same cycles for grant ${grant}`);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	const replacement = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(replacement, 0, OpCode.SUB, 4, 0, 8);
	for (const { memory } of machines) memory.writeBytes(DYNAMIC_RAM_BASE + 7 * INSTRUCTION_BYTES, replacement);
	assert.ok(cache.entries[0] === null && cache.entries[2] === null && cache.entries[4] === null,
		'a source write retires the function containing its internal branch targets');
	for (const { cpu } of machines) {
		cpu.rootThread.frameAtDepth(0).registers.setBoolean(2, true);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 2048);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	assert.ok(cache.entries[0] !== null && cache.entries[4]?.region === cache.entries[0].region,
		'the changed target and source regenerate in one function');
	// A large hot chain must use bounded JS stack, rather than recursive tail calls.
	runCpuParity(machines[0].cpu, machines[1].cpu, 600002);
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
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: second + 5, maxStack: 9 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(0, 2); frame.registers.setInteger(1, 1); frame.registers.setInteger(8, 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 2048);
	const lookup = machines[0].cpu.rootThread.frameAtDepth(0).executionImage.compiledCodeLookup!;
	const firstPage = lookup.find(DYNAMIC_RAM_BASE, 0)!, secondPage = lookup.find(DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE, 0)!;
	const root = firstPage.compiledBlocks!.entries[0]!, target = secondPage.compiledBlocks!.entries[0]!;
	assert.equal(machines[0].cpu.rootThread.frameAtDepth(0).stackCapacity, 9);
	assert.equal(root.region.requiredSlots, 9);
	assert.equal(target.region.requiredSlots, 9);
	assert.equal(root.terminal.linkedBlock, target); assert.equal(target.terminal.linkedBlock, root);
	assert.equal(root.page, firstPage); assert.equal(target.page, secondPage, 'a linked body carries its own page, not the predecessor page');
	for (let grant = 1; grant <= 128; ++grant) {
		for (const { cpu } of machines) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		assert.equal(machines[0].cpu.runUntilDepth(0, grant), machines[1].cpu.runUntilDepth(0, grant));
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining,
			`cross-page linked execution charges the same cycles for grant ${grant}`);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	const replacement = new Uint8Array(INSTRUCTION_BYTES); writeInstruction(replacement, 0, OpCode.SUB, 4, 0, 8);
	for (const { memory } of machines) memory.writeBytes(DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE + 3 * INSTRUCTION_BYTES, replacement);
	assert.equal(firstPage.compiledBlocks!.entries[0], root); assert.equal(root.terminal.linkedBlock, null);
	for (const { cpu } of machines) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 2048);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	assert.equal(root.terminal.linkedBlock, secondPage.compiledBlocks!.entries[0]); assert.ok(root.terminal.linkedBlock);
	runCpuParity(machines[0].cpu, machines[1].cpu, 600002);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	machines[0].cpu.reset(); assert.equal(root.terminal.linkedBlock, null);
});

for (const inRam of [false, true]) test(`short grants do not promote sequential positions (inRam=${inRam})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	for (let word = 0; word < 12; ++word) writeInstruction(text, word, OpCode.ADD, 0, 0, 1);
	writeInstruction(text, 12, OpCode.JMP, 0, 63, 51, 255); // -13 words
	writeInstruction(text, 32, OpCode.JMP, 0, 63, 35, 255); // enter word 4
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 33, maxStack: 12 }] }, RAM_CODE_FIXTURE_BYTES);
	const start = inRam ? DYNAMIC_RAM_BASE : image.image.functions[0].codeAddress;
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		if (inRam) memory.writeBytes(start, text);
		const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(0, 0); frame.registers.setInteger(1, 1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 4096);
	const lookup = machines[0].cpu.rootThread.frameAtDepth(0).executionImage.compiledCodeLookup!;
	const page = lookup.find(start, 0)!, cache = page.compiledBlocks!;
	const entry = (start & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.ok(cache.entries[entry]); assert.equal(cache.entries[entry]!.sourceWords, 13);
	for (let run = 0; run < 512; ++run) {
		runCpuParity(machines[0].cpu, machines[1].cpu, 1);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	for (let grant = 2; grant <= 31; ++grant) {
		runCpuParity(machines[0].cpu, machines[1].cpu, grant);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	assert.equal(cache.entries.filter(block => block !== null).length, 1,
		'arbitrary sequential grant resumptions must not create overlapping suffix translations');
	assert.equal(cache.entries[entry + 4], null);
	for (const { cpu } of machines) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start + 32 * INSTRUCTION_BYTES);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 128);
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	assert.ok(cache.entries[entry + 4], 'a real branch into the same interior position is still eligible');
});

test('linked counted stores need only one cycle, then stop or block before the following instruction', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 6, 0, 0); writeInstruction(text, 1, OpCode.JMP, 0, 0, 2);
	writeInstruction(text, 4, OpCode.WIDE, 0, 0, 0); writeInstruction(text, 5, OpCode.STORE_MEM_WORDS, 8, 0, 5);
	writeInstruction(text, 6, OpCode.K1, 7, 0, 0); writeInstruction(text, 7, OpCode.JMP, 0, 63, 56, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 8, maxStack: 13 }] }, RAM_CODE_FIXTURE_BYTES);
	const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter);
	const pc = image.image.functions[0].codeAddress, address = DYNAMIC_RAM_BASE + 0x4000;
	for (const { cpu } of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers; r.setInteger(0, address);
		for (let i = 0; i < 5; ++i) r.setInteger(8 + i, 73 + i);
		cpu.runUntilDepth(0, 1024);
	}
	const cache = js.cpu.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!, first = cache.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	const store = cache.entries[((pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES) + 4]!;
	const prefixCycles = BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.JMP];
	const storeCycles = BASE_CYCLES[OpCode.STORE_MEM_WORDS] + 5;
	assert.ok(store && store.region === first.region); assert.equal(store.terminal.cycles, BASE_CYCLES[OpCode.STORE_MEM_WORDS], "word work is charged only after preflight");
	assert.ok(cache.entries[store.firstWord + 2]?.region === first.region);
	for (const grant of [prefixCycles, prefixCycles + 1, prefixCycles + storeCycles,
		prefixCycles + storeCycles + 1, prefixCycles + storeCycles + 2, prefixCycles + storeCycles + 3]) {
		for (const { cpu } of [js, ref]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			const frame = cpu.rootThread.frameAtDepth(0); frame.top = 0; frame.registers.setInteger(7, 99);
		}
		assert.equal(runCpuParity(js.cpu, ref.cpu, grant), RunResult.Yielded);
		for (const { cpu } of [js, ref]) assert.equal(cpu.rootThread.frameAtDepth(0).registers.getInteger(7), grant <= prefixCycles + storeCycles ? 99 : 1);
		assert.deepEqual(js.cpu.captureRuntimeState(), ref.cpu.captureRuntimeState());
	}
	const endpoints = [];
	for (const { cpu, memory } of [js, ref]) {
		const port = { ready: false, writes: [] as number[] }; endpoints.push(port);
		for (let i = 0; i < 5; ++i) {
			memory.mapIoWrite(IO_BASE + 0x5000 + i * 4, port, (state, _address, word) => state.writes.push(word));
			memory.mapIoWriteReady<typeof port>(IO_BASE + 0x5000 + i * 4, state => state.ready);
		}
		const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(0, IO_BASE + 0x5000); frame.registers.setInteger(7, 99);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		runGuestToHalt(cpu, prefixCycles + 1);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.STORE_MEM_WORDS]);
		const chargedBeforeWait = prefixCycles + 1 - cpu.instructionBudgetRemaining;
		assert.equal(frame.pc, pc + 4 * INSTRUCTION_BYTES); assert.equal(cpu.stalledMemoryWriteAddress(), IO_BASE + 0x5000); assert.deepEqual(port.writes, []);
		port.ready = true; cpu.resumeMemoryWrite(IO_BASE + 0x5000);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - (storeCycles - BASE_CYCLES[OpCode.STORE_MEM_WORDS]));
		assert.equal(chargedBeforeWait + 1 - cpu.instructionBudgetRemaining, prefixCycles + storeCycles,
			'the linked store retains its initial base charge and pays its word surcharge exactly once');
		assert.equal(frame.pc, pc + 6 * INSTRUCTION_BYTES); assert.equal(frame.registers.getInteger(7), 99);
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
	], exceptionFunctionIndex: 1 }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text); memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 0x800, 5);
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(0, DYNAMIC_RAM_BASE + 0x800); frame.registers.setInteger(1, 1);
		frame.registers.setInteger(2, 0); frame.registers.setInteger(9, 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 1200);
	const page = machines[0].cpu.rootThread.frameAtDepth(0).decodedPage!, root = page.compiledBlocks!.entries[0]!;
	assert.ok(page.compiledBlocks!.entries[4]?.region === root.region, 'the memory successor remains inside the source region');
	for (const address of [IO_SYS_BUS_FAULT_CODE, 0x01000000]) {
		for (const { cpu } of machines) {
			const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(0, address); frame.top = 0;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		}
		runCpuParity(machines[0].cpu, machines[1].cpu, 6);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	assert.equal(machines[0].cpu.readEpcWord(), DYNAMIC_RAM_BASE + 4 * INSTRUCTION_BYTES);
});


test('an external entry into a WIDE body shares its sequential join without duplicated suffixes', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0); writeInstruction(text, 1, OpCode.ADD, 0, 0, 1);
	writeInstruction(text, 2, OpCode.ADD, 2, 0, 1); writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 16, OpCode.JMP, 0, 63, 48, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 17, maxStack: 12 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(0, 0); frame.registers.setInteger(1, 1); frame.registers.setInteger(2, 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 1200);
	for (let visit = 0; visit < 16; ++visit) {
		for (const { cpu } of machines) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE + 16 * INSTRUCTION_BYTES);
		}
		runCpuParity(machines[0].cpu, machines[1].cpu, 128);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	const entries = machines[0].cpu.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries;
	assert.ok(entries[0] && entries[1] && entries[2] && entries[16]);
	assert.ok(entries[0].region === entries[1].region && entries[1].region === entries[2].region);
	assert.deepEqual([entries[0].sourceWords, entries[1].sourceWords, entries[2].sourceWords], [2, 1, 2]);
	for (let grant = 1; grant <= 31; ++grant) {
		for (const { cpu } of machines) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE + INSTRUCTION_BYTES);
		}
		runCpuParity(machines[0].cpu, machines[1].cpu, grant);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
});

test('more than six live-through raw Values remain local across every internal edge', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	const starts: number[] = [];
	let word = 0;
	for (let segment = 0; segment < 2; ++segment) {
		starts.push(word);
		for (let register = 0; register < 8; ++register) writeInstruction(text, word++, OpCode.MOV, 16 + register, register, 0);
		for (let first = segment * 4; first < segment * 4 + 4; first += 2) {
			writeInstruction(text, word++, OpCode.MOV, 24, first, 0);
			writeInstruction(text, word++, OpCode.MOV, first, first + 1, 0);
			writeInstruction(text, word++, OpCode.MOV, first + 1, 24, 0);
		}
		if (segment === 0) writeInstruction(text, word++, OpCode.JMP, 0, 0, 0);
		else writeInstruction(text, word++, OpCode.JMP, 0, 63, 34, 255); // -30 words
	}
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: word, maxStack: 25 }] }, RAM_CODE_FIXTURE_BYTES);
	const { cpu } = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), frame = cpu.rootThread.frameAtDepth(0);
	cpu.runUntilDepth(0, 1024);
	const page = frame.decodedPage!, firstWord = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const table = createReferenceTable(cpu), string = cpu.stringPool.intern('retained');
	const tags = [ValueTag.Nil, ValueTag.False, ValueTag.True, ValueTag.Float, ValueTag.Float, ValueTag.String, ValueTag.Table, ValueTag.Integer];
	const words = [13, 37, 42, 0x80000000, 0xffc12345, string, table, 19];
	for (const start of [0, 1]) for (const grant of [1, 15, 16, 63, 128, 257]) {
		const block = page.compiledBlocks!.entries[firstWord + starts[start]]!, r = new ValueSlots(25);
		const expected = Array.from({ length: 8 }, (_, index) => index);
		for (let register = 0; register < 8; ++register) r.setEncoded(register, tags[register], words[register]);
		let segment = start, remaining = grant;
		do {
			for (let first = segment * 4; first < segment * 4 + 4; first += 2)
				[expected[first], expected[first + 1]] = [expected[first + 1], expected[first]];
			remaining -= 15 * BASE_CYCLES[OpCode.MOV]; segment ^= 1;
		} while (remaining > page.compiledBlocks!.entries[firstWord + starts[segment]]!.admissionCycles);
		const writes = new Uint32Array(8);
		observeRegisterStores(r, register => { if (register < 8) ++writes[register]; });
		const state = { remainingCycles: grant, registerTop: 0, memoryAddress: 0 };
		block.region.execute(r, frame.executionImage.constWords, page, frame, block.entry, state);
		assert.equal(state.remainingCycles, remaining); assert.equal(state.registerTop, 25);
		for (let register = 0; register < 8; ++register) {
			assert.equal(r.getTag(register), tags[expected[register]]);
			assert.equal(r.getPayload(register), words[expected[register]]);
			assert.ok(writes[register] <= 1, `live-through binding ${register} is published only at the cold exit`);
		}
	}
});

test('generated-source capacity admits whole replacements without flushing unrelated entries', () => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }] });
	const { cpu, memory } = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript);
	const page = createDecodedInstructionPage({ key: DYNAMIC_RAM_BASE, cacheable: true, readBytes: null,
		readByteOffset: 0, writeWatches: null, writeWatchIndex: 0 });
	const resident = page.compiledBlocks = new CompiledBlockPage();
	const globals = new ValueSlots(0), cop0 = new Uint32Array(0);
	const compile = (...words: number[]) => {
		const plans = words.map(firstWord => {
			page.ops[firstWord] = OpCode.JMP;
			page.widths[firstWord] = 1;
			page.bx[firstWord] = DYNAMIC_RAM_BASE;
			return { page, firstWord, endWord: firstWord + 1, pc: DYNAMIC_RAM_BASE + firstWord * INSTRUCTION_BYTES,
				skippedInstructionWidth: 0, fallthrough: false };
		});
		return compileJavaScriptRegion(plans, cpu.rootThread.currentFrame!.executionImage, memory,
			cpu.stringPool, globals, globals, cop0, cpu.gc);
	};
	const a = compile(31), b = compile(63), c = compile(95), b2 = compile(63);
	const cache = new CompiledCodeCache(a.sourceUnits + b.sourceUnits);
	const none = new Set<CompiledRegion>();
	assert.ok(cache.install(a, none) && cache.install(b, none));
	linkCompiledBlock(b.entries[0].terminal, a.entries[0]);
	assert.equal(cache.install(compile(...Array.from({ length: 128 }, (_, i) => 2 * i + 1)), new Set([a, b])), false);
	assert.equal(b.entries[0].terminal.linkedBlock, a.entries[0], 'oversize rejection leaves the resident link in place');
	assert.ok(cache.install(b2, new Set([b])));
	assert.equal(resident.entries[31], a.entries[0], 'replacing an equal charge needs no eviction');
	linkCompiledBlock(b2.entries[0].terminal, a.entries[0]);
	assert.ok(cache.install(c, none));
	assert.equal(resident.entries[31], null);
	assert.equal(b2.entries[0].terminal.linkedBlock, null);
	assert.equal(resident.entries[63], b2.entries[0]);
	assert.equal(resident.sourceUnits, b2.sourceUnits + c.sourceUnits);
	cache.retirePage(page, 95, 96);
	assert.equal(resident.entries[95], null);
	assert.equal(resident.entries[63], b2.entries[0]);
	cache.retireAll();
	assert.equal(resident.entryCount, 0);
	assert.equal(resident.sourceUnits, 0);
});
