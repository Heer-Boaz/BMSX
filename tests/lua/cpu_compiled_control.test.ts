import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { COP0_BAD_ADDRESS, COP0_CAUSE, COP0_EPC, COP0_EXEC, COP0_LUA_FAULT_REASON, COP0_STATUS,
	CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE, CPU_CAUSE_IRQ, CPU_STATUS_USER_MODE_CURRENT } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { IO_IRQ_MASK, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

function assertParity(js: CPU, ref: CPU): void {
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()), 'full CPU state, value graphs, frames and CP0/NMI words');
	assert.equal(js.instructionBudgetRemaining, ref.instructionBudgetRemaining);
	assert.equal(js.readCurrentInstructionPc(), ref.readCurrentInstructionPc());
	assert.equal(js.lastPc, ref.lastPc);
}

test('compiled CP0 loads retain full unsigned words and consume the live registerfile', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 8, 0, 0);
	const fields = [COP0_STATUS, COP0_CAUSE, COP0_EPC, COP0_BAD_ADDRESS, COP0_LUA_FAULT_REASON, COP0_EXEC];
	for (let i = 0; i < fields.length; ++i) writeInstruction(text, i + 1, OpCode.MFC0, i, fields[i], 0);
	writeInstruction(text, 7, OpCode.ADD, 9, 1, 8);
	writeInstruction(text, 8, OpCode.JMP, 0, 63, 55, 255);
	writeInstruction(text, 32, OpCode.MTC0, 0, COP0_STATUS, 0); writeInstruction(text, 48, OpCode.HALT, 0, 0, 0); writeInstruction(text, 49, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 9, maxStack: 10 }, { firstWord: 32, wordCount: 1 },
		{ firstWord: 48, wordCount: 2 }], exceptionFunctionIndex: 2 });
	for (const word of [0, 0x80000000, 0xffffffff, 0xa5a55a5a]) {
		const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
		for (const cpu of [js, ref]) {
			const state = cpu.captureRuntimeState(); state.statusWord = (word & ~CPU_STATUS_USER_MODE_CURRENT) >>> 0;
			state.causeWord = word; state.epcWord = (word ^ 0x13579bdf) >>> 0; state.badAddressWord = ~word >>> 0; state.luaFaultReasonWord = word;
			cpu.restoreRuntimeState(state); cpu.runUntilDepth(0, 900);
		}
		assertParity(js, ref);
		const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
		assert.equal(js.rootThread.frames[0].decodedPage!.compiledBlocks!.entries[entry]!.sourceWords, 9);
		assert.equal(js.rootThread.frames[0].decodedPage!.compiledBlocks!.entries[entry]!.exits.length, 2, 'one privilege edge plus the terminal, not one edge per implemented read');
		const expected = [(word & ~CPU_STATUS_USER_MODE_CURRENT) >>> 0, word, (word ^ 0x13579bdf) >>> 0, ~word >>> 0, word, 0];
		for (let i = 0; i < expected.length; ++i) assert.equal(js.readFrameRegister(0, i), expected[i]);
		assert.equal(js.readFrameRegister(0, 9), word + 1, 'ordinary arithmetic is not word-wrapped');
		for (const cpu of [js, ref]) { cpu.writeEpcWord((word + 1) >>> 0); cpu.runUntilDepth(0, 9); }
		assertParity(js, ref); assert.equal(js.readFrameRegister(0, 2), (word + 1) >>> 0);
		for (const cpu of [js, ref]) {
			const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(0, CPU_STATUS_USER_MODE_CURRENT);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[1].codeAddress); cpu.runUntilDepth(0, 1);
			frame.registers.setNumber(0, 73); frame.registers.setNumber(8, 73); frame.top = 0;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress); cpu.runUntilDepth(0, 9);
		}
		assertParity(js, ref); assert.equal(js.readFrameRegister(0, 0), 73); assert.equal(js.readFrameRegister(0, 8), 1);
		assert.equal(js.rootThread.frames[0].top, 9); assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
	}
});

test('compiled CP0 writes convert words without changing their sources or ignored fields', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.ADD, 4, 0, 1);
	writeInstruction(text, 1, OpCode.MTC0, 4, COP0_EPC, 0);
	writeInstruction(text, 2, OpCode.MFC0, 5, COP0_EPC, 0);
	writeInstruction(text, 3, OpCode.MOV, 6, 4, 0);
	writeInstruction(text, 4, OpCode.MTC0, 12, COP0_CAUSE, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 13 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) { const r = cpu.rootThread.frames[0].registers; r.setNumber(0, 0); r.setNumber(1, 0); r.setTable(12, cpu.createTable()); cpu.runUntilDepth(0, 600); }
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
	assert.equal(js.rootThread.frames[0].decodedPage!.compiledBlocks!.entries[entry]!.sourceWords, 6);
	assert.equal(js.rootThread.frames[0].decodedPage!.compiledBlocks!.entries[entry]!.exits.length, 2);
	for (const value of [-0, -1.5, 4294967297.75, 1e100, Infinity, NaN, null, true]) {
		for (const cpu of [js, ref]) { cpu.rootThread.frames[0].registers.set(0, value); cpu.runUntilDepth(0, 6); }
		assertParity(js, ref);
		const numeric = js.rootThread.frames[0].registers.getNumber(4);
		assert.equal(js.readEpcWord(), numeric >>> 0); assert.equal(js.readCauseWord(), 0);
		assert.equal(js.readFrameRegister(0, 5), numeric >>> 0); assert.equal(js.readFrameRegister(0, 6), numeric);
		assert.equal(js.rootThread.frames[0].top, 7, 'ignored writes do not make their source a destination');
	}
});

test('a compiled Status write returns for pending IRQ arbitration before its successor', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.ADD, 3, 0, 1);
	writeInstruction(text, 1, OpCode.MTC0, 3, COP0_STATUS, 0);
	writeInstruction(text, 2, OpCode.KSMI, 6, 0, 9);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 16, OpCode.HALT, 0, 0, 0); writeInstruction(text, 17, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 7 }, { firstWord: 16, wordCount: 2 }], irqFunctionIndex: 1 });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	for (const { cpu, memory, irqController } of [js, ref]) {
		const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(0, 0); frame.registers.setNumber(1, 0);
		cpu.runUntilDepth(0, 400); frame.top = 0; frame.registers.setNumber(0, 1); frame.registers.setNumber(6, 73);
		memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_VBLANK); irqController.raise(IRQ_VBLANK);
		assert.equal(cpu.runUntilDepth(0, 32), RunResult.Halted); assert.equal(cpu.isExceptionFrame(1), true);
	}
	assertParity(js.cpu, ref.cpu);
	assert.equal(js.cpu.readFramePc(0), image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES);
	assert.equal(js.cpu.readFrameRegister(0, 6), 73);
	assert.equal(js.cpu.readCauseWord(), CPU_CAUSE_IRQ); assert.equal(js.cpu.readEpcWord(), js.cpu.readFramePc(0));
});

function faultLoopSource(op: OpCode.MFC0 | OpCode.MTC0, wide: boolean) {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.MTC0, 0, COP0_STATUS, 0);
	writeInstruction(text, 1, OpCode.K1, 3, 0, 0);
	if (wide) writeInstruction(text, 2, OpCode.WIDE, 0, 1, 0);
	writeInstruction(text, wide ? 3 : 2, op, 12, 44, 0);
	writeInstruction(text, wide ? 4 : 3, OpCode.JMP, 0, 63, wide ? 61 : 62, 255);
	writeInstruction(text, 16, OpCode.GETGL, 0, 0, 0);
	writeInstruction(text, 17, OpCode.MTC0, 0, COP0_STATUS, 0);
	writeInstruction(text, 18, OpCode.WIDE, 255, 255, 255);
	writeInstruction(text, 19, OpCode.RFE, 63, 63, 63, 255);
	return { text, functions: [{ firstWord: 0, wordCount: wide ? 5 : 4, maxStack: 16 },
		{ firstWord: 16, wordCount: 4, maxStack: 1 }], exceptionFunctionIndex: 1, globalNames: ['returnStatus'] };
}

test('a later unknown selector keeps its own sparse fault edge after the privilege guard', () => {
	const source = faultLoopSource(OpCode.MFC0, false);
	writeInstruction(source.text, 2, OpCode.MFC0, 6, COP0_EPC, 0); writeInstruction(source.text, 3, OpCode.MFC0, 12, 44, 0);
	writeInstruction(source.text, 4, OpCode.JMP, 0, 63, 61, 255); source.functions[0].wordCount = 5;
	const image = linkRawTestSystemBlua32(source), js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frames[0].registers; r.setNumber(0, CPU_STATUS_USER_MODE_CURRENT); r.setTable(12, cpu.createTable());
		cpu.setGlobalByKey(cpu.stringPool.find('returnStatus')!, ValueTag.Number, 8, null); cpu.runUntilDepth(0, 900);
		cpu.setGlobalByKey(cpu.stringPool.find('returnStatus')!, ValueTag.Number, 0, null); assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
	}
	assertParity(js, ref); assert.equal(js.readCurrentInstructionPc(), image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES);
	assert.equal(js.readFrameRegister(0, 6), image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES);
	assert.equal(js.rootThread.frames[0].top, 7);
});

for (const op of [OpCode.MFC0, OpCode.MTC0] as const) for (const wide of [false, true]) {
	test(`compiled opcode ${op} privilege priority and WIDE=${wide} faults preserve destination/top and use native RFE`, () => {
		const image = linkRawTestSystemBlua32(faultLoopSource(op, wide));
		const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
		let conversions = 0;
		const registers = js.rootThread.frames[0].registers, getNumber = registers.getNumber.bind(registers);
		registers.getNumber = index => { if (index === 12) ++conversions; return getNumber(index); };
		for (const cpu of [js, ref]) {
			const r = cpu.rootThread.frames[0].registers; r.setNumber(0, CPU_STATUS_USER_MODE_CURRENT); r.setTable(12, cpu.createTable());
			cpu.setGlobalByKey(cpu.stringPool.find('returnStatus')!, ValueTag.Number, 0xa5a5a508, null);
		}
		const original = registers.getTable(12);
		for (const cpu of [js, ref]) cpu.runUntilDepth(0, 900);
		assert.equal(conversions, 0, 'user-mode rejection precedes source conversion');
		assertParity(js, ref);
		assert.equal(js.readCauseWord(), CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES);
		const blocks = Array.from(js.rootThread.frames[0].executionImage.decodedPages.values()).flatMap(page => page.compiledBlocks?.entries.filter(block => block !== null) ?? []);
		assert.ok(blocks.some(block => block.exits.some(exit => exit.exit === CompiledBlockExit.ControlFault && exit.currentPc === js.readEpcWord())));
		assert.ok(blocks.some(block => block.terminal.exit === CompiledBlockExit.ExceptionReturn && block.sourceWords === 2));
		for (const cpu of [js, ref]) { cpu.setGlobalByKey(cpu.stringPool.find('returnStatus')!, ValueTag.Number, 0, null); assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted); }
		assertParity(js, ref);
		assert.equal(js.captureRuntimeState().hardHalted, true); assert.equal(js.readCauseWord(), CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		assert.equal(js.rootThread.frames[0].registers.getTable(12), original); assert.equal(js.rootThread.frames[0].top, 4);
		if (op === OpCode.MTC0) assert.equal(conversions, 1, 'the supervisor path converts once before rejecting the unknown field');
	});
}

test('a warmed WIDE RFE rejects an ordinary frame after returning to the active EPC', () => {
	const image = linkRawTestSystemBlua32(faultLoopSource(OpCode.MFC0, false));
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frames[0].registers; r.setNumber(0, CPU_STATUS_USER_MODE_CURRENT); r.setTable(12, cpu.createTable());
		cpu.setGlobalByKey(cpu.stringPool.find('returnStatus')!, ValueTag.Number, 0xa5a5a508, null); cpu.runUntilDepth(0, 900);
		for (let step = 0; step < 8 && cpu.rootThread.frames.length > 1; ++step) cpu.runUntilDepth(0, 1);
		assert.equal(cpu.rootThread.frames.length, 1); cpu.runUntilDepth(0, 1);
		cpu.writeEpcWord(image.image.functions[1].codeAddress + 2 * INSTRUCTION_BYTES);
		cpu.setGlobalByKey(cpu.stringPool.find('returnStatus')!, ValueTag.Number, 0, null);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
	}
	assertParity(js, ref); assert.equal(js.captureRuntimeState().hardHalted, true);
	assert.equal(js.readCurrentInstructionPc(), image.image.functions[1].codeAddress + 2 * INSTRUCTION_BYTES);
	assert.equal(js.rootThread.frames[0].top, 4);
});

test('compiled EXEC replaces frames after returning and rejects a non-static target', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	for (const word of [0, 16]) { writeInstruction(text, word, OpCode.GETGL, 0, 0, word === 0 ? 0 : 1); writeInstruction(text, word + 1, OpCode.MTC0, 0, COP0_EXEC, 0); }
	writeInstruction(text, 32, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2 }, { firstWord: 16, wordCount: 2 },
		{ firstWord: 32, wordCount: 1, staticClosure: false }], globalNames: ['next', 'start'] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		cpu.setGlobalByKey(cpu.stringPool.find('next')!, ValueTag.Number, image.symbols.functionAddresses[1] + 0.75, null);
		cpu.setGlobalByKey(cpu.stringPool.find('start')!, ValueTag.Number, image.symbols.functionAddresses[0], null); cpu.runUntilDepth(0, 800);
	}
	assertParity(js, ref);
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
	let generated = false;
	for (const page of js.rootThread.frames[0].executionImage.decodedPages.values()) if (page.compiledBlocks !== null) {
		const block = page.compiledBlocks.entries[entry];
		generated ||= block !== null && block.terminal.exit === CompiledBlockExit.ExecuteFunction && block.terminal.currentPc === image.image.functions[0].codeAddress + INSTRUCTION_BYTES;
	}
	assert.equal(generated, true, 'the context-replacing EXEC has a real generated body even before the next frame fetch');
	for (const cpu of [js, ref]) {
		for (const key of ['next', 'start']) cpu.setGlobalByKey(cpu.stringPool.find(key)!, ValueTag.Number, image.symbols.functionAddresses[2], null);
		assert.equal(cpu.runUntilDepth(0, 4), RunResult.Halted);
	}
	assertParity(js, ref);
	assert.equal(js.captureRuntimeState().hardHalted, true, 'a non-static EXEC target is rejected rather than entering its HALT body');
});

test('compiled NMI return samples active EPC then restores retained words without restoring Status wholesale', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 0, 0, 0); writeInstruction(text, 1, OpCode.ADD, 1, 1, 0); writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	writeInstruction(text, 16, OpCode.MFC0, 0, COP0_CAUSE, 0); writeInstruction(text, 17, OpCode.WIDE, 255, 255, 255); writeInstruction(text, 18, OpCode.RFE, 63, 63, 63, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 2 }, { firstWord: 16, wordCount: 3 }], exceptionFunctionIndex: 1 });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const state = cpu.captureRuntimeState(); state.statusWord = 0xa5a5a511; state.causeWord = 0xdeadbeef; state.epcWord = 0x12345679;
		state.badAddressWord = 0x87654321; state.luaFaultReasonWord = 0x80000000; state.exceptionDomainWord = 7;
		cpu.restoreRuntimeState(state); cpu.rootThread.frames[0].registers.setNumber(1, 0); cpu.runUntilDepth(0, 300);
	}
	for (let iteration = 0; iteration < 12; ++iteration) {
		for (const cpu of [js, ref]) {
			const before = cpu.captureRuntimeState(); cpu.requestNonMaskableInterrupt(); assert.equal(cpu.enterPendingInterrupt(), true);
			cpu.writeEpcWord(image.image.functions[0].codeAddress + INSTRUCTION_BYTES); assert.equal(cpu.runUntilDepth(1, 100), RunResult.Halted);
			const after = cpu.captureRuntimeState(), entered = ((before.statusWord & ~0x3f) | ((before.statusWord << 2) & 0x3f)) >>> 0;
			assert.equal(after.statusWord, ((entered & ~0xf) | ((entered >>> 2) & 0xf)) >>> 0);
			for (const key of ['causeWord', 'epcWord', 'badAddressWord', 'luaFaultReasonWord', 'exceptionDomainWord'] as const) assert.equal(after[key], before[key]);
			assert.equal(cpu.readFramePc(0), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
		}
		assertParity(js, ref);
	}
	let generated = false;
	const entry = (image.image.functions[1].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
	for (const page of js.rootThread.frames[0].executionImage.decodedPages.values()) if (page.compiledBlocks !== null) {
		const block = page.compiledBlocks.entries[entry];
		generated ||= block !== null && block.terminal.exit === CompiledBlockExit.ExceptionReturn && block.sourceWords === 3;
	}
	assert.equal(generated, true, 'the NMI handler executes its CP0 read and WIDE RFE in a generated body');
});
