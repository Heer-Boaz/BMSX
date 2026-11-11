import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCpuParity } from '../helpers/cpu_execution';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { Closure, type Upvalue } from '../../machine/ts/machine/cpu/closure';
import { ValueTag, valueString } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
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
	runCpuParity(js, ref, 1100);
	const frame = js.rootThread.frameAtDepth(0), page = frame.decodedPage!;
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = page.compiledBlocks!.entries[entry]!;
	assert.equal(block.sourceWords, 8);
	for (const cpu of [js, ref]) for (let i = 0; i < 257; ++i) {
		cpu.setGlobalByKey(cpu.stringPool.intern(`grown-${i}`), ValueTag.Number, i, null);
	}
	for (const value of [null, false, true, -0, NaN, Infinity, 'text'] as const) {
		for (const cpu of [js, ref]) {
			const r = cpu.rootThread.frameAtDepth(0).registers;
			r.set(12, value === 'text' ? valueString(cpu.stringPool.intern(value)) : value);
			cpu.setGlobalByKey(cpu.stringPool.intern('shared'), r.getTag(12), r.getScalar(12), r.getReference(12));
			cpu.setSystemGlobalByKey(cpu.stringPool.intern('shared'), ValueTag.Number, 73, null);
		}
		runCpuParity(js, ref, 11);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		assert.equal(js.getSystemGlobalByKey(js.stringPool.find('copied')!), frame.registers.get(12));
		assert.equal(js.getGlobalByKey(js.stringPool.find('copied')!), 73);
		assert.equal(frame.top, 3, 'global stores do not extend top to the source register');
	}
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers;
		r.setTable(12, cpu.createTable(0, 0));
		cpu.setGlobalByKey(cpu.stringPool.intern('shared'), r.getTag(12), r.getScalar(12), r.getReference(12));
	}
	runCpuParity(js, ref, 11);
	assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	assert.equal(js.getSystemGlobalByKey(js.stringPool.find('copied')!), frame.registers.getTable(12));
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
	const constants = [null, false, true, 'literal', -0, NaN, Infinity, 11];
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 7, maxStack: 16 }], constants });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) { cpu.rootThread.frameAtDepth(0).registers.setNumber(2, 0); cpu.runUntilDepth(0, 700); }
	const frame = js.rootThread.frameAtDepth(0), page = frame.decodedPage!;
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(page.compiledBlocks!.entries[entry]!.sourceWords, 7);
	for (const input of [0, 1.9, 2.9, 3, 4, 5, 6, 7, 4294967296, NaN, Infinity, -Infinity, -0]) {
		for (const cpu of [js, ref]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
			cpu.rootThread.frameAtDepth(0).registers.setNumber(2, input);
		}
		runCpuParity(js, ref, 7);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		const constant = constants[input >>> 0];
		assert.equal(frame.registers.get(3), constant === 'literal' ? valueString(js.stringPool.find(constant)!) : constant);
		assert.equal(frame.registers.getTag(8), ValueTag.Nil);
		assert.equal(frame.registers.getTag(9), ValueTag.Nil);
		assert.equal(frame.top, 10, 'zero-count nil fill does not extend top');
	}
});

test('a hot WIDE LOADKR fault publishes its prefix before trapping without writing the destination', () => {
	for (const bad of [8, -1, 4294967295]) {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.K1, 7, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 1, 1, 0);
		writeInstruction(text, 2, OpCode.LOADKR, 0, 1, 0); // R256 = K[U32(R513)], not RK[513].
		writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 514 }], constants: [11] });
		const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
		for (const cpu of [js, ref]) { cpu.rootThread.frameAtDepth(0).registers.setNumber(513, 0); cpu.runUntilDepth(0, 300); }
		const frame = js.rootThread.frameAtDepth(0), page = frame.decodedPage!;
		const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
		assert.equal(page.compiledBlocks!.entries[entry]!.exits[0].exit, CompiledBlockExit.InvalidConstant);
		for (const cpu of [js, ref]) {
			cpu.rootThread.frameAtDepth(0).registers.setNumber(256, 73);
			cpu.rootThread.frameAtDepth(0).registers.setNumber(513, bad);
			cpu.rootThread.frameAtDepth(0).top = 0;
		}
		runCpuParity(js, ref, 3);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
		assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
		assert.equal(frame.registers.getNumber(256), 73);
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
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const frame = cpu.rootThread.frameAtDepth(0);
		const open: Upvalue = { hashId: 100, open: true, index: 0, frame, valueTag: ValueTag.Nil, valueScalar: NaN, valueReference: null, nextOpen: null };
		const closed: Upvalue = { hashId: 101, open: false, index: 0, frame: null, valueTag: ValueTag.Nil, valueScalar: NaN, valueReference: null, nextOpen: null };
		frame.closure = new Closure(frame.functionAddress, [open, closed], 0);
		cpu.runUntilDepth(0, 1100);
	}
	const frame = js.rootThread.frameAtDepth(0), page = frame.decodedPage!;
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const region = page.compiledBlocks!.entries[entry]!.region;
	assert.equal(region.entries[0].sourceWords, 9);
	for (const value of [null, false, true, -0, NaN, 'upvalue'] as const) {
		for (const cpu of [js, ref]) cpu.rootThread.frameAtDepth(0).registers.set(12,
			value === 'upvalue' ? valueString(cpu.stringPool.intern(value)) : value);
		runCpuParity(js, ref, 11);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		assert.equal(frame.registers.getNumber(3), 10, 'SETUP invalidates the earlier cached alias of R0');
		assert.equal(frame.registers.getNumber(4), 9);
		assert.equal(frame.registers.get(6), frame.registers.get(12));
		assert.equal(frame.top, 7, 'SETUP does not extend top to its source register');
	}
	const upvalue = frame.closure.upvalues[0];
	upvalue.open = false; upvalue.frame = null; upvalue.valueTag = ValueTag.Number; upvalue.valueScalar = 1;
	const r = frame.registers, setEncoded = r.setEncoded.bind(r), writes = new Uint32Array(16);
	r.setEncoded = (index, tag, scalar, reference) => { ++writes[index]; setEncoded(index, tag, scalar, reference); };
	const block = page.compiledBlocks!.entries[entry]!, run = {
		remainingCycles: block.region.entries.reduce((cycles, entry) => cycles + entry.terminal.cycles, 0), registerTop: frame.top,
	};
	const exit = block.region.exits[block.region.execute(r, frame.executionImage.constScalars, page, frame, block.entry, run)];
	assert.equal(exit.nextPc, image.image.functions[0].codeAddress); assert.equal(run.remainingCycles, 0);
	assert.equal(writes[0], 1, 'an ordinary closed-cell write does not publish unrelated local definitions');
	assert.equal(writes[2], 1, 'a pending numeric source is forwarded to the upvalue without an intermediate writeback');
	assert.equal(r.getNumber(3), 2);
});

test('an empty compiled open VARARG changes top without touching or growing the destination range', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.VARARG, 31, 0, 0);
	writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 4 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		cpu.rootThread.frameAtDepth(0).registers.setNumber(0, 73); cpu.runUntilDepth(0, 600);
	}
	assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	const frame = js.rootThread.frameAtDepth(0);
	assert.equal(frame.top, 31); assert.equal(frame.stackCapacity, 4); assert.equal(frame.registers.getNumber(0), 73);
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
			for (let i = 0; i < count; ++i) root.registers.set(i + 1, i === 0 ? false : i === 1 ? null : i);
			root.top = count + 1;
			assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded);
			assert.equal(cpu.rootThread.frameAtDepth(1).varargCount, count);
		}
		runCpuParity(js, ref, 9);
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState(), 'a full hot-block grant also covers the growing exit');
		if (count === 63) assert.ok(js.rootThread.frameAtDepth(1).stackCapacity > 16);
		for (const grant of [0, 1, 1, 2, 1, 1, 2, 1]) {
			runCpuParity(js, ref, grant);
			assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
		}
		assert.equal(js.rootThread.frameAtDepth(1).top, count, 'the second open VARARG replaces, rather than maximizes, top');
		assert.equal(page.compiledBlocks!.entries[entry]!.region.entries[0].sourceWords, 7,
			'the complete generated loop survives frame relocation and added helper-resume entries');
	}
});
