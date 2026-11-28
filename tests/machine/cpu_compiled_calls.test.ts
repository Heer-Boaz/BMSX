import { nativeHeapReference } from '../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCpuParity } from '../helpers/cpu_execution';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { valueBool, valueFloatBits, valueInteger, valueNil, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { readLE32, writeLE32 } from '../../machine/ts/common/endian';
import { DECODED_PAGE_WORDS } from '../../machine/ts/machine/cpu/execution_image';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { LUA_FAULT_REASON_CALL_NON_FUNCTION, LUA_FAULT_REASON_INVALID_ARGUMENT, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { DYNAMIC_RAM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { RAM_CODE_FIXTURE_BYTES, linkRawTestSystemBlua32, seedTestMappedStaticClosure, seedTestRomClosure } from '../helpers/blua32';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';

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
		writeInstruction(text, DECODED_PAGE_WORDS, OpCode.ADD, 2, 0, 1);
		writeInstruction(text, DECODED_PAGE_WORDS + 1, OpCode.MOV, 3, 0, 0);
		writeInstruction(text, DECODED_PAGE_WORDS + 2, OpCode.RET, 2, open ? 0 : 3, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 8, maxStack: 8 },
			{ firstWord: DECODED_PAGE_WORDS, wordCount: 3, numParams: 2, maxStack: 8 },
		], constants: [integerConstant(3), integerConstant(4)], closureRelocations: [{ wordIndex: 1, functionAddress: record }] }, RAM_CODE_FIXTURE_BYTES);
		const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
		// Supplied fixed arguments already occupy the callee window: no placement surcharge.
		const callEntryCycles = BASE_CYCLES[OpCode.MOV] + 2 * BASE_CYCLES[OpCode.LOADK] + BASE_CYCLES[OpCode.CALL];
		for (const { cpu, memory } of machines) {
			memory.writeBytes(record, image.romBytes.subarray(image.symbols.functionAddresses[1], image.symbols.functionAddresses[1] + BLUA32_FUNCTION_RECORD_SIZE));
			seedTestMappedStaticClosure(cpu, record);
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
			cpu.rootThread.frameAtDepth(0).registers.setInteger(3, 99);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
			assert.equal(cpu.runUntilDepth(0, callEntryCycles), RunResult.Yielded);
			assert.equal(cpu.getFrameDepth(), 2);
			assert.equal(cpu.rootThread.currentFrame!.pc, image.image.functions[1].codeAddress, 'the setup grant ends at callee entry, before ADD');
			assert.equal(cpu.instructionBudgetRemaining, 0);
			assert.equal(cpu.runUntilDepth(1, 50), RunResult.Halted);
			assert.equal(cpu.instructionBudgetRemaining, 50 - BASE_CYCLES[OpCode.ADD] - BASE_CYCLES[OpCode.MOV] - BASE_CYCLES[OpCode.RET] - 2);
			assert.equal(cpu.rootThread.frameAtDepth(0).registers.get(3), valueInteger(99), 'a compiled RET must not execute a compiled caller beyond the requested depth');
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		for (const { cpu, memory } of machines) {
			const registers = cpu.rootThread.frameAtDepth(0).registers;
			registers.setNil(0); registers.setNil(4);
			nativeHeapReference(cpu).gc.collect();
			const capacity = cpu.rootThread.stackRegisters.capacity();
			// Reuse a reclaimed RAM record, like the BIOS loader arena does.
			memory.writeMappedU32LE(record + BLUA32_FUNCTION_MAX_STACK_OFFSET, 1024);
			seedTestMappedStaticClosure(cpu, record);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry - 2 * INSTRUCTION_BYTES);
			assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.CLOSURE] + callEntryCycles), RunResult.Yielded);
			assert.ok(cpu.rootThread.stackRegisters.capacity() > capacity, 'a recycled prototype supplies its new stack extent');
			const closure = cpu.rootThread.frameAtDepth(0).registers.getPayload(0);
			const state = cpu.captureRuntimeState();
			cpu.restoreRuntimeState(state);
			const restored = cpu.rootThread.currentFrame!.closure!;
			assert.equal(restored, closure, 'the active frame retains its physical closure reference');
			assert.equal(cpu.captureClosureBinding(restored).functionAddress, record);
			assert.equal(cpu.captureClosureBinding(restored).maxStack, 1024, 'the restored binding still supplies the published stack extent');
			assert.equal(cpu.runUntilDepth(1, 50), RunResult.Halted);
			assert.equal(cpu.rootThread.frameAtDepth(0).registers.get(4), valueInteger(7));
		}
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		const word = new Uint8Array(4);
		writeLE32(word, 0, image.image.functions[1].codeAddress + 1);
		for (const { cpu, memory } of machines) {
			const registers = cpu.rootThread.frameAtDepth(0).registers;
			registers.setNil(0); registers.setNil(4);
			nativeHeapReference(cpu).gc.collect();
			memory.writeBytes(record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, word);
			seedTestMappedStaticClosure(cpu, record);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry - 2 * INSTRUCTION_BYTES);
			assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.CLOSURE] + callEntryCycles), RunResult.Yielded);
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
	], closureRelocations: [{ wordIndex: 1, functionIndex: 1 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu } of machines) {
		seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
	}
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
		thread.stackRegisters.setInteger(8, 63);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 3);
	for (const { cpu } of machines) {
		assert.equal(cpu.getFrameDepth(), 2);
		assert.equal(cpu.rootThread.currentFrame!.pc, calleeEntry);
		assert.equal(cpu.rootThread.currentFrame!.stackBase, 8);
		assert.equal(cpu.rootThread.currentFrame!.registers.get(0), valueInteger(63),
			'activation keeps the supplied argument in its original slot');
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
	for (const { cpu } of machines) assert.equal(cpu.rootThread.frameAtDepth(0).registers.get(7), valueInteger(63),
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
			{ wordIndex: 1, functionIndex: 2 },
			{ wordIndex: 4, functionIndex: 1 },
		] }, RAM_CODE_FIXTURE_BYTES);
		const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
		for (const { cpu } of machines) {
			seedTestRomClosure(cpu, image.symbols.functionAddresses[2]);
			seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
		}
		// The first guest call retains backing storage before the raw function
		// record with parameters beyond maxStack is ever entered.
		runCpuParity(machines[0].cpu, machines[1].cpu, 20000);
		runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
		const entry = image.image.functions[0].codeAddress + 5 * INSTRUCTION_BYTES;
		const calleeEntry = image.image.functions[1].codeAddress;
		const lookup = machines[0].cpu.rootThread.frameAtDepth(0).executionImage.compiledCodeLookup!;
		for (const pc of [entry, calleeEntry]) assert.ok(lookup.find(pc, 0)!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) >>> 2],
			'the real caller and callee are generated before the initialization probe');
		for (const completion of [false, true]) {
			const retainedCapacities = machines.map(({ cpu }) => cpu.rootThread.stackRegisters.capacity());
			const argumentsByMachine = machines.map(({ cpu }) => {
				const thread = cpu.rootThread;
				const caller = thread.frameAtDepth(0);
				const closure = caller.registers.getPayload(0);
				const closureValue = caller.registers.get(0);
				const args: Value[] = [valueFloatBits(0x80000000), valueFloatBits(0xffa12345), valueString(nativeHeapReference(cpu).stringPool.intern('call-initialization')), valueBool(false), valueBool(true), closureValue].slice(0, argCount);
				assert.equal(thread.stackTop, 8);
				assert.equal(caller.stackCapacity, 8);
				assert.ok(thread.stackRegisters.capacity() >= 32);
				for (let index = 8; index < 32; ++index) thread.stackRegisters.set(index, closureValue);
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
					assert.equal(callee.registers.get(index), valueNil(), 'missing formals are nil');
				}
				nativeHeapReference(cpu).gc.collect();
				const state = cpu.captureRuntimeState();
				assert.equal(thread.stackTop, base + capacity);
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
	], closureRelocations: [{ wordIndex: 1, functionIndex: 1 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu } of machines) {
		seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
	}
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
		thread.stackRegisters.setInteger(8, 71);
		thread.stackRegisters.setInteger(9, 72);
		thread.stackRegisters.setInteger(10, 73);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
	}
	runCpuParity(machines[0].cpu, machines[1].cpu, 3);
	for (const { cpu } of machines) {
		const thread = cpu.rootThread;
		const callee = thread.currentFrame!;
		assert.equal(callee.stackBase, 11);
		assert.equal(callee.stackCapacity, 4);
		assert.equal(callee.top, 1);
		assert.equal(callee.registers.get(0), valueInteger(71));
		assert.equal(callee.varargBase, 9);
		assert.equal(callee.varargCount, 2);
		assert.equal(thread.stackRegisters.get(8), valueNil(), 'moved fixed parameters do not retain duplicate roots');
		assert.equal(thread.stackRegisters.get(9), valueInteger(72));
		assert.equal(thread.stackRegisters.get(10), valueInteger(73));
		callee.registers.setInteger(0, 99);
		assert.equal(thread.stackRegisters.get(10), valueInteger(73), 'working parameter writes cannot alter saved extras');
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	runCpuParity(machines[0].cpu, machines[1].cpu, 100, 1);
	for (const { cpu } of machines) assert.equal(cpu.rootThread.frameAtDepth(0).registers.get(7), valueInteger(99));
});

test('RET admits only the source values the receiver actually reads', () => {
	for (const selected of [1, 2]) {
		const text = new Uint8Array(7 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CALL, 0, 1, selected + 1);
		writeInstruction(text, 3, OpCode.HALT, 0, 0, 0);
		writeInstruction(text, 4, OpCode.K1, 0, 0, 0);
		writeInstruction(text, 5, OpCode.RET, 0, 3, 0);
		writeInstruction(text, 6, OpCode.HALT, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 4, maxStack: 2 }, { firstWord: 4, wordCount: 2, maxStack: 1 }, { firstWord: 6, wordCount: 1 },
		], exceptionFunctionIndex: 2, closureRelocations: [{ wordIndex: 1, functionIndex: 1 }] });
		for (const backend of [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter]) {
			const { cpu } = createTestHeapServiceCpu(image, backend);
			seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
			const callCycles = BASE_CYCLES[OpCode.CLOSURE] + BASE_CYCLES[OpCode.CALL];
			assert.equal(cpu.runUntilDepth(0, callCycles), RunResult.Yielded);
			const caller = cpu.rootThread.frameAtDepth(0), callee = cpu.rootThread.frameAtDepth(1);
			const before = caller.registers.get(0);
			const grant = BASE_CYCLES[OpCode.K1] + 1;
			if (selected === 1) {
				assert.equal(cpu.runUntilDepth(1, grant), RunResult.Halted);
				assert.equal(caller.registers.get(0), valueInteger(1));
				assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.RET] - 1);
			} else {
				assert.equal(cpu.runUntilDepth(1, grant), RunResult.Yielded);
				assert.equal(cpu.readEpcWord(), image.image.functions[1].codeAddress + INSTRUCTION_BYTES);
				assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
				assert.equal(caller.registers.get(0), before);
				assert.equal(callee.registers.get(0), valueInteger(1));
				assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.RET]);
			}
		}
	}
});

test('function records that exceed the physical stack or capture capacity fault before placement', () => {
	for (const captureCount of [false, true]) {
		const text = new Uint8Array(5 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CALL, 0, 1, 1);
		writeInstruction(text, 3, OpCode.HALT, 0, 0, 0);
		writeInstruction(text, 4, OpCode.RET, 0, 1, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 3 }, { firstWord: 4, wordCount: 1 }, { firstWord: 3, wordCount: 1 },
		], exceptionFunctionIndex: 2, closureRelocations: [{ wordIndex: 1, functionIndex: 1 }] });
		const field = captureCount ? BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET : BLUA32_FUNCTION_MAX_STACK_OFFSET;
		writeLE32(image.romBytes, image.symbols.functionAddresses[1] - SYSTEM_ROM_BASE + field, 0xffffffff);
		for (const backend of [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter]) {
			const { cpu } = createTestHeapServiceCpu(image, backend);
			if (!captureCount) seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
			if (!captureCount) assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			const caller = cpu.rootThread.frameAtDepth(0);
			const value = caller.registers.get(0);
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			assert.equal(cpu.readEpcWord(), image.image.functions[0].codeAddress + (captureCount ? 0 : 2 * INSTRUCTION_BYTES));
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
			assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[captureCount ? OpCode.CLOSURE : OpCode.CALL]);
			assert.equal(caller.registers.get(0), value);
			assert.equal(caller.stackCapacity, 1);
		}
	}
});

for (const wide of [false, true]) test(`generated CALL/RET preserve full state and fault boundaries (WIDE: ${wide})`, () => {
	const callBody = wide ? 4 : 3;
	const calleeStart = callBody + 3;
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 4, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 0, 4, 0);
	if (wide) writeInstruction(text, 3, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, callBody, OpCode.CALL, 0, 1, 2);
	writeInstruction(text, callBody + 1, OpCode.MOV, 6, 0, 0);
	writeInstruction(text, callBody + 2, OpCode.JMP, 0, 63, wide ? 59 : 60, 255);
	writeInstruction(text, calleeStart, OpCode.K1, 0, 0, 0);
	writeInstruction(text, calleeStart + 1, OpCode.RET, 0, 2, 0);
	writeInstruction(text, calleeStart + 2, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: calleeStart, maxStack: 8 }, { firstWord: calleeStart, wordCount: 2 }, { firstWord: calleeStart + 2, wordCount: 1 },
	], exceptionFunctionIndex: 2, closureRelocations: [{ wordIndex: 1, functionIndex: 1 }] }, RAM_CODE_FIXTURE_BYTES);
	const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
	seedTestRomClosure(js, image.symbols.functionAddresses[1]);
	seedTestRomClosure(ref, image.symbols.functionAddresses[1]);
	assert.equal(runCpuParity(js, ref, 10001), RunResult.Yielded);
	assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	const executionImage = js.rootThread.frameAtDepth(0).executionImage;
	const exits = new Set([...executionImage.decodedPages.values()].flatMap(page => page.compiledBlocks?.entries.filter(block => block !== null).map(block => block!.terminal.exit) ?? []));
	assert.ok(exits.has(CompiledBlockExit.Call) && exits.has(CompiledBlockExit.Return), 'both sides of the call use generated exits');
	for (const cpu of [js, ref]) {
		cpu.runUntilDepth(1, 100);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES);
		assert.equal(cpu.getFrameDepth(), 1);
		assert.equal(cpu.runUntilDepth(0, 3), RunResult.Yielded);
		assert.equal(cpu.getFrameDepth(), 2);
		assert.equal(cpu.rootThread.frameAtDepth(1).callSitePc, image.image.functions[0].codeAddress + callBody * INSTRUCTION_BYTES);
		assert.equal(cpu.runUntilDepth(0, 5), RunResult.Yielded);
		assert.equal(cpu.getFrameDepth(), 1);
		cpu.rootThread.frameAtDepth(0).registers.setInteger(4, 77);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_CALL_NON_FUNCTION);
		assert.equal(cpu.readEpcWord(), image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES);
		assert.equal(cpu.readFrameRegister(0, 6), valueInteger(1));
	}
	assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
});

for (const editReturn of [false, true]) test(`CALL keeps its bound record when the suspended caller's ${editReturn ? 'return address' : 'call instruction'} is rewritten`, () => {
	const recordAddress = 0x08005000;
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 4, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 0, 4, 0);
	writeInstruction(text, 3, OpCode.CALL, 0, 1, 2);
	writeInstruction(text, 4, OpCode.MOV, 6, 0, 0);
	writeInstruction(text, 5, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 6, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 7, OpCode.RET, 0, 2, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 6, maxStack: 8 }, { firstWord: 6, wordCount: 2 },
	], closureRelocations: [{ wordIndex: 1, functionAddress: recordAddress }] }, RAM_CODE_FIXTURE_BYTES);
	const states = [];
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu, memory } = createTestHeapServiceCpu(image, backend);
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
		seedTestMappedStaticClosure(cpu, recordAddress);
		assert.equal(cpu.runUntilDepth(0, 10001), RunResult.Yielded);
		const page = cpu.rootThread.frameAtDepth(0).decodedPage!;
		if (backend === CpuExecutionBackend.JavaScript) assert.equal(page.compiledBlocks!.entries[2]!.terminal.exit, CompiledBlockExit.Call);
		cpu.runUntilDepth(1, 100);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE + 2 * INSTRUCTION_BYTES);
		source.armed = true;
		assert.equal(cpu.runUntilDepth(0, 3), RunResult.Yielded);
		assert.equal(source.writes, 0, 'this call consumes a published prototype without repeating the construction bus read');
		assert.equal(cpu.getFrameDepth(), 2);
		const caller = cpu.rootThread.frameAtDepth(0), returnPc = DYNAMIC_RAM_BASE + 4 * INSTRUCTION_BYTES;
		assert.equal(caller.pc, returnPc);
		caller.registers.setInteger(6, 73);
		const edit = editReturn ? 4 : 3;
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(page.compiledBlocks!.entries[editReturn ? 4 : 2]);
		memory.writeBytes(DYNAMIC_RAM_BASE + edit * INSTRUCTION_BYTES, replacement);
		if (backend === CpuExecutionBackend.JavaScript) assert.equal(page.compiledBlocks!.entries[editReturn ? 4 : 2], null);
		if (!editReturn) cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE + 2 * INSTRUCTION_BYTES);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assert.equal(cpu.getFrameDepth(), 1);
		assert.equal(cpu.readFramePc(0), DYNAMIC_RAM_BASE + (edit + 1) * INSTRUCTION_BYTES);
		assert.equal(cpu.readFrameRegister(0, 6), valueInteger(73), 'the obsolete MOV must not run');
		if (editReturn) assert.equal(cpu.readFrameRegister(0, 0), valueInteger(1), 'RET delivers its result before fetching the new instruction');
		const state = cpu.captureRuntimeState();
		const ram = memory.captureSaveState();
		memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(state);
		assert.equal(source.writes, 0, 'restoring an I/O-backed closure must not sample its source again');
		assert.deepEqual(cpu.captureRuntimeState(), state);
		states.push(state);
	}
	assert.deepEqual(states[1], states[0]);
});
