import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CPU, CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { COMPILED_BLOCK_THRESHOLD, CompiledBlockExit, CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { valueInteger, valueNil, valuePayload, valueString, valueTable, ValueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_RECORD_SIZE } from '../../machine/ts/spec/blua32/image_format';
import { CLOSURE_ADDRESS_REGISTER_WIDE_C, INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { linkRawTestSystemBlua32, linkTestSystemBlua32, seedTestMappedStaticClosure, seedTestRomClosure } from '../helpers/blua32';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { createTestHeapServiceCpu, compileHeapServiceSystem } from '../helpers/heap_service_system';
import { createManagedTestOpcodeCpu, linkManagedTestOpcodes } from '../helpers/managed_opcode';
import { runGuestToHalt } from '../helpers/cpu_execution';

function assertParity(js: CPU, ref: CPU): void {
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()), 'full values, heap graph, roots, frame extents and control latches');
	assert.equal(js.instructionBudgetRemaining, ref.instructionBudgetRemaining);
	assert.equal(js.readCurrentInstructionPc(), ref.readCurrentInstructionPc());
	assert.equal(js.lastPc, ref.lastPc);
}

test('compiled captured CLOSURE publishes the live moved reference to BIOS collection', () => {
	const image = linkTestSystemBlua32(compileHeapServiceSystem(`
local function factory(input)
	local live = input
	input = nil
	return function() return live end
end
return factory
`, 0));
	const { cpu } = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript);
	runGuestToHalt(cpu, 100_000);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	assert.equal(values.length, 1);
	const factory = valuePayload(values[0]), start = cpu.captureClosureBinding(factory).codeAddress;
	// Keep the already issued factory bound while repeatedly warming its
	// ordinary CLOSURE exit and retiring the verified firmware.
	setReferenceGlobal(cpu, cpu.stringPool.intern('factory'), values[0]);
	for (let i = 0; i < COMPILED_BLOCK_THRESHOLD + 2; ++i) {
		cpu.beginCompletionCall(factory, [valueInteger(i)]);
		runGuestToHalt(cpu, 100_000);
	}
	cpu.gc.collect(); // the next collector work must come from this allocation
	const payload = cpu.stringPool.intern('payload'), kept = cpu.stringPool.intern('retained');
	const table = createReferenceTable(cpu, 1024, 1);
	cpu.gc.tables.setStringKey(table, payload, valueString(kept));
	cpu.beginCompletionCall(factory, [valueTable(table)]);
	cpu.luaHeap.setCollectionTarget(cpu.luaHeap.usedBytes());
	const caller = cpu.rootThread.currentFrame!;
	assert.equal(cpu.runUntilDepth(0, 4096, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	assert.ok(cpu.fixedInterruptActive(), 'the compiled caller entered the architectural System vector');
	const block = caller.decodedPage!.compiledBlocks!.entries[(start & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	assert.equal(block.terminal.exit, CompiledBlockExit.CreateClosure);
	assert.equal(caller.registers.get(0), valueNil(), 'the source register no longer holds the Table');
	const before = cpu.gc.white();
	runGuestToHalt(cpu, 100_000);
	assert.ok(cpu.gc.active() || cpu.gc.white() !== before, 'BIOS admitted collector work during the allocation');
	cpu.readCompletionValues(values);
	const capture = valuePayload(values[0]);
	cpu.gc.collect(values[0]);
	assert.equal(cpu.readClosureUpvalue(capture, 0), valueTable(table));
	assert.equal(cpu.gc.tables.getStringKey(table, payload), valueString(kept));
});

test('hot immediate CLOSURE retains the full Bx operand and canonical STATIC identity', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 7, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0); writeInstruction(text, 2, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 3, OpCode.MOV, 1, 0, 0);
	writeInstruction(text, 4, OpCode.WIDE, 0, 0, 0); writeInstruction(text, 5, OpCode.CLOSURE, 2, 0, 0);
	writeInstruction(text, 6, OpCode.JMP, 0, 63, 57, 255); writeInstruction(text, 16, OpCode.HALT, 0, 0, 0);
	const target = DYNAMIC_RAM_BASE;
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 7, maxStack: 8 }, { firstWord: 16, wordCount: 1 }],
		closureRelocations: [{ wordIndex: 2, functionAddress: target }, { wordIndex: 5, functionAddress: target }] }, BLUA32_FUNCTION_RECORD_SIZE);
	const left = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), right = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter);
	const record = image.symbols.functionAddresses[1] - SYSTEM_ROM_BASE;
	for (const { cpu, memory } of [left, right]) {
		memory.writeBytes(target, image.romBytes.subarray(record, record + BLUA32_FUNCTION_RECORD_SIZE));
		seedTestMappedStaticClosure(cpu, target);
	}
	const js = left.cpu, ref = right.cpu;
	js.runUntilDepth(0, 500); ref.runUntilDepth(0, 500); assertParity(js, ref);
	const frame = js.rootThread.frameAtDepth(0), entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = frame.decodedPage!.compiledBlocks!.entries[entry]!;
	assert.equal(block.terminal.exit, CompiledBlockExit.CreateClosure); assert.equal(block.sourceWords, 3);
	assert.equal(block.terminal.exitBx, target / BLUA32_FUNCTION_ALIGNMENT); assert.ok(block.terminal.exitBx > 0xffff);
	assert.equal(frame.registers.get(0), frame.registers.get(2));
});

test('hot register CLOSURE preserves its prefix and destination on a prototype bus fault', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 7, 0, 0); writeInstruction(text, 1, OpCode.GETGL, 0, 0, 0);
	writeInstruction(text, 2, OpCode.WIDE, 4, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C);
	writeInstruction(text, 3, OpCode.CLOSURE, 0, 0, 0); // R256 = closure at u32(R0).
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255); writeInstruction(text, 16, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 257 },
		{ firstWord: 16, wordCount: 1, staticClosure: true }], globalNames: ['target'] });
	const left = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), right = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter);
	const target = image.symbols.functionAddresses[1], bad = 0xdead0000;
	for (const { cpu } of [left, right]) {
		seedTestRomClosure(cpu, target);
		setReferenceGlobal(cpu, cpu.stringPool.find('target')!, valueInteger(target));
		cpu.runUntilDepth(0, 32 * (BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.GETGL] + BASE_CYCLES[OpCode.CLOSURE] + BASE_CYCLES[OpCode.JMP]));
	}
	const js = left.cpu, ref = right.cpu, frame = js.rootThread.frameAtDepth(0);
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[entry]!.terminal.exit, CompiledBlockExit.CreateClosure);
	for (const { cpu } of [left, right]) {
		setReferenceGlobal(cpu, cpu.stringPool.find('target')!, valueInteger(bad));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
		cpu.rootThread.frameAtDepth(0).registers.setInteger(256, 73); cpu.rootThread.frameAtDepth(0).top = 0;
	}
	assert.equal(js.runUntilDepth(0, 6), RunResult.Halted); assert.equal(ref.runUntilDepth(0, 6), RunResult.Halted); assertParity(js, ref);
	assert.equal(js.captureRuntimeState().hardHalted, true); assert.equal(frame.registers.getInteger(256), 73); assert.equal(frame.top, 8);
	assert.equal(js.readCurrentInstructionPc(), image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES);
	assert.equal(js.lastPc, image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES);
});

for (const source of [0, 513]) test(`compiled CLOSURE reads its live register address before replacing that same slot (R${source})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.WIDE, source >> 6, 0, 0);
	writeInstruction(text, 1, OpCode.GETGL, source & 63, 0, 0);
	writeInstruction(text, 2, OpCode.WIDE, source >> 6, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C);
	writeInstruction(text, 3, OpCode.CLOSURE, source & 63, (source >> 6) & 63, source & 63);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	writeInstruction(text, 16, OpCode.HALT, 0, 0, 0);
	const image = linkManagedTestOpcodes({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: source + 1 },
		{ firstWord: 16, wordCount: 1 }, { firstWord: 16, wordCount: 1 }], globalNames: ['target'] }, BLUA32_FUNCTION_RECORD_SIZE);
	const template = image.symbols.functionAddresses[2] - SYSTEM_ROM_BASE;
	const js = createManagedTestOpcodeCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createManagedTestOpcodeCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
		cpu.memory.writeBytes(DYNAMIC_RAM_BASE, image.romBytes.subarray(template, template + BLUA32_FUNCTION_RECORD_SIZE));
		seedTestMappedStaticClosure(cpu, DYNAMIC_RAM_BASE);
		setReferenceGlobal(cpu, cpu.stringPool.find('target')!, valueInteger(image.symbols.functionAddresses[1]));
		cpu.runUntilDepth(0, 400);
	}
	const frame = js.rootThread.frameAtDepth(0), pc = image.image.functions[0].codeAddress;
	const block = frame.decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	assert.equal(block.terminal.exitBx, source); assert.equal(block.terminal.exitA, source);
	for (const address of [DYNAMIC_RAM_BASE, image.symbols.functionAddresses[1], DYNAMIC_RAM_BASE, DYNAMIC_RAM_BASE, image.symbols.functionAddresses[1]]) {
		for (const cpu of [js, ref]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			setReferenceGlobal(cpu, cpu.stringPool.find('target')!, valueInteger(address));
		}
		assert.equal(js.runUntilDepth(0, 4), ref.runUntilDepth(0, 4)); assertParity(js, ref);
		assert.equal(js.captureClosureBinding(frame.registers.getClosure(source, js.gc)).functionAddress, address);
	}
});
