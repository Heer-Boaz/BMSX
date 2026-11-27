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
import { HEAP_SERVICE_RESIDENT_OFFSET, HeapServiceResidentField, HEAP_SERVICE_IMAGE_FLAG } from '../../machine/ts/spec/bmsx/heap_service';
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

test('a warm JavaScript CALL to the resident constructor yields to the bound BIOS before its compiled continuation', t => {
	const image = linkTestSystemBlua32(compileHeapServiceSystem('local t = {40, answer = 2}\nreturn t[1] + t.answer', 0));
	assert.ok(image.image.header.flags & HEAP_SERVICE_IMAGE_FLAG);
	const functionAddress = image.vectors.entryFunctionAddress;
	const pc = image.image.functions[image.symbols.functionAddresses.indexOf(functionAddress)].codeAddress;
	const { cpu } = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript);
	const frame = cpu.rootThread.frameAtDepth(0);
	const enter = () => cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, pc);
	const grant = () => cpu.runUntilDepth(0, 4096, undefined, CpuRunKind.Scheduled);
	function retireService() {
		for (let grantIndex = 0; grantIndex < 16 && cpu.heapServiceActive(); ++grantIndex)
			assert.equal(grant(), RunResult.Yielded);
		assert.equal(cpu.heapServiceActive(), false);
	}
	for (let visit = 0; visit <= COMPILED_BLOCK_THRESHOLD; ++visit) {
		enter();
		assert.equal(grant(), RunResult.Yielded);
		assert.equal(cpu.heapServiceActive(), true);
		retireService();
	}
	const { textBytes, header: { textAddress } } = image.image;
	let callPc = pc;
	let call = decodeBlua32InstructionAtPc(textBytes, textAddress, callPc);
	while (call.op !== OpCode.CALL) {
		callPc = call.pc + INSTRUCTION_BYTES;
		call = decodeBlua32InstructionAtPc(textBytes, textAddress, callPc);
	}
	const entry = (callPc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = frame.decodedPage!.compiledBlocks!.entries[entry]!;
	const { terminal, region } = block;
	assert.equal(terminal.exit, CompiledBlockExit.Call);
	assert.deepEqual([terminal.exitB, terminal.exitC], [3, 2], 'two provided Values and one requested result');
	const execute = region.execute;
	let callExits = 0;
	const compiled = t.mock.method(region, 'execute', (...args: Parameters<typeof execute>) => {
		const exitIndex = execute(...args);
		if (region.exits[exitIndex].exit === CompiledBlockExit.Call) ++callExits;
		return exitIndex;
	});
	enter();
	assert.equal(grant(), RunResult.Yielded);
	assert.equal(callExits, 1);
	assert.equal(cpu.heapServiceActive(), true);
	const state = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_RESIDENT_OFFSET;
	assert.equal(cpu.memory.readRamRecordWord(state + HeapServiceResidentField.IssuePc), terminal.currentPc);
	assert.equal(frame.pc, terminal.nextPc, 'the successor is published but fenced until BIOS RET');
	assert.deepEqual([frame.registers.get(terminal.exitA + 1), frame.registers.get(terminal.exitA + 2)],
		[valueInteger(1), valueInteger(1)], 'the actual compiled exit publishes its argument window');
	assert.equal(frame.registers.getTag(terminal.exitA), ValueTag.ResidentFunction, 'no result before the return');
	const callsBefore = compiled.mock.callCount();
	retireService();
	assert.equal(compiled.mock.callCount(), callsBefore, 'allocator grants ran only the pinned BIOS lane');
	assert.equal(frame.pc, terminal.nextPc);
	assert.equal(frame.registers.getTag(terminal.exitA), ValueTag.Table);
	assert.equal(frame.top, terminal.exitA + 1, 'normal fixed CALL result placement');
	assert.equal(grant(), RunResult.Halted);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	assert.deepEqual(values, [valueInteger(42)]);
});

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
	cpu.setGlobalByKey(cpu.stringPool.intern('factory'), values[0]);
	for (let i = 0; i < COMPILED_BLOCK_THRESHOLD + 2; ++i) {
		cpu.beginCompletionCall(factory, [valueInteger(i)]);
		runGuestToHalt(cpu, 100_000);
	}
	cpu.gc.collect(); // the next collector work must come from this allocation
	const payload = cpu.stringPool.intern('payload'), kept = cpu.stringPool.intern('retained');
	const table = cpu.createTable(1024, 1);
	cpu.gc.tables.setStringKey(table, payload, valueString(kept));
	cpu.beginCompletionCall(factory, [valueTable(table)]);
	cpu.luaHeap.setCollectionTarget(cpu.luaHeap.usedBytes());
	const caller = cpu.rootThread.currentFrame!;
	assert.equal(cpu.runUntilDepth(0, 4096, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	assert.ok(cpu.heapServiceActive(), 'the compiled caller handed off rather than allocating in JavaScript');
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
		cpu.setGlobalByKey(cpu.stringPool.find('target')!, valueInteger(target));
		cpu.runUntilDepth(0, 32 * (BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.GETGL] + BASE_CYCLES[OpCode.CLOSURE] + BASE_CYCLES[OpCode.JMP]));
	}
	const js = left.cpu, ref = right.cpu, frame = js.rootThread.frameAtDepth(0);
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[entry]!.terminal.exit, CompiledBlockExit.CreateClosure);
	for (const { cpu } of [left, right]) {
		cpu.setGlobalByKey(cpu.stringPool.find('target')!, valueInteger(bad));
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
		cpu.setGlobalByKey(cpu.stringPool.find('target')!, valueInteger(image.symbols.functionAddresses[1]));
		cpu.runUntilDepth(0, 400);
	}
	const frame = js.rootThread.frameAtDepth(0), pc = image.image.functions[0].codeAddress;
	const block = frame.decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	assert.equal(block.terminal.exitBx, source); assert.equal(block.terminal.exitA, source);
	for (const address of [DYNAMIC_RAM_BASE, image.symbols.functionAddresses[1], DYNAMIC_RAM_BASE, DYNAMIC_RAM_BASE, image.symbols.functionAddresses[1]]) {
		for (const cpu of [js, ref]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			cpu.setGlobalByKey(cpu.stringPool.find('target')!, valueInteger(address));
		}
		assert.equal(js.runUntilDepth(0, 4), ref.runUntilDepth(0, 4)); assertParity(js, ref);
		assert.equal(js.captureClosureBinding(frame.registers.getClosure(source, js.gc)).functionAddress, address);
	}
});
