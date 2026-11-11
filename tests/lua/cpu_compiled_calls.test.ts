import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCpuParity } from '../helpers/cpu_execution';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { writeLE32 } from '../../machine/ts/common/endian';
import { DECODED_PAGE_WORDS } from '../../machine/ts/machine/cpu/execution_image';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_FUNCTION_RECORD_SIZE } from '../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

for (const open of [false, true]) for (const recordOffset of [0x1800, 0x1ff0]) {
	test(`compiled cross-page calls: open counts ${open}, RAM record offset ${recordOffset}`, () => {
		const record = DYNAMIC_RAM_BASE + recordOffset;
		const text = new Uint8Array(2 * MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 1, OpCode.CLOSURE, 4, 0, 0);
		writeInstruction(text, 2, OpCode.MOV, 0, 4, 0);
		writeInstruction(text, 3, OpCode.LOADK, 1, 0, 0);
		writeInstruction(text, 4, OpCode.LOADK, 2, 0, 1);
		writeInstruction(text, 5, OpCode.CALL, 0, open ? 0 : 3, open ? 0 : 2);
		writeInstruction(text, 6, OpCode.ADD, 3, 0, 1);
		writeInstruction(text, 7, OpCode.JMP, 0, 63, 58, 255);
		for (const start of [DECODED_PAGE_WORDS, DECODED_PAGE_WORDS + 32]) {
			writeInstruction(text, start, start === DECODED_PAGE_WORDS ? OpCode.ADD : OpCode.SUB, 2, 0, 1);
			writeInstruction(text, start + 1, OpCode.MOV, 3, start === DECODED_PAGE_WORDS ? 0 : 1, 0);
			writeInstruction(text, start + 2, OpCode.RET, 2, open ? 0 : 2, 0);
		}
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 8, maxStack: 8 },
			{ firstWord: DECODED_PAGE_WORDS, wordCount: 3, numParams: 2, maxStack: 8 },
			{ firstWord: DECODED_PAGE_WORDS + 32, wordCount: 3, numParams: 2, maxStack: 1024 },
		], constants: [3, 4], closureRelocations: [{ wordIndex: 1, functionAddress: record }] });
		const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
		for (const { memory } of machines) {
			memory.writeBytes(record, image.romBytes.subarray(image.symbols.functionAddresses[1], image.symbols.functionAddresses[1] + BLUA32_FUNCTION_RECORD_SIZE));
		}
		runCpuParity(machines[0].cpu, machines[1].cpu, 20000);
		runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
		const frame = machines[0].cpu.rootThread.frameAtDepth(0);
		const entry = image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES;
		const blocks = [...frame.executionImage.decodedPages.values()].flatMap(page => page.compiledBlocks?.entries.filter(block => block !== null) ?? []);
		assert.ok(blocks.some(block => block!.terminal.exit === CompiledBlockExit.Call));
		assert.ok(blocks.some(block => block!.terminal.exit === CompiledBlockExit.Return), 'the callee itself is generated, not merely its caller');
		for (let grant = 1; grant <= 128; ++grant) {
			runCpuParity(machines[0].cpu, machines[1].cpu, grant);
			assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		}
		for (const { cpu } of machines) {
			cpu.runUntilDepth(1, 100);
			cpu.rootThread.frameAtDepth(0).registers.setNumber(3, 99);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
			assert.equal(cpu.runUntilDepth(0, 5), RunResult.Yielded);
			assert.equal(cpu.getFrameDepth(), 2);
			assert.equal(cpu.runUntilDepth(1, 50), RunResult.Halted);
			assert.equal(cpu.instructionBudgetRemaining, 46);
			assert.equal(cpu.rootThread.frameAtDepth(0).registers.getNumber(3), 99, 'a compiled RET must not execute a compiled caller beyond the requested depth');
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		for (const { cpu, memory } of machines) {
			const capacity = cpu.rootThread.stackRegisters.capacity();
			memory.writeMappedU32LE(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, 1024);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
			assert.equal(cpu.runUntilDepth(0, 9), RunResult.Yielded);
			assert.equal(cpu.getFrameDepth(), 1);
			assert.ok(cpu.rootThread.stackRegisters.capacity() > capacity, 'a hot native call actually relocates the shared stack');
			assert.equal(cpu.rootThread.frameAtDepth(0).registers.getNumber(0), 7);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		for (const { cpu, memory } of machines) {
			memory.writeBytes(record, image.romBytes.subarray(image.symbols.functionAddresses[2], image.symbols.functionAddresses[2] + BLUA32_FUNCTION_RECORD_SIZE));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
			cpu.runUntilDepth(0, 20000); cpu.runUntilDepth(1, 100);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
			cpu.runUntilDepth(0, 5); cpu.runUntilDepth(1, 100);
			assert.equal(cpu.rootThread.frameAtDepth(0).registers.getNumber(0), -1, 'a live closure reads the current RAM function record at each call');
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		const word = new Uint8Array(4);
		writeLE32(word, 0, image.image.functions[1].codeAddress + 1);
		for (const { cpu, memory } of machines) {
			memory.writeBytes(record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, word);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
			assert.equal(cpu.runUntilDepth(0, 5), RunResult.Yielded);
			assert.equal(cpu.readBadAddressWord(), 0, 'CALL does not fetch the next instruction without a grant');
			cpu.runUntilDepth(0, 1);
			assert.equal(cpu.readBadAddressWord(), image.image.functions[1].codeAddress + 1);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.notEqual(entry & ~MAPPED_PAGE_BYTE_MASK, image.image.functions[1].codeAddress & ~MAPPED_PAGE_BYTE_MASK);
	});
}

test('CALL clears its reserved window before reading arguments from retained stack slots', () => {
	const text = new Uint8Array(8 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 4, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 7, 4, 0);
	writeInstruction(text, 3, OpCode.CALL, 7, 2, 1);
	writeInstruction(text, 4, OpCode.MOV, 3, 7, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 6, OpCode.MOV, 1, 0, 0);
	writeInstruction(text, 7, OpCode.RET, 1, 1, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 6, maxStack: 8 },
		{ firstWord: 6, wordCount: 2, numParams: 1, maxStack: 8 },
	], closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(0, 1) }] });
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	runCpuParity(machines[0].cpu, machines[1].cpu, 20000);
	runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
	const entry = image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES;
	const calleeEntry = image.image.functions[1].codeAddress;
	const lookup = machines[0].cpu.rootThread.frameAtDepth(0).executionImage.compiledCodeLookup!;
	for (const pc of [entry, calleeEntry]) assert.ok(lookup.find(pc, 0)!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) >>> 2],
		'the caller and callee are both generated before exercising retained storage');
	for (const { cpu } of machines) {
		const thread = cpu.rootThread;
		assert.equal(thread.frameAtDepth(0).stackCapacity, 8);
		assert.equal(thread.stackTop, 8);
		assert.ok(thread.stackRegisters.capacity() >= 16, 'the argument address lies inside retained allocation, not outside its backing');
		// CALL R7,B=2 reads one argument from absolute slot 8, which is also
		// the next callee window. No frame expansion or active-slot write occurs.
		thread.stackRegisters.setNumber(8, 63);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 3);
	for (const { cpu } of machines) {
		assert.equal(cpu.getFrameDepth(), 2);
		assert.equal(cpu.rootThread.currentFrame!.pc, calleeEntry);
		assert.equal(cpu.rootThread.currentFrame!.stackBase, 8);
		assert.equal(cpu.rootThread.currentFrame!.registers.get(0), null,
			'the argument observes nil written during activation, not the retained value 63');
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
	for (const { cpu } of machines) assert.equal(cpu.rootThread.frameAtDepth(0).registers.get(7), null,
		'the callee returns the cleared argument through the real result window');
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});
