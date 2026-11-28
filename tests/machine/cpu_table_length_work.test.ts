import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { textToByteString } from '../../machine/ts/common/byte_string';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { RunResult, type CPU } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { TableHeader } from '../../machine/ts/machine/cpu/table';
import { valueBool, valueInteger, valueNil, valueString, valueTable } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE, MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { CPU_CAUSE_CODE_TRAP } from '../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

const cases = [
	['empty', 0], ['ascending', 64], ['descending', 4096],
	['stale', 0], ['sparse', 2 ** 30], ['terminal', 0x7fffffff],
] as const;

function program(wide: boolean) {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE), starts: number[] = [];
	let word = 0;
	for (const [op, a, b, c] of [[OpCode.KSMI, 9, 0, 37], [OpCode.MOV, 6, 0, 0], [OpCode.LEN, 6, 6, 0],
		[OpCode.SETI, 10, 1, 6], [OpCode.MOV, 8, 9, 0]]) {
		starts.push(word); if (wide) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, word++, op, a, b, c);
	}
	starts.push(word); writeInstruction(text, word, OpCode.JMP, 0, 63, (-(word + 1)) & 63, 255);
	return { image: linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: word + 1, maxStack: 12 }] }), starts };
}

function makeTable(cpu: CPU, kind: typeof cases[number][0]): number {
	const table = createReferenceTable(cpu, kind === 'sparse' || kind === 'terminal' ? 0 : 4096, 128);
	if (kind === 'ascending') for (let k = 1; k <= 64; k++) nativeHeapReference(cpu).gc.tables.setInteger(table, k, valueBool(false));
	if (kind === 'descending' || kind === 'stale') {
		const value = kind === 'stale' ? valueTable(createReferenceTable(cpu)) : valueBool(false);
		for (let k = 4096; k >= 1; k--) nativeHeapReference(cpu).gc.tables.setInteger(table, k, value);
	}
	if (kind === 'stale') nativeHeapReference(cpu).gc.tables.clearWeakEntries(table, false, true, () => false);
	if (kind === 'sparse' || kind === 'terminal') for (let bit = 30; bit >= 0; bit--) nativeHeapReference(cpu).gc.tables.setInteger(table, 2 ** bit, valueBool(false));
	if (kind === 'terminal') nativeHeapReference(cpu).gc.tables.setInteger(table, 0x7fffffff, valueBool(false));
	return table;
}
test('Table length reads a stable boundary without changing mappings', () => {
	for (const [kind, boundary] of cases) {
		const { image } = program(false), { cpu } = createTestSystemCpu(image);
		const table = makeTable(cpu, kind); cpu.rootThread.currentFrame!.registers.setTable(0, table);
		const before = cpu.captureRuntimeState();
		for (let repeat = 0; repeat < 3; ++repeat) {
			assert.equal(cpu.tables.length(table), boundary, 'raw host query preserves its Number-returning contract');
		}
		assert.ok(isDeepStrictEqual(cpu.captureRuntimeState(), before), 'a length read does not change CPU control state');
		assert.equal(cpu.memory.readRamRecordWord(table + TableHeader.Length), boundary, 'repeated reads reuse the computed boundary');
	}
	const { image } = program(false), { cpu } = createTestSystemCpu(image), table = makeTable(cpu, 'descending');
	assert.equal(cpu.memory.readRamRecordWord(table + TableHeader.Length), 1);
	for (let k = 0; k < 300; ++k) nativeHeapReference(cpu).gc.tables.setStringKey(table, nativeHeapReference(cpu).stringPool.intern(`key${k}`), valueBool(true));
	assert.equal(cpu.memory.readRamRecordWord(table + TableHeader.Length), 1, 'hash redistribution preserves the logical seed');
	assert.equal(cpu.tables.length(table), 4096);
	nativeHeapReference(cpu).gc.tables.setInteger(table, 4097, valueBool(false)); assert.equal(cpu.memory.readRamRecordWord(table + TableHeader.Length), 4097, 'adjacent append advances the cached boundary');
	nativeHeapReference(cpu).gc.tables.setInteger(table, 4097, valueNil()); assert.equal(cpu.memory.readRamRecordWord(table + TableHeader.Length), 4096);
	nativeHeapReference(cpu).gc.tables.clear(table); assert.equal(cpu.memory.readRamRecordWord(table + TableHeader.Length), 0); assert.equal(cpu.tables.length(table), 0);
	const hash = createReferenceTable(cpu, 0, 16); nativeHeapReference(cpu).gc.tables.setInteger(hash, 1, valueBool(false)); assert.equal(cpu.memory.readRamRecordWord(hash + TableHeader.Length), 1);
	nativeHeapReference(cpu).gc.tables.setInteger(hash, 2, valueBool(false)); assert.equal(cpu.memory.readRamRecordWord(hash + TableHeader.Length), 2, 'eligible keys in preallocated hash storage use the same seed update');
});

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) for (const wide of [false, true]) {
	test(`LEN every grant commits its aliased result before side-effecting successor (${backend}, WIDE=${wide})`, () => {
		for (const [kind, boundary] of cases) {
			const { image, starts } = program(wide), { cpu } = createTestSystemCpu(image, backend);
			let frame = cpu.rootThread.currentFrame!; const base = frame.pc;
			const table = makeTable(cpu, kind), marker = createReferenceTable(cpu, 1);
			frame.registers.setTable(0, table); frame.registers.setTable(10, marker);
			const charges = [2, 2, 3, 8, 2, 2], total = charges.reduce((a, b) => a + b, 0);
			cpu.runUntilDepth(0, total * 64);
			if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(base & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
			const savedSeed = cpu.memory.readRamRecordWord(table + TableHeader.Length), heap = cpu.luaHeap.usedBytes();
			for (let grant = 0; grant <= total; ++grant) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
				frame.registers.setInteger(6, 91); frame.registers.setNil(8); frame.registers.setNil(9); nativeHeapReference(cpu).gc.tables.setInteger(marker, 1, valueInteger(-1));
				assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
				let remaining = grant, completed = 0; while (remaining > 0) remaining -= charges[completed++];
				assert.equal(cpu.instructionBudgetRemaining, remaining, `${kind}/${grant}: fixed charge once`);
				assert.equal(frame.pc, base + starts[completed === 6 ? 0 : completed] * INSTRUCTION_BYTES);
				assert.equal(frame.registers.get(6), completed >= 3 ? valueInteger(boundary) : completed >= 2 ? valueTable(table) : valueInteger(91));
				assert.equal(cpu.tables.getInteger(marker, 1), valueInteger(completed >= 4 ? boundary : -1), 'no future table mutation after exhausted LEN');
				assert.equal(frame.registers.get(8), completed >= 5 ? valueInteger(37) : valueNil(), 'cached live Number survives the helper and exact prefix admission');
			}
			assert.equal(cpu.memory.readRamRecordWord(table + TableHeader.Length), savedSeed); assert.equal(cpu.luaHeap.usedBytes(), heap);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
			const memory = cpu.memory.captureSaveState(), before = cpu.captureRuntimeState(); cpu.runUntilDepth(0, 5); const after = cpu.captureRuntimeState(), debt = cpu.instructionBudgetRemaining;
			cpu.memory.restoreSaveState(memory); cpu.restoreRuntimeState(before); cpu.runUntilDepth(0, 5); frame = cpu.rootThread.currentFrame!;
			assert.equal(cpu.instructionBudgetRemaining, debt); assert.ok(isDeepStrictEqual(cpu.captureRuntimeState(), after));
			// String LEN uses the same fixed charge.
			frame.registers.set(0, valueString(nativeHeapReference(cpu).stringPool.intern(textToByteString('é😀\0'))));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
			cpu.runUntilDepth(0, 5); assert.equal(cpu.instructionBudgetRemaining, -2); assert.equal(frame.registers.getInteger(6), 7);
			frame.registers.setBoolean(0, true); frame.registers.setNil(8);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
			cpu.runUntilDepth(0, 5); assert.equal(cpu.instructionBudgetRemaining, -2);
			assert.equal(cpu.readCauseWord() & 0x7c, CPU_CAUSE_CODE_TRAP);
			assert.equal(frame.registers.get(6), valueBool(true), 'invalid LEN retains the aliased destination');
			assert.equal(frame.registers.get(8), valueNil());
		}
	});
}

for (const kind of ['ascending', 'descending'] as const) test(`published JS region completes LEN and its suffix within one fixed budget (${kind})`, () => {
	const { image } = program(false), { cpu } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const frame = cpu.rootThread.currentFrame!, base = frame.pc, table = makeTable(cpu, kind), marker = createReferenceTable(cpu, 1);
	frame.registers.setTable(0, table); frame.registers.setTable(10, marker); cpu.runUntilDepth(0, 19 * 64);
	const page = frame.decodedPage!, block = page.compiledBlocks!.entries[(base & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]!;
	assert.ok(block && 19 > block.admissionCycles, 'the real generated body is admitted, not an interpreter fallback');
	frame.registers.setInteger(6, 91); frame.registers.setNil(8); nativeHeapReference(cpu).gc.tables.setInteger(marker, 1, valueInteger(-1));
	const state = { remainingCycles: 19, registerTop: frame.top, memoryAddress: 0 };
	const exit = block.region.exits[block.region.execute(frame.registers, frame.executionImage.constWords, page, frame, block.entry, state)];
	assert.equal(exit.nextPc, base);
	assert.equal(state.remainingCycles, 0);
	assert.equal(frame.registers.getInteger(6), kind === 'ascending' ? 64 : 4096, 'resident LEN result is raw-published on completed Continue');
	assert.equal(cpu.tables.getInteger(marker, 1), frame.registers.get(6)); assert.equal(frame.registers.get(8), valueInteger(37));
});

for (const wide of [false, true]) test(`skipped LEN is neither charged nor executed (WIDE=${wide})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.EQ, 0, 1, 1);
	let word = 1; if (wide) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, word++, OpCode.LEN, 6, 0, 0); writeInstruction(text, word++, OpCode.KSMI, 8, 0, 37);
	writeInstruction(text, word, OpCode.JMP, 0, 63, (-(word + 1)) & 63, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: word + 1, maxStack: 10 }] });
	for (const backend of [CpuExecutionBackend.Interpreter]) {
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!;
		frame.registers.setTable(0, makeTable(cpu, 'descending')); frame.registers.setInteger(1, 1); frame.registers.setInteger(6, 91);
		const base = frame.pc; cpu.runUntilDepth(0, 6 * 64);
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(base & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base); frame.registers.setNil(8);
		cpu.runUntilDepth(0, 4); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.getInteger(6), 91); assert.equal(frame.registers.getInteger(8), 37);
	}
});
