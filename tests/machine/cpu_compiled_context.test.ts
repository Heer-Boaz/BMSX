import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeRegisterStores, runCpuParity } from '../helpers/cpu_execution';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { integerConstant, numberConstantFromHost } from '../../toolchain/ts/lua/number';
import { valueBool, valueFloat, valueFloatBits, valueInteger, valueNil, ValueTag, valueString } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
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
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[entry]!.sourceWords, 2);
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
