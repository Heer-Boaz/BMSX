import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE, IO_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

test('helper continuations are predeclared entries and read their own current Value bank', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 8, 0, 0);
	writeInstruction(text, 1, OpCode.LOAD_MEM, 0, 1, MemoryAccessKind.U32LE);
	writeInstruction(text, 2, OpCode.MOV, 4, 8, 0);
	writeInstruction(text, 3, OpCode.STORE_MEM, 4, 1, MemoryAccessKind.U32LE);
	writeInstruction(text, 4, OpCode.MOV, 5, 0, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 9 }] });
	const { cpu, memory } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), frame = cpu.rootThread.frames[0];
	frame.registers.setNumber(1, DYNAMIC_RAM_BASE); cpu.runUntilDepth(0, 1024);
	const page = frame.decodedPage!, first = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const entries = [0, 2, 4].map(word => page.compiledBlocks!.entries[first + word]!);
	assert.ok(entries.every(entry => entry.region === entries[0].region), 'all helper returns are known before a slow helper is taken');
	assert.deepEqual(entries.map(entry => entry.entryCycles), [8, 5, 2]);
	assert.deepEqual(entries.map(entry => entry.sourceWords), [6, 4, 2]);
	const table = cpu.createTable();
	for (let iteration = 0; iteration < 32; ++iteration) for (let start = 0; start < entries.length; ++start) {
		const registers = new ValueSlots(9), block = entries[start];
		registers.setEncoded(0, ValueTag.False, 37, null); registers.setNumber(1, DYNAMIC_RAM_BASE); registers.setTable(8, table);
		memory.writeMappedWord(DYNAMIC_RAM_BASE, 17);
		const run = { remainingCycles: block.entryCycles, registerTop: 0 };
		const exit = block.region.exits[block.region.execute(registers, frame.executionImage.constScalars, page, frame, block.entry, run)];
		assert.ok(exit === entries[2].terminal, 'one generated invocation executes the complete suffix');
		assert.deepEqual(run, { remainingCycles: 0, registerTop: start === 0 ? 9 : 6 });
		if (start === 0) {
			assert.equal(registers.getNumber(0), 17); assert.equal(registers.getNumber(4), 1);
			assert.equal(registers.getNumber(5), 17); assert.equal(registers.getNumber(8), 1);
			assert.equal(memory.readMappedWord(DYNAMIC_RAM_BASE), 1);
		} else {
			for (const register of [0, 5]) { assert.equal(registers.getTag(register), ValueTag.False); assert.equal(registers.getScalar(register), 37); }
			assert.equal(registers.getTable(8), table); assert.equal(registers.get(4), start === 1 ? table : null);
			assert.equal(memory.readMappedWord(DYNAMIC_RAM_BASE), start === 1 ? 0 : 17);
		}
	}
});

test('resident Values cross internal string branches and publish only when leaving the region', () => {
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
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 10, maxStack: 11 }], constants: [1] });
	const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), frame = cpu.rootThread.frames[0];
	const alpha = cpu.stringPool.intern('alpha'), omega = cpu.stringPool.intern('omega');
	frame.registers.setStringId(0, alpha); frame.registers.setStringId(1, omega); frame.registers.setNumber(4, 0);
	frame.registers.setEncoded(8, ValueTag.False, 37, null); cpu.runUntilDepth(0, 1024);
	const page = frame.decodedPage!, first = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = page.compiledBlocks!.entries[first]!, table = cpu.createTable();
	for (const less of [false, true]) for (const kind of [ValueTag.False, ValueTag.Table, ValueTag.Number]) for (const grant of [32, 63, 128, 257]) {
		const r = new ValueSlots(11), writes = new Uint32Array(11), store = r.setEncoded.bind(r);
		r.setStringId(0, less ? alpha : omega); r.setStringId(1, less ? omega : alpha);
		r.setNumber(3, 73); r.setNumber(4, 0);
		r.setEncoded(8, kind, kind === ValueTag.False ? 37 : kind === ValueTag.Number ? -0 : NaN, kind === ValueTag.Table ? table : null);
		r.setEncoded = (register, tag, scalar, reference) => { ++writes[register]; store(register, tag, scalar, reference); };
		const run = { remainingCycles: grant, registerTop: 0 };
		block.region.execute(r, frame.executionImage.constScalars, page, frame, block.entry, run);
		assert.ok(r.getNumber(4) > 0); assert.equal(r.getNumber(5), r.getNumber(4)); assert.equal(run.registerTop, 11);
		if (!less) { assert.equal(r.getNumber(3), 73); assert.equal(r.getTag(9), ValueTag.Nil); }
		for (const register of less ? [3, 6, 7, 9, 10] : [6, 7, 10]) {
			assert.equal(r.getTag(register), r.getTag(8)); assert.equal(r.getScalar(register), r.getScalar(8));
			assert.equal(r.getReference(register), r.getReference(8));
		}
		assert.ok(writes[4] <= 1 && writes[7] <= 1, 'resident definitions are not written back at internal branches');
		assert.equal(writes[8], 0, 'the read-only resident is never redundantly published');
	}
});

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
	assert.ok(cache.entries[2]?.region === root.region && cache.entries[4]?.region === root.region,
		'both conditional targets are local entries of one generated function');
	assert.equal(root.terminal.linkedBlock, null); assert.equal(taken.linkedBlock, null);
	assert.equal(taken.exit, CompiledBlockExit.Continue);
	for (const flag of [false, true]) for (const start of [0, 2, 4, 6]) for (let grant = 2; grant <= 64; ++grant) {
		const frame = machines[0].cpu.rootThread.frames[0], registers = new ValueSlots(12);
		for (let index = 0; index < 12; ++index) registers.setNumber(index, 0);
		registers.setNumber(0, 2); registers.setNumber(1, 1); registers.setBool(2, flag);
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
			remaining -= 2;
			if (remaining < 2) break;
		}
		const run = { remainingCycles: grant, registerTop: 0 }, block = cache.entries[start]!;
		const exit = block.region.exits[block.region.execute(registers, frame.executionImage.constScalars, page, frame, block.entry, run)];
		assert.ok(exit === expectedExit, 'one function call executes all admitted internal edges');
		assert.deepEqual(run, { remainingCycles: remaining, registerTop: top });
		assert.deepEqual(Array.from({ length: 12 }, (_, index) => registers.get(index)), expected);
	}

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
	assert.ok(cache.entries[0] === null && cache.entries[2] === null && cache.entries[4] === null,
		'a source write retires the function containing its internal branch targets');
	for (const { cpu } of machines) {
		cpu.rootThread.frames[0].registers.setBool(2, true);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 2048);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	assert.ok(cache.entries[0] !== null && cache.entries[4]?.region === cache.entries[0].region,
		'the changed target and source regenerate in one function');
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

for (const inRam of [false, true]) test(`short grants do not promote sequential positions (inRam=${inRam})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	for (let word = 0; word < 12; ++word) writeInstruction(text, word, OpCode.ADD, 0, 0, 1);
	writeInstruction(text, 12, OpCode.JMP, 0, 63, 51, 255); // -13 words
	writeInstruction(text, 32, OpCode.JMP, 0, 63, 35, 255); // enter word 4
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 33, maxStack: 12 }] });
	const start = inRam ? DYNAMIC_RAM_BASE : image.image.functions[0].codeAddress;
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		if (inRam) memory.writeBytes(start, text);
		const frame = cpu.rootThread.frames[0]; frame.registers.setNumber(0, 0); frame.registers.setNumber(1, 1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start);
		cpu.runUntilDepth(0, 4096);
	}
	const lookup = machines[0].cpu.rootThread.frames[0].executionImage.compiledCodeLookup!;
	const page = lookup.find(start, 0)!, cache = page.compiledBlocks!;
	const entry = (start & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.ok(cache.entries[entry]); assert.equal(cache.entries[entry]!.sourceWords, 13);
	for (let run = 0; run < 512; ++run) {
		for (const { cpu } of machines) cpu.runUntilDepth(0, 1);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
	}
	for (let grant = 2; grant <= 31; ++grant) {
		for (const { cpu } of machines) cpu.runUntilDepth(0, grant);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
	}
	assert.equal(cache.entries.filter(block => block !== null).length, 1,
		'arbitrary sequential grant resumptions must not create overlapping suffix translations');
	assert.equal(cache.entries[entry + 4], null);
	for (const { cpu } of machines) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start + 32 * INSTRUCTION_BYTES);
		cpu.runUntilDepth(0, 128);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	assert.ok(cache.entries[entry + 4], 'a real branch into the same interior position is still eligible');
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
	const store = cache.entries[((pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES) + 4]!;
	assert.ok(store && store.region === first.region); assert.equal(store.entryCycles, 1); assert.equal(store.terminal.cycles, 4);
	assert.ok(cache.entries[store.firstWord + 2]?.region === first.region);
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
	assert.ok(page.compiledBlocks!.entries[4]?.region === root.region, 'the memory successor remains inside the source region');
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


test('an external entry into a WIDE body shares its sequential join without duplicated suffixes', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0); writeInstruction(text, 1, OpCode.ADD, 0, 0, 1);
	writeInstruction(text, 2, OpCode.ADD, 2, 0, 1); writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 16, OpCode.JMP, 0, 63, 48, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 17, maxStack: 12 }] });
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frames[0];
		frame.registers.setNumber(0, 0); frame.registers.setNumber(1, 1); frame.registers.setNumber(2, 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1200);
	}
	for (let visit = 0; visit < 16; ++visit) {
		for (const { cpu } of machines) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE + 16 * INSTRUCTION_BYTES);
			cpu.runUntilDepth(0, 128);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	}
	const entries = machines[0].cpu.rootThread.frames[0].decodedPage!.compiledBlocks!.entries;
	assert.ok(entries[0] && entries[1] && entries[2] && entries[16]);
	assert.ok(entries[0].region === entries[1].region && entries[1].region === entries[2].region);
	assert.deepEqual([entries[0].sourceWords, entries[1].sourceWords, entries[2].sourceWords], [2, 1, 2]);
	for (let grant = 1; grant <= 31; ++grant) {
		for (const { cpu } of machines) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE + INSTRUCTION_BYTES);
			cpu.runUntilDepth(0, grant);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
	}
});
