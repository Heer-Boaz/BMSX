import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { RunResult, type CPU } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { type Table, type TableLengthWork } from '../../machine/ts/machine/cpu/table';
import { CpuSnapshot, CpuSnapshotTable, CpuSnapshotWriter } from '../../machine/ts/machine/cpu/snapshot';
import { valueString } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE, MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { CPU_CAUSE_CODE_TRAP } from '../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

const cases = [
	['empty', 0, 1], ['ascending', 64, 2], ['descending', 4096, 26],
	['stale', 0, 1], ['sparse', 2 ** 52, 105], ['terminal', 0x1fffffffffffff, 54],
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

function makeTable(cpu: CPU, kind: typeof cases[number][0]): Table {
	const table = cpu.createTable(kind === 'sparse' || kind === 'terminal' ? 0 : 4096, 128);
	if (kind === 'ascending') for (let k = 1; k <= 64; k++) table.setInteger(k, false);
	if (kind === 'descending' || kind === 'stale') {
		const value = kind === 'stale' ? cpu.createTable() : false;
		for (let k = 4096; k >= 1; k--) table.setInteger(k, value);
	}
	if (kind === 'stale') table.clearWeakEntries(false, true, () => false);
	if (kind === 'sparse' || kind === 'terminal') for (let bit = 52; bit >= 0; bit--) table.set(2 ** bit, false);
	if (kind === 'terminal') table.set(0x1fffffffffffff, false);
	return table;
}
function seed(table: Table): number {
	const snapshot = new CpuSnapshot(), writer = new CpuSnapshotWriter(snapshot);
	const offset = table.captureSnapshot(writer, () => {}); writer.finish();
	return snapshot.word(offset + CpuSnapshotTable.LengthHint);
}

test('pure Table length emits exact logical own-presence work without repairing its saved seed', () => {
	for (const [kind, boundary, probes] of cases) {
		const { image } = program(false), { cpu } = createTestSystemCpu(image);
		const table = makeTable(cpu, kind); cpu.rootThread.currentFrame!.registers.setTable(0, table);
		const before = cpu.captureRuntimeState(), work: TableLengthWork = { probes: 0 };
		for (let repeat = 0; repeat < 3; ++repeat) {
			assert.equal(table.length(work), boundary); assert.equal(work.probes, probes, kind);
			assert.equal(table.length(), boundary, 'raw host query preserves its Number-returning contract');
		}
		assert.ok(isDeepStrictEqual(cpu.captureRuntimeState(), before), 'logical probe output mutates no guest state, storage, seed or heap');
	}
	const { image } = program(false), { cpu } = createTestSystemCpu(image), table = makeTable(cpu, 'descending');
	assert.equal(seed(table), 1);
	for (let k = 0; k < 300; ++k) table.setStringKey(cpu.stringPool.intern(`key${k}`), true);
	assert.equal(seed(table), 1, 'hash redistribution preserves the logical seed');
	const work = { probes: 0 }; assert.equal(table.length(work), 4096); assert.equal(work.probes, 26);
	table.setInteger(2, false); assert.equal(seed(table), 2, 'even an existing eligible mapping advances only one adjacent step');
	table.setInteger(2, null); assert.equal(seed(table), 1);
	table.clear(); assert.equal(seed(table), 0); assert.equal(table.length(work), 0); assert.equal(work.probes, 1);
	const hash = cpu.createTable(0, 16); hash.setInteger(1, false); assert.equal(seed(hash), 1);
	hash.setInteger(2, false); assert.equal(seed(hash), 2, 'eligible keys in preallocated hash storage use the same seed update');
});

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) for (const wide of [false, true]) {
	test(`LEN every grant commits aliased result/work before side-effecting successor (${backend}, WIDE=${wide})`, () => {
		for (const [kind, boundary, probes] of cases) {
			const { image, starts } = program(wide), { cpu } = createTestSystemCpu(image, backend);
			let frame = cpu.rootThread.currentFrame!; const base = frame.pc;
			const table = makeTable(cpu, kind), marker = cpu.createTable(1);
			frame.registers.setTable(0, table); frame.registers.setTable(10, marker);
			const charges = [2, 2, 3 + 3 * probes, 5, 2, 2], total = charges.reduce((a, b) => a + b, 0);
			cpu.runUntilDepth(0, total * 64);
			if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(base & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
			const savedSeed = seed(table), heap = cpu.luaHeap.usedBytes();
			for (let grant = 0; grant <= total; ++grant) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
				frame.registers.setNumber(6, 91); frame.registers.setNil(8); frame.registers.setNil(9); marker.setInteger(1, -1);
				assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
				let remaining = grant, completed = 0; while (remaining > 0) remaining -= charges[completed++];
				assert.equal(cpu.instructionBudgetRemaining, remaining, `${kind}/${grant}: entire P charge once`);
				assert.equal(frame.pc, base + starts[completed === 6 ? 0 : completed] * INSTRUCTION_BYTES);
				assert.equal(frame.registers.get(6), completed >= 3 ? boundary : completed >= 2 ? table : 91);
				assert.equal(marker.getInteger(1), completed >= 4 ? boundary : -1, 'no future table mutation after exhausted LEN');
				assert.equal(frame.registers.get(8), completed >= 5 ? 37 : null, 'cached live Number survives the helper and exact prefix admission');
			}
			assert.equal(seed(table), savedSeed); assert.equal(cpu.luaHeap.usedBytes(), heap);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
			const before = cpu.captureRuntimeState(); cpu.runUntilDepth(0, 5); const after = cpu.captureRuntimeState(), debt = cpu.instructionBudgetRemaining;
			cpu.restoreRuntimeState(before); cpu.runUntilDepth(0, 5); frame = cpu.rootThread.currentFrame!;
			assert.equal(cpu.instructionBudgetRemaining, debt); assert.ok(isDeepStrictEqual(cpu.captureRuntimeState(), after));
			// String LEN must ignore any previous Table probe output.
			frame.registers.set(0, valueString(cpu.stringPool.intern('é😀\0')));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
			cpu.runUntilDepth(0, 5); assert.equal(cpu.instructionBudgetRemaining, -2); assert.equal(frame.registers.getNumber(6), 3);
			frame.registers.set(0, true); frame.registers.setNil(8);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
			cpu.runUntilDepth(0, 5); assert.equal(cpu.instructionBudgetRemaining, -2);
			assert.equal(cpu.readCauseWord() & 0x7c, CPU_CAUSE_CODE_TRAP);
			assert.equal(frame.registers.get(6), true, 'invalid LEN has no result or presence-test work');
			assert.equal(frame.registers.get(8), null);
		}
	});
}

for (const kind of ['ascending', 'descending'] as const) test(`published JS region directly exposes completed LEN frontier (${kind})`, () => {
	const { image, starts } = program(false), { cpu } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const frame = cpu.rootThread.currentFrame!, base = frame.pc, table = makeTable(cpu, kind), marker = cpu.createTable(1);
	frame.registers.setTable(0, table); frame.registers.setTable(10, marker); cpu.runUntilDepth(0, (kind === 'ascending' ? 22 : 94) * 64);
	const page = frame.decodedPage!, block = page.compiledBlocks!.entries[(base & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]!;
	assert.ok(block && 15 > block.admissionCycles, 'the real generated body is admitted, not an interpreter fallback');
	frame.registers.setNumber(6, 91); frame.registers.setNil(8); marker.setInteger(1, -1);
	const state = { remainingCycles: 15, registerTop: frame.top, memoryAddress: 0, lengthWork: { probes: 0 } };
	const exit = block.region.exits[block.region.execute(frame.registers, frame.executionImage.constScalars, page, frame, block.entry, state)];
	assert.equal(exit.nextPc, base + starts[3] * INSTRUCTION_BYTES);
	assert.equal(state.remainingCycles, kind === 'ascending' ? 2 : -70);
	assert.equal(state.lengthWork.probes, kind === 'ascending' ? 2 : 26);
	assert.equal(frame.registers.getNumber(6), kind === 'ascending' ? 64 : 4096, 'resident LEN result is raw-published on completed Continue');
	assert.equal(marker.getInteger(1), -1); assert.equal(frame.registers.get(8), null);
});

for (const wide of [false, true]) test(`skipped LEN performs no logical search (WIDE=${wide})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.EQ, 0, 1, 1);
	let word = 1; if (wide) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, word++, OpCode.LEN, 6, 0, 0); writeInstruction(text, word++, OpCode.KSMI, 8, 0, 37);
	writeInstruction(text, word, OpCode.JMP, 0, 63, (-(word + 1)) & 63, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: word + 1, maxStack: 10 }] });
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!;
		frame.registers.setTable(0, makeTable(cpu, 'descending')); frame.registers.setNumber(1, 1); frame.registers.setNumber(6, 91);
		const base = frame.pc; cpu.runUntilDepth(0, 6 * 64);
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(base & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base); frame.registers.setNil(8);
		cpu.runUntilDepth(0, 4); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.getNumber(6), 91); assert.equal(frame.registers.getNumber(8), 37);
	}
});
