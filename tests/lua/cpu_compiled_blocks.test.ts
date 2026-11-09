import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult, type CPU } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32, linkTestSystemBlua32 } from '../helpers/blua32';
import { LUA_FAULT_REASON_CALL_NON_FUNCTION } from '../../machine/ts/spec/blua32/cop0';
import { BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { readLE32 } from '../../machine/ts/common/endian';
import { compileLuaSource } from './cpu_test_harness';

function compiledEntries(cpu: CPU): number {
	let count = 0;
	for (const frame of cpu.rootThread.frames) {
		for (const page of frame.executionImage.decodedPages.values()) {
			if (page.compiledBlocks === null) continue;
			for (const block of page.compiledBlocks.entries) if (block !== null) ++count;
		}
	}
	return count;
}

function loopImage() {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 1, OpCode.ADD, 1, 1, 0);
	writeInstruction(text, 2, OpCode.SHL, 2, 1, 0);
	writeInstruction(text, 3, OpCode.BXOR, 3, 2, 0);
	writeInstruction(text, 4, OpCode.WIDE, 1, 0, 0);
	writeInstruction(text, 5, OpCode.MOV, 0, 3, 0);
	writeInstruction(text, 6, OpCode.JMP, 0, 63, 57, 255); // -7 words
	return linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 7, maxStack: 257 }] });
}

test('generated JavaScript warms within one slice and preserves every budget boundary and WIDE extent', () => {
	const image = loopImage();
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image).cpu;
	for (const cpu of [js, ref]) cpu.rootThread.frames[0].registers.setNumber(1, 0);
	for (const grant of [600, ...Array.from({ length: 40 }, (_, i) => [0, 1, 2, 3, 5, 6, 7, 63, 257][i % 9])]) {
		assert.equal(js.runUntilDepth(0, grant), ref.runUntilDepth(0, grant));
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState(), `full CPU state at grant ${grant}`);
		assert.equal(js.instructionBudgetRemaining, ref.instructionBudgetRemaining);
	}
	assert.ok(compiledEntries(js) > 0, 'the JavaScript backend really installed generated functions');
});

test('generated moves retain reference values, string ids, boolean kinds and constant payloads', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.MOV, 4, 0, 0);
	writeInstruction(text, 1, OpCode.LOADK, 5, 0, 0);
	writeInstruction(text, 2, OpCode.KNIL, 6, 0, 0);
	writeInstruction(text, 3, OpCode.KFALSE, 7, 0, 0);
	writeInstruction(text, 4, OpCode.KTRUE, 8, 0, 0);
	writeInstruction(text, 5, OpCode.K0, 9, 0, 0);
	writeInstruction(text, 6, OpCode.KM1, 10, 0, 0);
	writeInstruction(text, 7, OpCode.KSMI, 11, 63, 62, 255);
	writeInstruction(text, 8, OpCode.JMP, 0, 63, 55, 255);
	for (const constant of [null, false, true, 'literal', -0, NaN, Infinity]) {
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 9, maxStack: 12 }], constants: [constant] });
		const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
		const ref = createTestSystemCpu(image).cpu;
		for (const cpu of [js, ref]) cpu.rootThread.frames[0].registers.setTable(0, cpu.createTable(0, 0));
		js.runUntilDepth(0, 900);
		ref.runUntilDepth(0, 900);
		assert.ok(compiledEntries(js) > 0);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		const registers = js.rootThread.frames[0].registers;
		assert.equal(registers.getTable(4), registers.getTable(0));
		assert.equal(registers.getTag(7), ValueTag.False);
		assert.equal(registers.getTag(8), ValueTag.True);
		assert.equal(registers.getNumber(11), -2);
	}
});

for (const op of [OpCode.ADD, OpCode.SUB, OpCode.MUL, OpCode.DIV, OpCode.BAND, OpCode.BOR, OpCode.BXOR, OpCode.SHL, OpCode.SHR, OpCode.UNM, OpCode.BNOT]) {
	test(`generated opcode ${OpCode[op]} agrees with scalar dispatch for numeric edges, non-Numbers and destination aliases`, () => {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		const values = [0, -0, 0.25, -0.75, 1, -1, 31, 32, 2147483648, -2147483648,
			4294967295, -4294967296.75, 4294967296.25, 1e100, -1e100, Number.MIN_VALUE,
			Infinity, -Infinity, NaN, null, false, true];
		for (const destination of [0, 1, 2]) {
			writeInstruction(text, 0, op, destination, 0, 1);
			writeInstruction(text, 1, OpCode.MOV, 3, destination, 0);
			writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
			const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 4 }] });
			const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
			const ref = createTestSystemCpu(image).cpu;
			for (const cpu of [js, ref]) cpu.runUntilDepth(0, 90);
			assert.ok(compiledEntries(js) > 0);
			for (const left of values) for (const right of values) {
				for (const cpu of [js, ref]) {
					cpu.rootThread.frames[0].registers.set(0, left);
					cpu.rootThread.frames[0].registers.set(1, right);
				}
				assert.equal(js.runUntilDepth(0, 3), ref.runUntilDepth(0, 3));
				for (let register = 0; register < 4; ++register) {
					assert.equal(js.readFrameRegister(0, register), ref.readFrameRegister(0, register));
				}
			}
		}
	});
}

test('writes to cached RAM source retire generated functions before the next execution', () => {
	const image = loopImage();
	const { cpu, memory } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const code = image.romBytes.subarray(image.image.functions[0].codeAddress - SYSTEM_ROM_BASE);
	// Relative JMP targets are decoded at the RAM address, not the ROM address.
	memory.writeBytes(DYNAMIC_RAM_BASE, code.subarray(0, MAPPED_PAGE_BYTE_SIZE));
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
	cpu.rootThread.frames[0].registers.setNumber(1, 0);
	cpu.runUntilDepth(0, 600);
	assert.ok(compiledEntries(cpu) > 0);
	const replacement = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(replacement, 0, OpCode.KM1, 0, 0, 0);
	memory.writeBytes(DYNAMIC_RAM_BASE, replacement);
	assert.equal(compiledEntries(cpu), 0);
	cpu.runUntilDepth(0, 6);
	assert.equal(cpu.readFrameRegister(0, 0), -1);
});

test('generated RK constants preserve numeric kind checks and signed selectors', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.ADD, 0, 63, 62, 63); // K[0] + K[1]
	writeInstruction(text, 1, OpCode.SHL, 1, 63, 62, 63);
	writeInstruction(text, 2, OpCode.DIV, 2, 63, 62, 63);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	for (const left of [null, false, true, '7', -0, NaN, Infinity, -4294967296.75]) {
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 3 }], constants: [left, -1] });
		const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
		const ref = createTestSystemCpu(image).cpu;
		js.runUntilDepth(0, 400);
		ref.runUntilDepth(0, 400);
		assert.ok(compiledEntries(js) > 0);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	}
});

test('sparse observation and instrumented stops retire or bypass compiled blocks without lost instruction boundaries', () => {
	const image = loopImage();
	const cpu = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	cpu.rootThread.frames[0].registers.setNumber(1, 0);
	cpu.runUntilDepth(0, 600);
	assert.ok(compiledEntries(cpu) > 0);
	const observedPc = image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES;
	const observed: number[] = [];
	cpu.setInstructionObserver({ points: [new Set([observedPc]), new Set(), new Set()], observe(_domain, pc) { observed.push(pc); } });
	assert.equal(compiledEntries(cpu), 0);
	for (let i = 0; i < 20; ++i) cpu.runUntilDepth(0, 6);
	assert.equal(observed.length, 20);
	cpu.setInstructionObserver(null);
	cpu.runUntilDepth(0, 600);
	assert.ok(compiledEntries(cpu) > 0);
	cpu.setExecutionHook((_domain, pc) => pc === observedPc, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.ExecutionStopped);
	assert.equal(cpu.readFramePc(0), observedPc);
	assert.equal(observed.length, 20);
});

test('compiled loops and repeated calls replay the full state through short grants and restore', () => {
	const image = linkTestSystemBlua32(compileLuaSource(`
local function step(x) return ((x << 1) ~ 3) + 1 end
local n = 1
for i = 1, 200 do n = step(n) end
return n
`, 'generated-calls.lua'));
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image).cpu;
	let result = RunResult.Yielded;
	let installed = 0;
	for (let slice = 0; slice < 1000 && result === RunResult.Yielded; ++slice) {
		const grant = slice % 3 === 0 ? 200 : 7;
		result = js.runUntilDepth(0, grant);
		assert.equal(result, ref.runUntilDepth(0, grant));
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		installed = Math.max(installed, compiledEntries(js));
		if (slice === 8) {
			const saved = js.captureRuntimeState();
			js.restoreRuntimeState(saved);
			assert.deepEqual(js.captureRuntimeState(), saved);
		}
	}
	assert.equal(result, RunResult.Halted);
	assert.ok(installed > 0, 'hot callee code and loop bodies actually use generated execution');
});

for (const op of [OpCode.JMPIF, OpCode.JMPIFNOT]) test(`generated conditional ${op} retains truthiness and exact taken/fallthrough state`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.NOT, 2, 0, 0);
	writeInstruction(text, 1, op, 63, 0, 2);
	writeInstruction(text, 2, OpCode.K1, 3, 0, 0);
	writeInstruction(text, 3, OpCode.JMP, 0, 0, 1);
	writeInstruction(text, 4, OpCode.KM1, 3, 0, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 64 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image).cpu;
	for (const cpu of [js, ref]) cpu.runUntilDepth(0, 600);
	assert.ok(compiledEntries(js) > 0);
	for (const value of [null, false, true, 0, -0, NaN, Infinity, -1]) {
		for (let grant = 1; grant <= 30; ++grant) {
			for (const cpu of [js, ref]) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
				const registers = cpu.rootThread.frames[0].registers;
				registers.set(0, value);
				registers.set(63, value);
			}
			assert.equal(js.runUntilDepth(0, grant), ref.runUntilDepth(0, grant));
			assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
			assert.equal(js.instructionBudgetRemaining, ref.instructionBudgetRemaining);
		}
	}
});

for (const standalone of [false, true]) test(`generated HALT commits its thread/depth latch and resumes after NMI (standalone: ${standalone})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 1, OpCode.NOT, 1, 0, 0);
	writeInstruction(text, 2, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 3, OpCode.HALT, 63, 63, 63, 255);
	writeInstruction(text, 4, OpCode.KSMI, 2, 0, 7);
	writeInstruction(text, 5, OpCode.RET, 2, 1, 0);
	writeInstruction(text, 6, OpCode.RFE, 0, 0, 0);
	writeInstruction(text, 7, OpCode.KSMI, 0, 0, 9);
	writeInstruction(text, 8, OpCode.RET, 0, 1, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 6, maxStack: 3 }, { firstWord: 6, wordCount: 1 }, { firstWord: 7, wordCount: 2 },
	], exceptionFunctionIndex: 1, irqFunctionIndex: 1 });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image).cpu;
	const entry = image.image.functions[0].codeAddress;
	const startPc = entry + (standalone ? 2 : 0) * INSTRUCTION_BYTES;
	const grant = standalone ? 1 : 3;
	for (let warmup = 0; warmup < 20; ++warmup) {
		for (const cpu of [js, ref]) {
			cpu.clearHaltUntilIrq();
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], startPc);
			assert.equal(cpu.runUntilDepth(0, grant), RunResult.Halted);
			assert.equal(cpu.instructionBudgetRemaining, 0);
			assert.equal(cpu.readFramePc(0), entry + 4 * INSTRUCTION_BYTES);
			assert.equal(cpu.isHaltedUntilIrq(), true);
		}
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	}
	const page = js.rootThread.frames[0].decodedPage!;
	const block = page.compiledBlocks!.entries[(startPc & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
	assert.equal(block.exit, CompiledBlockExit.Halt, 'the executed HALT is a generated exit, not interpreter dispatch');
	for (const cpu of [js, ref]) {
		const saved = cpu.captureRuntimeState();
		cpu.restoreRuntimeState(saved);
		assert.equal(cpu.isHaltedUntilIrq(), true);
		const depth = cpu.getFrameDepth();
		cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[2]);
		assert.equal(cpu.runUntilDepth(depth, 100), RunResult.Halted);
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.isHaltedUntilIrq(), true, 'returning from a deeper tooling call restores the root HALT condition');
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), true);
		assert.equal(cpu.isHaltedUntilIrq(), false);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assert.equal(cpu.getFrameDepth(), 0);
	}
	assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
});

test('a generated terminal WIDE instruction can straddle pages and retires when its body changes', () => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }] });
	const { cpu, memory } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const pc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - INSTRUCTION_BYTES;
	const code = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 1, OpCode.HALT, 0, 0, 0);
	memory.writeBytes(pc, code);
	for (let warmup = 0; warmup < 20; ++warmup) {
		cpu.clearHaltUntilIrq();
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Halted);
		assert.equal(cpu.readFramePc(0), pc + 2 * INSTRUCTION_BYTES);
	}
	const head = cpu.rootThread.frames[0].executionImage.decodedPages;
	assert.ok([...head.values()].some(page => page.compiledBlocks?.entries[255]?.exit === CompiledBlockExit.Halt));
	writeInstruction(code, 1, OpCode.KM1, 0, 0, 0);
	memory.writeBytes(pc + INSTRUCTION_BYTES, code.subarray(INSTRUCTION_BYTES));
	assert.equal(compiledEntries(cpu), 0);
	cpu.clearHaltUntilIrq();
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
	assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
	assert.equal(cpu.readFrameRegister(0, 0), -1);
});

test('source writes retire overlapping blocks without discarding independent code on the same page', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	for (const start of [0, 8]) {
		writeInstruction(text, start, OpCode.K1, 0, 0, 0);
		writeInstruction(text, start + 1, OpCode.ADD, 1, 0, 0);
		writeInstruction(text, start + 2, OpCode.JMP, 0, 63, 61, 255);
	}
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 11, maxStack: 2 }] });
	const { cpu, memory } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	memory.writeBytes(DYNAMIC_RAM_BASE, text);
	for (const start of [0, 8]) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE + start * INSTRUCTION_BYTES);
		cpu.runUntilDepth(0, 300);
	}
	const page = cpu.rootThread.frames[0].decodedPage!;
	const preserved = page.compiledBlocks!.entries[0];
	assert.ok(preserved !== null && page.compiledBlocks!.entries[8] !== null);
	writeInstruction(text, 9, OpCode.SUB, 1, 0, 0);
	memory.writeBytes(DYNAMIC_RAM_BASE + 9 * INSTRUCTION_BYTES, text.subarray(9 * INSTRUCTION_BYTES, 10 * INSTRUCTION_BYTES));
	assert.equal(page.compiledBlocks!.entries[0], preserved);
	assert.equal(page.compiledBlocks!.entries[8], null);
	assert.equal(cpu.runUntilDepth(0, 3), RunResult.Yielded);
	assert.equal(cpu.readFrameRegister(0, 1), 0);
});

for (const wide of [false, true]) test(`generated CALL/RET preserve full state and fault boundaries (WIDE: ${wide})`, () => {
	const callBody = wide ? 4 : 3;
	const calleeStart = callBody + 3;
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 4, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 0, 4, 0);
	if (wide) writeInstruction(text, 3, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, callBody, OpCode.CALL, 0, 1, 1);
	writeInstruction(text, callBody + 1, OpCode.MOV, 6, 0, 0);
	writeInstruction(text, callBody + 2, OpCode.JMP, 0, 63, wide ? 59 : 60, 255);
	writeInstruction(text, calleeStart, OpCode.K1, 0, 0, 0);
	writeInstruction(text, calleeStart + 1, OpCode.RET, 0, 1, 0);
	writeInstruction(text, calleeStart + 2, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: calleeStart, maxStack: 8 }, { firstWord: calleeStart, wordCount: 2 }, { firstWord: calleeStart + 2, wordCount: 1 },
	], exceptionFunctionIndex: 2, closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image).cpu;
	for (const cpu of [js, ref]) assert.equal(cpu.runUntilDepth(0, 10001), RunResult.Yielded);
	assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	const executionImage = js.rootThread.frames[0].executionImage;
	const exits = new Set([...executionImage.decodedPages.values()].flatMap(page => page.compiledBlocks?.entries.filter(block => block !== null).map(block => block!.exit) ?? []));
	assert.ok(exits.has(CompiledBlockExit.Call) && exits.has(CompiledBlockExit.Return), 'both sides of the call use generated exits');
	for (const cpu of [js, ref]) {
		assert.equal(cpu.getFrameDepth(), 1);
		assert.equal(cpu.runUntilDepth(0, 3), RunResult.Yielded);
		assert.equal(cpu.getFrameDepth(), 2);
		assert.equal(cpu.rootThread.frames[1].callSitePc, image.image.functions[0].codeAddress + callBody * INSTRUCTION_BYTES);
		assert.equal(cpu.runUntilDepth(0, 5), RunResult.Yielded);
		assert.equal(cpu.getFrameDepth(), 1);
		cpu.rootThread.frames[0].registers.setNumber(4, 77);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_CALL_NON_FUNCTION);
		assert.equal(cpu.readEpcWord(), image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES);
		assert.equal(cpu.readFrameRegister(0, 6), 1);
	}
	assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
});

test('a compiled CALL completes after a mapped record read replaces its source instruction', () => {
	const recordAddress = 0x08005000;
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 4, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 0, 4, 0);
	writeInstruction(text, 3, OpCode.CALL, 0, 1, 1);
	writeInstruction(text, 4, OpCode.MOV, 6, 0, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 6, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 7, OpCode.RET, 0, 1, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 6, maxStack: 8 }, { firstWord: 6, wordCount: 2 },
	], closureRelocations: [{ wordIndex: 1, functionAddress: recordAddress }] });
	const states = [];
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu, memory } = createTestSystemCpu(image, backend);
		const entry = image.image.functions[0].codeAddress - SYSTEM_ROM_BASE;
		memory.writeBytes(DYNAMIC_RAM_BASE, image.romBytes.subarray(entry, entry + text.length));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		const replacement = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(replacement, 0, OpCode.HALT, 0, 0, 0);
		const source = { armed: false, writes: 0 };
		const record = image.symbols.functionAddresses[1] - SYSTEM_ROM_BASE;
		for (let offset = 0; offset <= BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET; offset += 4) {
			memory.mapIoRead(recordAddress + offset, source, (source, address) => {
				const offset = address - recordAddress;
				if (source.armed && offset === BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET) {
					source.armed = false;
					++source.writes;
					memory.writeBytes(DYNAMIC_RAM_BASE + 3 * INSTRUCTION_BYTES, replacement);
				}
				return readLE32(image.romBytes, record + offset);
			});
		}
		assert.equal(cpu.runUntilDepth(0, 10001), RunResult.Yielded);
		const page = cpu.rootThread.frames[0].decodedPage!;
		if (backend === CpuExecutionBackend.JavaScript) assert.equal(page.compiledBlocks!.entries[2]!.exit, CompiledBlockExit.Call);
		source.armed = true;
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assert.equal(source.writes, 1);
		assert.equal(cpu.instructionBudgetRemaining, 90);
		assert.equal(cpu.readFramePc(0), DYNAMIC_RAM_BASE + 4 * INSTRUCTION_BYTES);
		assert.equal(cpu.readFrameRegister(0, 6), 1);
		if (backend === CpuExecutionBackend.JavaScript) assert.equal(page.compiledBlocks!.entries[2], null);
		states.push(cpu.captureRuntimeState());
	}
	assert.deepEqual(states[1], states[0]);
});
