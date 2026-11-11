import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCpuParity } from '../helpers/cpu_execution';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueString, type Value } from '../../machine/ts/machine/cpu/value';
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
		writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.MOV, 4, 0, 0);
		writeInstruction(text, 3, OpCode.LOADK, 5, 0, 0);
		writeInstruction(text, 4, OpCode.LOADK, 6, 0, 1);
		writeInstruction(text, 5, OpCode.CALL, 4, open ? 0 : 3, open ? 0 : 3);
		writeInstruction(text, 6, OpCode.ADD, 3, 4, 5);
		writeInstruction(text, 7, OpCode.JMP, 0, 63, 58, 255);
		for (const start of [DECODED_PAGE_WORDS, DECODED_PAGE_WORDS + 32]) {
			writeInstruction(text, start, start === DECODED_PAGE_WORDS ? OpCode.ADD : OpCode.SUB, 2, 0, 1);
			writeInstruction(text, start + 1, OpCode.MOV, 3, start === DECODED_PAGE_WORDS ? 0 : 1, 0);
			writeInstruction(text, start + 2, OpCode.RET, 2, open ? 0 : 3, 0);
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
			assert.equal(cpu.rootThread.frameAtDepth(0).registers.getNumber(4), 7);
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		for (const { cpu, memory } of machines) {
			memory.writeBytes(record, image.romBytes.subarray(image.symbols.functionAddresses[2], image.symbols.functionAddresses[2] + BLUA32_FUNCTION_RECORD_SIZE));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
			cpu.runUntilDepth(0, 20000); cpu.runUntilDepth(1, 100);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
			cpu.runUntilDepth(0, 5); cpu.runUntilDepth(1, 100);
			assert.equal(cpu.rootThread.frameAtDepth(0).registers.getNumber(4), -1, 'a live closure reads the current RAM function record at each call');
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

test('CALL shares supplied argument slots without clearing them', () => {
	const text = new Uint8Array(8 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 4, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 7, 4, 0);
	writeInstruction(text, 3, OpCode.CALL, 7, 2, 2);
	writeInstruction(text, 4, OpCode.MOV, 3, 7, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 6, OpCode.MOV, 1, 0, 0);
	writeInstruction(text, 7, OpCode.RET, 1, 2, 0);
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
		assert.equal(cpu.rootThread.currentFrame!.registers.get(0), 63,
			'activation keeps the supplied argument in its original slot');
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
	for (const { cpu } of machines) assert.equal(cpu.rootThread.frameAtDepth(0).registers.get(7), 63,
		'the callee returns the original argument through the shared result window');
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

for (const { numParams, maxStack, argCount } of [
	{ numParams: 2, maxStack: 4, argCount: 1 },
	{ numParams: 4, maxStack: 4, argCount: 2 },
	{ numParams: 7, maxStack: 2, argCount: 1 },
	{ numParams: 7, maxStack: 2, argCount: 6 },
	{ numParams: 3, maxStack: 0, argCount: 1 },
	{ numParams: 0, maxStack: 0, argCount: 0 },
]) {
	test(`call initialization preserves raw values and declared extents: parameters ${numParams}, stack ${maxStack}, arguments ${argCount}`, () => {
		const text = new Uint8Array(9 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CALL, 0, 1, 0);
		writeInstruction(text, 3, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 4, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(text, 5, OpCode.CALL, 0, argCount + 1, 0);
		writeInstruction(text, 6, OpCode.JMP, 0, 63, 62, 255);
		writeInstruction(text, 7, OpCode.RET, numParams, 0, 0);
		writeInstruction(text, 8, OpCode.RET, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 7, maxStack: 8 },
			{ firstWord: 7, wordCount: 1, numParams, maxStack },
			{ firstWord: 8, wordCount: 1, maxStack: 32 },
		], closureRelocations: [
			{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(0, 2) },
			{ wordIndex: 4, functionAddress: blua32TestFunctionAddress(0, 1) },
		] });
		const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
		// The first guest call retains backing storage before the raw function
		// record with parameters beyond maxStack is ever entered.
		runCpuParity(machines[0].cpu, machines[1].cpu, 20000);
		runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
		const entry = image.image.functions[0].codeAddress + 5 * INSTRUCTION_BYTES;
		const calleeEntry = image.image.functions[1].codeAddress;
		const lookup = machines[0].cpu.rootThread.frameAtDepth(0).executionImage.compiledCodeLookup!;
		for (const pc of [entry, calleeEntry]) assert.ok(lookup.find(pc, 0)!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) >>> 2],
			'the real caller and callee are generated before the initialization probe');
		const retainedCapacities = machines.map(({ cpu }) => cpu.rootThread.stackRegisters.capacity());
		for (const completion of [false, true]) {
			const argumentsByMachine = machines.map(({ cpu }) => {
				const thread = cpu.rootThread;
				const caller = thread.frameAtDepth(0);
				const closure = caller.registers.getClosure(0);
				const args: Value[] = [-0, NaN, valueString(cpu.stringPool.intern('call-initialization')), false, true, closure].slice(0, argCount);
				assert.equal(thread.stackTop, 8);
				assert.equal(caller.stackCapacity, 8);
				assert.ok(thread.stackRegisters.capacity() >= 32);
				for (let index = 8; index < 32; ++index) thread.stackRegisters.set(index, closure);
				if (completion) cpu.beginCompletionCall(closure, args);
				else {
					for (let index = 0; index < args.length; ++index) caller.registers.set(index + 1, args[index]);
					cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
				}
				return args;
			});
			if (!completion) runCpuParity(machines[0].cpu, machines[1].cpu, 2);
			for (const [machineIndex, { cpu }] of machines.entries()) {
				const thread = cpu.rootThread;
				const caller = thread.frameAtDepth(0);
				const callee = thread.currentFrame!;
				const capacity = Math.max(maxStack, numParams, 1);
				const base = completion ? 8 : 1;
				assert.equal(cpu.getFrameDepth(), 2);
				assert.equal(callee.pc, calleeEntry);
				assert.equal(callee.stackBase, base);
				assert.equal(callee.stackCapacity, capacity);
				assert.equal(callee.top, numParams);
				assert.equal(thread.stackTop, base + capacity, 'all formal parameters belong to the active rooted reservation');
				assert.equal(caller.stackCapacity, 8);
				assert.equal(caller.top, 0, 'activation does not change the caller active-register extent');
				assert.equal(thread.stackRegisters.capacity(), retainedCapacities[machineIndex]);
				for (let index = 0; index < argCount; ++index) assert.equal(callee.registers.get(index), argumentsByMachine[machineIndex][index],
					'argument movement preserves number identity, value tags and references');
				for (let index = argCount; index < numParams; ++index) {
					assert.equal(callee.registers.get(index), null, 'missing formals are nil');
					assert.equal(callee.registers.getReference(index), null, 'cleared slots do not retain stale references');
				}
				cpu.collectTrackedHeapBytes();
				const state = cpu.captureRuntimeState();
				assert.equal(state.threads[0].stack.length, base + capacity);
				cpu.restoreRuntimeState(state);
				for (let index = 0; index < argCount; ++index) assert.equal(cpu.rootThread.currentFrame!.registers.get(index), argumentsByMachine[machineIndex][index]);
			}
			assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
			runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
		}
	});
}

test('CALL retains varargs below the relocated fixed-parameter window', () => {
	const text = new Uint8Array(7 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 4, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 7, 4, 0);
	writeInstruction(text, 3, OpCode.CALL, 7, 4, 2);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 61, 255);
	writeInstruction(text, 5, OpCode.VARARG, 1, 3, 0);
	writeInstruction(text, 6, OpCode.RET, 0, 4, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 5, maxStack: 8 },
		{ firstWord: 5, wordCount: 2, numParams: 1, maxStack: 4, isVararg: true },
	], closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(0, 1) }] });
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	runCpuParity(machines[0].cpu, machines[1].cpu, 20000);
	runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
	const entry = image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES;
	const calleeEntry = image.image.functions[1].codeAddress;
	const lookup = machines[0].cpu.rootThread.frameAtDepth(0).executionImage.compiledCodeLookup!;
	for (const pc of [entry, calleeEntry]) assert.ok(lookup.find(pc, 0)!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) >>> 2],
		'the caller and callee are generated before the vararg alias probe');
	for (const { cpu } of machines) {
		const thread = cpu.rootThread;
		assert.equal(thread.frameAtDepth(0).stackCapacity, 8);
		assert.equal(thread.stackTop, 8);
		assert.ok(thread.stackRegisters.capacity() >= 16);
		thread.stackRegisters.setNumber(8, 71);
		thread.stackRegisters.setNumber(9, 72);
		thread.stackRegisters.setNumber(10, 73);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 3);
	for (const { cpu } of machines) {
		const thread = cpu.rootThread;
		const callee = thread.currentFrame!;
		assert.equal(callee.stackBase, 11);
		assert.equal(callee.stackCapacity, 4);
		assert.equal(callee.top, 1);
		assert.equal(callee.registers.getNumber(0), 71);
		assert.equal(callee.varargBase, 9);
		assert.equal(callee.varargCount, 2);
		assert.equal(thread.stackRegisters.get(8), null, 'moved fixed parameters do not retain duplicate roots');
		assert.equal(thread.stackRegisters.getNumber(9), 72);
		assert.equal(thread.stackRegisters.getNumber(10), 73);
		callee.registers.setNumber(0, 99);
		assert.equal(thread.stackRegisters.getNumber(10), 73, 'working parameter writes cannot alter saved extras');
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
	for (const { cpu } of machines) assert.equal(cpu.rootThread.frameAtDepth(0).registers.getNumber(7), 99);
});
