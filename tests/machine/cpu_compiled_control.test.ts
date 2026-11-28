import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCpuParity } from '../helpers/cpu_execution';
import { isDeepStrictEqual } from 'node:util';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueBool, valueInteger, valueFloat } from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { COP0_BAD_ADDRESS, COP0_CAUSE, COP0_EPC, COP0_EXEC, COP0_LUA_FAULT_REASON, COP0_RAM_END, COP0_STATUS,
	CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE, CPU_CAUSE_CODE_SYSCALL, CPU_CAUSE_IRQ, CPU_STATUS_INHIBIT_RESET, CPU_STATUS_USER_MODE_CURRENT } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { IO_IRQ_MASK, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';

function assertParity(js: CPU, ref: CPU): void {
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()), 'full CPU state, value graphs, frames and CP0/NMI words');
	assert.equal(js.readCurrentInstructionPc(), ref.readCurrentInstructionPc());
	assert.equal(js.lastPc, ref.lastPc);
}

test('an adopted CP0 RAM_END read uses the live physical fence', () => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.MFC0, 0, COP0_RAM_END, 0);
	writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 1 }] });
	const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
	runCpuParity(js, ref, 256);
	assert.ok(js.rootThread.currentFrame!.decodedPage!.compiledBlocks!.entries.some(entry => entry !== null));
	const next = DYNAMIC_RAM_BASE + HEAP_PAGE_SIZE;
	for (const cpu of [js, ref]) cpu.memory.setRamBusEnd(next);
	runCpuParity(js, ref, 8);
	assert.equal(js.readFrameRegister(0, 0), valueInteger(next));
	assertParity(js, ref);
});

test('ordinary SVC passes a register window without moving its operands', () => {
	const text = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.SVC, 3, 3, 0);
	writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
	writeInstruction(text, 2, OpCode.RFE, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 2, maxStack: 6 }, { firstWord: 2, wordCount: 1, numParams: 3 },
	], exceptionFunctionIndex: 1 });
	const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const frame = cpu.rootThread.currentFrame!;
		frame.registers.set(3, valueBool(true));
		frame.registers.setInteger(4, 89);
		frame.registers.setFloatBits(5, 0x80000000);
	}
	runCpuParity(js, ref, 48 * (BASE_CYCLES[OpCode.SVC] + BASE_CYCLES[OpCode.RFE] + BASE_CYCLES[OpCode.JMP]));
	assert.ok(js.rootThread.currentFrame!.decodedPage!.compiledBlocks!.entries.some(entry => entry !== null));
	assert.equal(runCpuParity(js, ref, 1), RunResult.Yielded);
	for (const cpu of [js, ref]) {
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
		assert.equal(cpu.fixedInterruptActive(), true);
		const frame = cpu.activeThread.currentFrame!, issuer = cpu.rootThread.currentFrame!;
		assert.equal(frame.argumentCount, 3);
		assert.deepEqual([frame.registers.get(0), frame.registers.get(1), frame.registers.get(2)],
			[valueBool(true), valueInteger(3), valueInteger(2)]);
		assert.equal(issuer.registers.getInteger(4), 89);
		assert.equal(issuer.registers.getPayload(5), 0x80000000);
		assert.equal(issuer.pc, cpu.readEpcWord());
	}
	assertParity(js, ref);
});

test('compiled CP0 loads retain raw words as Integers and consume the live registerfile', () => {
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
		const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
		for (const cpu of [js, ref]) {
			const state = cpu.captureRuntimeState(); state.statusWord = (word & ~CPU_STATUS_USER_MODE_CURRENT) >>> 0;
			state.causeWord = word; state.epcWord = (word ^ 0x13579bdf) >>> 0; state.badAddressWord = ~word >>> 0; state.luaFaultReasonWord = word;
			cpu.restoreRuntimeState(state); cpu.runUntilDepth(0, 900);
		}
		assertParity(js, ref);
		const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
		assert.equal(js.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries[entry]!.sourceWords, 9);
		assert.equal(js.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries[entry]!.exits.filter(x => x.exit === CompiledBlockExit.ControlFault).length, 1, 'one privilege edge plus the terminal, not one edge per implemented read');
		const expected = [(word & ~CPU_STATUS_USER_MODE_CURRENT) >>> 0, word, (word ^ 0x13579bdf) >>> 0, ~word >>> 0, word, 0];
		for (let i = 0; i < expected.length; ++i) assert.equal(js.readFrameRegister(0, i), valueInteger(expected[i]));
		assert.equal(js.readFrameRegister(0, 9), valueInteger(word + 1), 'Integer addition wraps the word');
		for (const cpu of [js, ref]) { cpu.writeEpcWord((word + 1) >>> 0); cpu.runUntilDepth(0, 18); }
		assertParity(js, ref); assert.equal(js.readFrameRegister(0, 2), valueInteger(word + 1));
		for (const cpu of [js, ref]) {
			const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(0, CPU_STATUS_USER_MODE_CURRENT);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[1].codeAddress); cpu.runUntilDepth(0, 1);
			frame.registers.setInteger(0, 73); frame.registers.setInteger(8, 73); frame.top = 0;
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress); cpu.runUntilDepth(0, 18);
		}
		assertParity(js, ref); assert.equal(js.readFrameRegister(0, 0), valueInteger(73)); assert.equal(js.readFrameRegister(0, 8), valueInteger(1));
		assert.equal(js.rootThread.frameAtDepth(0).top, 9); assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
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
	const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) { const r = cpu.rootThread.frameAtDepth(0).registers; r.setInteger(0, 0); r.setInteger(1, 0); r.setInteger(12, -1); cpu.runUntilDepth(0, 600); }
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
	assert.equal(js.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries[entry]!.sourceWords, 6);
	for (const [source, result, word] of [
		[valueInteger(-1), valueInteger(-1), 0xffffffff], [valueFloat(-0), valueFloat(0), 0],
		[valueFloat(-1.5), valueFloat(-1.5), 0xffffffff], [valueFloat(2 ** 32), valueFloat(2 ** 32), 0],
		[valueFloat(2 ** 32 + 512), valueFloat(2 ** 32 + 512), 512],
	] as const) {
		for (const cpu of [js, ref]) {
			const frame = cpu.rootThread.frameAtDepth(0);
			frame.registers.set(0, source); frame.pc = image.image.functions[0].codeAddress;
		}
		runCpuParity(js, ref, BASE_CYCLES[OpCode.ADD] + 2 * BASE_CYCLES[OpCode.MTC0] + BASE_CYCLES[OpCode.MFC0] + BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP]);
		assertParity(js, ref);
		assert.equal(js.readEpcWord(), word); assert.equal(js.readCauseWord(), 0);
		assert.equal(js.readFrameRegister(0, 0), source);
		assert.equal(js.readFrameRegister(0, 5), valueInteger(word)); assert.equal(js.readFrameRegister(0, 6), result);
		assert.equal(js.rootThread.frameAtDepth(0).top, 7, 'ignored writes do not make their source a destination');
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
	const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter);
	for (const { cpu, memory, irqController } of [js, ref]) {
		const frame = cpu.rootThread.frameAtDepth(0); frame.registers.setInteger(0, 0); frame.registers.setInteger(1, 0);
		cpu.runUntilDepth(0, 400); frame.top = 0; frame.registers.setInteger(0, 1); frame.registers.setInteger(6, 73);
		memory.writeMappedU32LE(IO_IRQ_MASK, IRQ_VBLANK); irqController.raise(IRQ_VBLANK);
		assert.equal(cpu.runUntilDepth(0, 32), RunResult.Halted); assert.equal(cpu.isExceptionFrame(1), true);
	}
	assertParity(js.cpu, ref.cpu);
	assert.equal(js.cpu.readFramePc(0), image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES);
	assert.equal(js.cpu.readFrameRegister(0, 6), valueInteger(73));
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
	const image = linkRawTestSystemBlua32(source), js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers; r.setInteger(0, CPU_STATUS_USER_MODE_CURRENT); r.setTable(12, createReferenceTable(cpu));
		setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.find('returnStatus')!, valueInteger(8)); cpu.runUntilDepth(0, 900);
		setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.find('returnStatus')!, valueInteger(0)); assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
	}
	assertParity(js, ref); assert.equal(js.readCurrentInstructionPc(), image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES);
	assert.equal(js.readFrameRegister(0, 6), valueInteger(image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES));
	assert.equal(js.rootThread.frameAtDepth(0).top, 7);
});

for (const op of [OpCode.MFC0, OpCode.MTC0] as const) for (const wide of [false, true]) {
	test(`compiled opcode ${op} privilege priority and WIDE=${wide} faults preserve destination/top and use native RFE`, () => {
		const image = linkRawTestSystemBlua32(faultLoopSource(op, wide));
		const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
		const registers = js.rootThread.frameAtDepth(0).registers;
		for (const cpu of [js, ref]) {
			const r = cpu.rootThread.frameAtDepth(0).registers; r.setInteger(0, CPU_STATUS_USER_MODE_CURRENT); r.setTable(12, createReferenceTable(cpu));
			setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.find('returnStatus')!, valueInteger(0xa5a5a408 | CPU_STATUS_INHIBIT_RESET));
		}
		const original = registers.get(12);
		runCpuParity(js, ref, 900);
		assertParity(js, ref);
		assert.equal(js.readCauseWord(), CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES);
		const blocks = Array.from(js.rootThread.frameAtDepth(0).executionImage.decodedPages.values()).flatMap(page => page.compiledBlocks?.entries.filter(block => block !== null) ?? []);
		assert.ok(blocks.some(block => block.exits.some(exit => exit.exit === CompiledBlockExit.ControlFault && exit.currentPc === js.readEpcWord())));
		assert.ok(blocks.some(block => block.terminal.exit === CompiledBlockExit.ExceptionReturn && block.sourceWords === 2));
		for (const cpu of [js, ref]) {
			if (op === OpCode.MTC0) cpu.rootThread.frameAtDepth(0).registers.setInteger(12, -1);
			setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.find('returnStatus')!, valueInteger(0));
			assert.equal(cpu.runUntilDepth(0, 20), RunResult.Yielded, 'clearing reset inhibit retires before WIDE RFE');
			assert.equal(cpu.rootThread.frameDepth, 2);
			assert.equal(cpu.isExceptionFrame(1), true);
			assert.equal(cpu.readFramePc(1), image.image.functions[1].codeAddress + 2 * INSTRUCTION_BYTES);
			assert.equal(cpu.captureRuntimeState().statusWord, 0);
		}
		assertParity(js, ref);
		for (const cpu of [js, ref]) assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
		assertParity(js, ref);
		assert.equal(js.captureRuntimeState().hardHalted, true); assert.equal(js.readCauseWord(), CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		assert.equal(js.readFrameRegister(0, 12), op === OpCode.MTC0 ? valueInteger(-1) : original); assert.equal(js.rootThread.frameAtDepth(0).top, 4);
	});
}

test('a warmed WIDE RFE rejects an ordinary frame after returning to the active EPC', () => {
	const image = linkRawTestSystemBlua32(faultLoopSource(OpCode.MFC0, false));
	const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers; r.setInteger(0, CPU_STATUS_USER_MODE_CURRENT); r.setTable(12, createReferenceTable(cpu));
		setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.find('returnStatus')!, valueInteger(0xa5a5a408 | CPU_STATUS_INHIBIT_RESET)); cpu.runUntilDepth(0, 900);
		for (let step = 0; step < 8 && cpu.rootThread.frameDepth > 1; ++step) cpu.runUntilDepth(0, 1);
		assert.equal(cpu.rootThread.frameDepth, 1); cpu.runUntilDepth(0, 1);
		cpu.writeEpcWord(image.image.functions[1].codeAddress + 2 * INSTRUCTION_BYTES);
		setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.find('returnStatus')!, valueInteger(0));
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Yielded, 'clearing reset inhibit retires before WIDE RFE');
		assert.equal(cpu.rootThread.frameDepth, 2);
		assert.equal(cpu.isExceptionFrame(1), true);
		assert.equal(cpu.readFramePc(1), image.image.functions[1].codeAddress + 2 * INSTRUCTION_BYTES);
		assert.equal(cpu.captureRuntimeState().statusWord, 0);
	}
	assertParity(js, ref);
	for (const cpu of [js, ref]) assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
	assertParity(js, ref); assert.equal(js.captureRuntimeState().hardHalted, true);
	assert.equal(js.rootThread.frameDepth, 1);
	assert.equal(js.isExceptionFrame(0), false);
	assert.equal(js.readCurrentInstructionPc(), image.image.functions[1].codeAddress + 2 * INSTRUCTION_BYTES);
	assert.equal(js.rootThread.frameAtDepth(0).top, 4);
});

test('compiled EXEC replaces frames after returning and rejects a non-static target', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	for (const word of [0, 16]) { writeInstruction(text, word, OpCode.GETGL, 0, 0, word === 0 ? 0 : 1); writeInstruction(text, word + 1, OpCode.MTC0, 0, COP0_EXEC, 0); }
	writeInstruction(text, 32, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2 }, { firstWord: 16, wordCount: 2 },
		{ firstWord: 32, wordCount: 1, staticClosure: false }], globalNames: ['next', 'start'] });
	const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.find('next')!, valueInteger(image.symbols.functionAddresses[1]));
		setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.find('start')!, valueInteger(image.symbols.functionAddresses[0])); cpu.runUntilDepth(0, 800);
	}
	assertParity(js, ref);
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
	let generated = false;
	for (const page of js.rootThread.frameAtDepth(0).executionImage.decodedPages.values()) if (page.compiledBlocks !== null) {
		const block = page.compiledBlocks.entries[entry];
		generated ||= block !== null && block.terminal.exit === CompiledBlockExit.WriteControl && block.terminal.currentPc === image.image.functions[0].codeAddress + INSTRUCTION_BYTES;
	}
	assert.equal(generated, true, 'the context-replacing EXEC has a real generated body even before the next frame fetch');
	for (const cpu of [js, ref]) {
		for (const key of ['next', 'start']) setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.find(key)!, valueInteger(image.symbols.functionAddresses[2]));
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
	const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const state = cpu.captureRuntimeState(); state.statusWord = 0xa5a5a511; state.causeWord = 0xdeadbeef; state.epcWord = 0x12345679;
		state.badAddressWord = 0x87654321; state.luaFaultReasonWord = 0x80000000; state.exceptionDomainWord = 7;
		cpu.restoreRuntimeState(state); cpu.rootThread.frameAtDepth(0).registers.setInteger(1, 0); cpu.runUntilDepth(0, 300);
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
		runCpuParity(js, ref, 1);
		assertParity(js, ref);
	}
	let generated = false;
	const entry = (image.image.functions[1].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
	for (const page of js.rootThread.frameAtDepth(0).executionImage.decodedPages.values()) if (page.compiledBlocks !== null) {
		const block = page.compiledBlocks.entries[entry];
		generated ||= block !== null && block.terminal.exit === CompiledBlockExit.ExceptionReturn && block.sourceWords === 3;
	}
	assert.equal(generated, true, 'the NMI handler executes its CP0 read and WIDE RFE in a generated body');
	const continuation = image.image.functions[0].codeAddress + INSTRUCTION_BYTES;
	const page = js.rootThread.frameAtDepth(0).decodedPage!;
	assert.ok(page.compiledBlocks!.entries[(continuation & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2],
		'a repeated RFE entry into the middle of a hot body is a translation entry, unlike an arbitrary grant resumption');
});
