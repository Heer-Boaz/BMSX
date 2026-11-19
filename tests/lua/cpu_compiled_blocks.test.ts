import { allocatedObjectRecords } from '../helpers/cpu_execution';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeRegisterPayloadReads, observeRegisterStores, runCpuParity } from '../helpers/cpu_execution';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { RunResult, type CPU } from '../../machine/ts/machine/cpu/cpu';
import { COMPILED_BLOCK_THRESHOLD, CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { integerConstant, numberConstantFromHost } from '../../toolchain/ts/lua/number';
import { COP0_EPC, LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { ValueTag, valueBool, valueFloat, valueFloatBits, valueNil, valueInteger } from '../../machine/ts/machine/cpu/value';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { RAM_CODE_FIXTURE_BYTES, createTestSystemCpu, linkRawTestSystemBlua32, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';
import { compileCoroutineTest } from '../helpers/coroutine';
import { luaFloorDivide, luaModulo } from '../../machine/ts/spec/blua32/numeric';
import { luaPow } from '../../machine/ts/spec/blua32/pow';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import type { Blua32ExecutionImage } from '../../machine/ts/machine/cpu/execution_image';

function compiledEntries(cpu: CPU): number {
	let count = 0;
	for (let frame = cpu.rootThread.currentFrame; frame !== null; frame = frame.previous) {
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
	return linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 7, maxStack: 257 }] }, RAM_CODE_FIXTURE_BYTES);
}

test('an unconfigured Runtime interprets while the selected JavaScript backend generates code at the same guest cost', () => {
	const address = DYNAMIC_RAM_BASE + 0x1000;
	const image = linkTestSystemBlua32(compileLuaSource(`
local n = 0
for i = 1, 256 do n = n + i; mem32le[${address}] = n end
return n`, 'cpu-default.lua'));
	const rom = new Uint8Array((image.romBytes.length + MAPPED_PAGE_BYTE_SIZE - 1) & -MAPPED_PAGE_BYTE_SIZE);
	rom.set(image.romBytes);
	const options = { systemRomBytes: rom, cartridgeSlots: [null, null] as [null, null], machineModel: PSX_MACHINE_SPEC };
	const input = { sampleInputControllerSnapshot: () => {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect: () => {} };
	const fast = new Runtime({ ...options, cpuExecutionBackend: CpuExecutionBackend.JavaScript }, input), scalar = new Runtime(options, input);
	const images: Blua32ExecutionImage[] = [], charges: number[] = [];
	for (const runtime of [fast, scalar]) {
		runtime.boot(); const cpu = runtime.machine.cpu;
		images.push(cpu.rootThread.frameAtDepth(0).executionImage);
		let result = RunResult.Yielded, cycles = 0;
		while (result === RunResult.Yielded) { result = cpu.runUntilDepth(0, 31); cycles += 31 - cpu.instructionBudgetRemaining; }
		charges.push(cycles);
		assert.equal(result, RunResult.Halted); assert.deepEqual(runtime.readCompletionValues(), [valueInteger(32896)]);
		assert.equal(runtime.machine.memory.readMappedWord(address), 32896);
	}
	assert.deepEqual(captureRuntimeSaveState(fast), captureRuntimeSaveState(scalar));
	assert.equal(charges[0], charges[1], 'the complete program retains its guest-cycle cost');
	let generated = 0;
	for (const page of images[0].decodedPages.values()) if (page.compiledBlocks !== null) {
		for (const block of page.compiledBlocks.entries) if (block !== null) ++generated;
	}
	assert.ok(generated > 0, 'the JavaScript Runtime must actually execute the codegen route');
	for (const page of images[1].decodedPages.values()) assert.equal(page.compiledBlocks, null, 'the default Runtime interprets');
});

test('generated JavaScript warms within one slice and preserves every admitted segment and WIDE extent', () => {
	const image = loopImage();
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) cpu.rootThread.frameAtDepth(0).registers.setInteger(1, 0);
	for (const grant of [600, ...Array.from({ length: 40 }, (_, i) => [0, 1, 2, 3, 5, 6, 7, 63, 257][i % 9])]) {
		runCpuParity(js, ref, grant);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState(), `full CPU state at grant ${grant}`);
	}
	assert.ok(compiledEntries(js) > 0, 'the JavaScript backend really installed generated functions');
});

test('a short grant stops before an unadmitted compiled allocation', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 1, OpCode.MOV, 1, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 2, 0, 0);
	writeInstruction(text, 3, OpCode.NEWT, 3, 0, 0);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 5 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1000);
	}
	assert.ok(compiledEntries(machines[0].cpu) > 0);
	for (const grant of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15]) {
		for (const { cpu } of machines) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
			cpu.rootThread.frameAtDepth(0).registers.clear(4, 0);
		}
		const [generated, reference] = machines.map(({ cpu }) => cpu.runUntilDepth(0, grant));
		assert.equal(generated, reference, `outcome at grant ${grant}`);
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining,
			`cycle charge at grant ${grant}`);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState(),
			`visible state and allocation identity at grant ${grant}`);
	}
});

test('a short grant stops before an unadmitted inline RAM store', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE), target = DYNAMIC_RAM_BASE + 0x20000;
	writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 1, OpCode.MOV, 1, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 2, 0, 0);
	writeInstruction(text, 3, OpCode.STORE_MEM, 5, 4, MemoryAccessKind.U32LE);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 6 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		const registers = cpu.rootThread.frameAtDepth(0).registers;
		registers.setInteger(4, target); registers.setInteger(5, 0x12345678);
		cpu.runUntilDepth(0, 1000);
	}
	assert.ok(compiledEntries(machines[0].cpu) > 0);
	for (const grant of [1, 2, 4, 6, 7, 8, 9, 10, 12]) {
		for (const { cpu, memory } of machines) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
			memory.writeU32(target, 0);
		}
		const [generated, reference] = machines.map(({ cpu }) => cpu.runUntilDepth(0, grant));
		assert.equal(generated, reference);
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.equal(machines[0].memory.readU32(target), machines[1].memory.readU32(target), `store at grant ${grant}`);
	}
});

test('one admitted compiled NEWT completes even when it exhausts its grant', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.NEWT, 0, 0, 0);
	writeInstruction(text, 1, OpCode.MOV, 1, 0, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 3 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1000);
	}
	assert.ok(compiledEntries(machines[0].cpu) > 0);
	for (const { cpu } of machines) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		const before = allocatedObjectRecords(cpu).length;
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.NEWT]);
		assert.equal(allocatedObjectRecords(cpu).length, before + 1);
		assert.equal(cpu.readFramePc(0), DYNAMIC_RAM_BASE + INSTRUCTION_BYTES);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

test('open VARARG work is charged before admitting a later compiled allocation', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 3, 0, 0);
	writeInstruction(text, 1, OpCode.VARARG, 4, 0, 0);
	writeInstruction(text, 2, OpCode.NEWT, 7, 0, 0);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 8, isVararg: true }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		const frame = cpu.rootThread.frameAtDepth(0);
		memory.writeRamRecordWord(frame.controlOffset + FrameField.VarargBase, 0);
		memory.writeRamRecordWord(frame.controlOffset + FrameField.VarargCount, 3);
		frame.registers.setInteger(0, 11); frame.registers.setInteger(1, 22); frame.registers.setInteger(2, 33);
		cpu.runUntilDepth(0, 1000);
	}
	assert.ok(compiledEntries(machines[0].cpu) > 0);
	const entry = machines[0].cpu.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries[0]!;
	assert.ok(entry.admissionVarargs > 0, 'the compiled continuation includes the open vararg charge');
	for (const grant of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15]) {
		for (const { cpu } of machines) cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID,
			image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		const [generated, reference] = machines.map(({ cpu }) => cpu.runUntilDepth(0, grant));
		assert.equal(generated, reference);
		assert.equal(machines[0].cpu.instructionBudgetRemaining, machines[1].cpu.instructionBudgetRemaining,
			`open vararg cycle charge at grant ${grant}`);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState(),
			`open vararg state and allocation identity at grant ${grant}`);
	}
});

for (const op of [OpCode.SHR, OpCode.MOD, OpCode.FLOORDIV, OpCode.POW]) test(`multiple numeric definitions stay local across opcode ${op} and copies until the actual exit`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 1, OpCode.KSMI, 1, 0, 5);
	writeInstruction(text, 2, OpCode.ADD, 2, 0, 1);
	writeInstruction(text, 3, OpCode.ADD, 0, 0, 1);
	writeInstruction(text, 4, OpCode.ADD, 1, 2, 1);
	writeInstruction(text, 5, OpCode.MUL, 2, 0, 1);
	writeInstruction(text, 6, OpCode.ADD, 0, 0, 2);
	writeInstruction(text, 7, OpCode.MOV, 3, 2, 0);
	writeInstruction(text, 8, op, 2, 2, 0);
	writeInstruction(text, 9, OpCode.MOV, 4, 0, 0);
	writeInstruction(text, 10, OpCode.ADD, 0, 0, 1);
	writeInstruction(text, 11, OpCode.JMP, 0, 63, 52, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 12, maxStack: 5 }] }, RAM_CODE_FIXTURE_BYTES);
	const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	cpu.runUntilDepth(0, 1200);
	const frame = cpu.rootThread.frameAtDepth(0), page = frame.decodedPage!;
	const block = page.compiledBlocks!.entries[(image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
	assert.equal(block.sourceWords, 12);
	const r = frame.registers;
	let reads = 0, writes = 0;
	observeRegisterPayloadReads(r, () => { ++reads; });
	observeRegisterStores(r, () => { ++writes; });
	assert.equal(block.region.exits[block.region.execute(r, frame.executionImage.constWords, page, frame, block.entry, { remainingCycles: 1, registerTop: frame.top, memoryAddress: 0, lengthWork: { probes: 0 } })].nextPc, image.image.functions[0].codeAddress);
	assert.equal(reads, 0, 'the generated block consumes local numeric definitions, not their stale slot values');
	assert.equal(writes, 5, 'each final numeric slot is published once instead of after every instruction');
	const result = op === OpCode.SHR ? 0 : op === OpCode.MOD ? luaModulo(66, 72)
		: op === OpCode.FLOORDIV ? luaFloorDivide(66, 72) : luaPow(66, 72);
	assert.deepEqual(Array.from({ length: 5 }, (_, index) => r.get(index)), [valueInteger(83), valueInteger(11),
		op === OpCode.POW ? valueFloat(result) : valueInteger(result), valueInteger(66), valueInteger(72)],
		'a copied value retains its definition after its source register is reassigned');
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
	for (const constant of [null, false, true, 'literal', integerConstant(0), ...[-0, NaN, Infinity].map(numberConstantFromHost)]) {
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 9, maxStack: 12 }], constants: [constant] }, RAM_CODE_FIXTURE_BYTES);
		const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
		const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
		for (const cpu of [js, ref]) cpu.rootThread.frameAtDepth(0).registers.setTable(0, cpu.createTable(0, 0));
		runCpuParity(js, ref, 900);
		assert.ok(compiledEntries(js) > 0);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		const registers = js.rootThread.frameAtDepth(0).registers;
		assert.equal(registers.getPayload(4), registers.getPayload(0));
		assert.equal(registers.getTag(7), ValueTag.False);
		assert.equal(registers.getTag(8), ValueTag.True);
		assert.equal(registers.getInteger(11), -2);
	}
});

for (const op of [OpCode.ADD, OpCode.SUB, OpCode.MUL, OpCode.DIV, OpCode.MOD, OpCode.FLOORDIV, OpCode.POW,
	OpCode.BAND, OpCode.BOR, OpCode.BXOR, OpCode.SHL, OpCode.SHR, OpCode.UNM, OpCode.BNOT]) {
	test(`generated opcode ${op} agrees with scalar dispatch for numeric edges, non-Numbers and destination aliases`, () => {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		const values = [...[0, 1, -1, 31, 32, 16777217, 2147483647, -2147483648].map(valueInteger),
			...[-0, 0, 0.25, -0.75, 0.05, 1 / 12, 2147483648, 4294967296, -4294967296, Infinity, -Infinity].map(valueFloat),
			valueFloatBits(1), valueFloatBits(0x7f7fffff), valueFloatBits(0xffa12345), valueNil(), valueBool(false), valueBool(true)];
		for (const destination of [0, 1, 2]) {
			writeInstruction(text, 0, op, destination, 0, 1);
			writeInstruction(text, 1, OpCode.MOV, 3, destination, 0);
			writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
			const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 4 },
				writeSkipFaultInstructionHandler(text, 3)], exceptionFunctionIndex: 1 }, RAM_CODE_FIXTURE_BYTES);
			const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
			const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
			const pc = image.image.functions[0].codeAddress;
			// Warm the actual arithmetic entry with valid inputs even for in-place MOD/DIV.
			for (let pass = 0; pass <= COMPILED_BLOCK_THRESHOLD; ++pass) {
				for (const cpu of [js, ref]) {
					const r = cpu.rootThread.frameAtDepth(0).registers;
					r.setInteger(0, 3); r.setInteger(1, 2);
					cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
				}
				runCpuParity(js, ref, BASE_CYCLES[op] + BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP]);
			}
			assert.ok(compiledEntries(js) > 0);
			const frame = js.rootThread.frameAtDepth(0);
			const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
			assert.equal(frame.decodedPage!.compiledBlocks!.entries[entry]!.sourceWords, 3,
				'the numeric opcode itself executes inside the generated body');
			for (const left of values) for (const right of values) {
				for (const cpu of [js, ref]) {
					cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
					const r = cpu.rootThread.frameAtDepth(0).registers;
					r.set(0, left); r.set(1, right); r.setInteger(2, 91); r.setInteger(3, 97);
				}
				runCpuParity(js, ref, BASE_CYCLES[op] + BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP]);
				assert.equal(js.getFrameDepth(), ref.getFrameDepth());
				if (js.getFrameDepth() === 2) {
					assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
					assert.equal(js.readEpcWord(), pc);
					assert.equal(js.readFrameRegister(0, destination), destination === 0 ? left : destination === 1 ? right : valueInteger(91));
					assert.equal(js.readFrameRegister(0, 3), valueInteger(97), 'neither the failed write nor its following MOV commits');
					runCpuParity(js, ref, 32, 1);
				} else {
					assert.equal(js.readFrameRegister(0, destination), js.readFrameRegister(0, 3));
					assert.equal(js.readFramePc(0), pc);
				}
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
	cpu.rootThread.frameAtDepth(0).registers.setInteger(1, 0);
	cpu.runUntilDepth(0, 600);
	assert.ok(compiledEntries(cpu) > 0);
	const replacement = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(replacement, 0, OpCode.KM1, 0, 0, 0);
	memory.writeBytes(DYNAMIC_RAM_BASE, replacement);
	assert.equal(compiledEntries(cpu), 0);
	cpu.runUntilDepth(0, 6);
	assert.equal(cpu.readFrameRegister(0, 0), valueInteger(-1));
});

// Each instruction in these two generated programs is one word. An invalid
// arithmetic operand raises a real guest trap; advance EPC so the *next*
// dependency and its cycle boundary are exercised too.
function writeSkipFaultInstructionHandler(text: Uint8Array, firstWord: number) {
	writeInstruction(text, firstWord, OpCode.MFC0, 0, COP0_EPC, 0);
	writeInstruction(text, firstWord + 1, OpCode.KSMI, 1, 0, INSTRUCTION_BYTES);
	writeInstruction(text, firstWord + 2, OpCode.ADD, 0, 0, 1);
	writeInstruction(text, firstWord + 3, OpCode.MTC0, 0, COP0_EPC, 0);
	writeInstruction(text, firstWord + 4, OpCode.RFE, 0, 0, 0);
	return { firstWord, wordCount: 5, maxStack: 2 };
}

test('generated RK constants preserve numeric kind checks and signed selectors', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.ADD, 0, 63, 62, 63); // K[0] + K[1]
	writeInstruction(text, 1, OpCode.SHL, 1, 63, 62, 63);
	writeInstruction(text, 2, OpCode.DIV, 2, 63, 62, 63);
	writeInstruction(text, 3, OpCode.MOD, 3, 63, 62, 63);
	writeInstruction(text, 4, OpCode.FLOORDIV, 4, 63, 62, 63);
	writeInstruction(text, 5, OpCode.POW, 5, 63, 62, 63);
	writeInstruction(text, 6, OpCode.JMP, 0, 63, 57, 255);
	const handler = writeSkipFaultInstructionHandler(text, 7);
	for (const left of [integerConstant(-7), null, false, true, '7', ...[-0, NaN, Infinity, -4294967296].map(numberConstantFromHost)]) {
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 7, maxStack: 6 }, handler], exceptionFunctionIndex: 1, constants: [left, integerConstant(-1)] }, RAM_CODE_FIXTURE_BYTES);
		const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
		const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
		const loopCycles = [OpCode.ADD, OpCode.SHL, OpCode.DIV, OpCode.MOD, OpCode.FLOORDIV, OpCode.POW, OpCode.JMP]
			.reduce((cycles, op) => cycles + BASE_CYCLES[op], 0);
		runCpuParity(js, ref, 3 * (COMPILED_BLOCK_THRESHOLD + 1) * loopCycles);
		assert.ok(compiledEntries(js) > 0);
		const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
		const entries = js.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries;
		// RFE can make each successor an entry. Cover the guest operations, not a
		// particular partition of faulting and nonfaulting paths into regions.
		for (let word = 0; word < 7; ++word) {
			assert.ok(entries.slice(entry, entry + word + 1).some((block, start) => block && start + block.sourceWords > word),
				`RK instruction at offset ${word} is present in generated code`);
		}
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	}
});

test('dependent generated instructions preserve live values, raw copies and complete short-grant charges', () => {
	const operations = [OpCode.ADD, OpCode.SUB, OpCode.MUL, OpCode.DIV, OpCode.MOD, OpCode.FLOORDIV, OpCode.POW,
		OpCode.BAND, OpCode.BOR, OpCode.BXOR, OpCode.SHL, OpCode.SHR, OpCode.UNM, OpCode.BNOT,
		OpCode.MOV, OpCode.LOADK, OpCode.KNIL, OpCode.KFALSE, OpCode.KTRUE,
		OpCode.K0, OpCode.K1, OpCode.KM1, OpCode.KSMI, OpCode.NOT];
	const floats = [-0, 0.25, -4294967296, Infinity, NaN];
	const initialValues = [...floats.map(valueFloat), valueNil(), valueBool(false), valueBool(true)];
	const constants = [...floats.map(numberConstantFromHost), null, false, true, 'literal'];
	let random = 0x915acd38;
	const next = () => {
		random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
		return random >>> 0;
	};
	for (let program = 0; program < 32; ++program) {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		let previous = 0, loopCycles = BASE_CYCLES[OpCode.JMP];
		for (let word = 0; word < 32; ++word) {
			const op = operations[next() % operations.length];
			loopCycles += BASE_CYCLES[op];
			const a = word % 3 === 0 ? previous : next() & 7;
			let b = word % 3 === 0 ? previous : next() & 7;
			let c = word % 3 === 1 ? previous : next() & 7;
			let ext = 0;
			if (op >= OpCode.ADD && op <= OpCode.SHR) {
				if ((next() & 3) === 0) b = -1 - next() % constants.length;
				if ((next() & 3) === 0) c = -1 - next() % constants.length;
				ext = ((b >>> 6) & 7) << 3 | ((c >>> 6) & 7);
			} else if (op === OpCode.LOADK || op === OpCode.KSMI) {
				const bx = op === OpCode.LOADK ? next() % constants.length : (next() & 127) - 64;
				b = bx >>> 6; c = bx & 63; ext = bx >>> 12;
			}
			writeInstruction(text, word, op, a, b, c, ext);
			previous = a;
		}
		writeInstruction(text, 32, OpCode.JMP, 0, (-33 >>> 6) & 63, -33 & 63, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 33, maxStack: 8 }, writeSkipFaultInstructionHandler(text, 33)], exceptionFunctionIndex: 1, constants }, RAM_CODE_FIXTURE_BYTES);
		const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
		const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
		for (const cpu of [js, ref]) {
			const registers = cpu.rootThread.frameAtDepth(0).registers;
			for (let reg = 0; reg < initialValues.length; ++reg) registers.set(reg, initialValues[reg]);
			registers.setTable(0, cpu.createTable(0, 0));
			registers.setFloat(7, -0);
		}
		for (const grant of [3 * (COMPILED_BLOCK_THRESHOLD + 1) * loopCycles, ...Array.from({ length: 40 }, (_, i) => i + 1)]) {
			runCpuParity(js, ref, grant);
			assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState(), `program ${program}, grant ${grant}`);
		}
		assert.ok(compiledEntries(js) > 0, `dependent program ${program} used generated code`);
	}
});

test('generated field access retains metatables, deletion, rehash, reference values and GC roots', () => {
	const image = compileCoroutineTest(`
local parent = { value = 2 }
local keys = { "a", "b", "c", "d", "e", "f", "g" }
local t = setmetatable({}, { __index = parent })
local other = { value = false }
local n = 0
for i = 1, 120 do
 if i % 11 == 0 then t.value = nil end
 t.value = t.value + 1
 t[keys[i % 7 + 1]] = other
 t[i + 10000] = other
 other.value = t.value
 n = n + other.value
 if i % 23 == 0 then collectgarbage() end
end
return n, t.value, other.value
`, 0);
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) cpu.installBootPrimitives();
	const executionImage = js.rootThread.frameAtDepth(0).executionImage;
	let result = RunResult.Yielded;
	for (let slice = 0; slice < 10000 && result === RunResult.Yielded; ++slice) {
		const grant = [1, 2, 3, 9, 33, 256][slice % 6];
		result = runCpuParity(js, ref, grant);
		assert.equal(js.readLuaFaultReasonWord(), 0, 'the field program must execute without a guest fault');
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	}
	assert.equal(result, RunResult.Halted);
	const exits = new Set([...executionImage.decodedPages.values()].flatMap(page =>
		page.compiledBlocks?.entries.filter(block => block !== null).flatMap(block => block!.exits.map(exit => exit.exit)) ?? []));
	assert.ok(exits.has(CompiledBlockExit.ReadField) && exits.has(CompiledBlockExit.WriteField), 'field reads and writes used generated execution');
});

test('field cache hits stay in one generated block and misses publish only the executed prefix', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 3, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.GETFIELD, 4, 0, 0);
	writeInstruction(text, 3, OpCode.ADD, 4, 4, 1);
	writeInstruction(text, 4, OpCode.SETFIELD, 0, 0, 4);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 58, 255);
	writeInstruction(text, 6, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 6, maxStack: 8 }, { firstWord: 6, wordCount: 1 },
	], constants: ['field'], exceptionFunctionIndex: 1 }, RAM_CODE_FIXTURE_BYTES);
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	const entry = image.image.functions[0].codeAddress;
	for (const cpu of [js, ref]) {
		const table = cpu.createTable(0, 1);
		cpu.gc.tables.storeStringKey(table, cpu.stringPool.intern('field'), ValueTag.Integer, 0);
		cpu.rootThread.frameAtDepth(0).registers.setTable(0, table);
		cpu.rootThread.frameAtDepth(0).registers.setInteger(1, 1);
		cpu.runUntilDepth(0, 1200);
	}
	const frame = js.rootThread.frameAtDepth(0);
	const page = frame.decodedPage!;
	const block = page.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
	assert.equal(block.sourceWords, 6);
	assert.equal(block.region.exits.filter(exit => exit.exit === CompiledBlockExit.ReadField || exit.exit === CompiledBlockExit.WriteField).length, 2);
	for (const cpu of [js, ref]) {
		const f = cpu.rootThread.frameAtDepth(0);
		cpu.gc.tables.storeStringKey(f.registers.getPayload(0), cpu.stringPool.intern('field'), ValueTag.Integer, 0);
		f.registers.setInteger(4, 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
	}
	const directExit = block.region.exits[block.region.execute(frame.registers, frame.executionImage.constWords, page, frame, block.entry, { remainingCycles: 10, registerTop: frame.top, memoryAddress: 0, lengthWork: { probes: 0 } })];
	assert.equal(directExit.nextPc, image.image.functions[0].codeAddress,
		'both field hits and arithmetic reach the final branch without a host side exit');
	// Direct region calls bypass the CPU's usual publication of exit metadata.
	js.lastPc = directExit.lastPc;
	ref.runUntilDepth(0, BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.GETFIELD]
		+ BASE_CYCLES[OpCode.ADD] + BASE_CYCLES[OpCode.SETFIELD] + BASE_CYCLES[OpCode.JMP]);
	assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	for (let grant = 1; grant <= 40; ++grant) {
		for (const cpu of [js, ref]) cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
		runCpuParity(js, ref, grant);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	}
	for (const cpu of [js, ref]) {
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setBoolean(0, false); frame.top = 0;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assert.equal(frame.top, 4, 'the failed field load did not write its destination');
		assert.equal(cpu.readEpcWord(), entry + INSTRUCTION_BYTES);
	}
	assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
});

test('sparse observation and instrumented stops retire or bypass compiled blocks without lost instruction boundaries', () => {
	const image = loopImage();
	const cpu = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	cpu.rootThread.frameAtDepth(0).registers.setInteger(1, 0);
	cpu.runUntilDepth(0, 600);
	assert.ok(compiledEntries(cpu) > 0);
	const observedPc = image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES;
	const observed: number[] = [];
	cpu.setInstructionObserver({ points: [new Set([observedPc]), new Set(), new Set()], observe(_domain, pc) { observed.push(pc); } });
	assert.equal(compiledEntries(cpu), 0);
	for (let i = 0; i < 20; ++i) cpu.runUntilDepth(0, 6 * BASE_CYCLES[OpCode.K1]);
	assert.equal(observed.length, 20);
	cpu.setInstructionObserver(null);
	cpu.runUntilDepth(0, 600);
	assert.ok(compiledEntries(cpu) > 0);
	cpu.setExecutionHook((_domain, pc) => pc === observedPc, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.ExecutionStopped);
	assert.equal(cpu.readFramePc(0), observedPc);
	assert.equal(observed.length, 20);
});

test('restore retires warmed cross-page regions and their links before regenerating execution', () => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 3 }] }, RAM_CODE_FIXTURE_BYTES);
	const generated = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const scalar = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const js = generated.cpu, ref = scalar.cpu;
	const pageWords = MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES;
	const code = new Uint8Array(2 * MAPPED_PAGE_BYTE_SIZE);
	const outward = pageWords - 2, backward = -pageWords - 2;
	writeInstruction(code, 0, OpCode.ADD, 0, 0, 1);
	writeInstruction(code, 1, OpCode.JMP, 0, (outward >>> 6) & 63, outward & 63, (outward >>> 12) & 255);
	writeInstruction(code, pageWords, OpCode.ADD, 0, 0, 2);
	writeInstruction(code, pageWords + 1, OpCode.JMP, 0, (backward >>> 6) & 63, backward & 63, (backward >>> 12) & 255);
	for (const { cpu, memory } of [generated, scalar]) {
		memory.writeBytes(DYNAMIC_RAM_BASE, code);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		const registers = cpu.rootThread.frameAtDepth(0).registers;
		registers.setInteger(0, 0); registers.setInteger(1, 1); registers.setInteger(2, 2);
	}
	for (let revision = 0; revision < 3; ++revision) {
		runCpuParity(js, ref, 1024);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		const owner = js.rootThread.frameAtDepth(0).executionImage;
		const pages = [DYNAMIC_RAM_BASE, DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE]
			.map(pc => owner.compiledCodeLookup!.find(pc, 0)!);
		const blocks = pages.map(page => page.compiledBlocks!.entries[0]!);
		assert.ok(blocks.every(block => block !== null), 'both restored pages really warm into generated code');
		assert.equal(blocks[0].terminal.linkedBlock, blocks[1]);
		assert.equal(blocks[1].terminal.linkedBlock, blocks[0]);
		assert.ok(pages.every(page => page.compiledBlocks!.sourceUnits > 0));
		const saved = js.captureRuntimeState();
		js.restoreRuntimeState(saved);
		ref.restoreRuntimeState(ref.captureRuntimeState());
		assert.deepEqual(js.captureRuntimeState(), saved);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		assert.notEqual(js.rootThread.frameAtDepth(0).executionImage, owner);
		assert.equal(compiledEntries(js), 0, 'restored execution starts with fresh decoded owners');
		for (const page of pages) {
			assert.ok(page.compiledBlocks!.entries.every(block => block === null), 'restore withdraws the discarded generated entries');
			assert.equal(page.compiledBlocks!.sourceUnits, 0, 'retired regions release their generated-source charge');
		}
		for (const block of blocks) {
			assert.equal(block.incoming, null);
			for (const exit of block.exits) {
				assert.equal(exit.linkedBlock, null);
				assert.equal(exit.previousIncoming, null);
				assert.equal(exit.nextIncoming, null);
			}
		}
		for (const grant of [1, 2, 7, 19]) {
			runCpuParity(js, ref, grant);
			assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		}
	}
});

test('compiled loops and repeated calls replay the full state through short grants and restore', () => {
	const image = linkTestSystemBlua32(compileLuaSource(`
local function step(x) return ((x << 1) ~ 3) + 1 end
local n = 1
for i = 1, 200 do n = step(n) end
return n
`, 'generated-calls.lua'));
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	let result = RunResult.Yielded;
	let installed = 0;
	for (let slice = 0; slice < 1000 && result === RunResult.Yielded; ++slice) {
		const grant = slice % 3 === 0 ? 200 : 7;
		result = runCpuParity(js, ref, grant);
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
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 6, maxStack: 64 }] }, RAM_CODE_FIXTURE_BYTES);
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	runCpuParity(js, ref, 600);
	assert.ok(compiledEntries(js) > 0);
	for (const value of [valueNil(), valueBool(false), valueBool(true), valueInteger(0), valueFloat(-0), valueFloatBits(0xffa12345), valueFloat(Infinity), valueInteger(-1)]) {
		for (let grant = 1; grant <= 30; ++grant) {
			for (const cpu of [js, ref]) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
				const registers = cpu.rootThread.frameAtDepth(0).registers;
				registers.set(0, value);
				registers.set(63, value);
			}
			runCpuParity(js, ref, grant);
			assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
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
	writeInstruction(text, 5, OpCode.RET, 2, 2, 0);
	writeInstruction(text, 6, OpCode.RFE, 0, 0, 0);
	writeInstruction(text, 7, OpCode.KSMI, 0, 0, 9);
	writeInstruction(text, 8, OpCode.RET, 0, 2, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 6, maxStack: 3 }, { firstWord: 6, wordCount: 1 }, { firstWord: 7, wordCount: 2 },
	], exceptionFunctionIndex: 1, irqFunctionIndex: 1 }, RAM_CODE_FIXTURE_BYTES);
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	const entry = image.image.functions[0].codeAddress;
	const startPc = entry + (standalone ? 2 : 0) * INSTRUCTION_BYTES;
	const grant = BASE_CYCLES[OpCode.HALT] + (standalone ? 0 : BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.NOT]);
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
	const page = js.rootThread.frameAtDepth(0).decodedPage!;
	const block = page.compiledBlocks!.entries[(startPc & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
	assert.equal(block.terminal.exit, CompiledBlockExit.Halt, 'the executed HALT is a generated exit, not interpreter dispatch');
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
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }] }, RAM_CODE_FIXTURE_BYTES);
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
	const head = cpu.rootThread.frameAtDepth(0).executionImage.decodedPages;
	assert.ok([...head.values()].some(page => page.compiledBlocks?.entries[255]?.terminal.exit === CompiledBlockExit.Halt));
	writeInstruction(code, 1, OpCode.KM1, 0, 0, 0);
	memory.writeBytes(pc + INSTRUCTION_BYTES, code.subarray(INSTRUCTION_BYTES));
	assert.equal(compiledEntries(cpu), 0);
	cpu.clearHaltUntilIrq();
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
	assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
	assert.equal(cpu.readFrameRegister(0, 0), valueInteger(-1));
});

test('source writes retire overlapping blocks without discarding independent code on the same page', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	for (const start of [0, 8]) {
		writeInstruction(text, start, OpCode.K1, 0, 0, 0);
		writeInstruction(text, start + 1, OpCode.ADD, 1, 0, 0);
		writeInstruction(text, start + 2, OpCode.JMP, 0, 63, 61, 255);
	}
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 11, maxStack: 2 }] }, RAM_CODE_FIXTURE_BYTES);
	const { cpu, memory } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	memory.writeBytes(DYNAMIC_RAM_BASE, text);
	for (const start of [0, 8]) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE + start * INSTRUCTION_BYTES);
		cpu.runUntilDepth(0, 300);
	}
	const page = cpu.rootThread.frameAtDepth(0).decodedPage!;
	const preserved = page.compiledBlocks!.entries[0];
	assert.ok(preserved !== null && page.compiledBlocks!.entries[8] !== null);
	writeInstruction(text, 9, OpCode.SUB, 1, 0, 0);
	memory.writeBytes(DYNAMIC_RAM_BASE + 9 * INSTRUCTION_BYTES, text.subarray(9 * INSTRUCTION_BYTES, 10 * INSTRUCTION_BYTES));
	assert.ok(page.compiledBlocks!.entries[0] === preserved);
	assert.equal(page.compiledBlocks!.entries[8], null);
	assert.equal(cpu.runUntilDepth(0, 3), RunResult.Yielded);
	assert.equal(cpu.readFrameRegister(0, 1), valueInteger(0));
});
