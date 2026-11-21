import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeRegisterStores, runCpuParity } from '../helpers/cpu_execution';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { integerConstant, numberConstantFromHost } from '../../toolchain/ts/lua/number';
import { valueBool, valueFloat, valueFloatBits, valueInteger, valueNil, ValueTag, valueString } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { DYNAMIC_RAM_BASE, RAM_BASE, RAM_RECORD_WORD_MASK, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

test('compiled globals use the live banks across growth, keep namespaces distinct and preserve raw value kinds', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.GETGL, 0, 0, 0);
	writeInstruction(text, 1, OpCode.SETSYS, 0, 0, 1);
	writeInstruction(text, 2, OpCode.GETSYS, 1, 0, 0);
	writeInstruction(text, 3, OpCode.SETGL, 1, 0, 1);
	writeInstruction(text, 4, OpCode.K1, 2, 0, 0);
	writeInstruction(text, 5, OpCode.SETGL, 2, 0, 2);
	writeInstruction(text, 6, OpCode.SETSYS, 12, 0, 2);
	writeInstruction(text, 7, OpCode.JMP, 0, 63, 56, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 8, maxStack: 16 }],
		globalNames: ['shared', 'copied', 'numeric'], systemGlobalNames: ['shared', 'copied', 'numeric'] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	const loopCycles = BASE_CYCLES[OpCode.GETGL] + 2 * BASE_CYCLES[OpCode.SETSYS] + BASE_CYCLES[OpCode.GETSYS] + 2 * BASE_CYCLES[OpCode.SETGL] + BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.JMP];
	runCpuParity(js, ref, 50 * loopCycles);
	const frame = js.rootThread.frameAtDepth(0), page = frame.decodedPage!;
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = page.compiledBlocks!.entries[entry]!;
	assert.equal(block.sourceWords, 8);
	for (const cpu of [js, ref]) for (let i = 0; i < 257; ++i) {
		cpu.setGlobalByKey(cpu.stringPool.intern(`grown-${i}`), valueInteger(i));
	}
	for (const value of [valueNil(), valueBool(false), valueBool(true), valueInteger(-1), valueFloat(-0), valueFloatBits(0xffa12345), valueFloat(Infinity), 'text'] as const) {
		for (const cpu of [js, ref]) {
			const r = cpu.rootThread.frameAtDepth(0).registers;
			r.set(12, value === 'text' ? valueString(cpu.stringPool.intern(value)) : value);
			cpu.setGlobalByKey(cpu.stringPool.intern('shared'), r.get(12));
			cpu.setSystemGlobalByKey(cpu.stringPool.intern('shared'), valueInteger(73));
		}
		runCpuParity(js, ref, loopCycles);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		assert.equal(js.getSystemGlobalByKey(js.stringPool.find('copied')!), frame.registers.get(12));
		assert.equal(js.getGlobalByKey(js.stringPool.find('copied')!), valueInteger(73));
		assert.equal(frame.top, 3, 'global stores do not extend top to the source register');
	}
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers;
		r.setTable(12, cpu.createTable(0, 0));
		cpu.setGlobalByKey(cpu.stringPool.intern('shared'), r.get(12));
	}
	runCpuParity(js, ref, loopCycles);
	assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	assert.equal(js.getSystemGlobalByKey(js.stringPool.find('copied')!), frame.registers.get(12));
	assert.ok(page.compiledBlocks!.entries[entry] === block, 'growing the bank does not retire or strand the compiled consumer');
	const saved = js.captureRuntimeState();
	js.restoreRuntimeState(saved);
	assert.deepEqual(js.captureRuntimeState(), saved, 'retained bank capacity is not serialized as extra globals');
});

for (const alias of [false, true]) test(`compiled LOADNIL and LOADKR preserve kinds and raw register indexing (alias=${alias})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE), destination = alias ? 2 : 0;
	writeInstruction(text, 0, OpCode.K1, 8, 0, 0);
	writeInstruction(text, 1, OpCode.K1, 9, 0, 0);
	writeInstruction(text, 2, OpCode.LOADNIL, 8, 2, 0);
	writeInstruction(text, 3, OpCode.LOADNIL, 15, 0, 0);
	writeInstruction(text, 4, OpCode.LOADKR, destination, 2, 0);
	writeInstruction(text, 5, OpCode.MOV, 3, destination, 0);
	writeInstruction(text, 6, OpCode.JMP, 0, 63, 57, 255);
	const constants = [null, false, true, 'literal', numberConstantFromHost(-0), numberConstantFromHost(NaN), numberConstantFromHost(Infinity), integerConstant(7)];
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 7, maxStack: 16 }], constants });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) { cpu.rootThread.frameAtDepth(0).registers.setInteger(2, 7); cpu.runUntilDepth(0, 700); }
	const frame = js.rootThread.frameAtDepth(0), page = frame.decodedPage!;
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(page.compiledBlocks!.entries[entry]!.sourceWords, 7);
	const expected = [valueNil(), valueBool(false), valueBool(true), valueString(js.stringPool.find('literal')!),
		valueFloat(-0), valueFloat(NaN), valueFloat(Infinity), valueInteger(7)];
	for (const [input, index] of [
		[valueInteger(0), 0], [valueFloat(1.9), 1], [valueFloat(2.9), 2], [valueInteger(3), 3],
		[valueInteger(4), 4], [valueInteger(5), 5], [valueInteger(6), 6], [valueInteger(7), 7],
		[valueFloat(4294967296), 0], [valueFloat(-0), 0],
	] as const) {
		for (const cpu of [js, ref]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
			cpu.rootThread.frameAtDepth(0).registers.set(2, input);
		}
		runCpuParity(js, ref, 2 * BASE_CYCLES[OpCode.K1] + 2 * BASE_CYCLES[OpCode.LOADNIL] + BASE_CYCLES[OpCode.LOADKR] + BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP]);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		assert.equal(frame.registers.get(3), expected[index]);
		assert.equal(frame.registers.getTag(8), ValueTag.Nil);
		assert.equal(frame.registers.getTag(9), ValueTag.Nil);
		assert.equal(frame.top, 10, 'zero-count nil fill does not extend top');
	}
});

test('a hot WIDE LOADKR fault publishes its prefix before trapping without writing the destination', () => {
	for (const bad of [valueInteger(8), valueInteger(-1), valueFloat(Infinity), valueFloat(-Infinity), valueFloatBits(0xffa12345), valueNil()]) {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.K1, 7, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 1, 1, 0);
		writeInstruction(text, 2, OpCode.LOADKR, 0, 1, 0); // R256 = K[U32(R513)], not RK[513].
		writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 514 }], constants: [integerConstant(11)] });
		const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
		for (const cpu of [js, ref]) { cpu.rootThread.frameAtDepth(0).registers.setInteger(513, 0); cpu.runUntilDepth(0, 300); }
		const frame = js.rootThread.frameAtDepth(0), page = frame.decodedPage!;
		const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
		assert.equal(page.compiledBlocks!.entries[entry]!.exits[0].exit, CompiledBlockExit.InvalidConstant);
		for (const cpu of [js, ref]) {
			cpu.rootThread.frameAtDepth(0).registers.setInteger(256, 73);
			cpu.rootThread.frameAtDepth(0).registers.set(513, bad);
			cpu.rootThread.frameAtDepth(0).top = 0;
		}
		runCpuParity(js, ref, 3);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
		assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
		assert.equal(frame.registers.get(256), valueInteger(73));
		assert.equal(frame.top, 8, 'the trapping load did not extend top');
	}
});

test('fixed selectors must name an entry in their own image extent', () => {
	// Encode K[1] as -2 in the B or C RK lane. Fixed field indices stay unsigned.
	const cases = [
		[OpCode.LOADK, 0, 1, 0, 0, 0],
		[OpCode.GETGL, 0, 1, 0, 0, 0],
		[OpCode.SETGL, 0, 1, 0, 0, 0],
		[OpCode.GETSYS, 0, 1, 0, 0, 0],
		[OpCode.SETSYS, 0, 1, 0, 0, 0],
		[OpCode.DIV, 62, 0, 7 << 3, 63, 0],
		[OpCode.POW, 0, 62, 7, 0, 63],
		[OpCode.GETFIELD, 0, 1, 0, 0, 0],
		[OpCode.SETFIELD, 1, 0, 0, 0, 0],
		[OpCode.SELF, 0, 1, 0, 0, 0],
	] as const;
	for (const [op, b, c, ext, wideB, wideC] of cases) {
		for (const wide of [false, true]) {
			const width = wide ? 2 : 1;
			const text = new Uint8Array((width + 1) * INSTRUCTION_BYTES);
			if (wide) writeInstruction(text, 0, OpCode.WIDE, 0, wideB, wideC);
			writeInstruction(text, width - 1, op, 0, b, c, ext);
			writeInstruction(text, width, OpCode.HALT, 0, 0, 0);
			const image = linkRawTestSystemBlua32({ text, constants: ['key'], globalNames: ['g'], systemGlobalNames: ['s'],
				functions: [{ firstWord: 0, wordCount: width, maxStack: 2 }, { firstWord: width, wordCount: 1 }], exceptionFunctionIndex: 1 });
			const pc = image.image.functions[0].codeAddress;
			for (const dispatch of ['interpreter', 'js', 'instrumented', 'observed'] as const) {
				const backend = dispatch === 'js' ? CpuExecutionBackend.JavaScript : CpuExecutionBackend.Interpreter;
				const { cpu } = createTestSystemCpu(image, backend);
				const frame = cpu.rootThread.frameAtDepth(0);
				const g = cpu.stringPool.find('g')!, s = cpu.stringPool.find('s')!;
				cpu.setGlobalByKey(g, valueInteger(81));
				cpu.setSystemGlobalByKey(s, valueInteger(91));
				frame.registers.setInteger(0, 73);
				frame.registers.setInteger(1, 75);
				let observations = 0;
				if (dispatch === 'instrumented') cpu.setExecutionHook(() => false, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
				if (dispatch === 'observed') cpu.setInstructionObserver({
					points: [new Set([pc]), new Set(), new Set()],
					observe: () => { ++observations; assert.equal(frame.pc, pc + width * INSTRUCTION_BYTES); },
				});
				assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
				assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[op], `opcode ${op} in ${dispatch}`);
				assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_TRAP);
				assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
				assert.equal(cpu.readEpcWord(), pc);
				assert.equal(cpu.lastPc, pc + (width - 1) * INSTRUCTION_BYTES);
				assert.equal(frame.registers.get(0), valueInteger(73));
				assert.equal(frame.registers.get(1), valueInteger(75));
				assert.equal(frame.top, 0);
				assert.equal(cpu.getGlobalByKey(g), valueInteger(81));
				assert.equal(cpu.getSystemGlobalByKey(s), valueInteger(91));
				assert.equal(observations, dispatch === 'observed' ? 1 : 0);
			}
		}
	}
});

test('a hot comparison skips a WIDE invalid selector without executing it', () => {
	const text = new Uint8Array(5 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.EQ, 0, 0, 1);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.LOADK, 2, 0, 1);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 4, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, constants: [integerConstant(11)],
		functions: [{ firstWord: 0, wordCount: 4, maxStack: 3 }, { firstWord: 4, wordCount: 1 }], exceptionFunctionIndex: 1 });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const registers = cpu.rootThread.frameAtDepth(0).registers;
		registers.setInteger(0, 9);
		registers.setInteger(1, 9);
		registers.setInteger(2, 73);
	}
	const pc = image.image.functions[0].codeAddress;
	const loopCycles = BASE_CYCLES[OpCode.EQ] + BASE_CYCLES[OpCode.JMP];
	assert.equal(runCpuParity(js, ref, 50 * loopCycles), RunResult.Yielded);
	assert.equal(js.readCauseWord(), 0);
	assert.equal(js.readFramePc(0), pc);
	const frame = js.rootThread.frameAtDepth(0);
	const entry = (pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.ok(frame.decodedPage!.compiledBlocks!.entries[entry]);
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[entry + 1], null);
	for (const cpu of [js, ref]) cpu.rootThread.frameAtDepth(0).registers.setInteger(1, 10);
	assert.equal(runCpuParity(js, ref, BASE_CYCLES[OpCode.EQ]), RunResult.Yielded);
	assert.equal(js.readFramePc(0), pc + INSTRUCTION_BYTES);
	assert.equal(js.readCauseWord(), 0);
	assert.equal(runCpuParity(js, ref, 1), RunResult.Yielded);
	assert.equal(js.readEpcWord(), pc + INSTRUCTION_BYTES);
	assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
	assert.equal(frame.registers.get(2), valueInteger(73));
});

test('numeric fusion does not execute a following invalid image operand early', () => {
	const text = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.ADD, 1, 0, 0);
	writeInstruction(text, 1, OpCode.SHL, 2, 0, 62, 7);
	writeInstruction(text, 2, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, constants: [integerConstant(11)],
		functions: [{ firstWord: 0, wordCount: 2, maxStack: 3 }, { firstWord: 2, wordCount: 1 }], exceptionFunctionIndex: 1 });
	const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const frame = cpu.rootThread.frameAtDepth(0);
	const pc = image.image.functions[0].codeAddress;
	frame.registers.setInteger(0, 9);
	frame.registers.setInteger(2, 73);
	assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.ADD] + 1), RunResult.Yielded);
	assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.SHL]);
	assert.equal(cpu.readEpcWord(), pc + INSTRUCTION_BYTES);
	assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
	assert.equal(frame.registers.get(1), valueInteger(18));
	assert.equal(frame.registers.get(2), valueInteger(73));
});

test('compiled upvalues follow open aliases and closed values without stale numeric locals', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 1, OpCode.GETUP, 1, 0, 0);
	writeInstruction(text, 2, OpCode.KSMI, 2, 0, 9);
	writeInstruction(text, 3, OpCode.SETUP, 2, 0, 0);
	writeInstruction(text, 4, OpCode.ADD, 3, 0, 1);
	writeInstruction(text, 5, OpCode.GETUP, 4, 0, 0);
	writeInstruction(text, 6, OpCode.SETUP, 12, 1, 0);
	writeInstruction(text, 7, OpCode.GETUP, 6, 1, 0);
	writeInstruction(text, 8, OpCode.JMP, 0, 63, 55, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 9, maxStack: 16 }] });
	const loopCycles = BASE_CYCLES[OpCode.K1] + 3 * BASE_CYCLES[OpCode.GETUP] + BASE_CYCLES[OpCode.KSMI] + 2 * BASE_CYCLES[OpCode.SETUP] + BASE_CYCLES[OpCode.ADD] + BASE_CYCLES[OpCode.JMP];
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const frame = cpu.rootThread.frameAtDepth(0);
		const bound = frame.closure;
		const cells = new Uint32Array(2);
		const replacement = cpu.luaHeap.allocateClosureRecord(2, false, cells, cells.length);
		Upvalue.bindOpen(cpu.memory, cells[0], frame.thread.address, frame.stackBase, 0);
		ClosureRecord.initializeRecord(cpu.memory, replacement, cpu.captureClosureBinding(bound), false, cpu.gc.white(), 2);
		ClosureRecord.setCaptureAddress(cpu.memory, replacement, 0, cells[0]);
		ClosureRecord.setCaptureAddress(cpu.memory, replacement, 1, cells[1]);
		frame.closureAddress = replacement;
		cpu.runUntilDepth(0, 50 * loopCycles);
	}
	const frame = js.rootThread.frameAtDepth(0), page = frame.decodedPage!;
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const region = page.compiledBlocks!.entries[entry]!.region;
	assert.equal(region.entries[0].sourceWords, 9);
	for (const value of [valueNil(), valueBool(false), valueBool(true), valueInteger(0), valueFloat(-0), valueFloatBits(0x7fa12345), 'upvalue'] as const) {
		for (const cpu of [js, ref]) cpu.rootThread.frameAtDepth(0).registers.set(12,
			value === 'upvalue' ? valueString(cpu.stringPool.intern(value)) : value);
		runCpuParity(js, ref, loopCycles);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		assert.equal(frame.registers.get(3), valueInteger(10), 'SETUP invalidates the earlier cached alias of R0');
		assert.equal(frame.registers.get(4), valueInteger(9));
		assert.equal(frame.registers.get(6), frame.registers.get(12));
		assert.equal(frame.top, 7, 'SETUP does not extend top to its source register');
	}
	const upvalue = ClosureRecord.captureAddress(js.memory, frame.closure, 0);
	Upvalue.close(js.gc, upvalue); Upvalue.store(js.gc, upvalue, ValueTag.Integer, 1);
	const r = frame.registers, writes = new Uint32Array(16);
	observeRegisterStores(r, index => { ++writes[index]; });
	const block = page.compiledBlocks!.entries[entry]!, run = {
		remainingCycles: block.region.entries.reduce((cycles, entry) => cycles + entry.terminal.cycles, 0), registerTop: frame.top, memoryAddress: 0, lengthWork: { probes: 0 },
	};
	const exit = block.region.exits[block.region.execute(r, frame.executionImage.constWords, page, frame, block.entry, run)];
	assert.equal(exit.nextPc, image.image.functions[0].codeAddress); assert.equal(run.remainingCycles, 0);
	assert.equal(writes[0], 1, 'an ordinary closed-cell write does not publish unrelated local definitions');
	assert.equal(writes[2], 1, 'a pending numeric source is forwarded to the upvalue without an intermediate writeback');
	assert.equal(r.get(3), valueInteger(2));
});

test('compiled upvalues honor mirrored stack values, control observations and physical continuations', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.JMPIF, 7, 0, 5);
	writeInstruction(text, 1, OpCode.K1, 5, 0, 0);
	writeInstruction(text, 2, OpCode.GETUP, 2, 0, 0);
	writeInstruction(text, 3, OpCode.SETUP, 0, 1, 0);
	writeInstruction(text, 4, OpCode.KSMI, 3, 0, 33);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	writeInstruction(text, 6, OpCode.KSMI, 3, 0, 60);
	writeInstruction(text, 7, OpCode.JMP, 0, 63, 56, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 8, maxStack: 16 }] });
	const start = image.image.functions[0].codeAddress, alternate = start + 6 * INSTRUCTION_BYTES;
	const prefix = BASE_CYCLES[OpCode.JMPIF] + BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.GETUP] + BASE_CYCLES[OpCode.SETUP];
	const tail = BASE_CYCLES[OpCode.KSMI] + BASE_CYCLES[OpCode.JMP];
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	const machines = [js, ref].map(cpu => {
		const frame = cpu.rootThread.frameAtDepth(0), cells = new Uint32Array(2);
		const closure = cpu.luaHeap.allocateClosureRecord(2, false, cells, cells.length);
		ClosureRecord.initializeRecord(cpu.memory, closure, cpu.captureClosureBinding(frame.closure), false, cpu.gc.white(), 2);
		for (let capture = 0; capture < cells.length; ++capture)
			ClosureRecord.setCaptureAddress(cpu.memory, closure, capture, cells[capture]);
		frame.closureAddress = closure;
		Upvalue.bindOpen(cpu.memory, cells[1], frame.thread.address, frame.stackBase + 8, 0);
		frame.registers.set(7, valueBool(true));
		cpu.runUntilDepth(0, 30 * (BASE_CYCLES[OpCode.JMPIF] + tail));
		frame.registers.set(7, valueBool(false));
		cpu.runUntilDepth(0, 30 * (prefix + tail));
		return { cpu, frame, closure, cells };
	});
	const frame = js.rootThread.frameAtDepth(0), page = frame.decodedPage!;
	const firstWord = (start & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const entry = page.compiledBlocks!.entries[firstWord + 1]!;
	const setup = entry.exits.find(exit => exit.exit === CompiledBlockExit.WriteUpvalue)!;
	assert.equal(setup.linkedBlock?.firstWord, firstWord + 4, 'the ordinary SETUP continuation is cached before redirecting it');
	assert.ok(page.compiledBlocks!.entries[firstWord + 6], 'the alternate target is already generated');
	// These are private RAM record-port fixtures, not ordinary cartridge bus operations.
	for (const port of ['closed-read', 'closed-write', 'read-pc', 'read-top', 'write-pc'] as const) {
		for (const { cpu, frame, closure, cells } of machines) {
			const memory = cpu.memory;
			frame.pc = start;
			frame.compilationEntry = true;
			frame.top = 0;
			frame.registers.setInteger(0, port === 'write-pc' ? alternate : 9);
			frame.registers.setNil(2);
			frame.registers.setNil(3);
			frame.registers.setInteger(4, 0);
			frame.registers.setInteger(5, 9);
			for (let capture = 0; capture < cells.length; ++capture) {
				memory.writeRamRecordByte(cells[capture] + Upvalue.UPVALUE_FLAGS, 0);
				ClosureRecord.setCaptureAddress(memory, closure, capture, cells[capture]);
			}
			if (port === 'closed-read' || port === 'closed-write') {
				const cell = frame.registers.ramOffset() + 5 * 4 - Upvalue.UPVALUE_VALUE_WORD;
				assert.equal(cell & Upvalue.UPVALUE_ADDRESS_MASK, cell);
				memory.writeRamRecordByte(cell + Upvalue.UPVALUE_VALUE_TAG, ValueTag.Integer);
				ClosureRecord.setCaptureAddress(memory, closure, port === 'closed-read' ? 0 : 1, cell);
			} else {
				const owner = DYNAMIC_RAM_BASE - RAM_BASE + 0x200, tag = owner + 0x100;
				const word = frame.controlOffset + (port === 'read-top' ? FrameField.Top : FrameField.Pc);
				memory.writeRamRecordWord(owner + ThreadField.StackBlock, word);
				memory.writeRamRecordWord(owner + ThreadField.StackCapacity, ((tag - word) & RAM_RECORD_WORD_MASK) >>> 2);
				memory.writeRamRecordByte(tag, ValueTag.Integer);
				Upvalue.bindOpen(memory, cells[port === 'write-pc' ? 1 : 0], owner, 0, 0);
			}
		}
		runCpuParity(js, ref, prefix + tail);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState(), port);
		if (port === 'closed-read') assert.equal(frame.registers.get(2), valueInteger(1), 'closed GETUP loads the current dirty register word');
		if (port === 'closed-write') assert.equal(frame.registers.get(5), valueInteger(9), 'closed SETUP is not overwritten by a stale cached register');
		if (port === 'read-pc') assert.equal(frame.registers.get(2), valueInteger(start + 3 * INSTRUCTION_BYTES), 'open GETUP observes its advanced PC');
		if (port === 'read-top') assert.equal(frame.registers.get(2), valueInteger(6), 'open GETUP observes the prefix register extent');
		if (port === 'write-pc') assert.equal(frame.registers.get(3), valueInteger(60), 'SETUP takes the written PC, not its warmed fallthrough');
		assert.equal(setup.linkedBlock?.firstWord, firstWord + 4, 'alternate destinations do not replace the canonical continuation');
	}
});

test('an empty compiled open VARARG changes top without touching or growing the destination range', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.VARARG, 31, 0, 0);
	writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 4 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		cpu.rootThread.frameAtDepth(0).registers.setInteger(0, 73); cpu.runUntilDepth(0, 600);
	}
	assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	const frame = js.rootThread.frameAtDepth(0);
	assert.equal(frame.top, 31); assert.equal(frame.stackCapacity, 4); assert.equal(frame.registers.get(0), valueInteger(73));
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = frame.decodedPage!.compiledBlocks!.entries[entry]!;
	assert.equal(block.sourceWords, 2);
	assert.equal(block.region.requiredSlots, 0, 'the dynamic range is not part of the fixed extent');
});

test('a fresh frame grows through scalar VARARG before using a warm generated region', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.VARARG, 12, 5, 0);
	writeInstruction(text, 1, OpCode.MOV, 0, 15, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 8, isVararg: true }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const scalar = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	runCpuParity(js, scalar, 1200);
	const root = js.rootThread.frameAtDepth(0), start = image.image.functions[0].codeAddress;
	const at = (start & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const entries = root.decodedPage!.compiledBlocks!.entries;
	const block = entries[at]!, continuation = entries[at + 1]!;
	assert.equal(block.region, continuation.region);
	assert.equal(root.stackCapacity, 16);
	const region = block.region, execute = region.execute;
	let firstEntry = -1;
	Object.defineProperty(region, 'execute', { value: (...args: Parameters<typeof execute>) => {
		assert.equal(args[3].stackCapacity, 16, 'the growing VARARG must run before any public entry of the warm region');
		if (firstEntry < 0) firstEntry = args[4];
		return execute(...args);
	} });
	for (const cpu of [js, scalar]) {
		cpu.beginCompletionCall(cpu.rootThread.frameAtDepth(0).closure, [11, 22, 33, 44].map(valueInteger));
		assert.equal(cpu.rootThread.frameAtDepth(1).stackCapacity, 8);
	}
	const loop = BASE_CYCLES[OpCode.VARARG] + 4 + BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP];
	runCpuParity(js, scalar, 4 * loop, 1);
	assert.equal(firstEntry, continuation.entry, 'the generated continuation accepts the exact grown window');
	assert.equal(js.readFrameRegister(1, 0), valueInteger(44));
	assert.deepEqual(js.captureRuntimeState(), scalar.captureRuntimeState());
});

for (const fixed of [0, 5]) test(`hot VARARG handles exact top resets, nil padding and stack relocation (B=${fixed})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 20, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 0, 20, 0);
	writeInstruction(text, 3, OpCode.CALL, 0, 0, 2);
	writeInstruction(text, 4, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 16, OpCode.K1, 1, 0, 0);
	writeInstruction(text, 17, OpCode.K1, 7, 0, 0);
	writeInstruction(text, 18, OpCode.VARARG, 2, fixed === 0 ? 0 : fixed + 1, 0);
	writeInstruction(text, 19, OpCode.MOV, 0, 7, 0);
	writeInstruction(text, 20, OpCode.MOV, 1, 2, 0);
	writeInstruction(text, 21, OpCode.VARARG, 0, 0, 0);
	writeInstruction(text, 22, OpCode.JMP, 0, 63, 57, 255);
	writeInstruction(text, 24, OpCode.RET, 0, 2, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 160 },
		{ firstWord: 16, wordCount: 9, maxStack: 16, isVararg: true }],
		closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		cpu.runUntilDepth(0, 2);
		cpu.rootThread.frameAtDepth(0).top = 1;
		cpu.runUntilDepth(0, 9002);
	}
	const first = js.rootThread.frameAtDepth(1), page = first.decodedPage!;
	const entry = (image.image.functions[1].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = page.compiledBlocks!.entries[entry]!;
	assert.ok(block.sourceWords >= 7, 'varargs and the following branch stay in generated code');
	for (const count of [0, 2, 63]) {
		for (const cpu of [js, ref]) {
			const closure = cpu.rootThread.frameAtDepth(1).closure;
			cpu.writeFrameExecution(1, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[1], image.image.functions[1].codeAddress + 8 * INSTRUCTION_BYTES);
			assert.equal(cpu.runUntilDepth(1, 2), RunResult.Halted);
			const root = cpu.rootThread.frameAtDepth(0);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES);
			root.registers.setClosure(0, closure);
			for (let i = 0; i < count; ++i) root.registers.set(i + 1, i === 0 ? valueBool(false) : i === 1 ? valueNil() : valueInteger(i));
			root.top = count + 1;
			assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded);
			assert.equal(cpu.rootThread.frameAtDepth(1).varargCount, count);
		}
		runCpuParity(js, ref, 9);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState(), 'a full hot-block grant also covers the growing exit');
		for (const grant of [0, 1, 1, 2, 1, 1, 2, 1]) {
			runCpuParity(js, ref, grant);
			assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		}
		const secondVarargEnd = image.image.functions[1].codeAddress + 6 * INSTRUCTION_BYTES;
		while (js.rootThread.frameAtDepth(1).pc !== secondVarargEnd) {
			runCpuParity(js, ref, 1);
			assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		}
		if (count === 63) assert.ok(js.rootThread.frameAtDepth(1).stackCapacity > 16);
		assert.equal(js.rootThread.frameAtDepth(1).top, count, 'the second open VARARG replaces, rather than maximizes, top');
		assert.equal(page.compiledBlocks!.entries[entry]!.region.entries[0].sourceWords, 7,
			'the complete generated loop survives frame relocation and added helper-resume entries');
	}
});
