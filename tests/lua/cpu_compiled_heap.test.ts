import { numberConstantFromHost } from '../../toolchain/ts/lua/number';
import { utf8ByteLength } from '../../machine/ts/common/utf8';
import { ceilDiv4 } from '../../machine/ts/machine/common/numeric';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CompiledBlockExit, CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { valueBool, valueBuiltinFunction, valueFloat, valueFloatBits, valueInteger, valueNil, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { CLOSURE_ADDRESS_REGISTER_WIDE_C, INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { DYNAMIC_RAM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

function assertParity(js: CPU, ref: CPU): void {
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()), 'full values, heap graph, roots, frame extents and control latches');
	assert.equal(js.instructionBudgetRemaining, ref.instructionBudgetRemaining);
	assert.equal(js.readCurrentInstructionPc(), ref.readCurrentInstructionPc());
	assert.equal(js.lastPc, ref.lastPc);
}

for (const destination of [0, 1, 2]) test(`compiled CONCAT converts every value kind before an overlapping write (A=${destination})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 8, 0, 0);
	writeInstruction(text, 1, OpCode.CONCAT, destination, 0, 1);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 16 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	const pc = image.image.functions[0].codeAddress, entry = (pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	for (const cpu of [js, ref]) for (let warm = 0; warm < 12; ++warm) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.rootThread.frameAtDepth(0).registers.setInteger(0, 1); cpu.rootThread.frameAtDepth(0).registers.setInteger(1, 2);
		cpu.runUntilDepth(0, 4);
	}
	const frame = js.rootThread.frameAtDepth(0), block = frame.decodedPage!.compiledBlocks!.entries[entry]!;
	assert.equal(block.terminal.exit, CompiledBlockExit.Concat); assert.equal(block.sourceWords, 2);
	const primitives: [Value, string][] = [[valueNil(), 'nil'], [valueBool(false), 'false'], [valueBool(true), 'true'],
		[valueInteger(0), '0'], [valueFloat(-0), '-0.0'], [valueFloatBits(0xffa12345), 'nan'],
		[valueFloat(Infinity), 'inf'], [valueFloat(-Infinity), '-inf'], [valueFloat(1.234565), '1.234565'],
		[valueBuiltinFunction(BuiltinFunctionId.Type), 'function']];
	for (let kind = 0; kind < primitives.length + 4; ++kind) {
		const expected = kind < primitives.length ? primitives[kind][1]
			: ['λ\0🍻', 'table', 'function', 'thread'][kind - primitives.length];
		for (const cpu of [js, ref]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			const root = cpu.rootThread.frameAtDepth(0), r = root.registers; root.top = 0;
			if (kind < primitives.length) r.set(0, primitives[kind][0]);
			else switch (kind - primitives.length) {
				case 0: r.setString(0, cpu.stringPool.intern('λ\0🍻')); break;
				case 1: r.setTable(0, cpu.gc.reference(cpu.createTable(0, 0))); break;
				case 2: r.setClosure(0, cpu.gc.reference(root.closure)); break;
				case 3: r.setThread(0, cpu.gc.reference(cpu.rootThread)); break;
			}
			r.setString(1, cpu.stringPool.intern('!'));
		}
		assert.equal(js.runUntilDepth(0, 4), ref.runUntilDepth(0, 4)); assertParity(js, ref);
		assert.equal(js.stringPool.toString(frame.registers.getStringId(destination)), expected + '!');
		assert.equal(frame.top, 9);
	}
});

test('compiled CONCAT preserves signed RK constants and Unicode without numeric-word conversion', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 7, 0, 0);
	writeInstruction(text, 1, OpCode.CONCAT, 0, 63, 62, 63); // K[0], K[1].
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 8 }], constants: [numberConstantFromHost(-0), '🍻'] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	js.runUntilDepth(0, 320); ref.runUntilDepth(0, 320); assertParity(js, ref);
	const frame = js.rootThread.frameAtDepth(0), entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const terminal = frame.decodedPage!.compiledBlocks!.entries[entry]!.terminal;
	assert.equal(terminal.exit, CompiledBlockExit.Concat); assert.equal(terminal.exitB, -1); assert.equal(terminal.exitC, -2);
	assert.equal(js.stringPool.toString(frame.registers.getStringId(0)), '-0.0🍻');
});

for (const count of [0, 3, 513]) test(`compiled WIDE CONCATN reads exactly its register range before overwriting it (C=${count})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 7, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 2, 1, count >> 9);
	writeInstruction(text, 2, OpCode.CONCATN, 1, 0, count & 63);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 1025 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	const pc = image.image.functions[0].codeAddress;
	let expected = '';
	for (let i = 0; i < count; ++i) expected += i === 0 ? 'L' : i === 1 ? 'false' : String(i % 10);
	for (let warm = 0; warm < 12; ++warm) {
		for (const cpu of [js, ref]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			const r = cpu.rootThread.frameAtDepth(0).registers;
			for (let i = 0; i < count; ++i) {
				if (i === 0) r.setString(512, cpu.stringPool.intern('L'));
				else if (i === 1) r.setBoolean(513, false); else r.setInteger(512 + i, i % 10);
			}
		}
		assert.equal(js.runUntilDepth(0, 5), ref.runUntilDepth(0, 5)); assertParity(js, ref);
		assert.equal(js.stringPool.toString(js.rootThread.frameAtDepth(0).registers.getStringId(513)), expected);
	}
	const frame = js.rootThread.frameAtDepth(0), entry = (pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[entry]!.terminal.exitC, count);
	assert.equal(frame.top, 514, 'reading the sources does not extend top through the counted range');
});

for (const closure of [false, true]) test(`compiled allocation publishes moved reference roots before collection (closure=${closure})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.MOV, 7, 9, 0);
	writeInstruction(text, 1, OpCode.KNIL, 9, 0, 0);
	if (closure) {
		writeInstruction(text, 2, OpCode.WIDE, 0, 0, 0); writeInstruction(text, 3, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	} else {
		writeInstruction(text, 2, OpCode.CONCAT, 0, 1, 2); writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	}
	writeInstruction(text, 16, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: closure ? 5 : 4, maxStack: 16 },
		{ firstWord: 16, wordCount: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 7 }] }],
		closureRelocations: closure ? [{ wordIndex: 3, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }] : [] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	const pc = image.image.functions[0].codeAddress;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers; r.setInteger(9, 1); r.setInteger(1, 2); r.setInteger(2, 3);
		cpu.runUntilDepth(0, closure ? 405 : 400);
	}
	const entry = (pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(js.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries[entry]!.terminal.exit,
		closure ? CompiledBlockExit.CreateClosure : CompiledBlockExit.Concat);
	const garbage: string[] = [];
	for (const cpu of [js, ref]) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		const root = cpu.rootThread.frameAtDepth(0), r = root.registers, table = cpu.createTable(0, 1);
		table.records.setStringKey(table.address, cpu.stringPool.intern('payload'), valueString(cpu.stringPool.intern('retained')));
		r.setTable(9, cpu.gc.reference(table)); r.setString(1, cpu.stringPool.intern('fresh-')); r.setString(2, cpu.stringPool.intern('result'));
		root.top = 0;
		const heap = cpu.captureRuntimeState().luaHeap, text = 'g'.repeat(cpu.luaHeap.capacity() - heap.trackedBytes - 1);
		cpu.luaHeap.restoreState({ trackedBytes: heap.trackedBytes, nextCollectionBytes: cpu.luaHeap.capacity() });
		cpu.stringPool.intern(text); garbage.push(text);
	}
	assert.equal(js.runUntilDepth(0, 6), ref.runUntilDepth(0, 6)); assertParity(js, ref);
	for (const [index, cpu] of [js, ref].entries()) {
		assert.equal(cpu.stringPool.find(garbage[index]), undefined, 'the allocating operation really collected unreachable pressure');
		const r = cpu.rootThread.frameAtDepth(0).registers, retained = r.getTable(7, cpu.gc);
		assert.equal(retained.records.getStringKey(retained.address, cpu.stringPool.find('payload')!), valueString(cpu.stringPool.find('retained')!));
		if (closure) assert.equal(cpu.readClosureUpvalue(r.getClosure(0, cpu.gc), 0), r.get(7));
		else assert.equal(cpu.stringPool.toString(r.getStringId(0)), 'fresh-result');
	}
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
		closureRelocations: [{ wordIndex: 2, functionAddress: target }, { wordIndex: 5, functionAddress: target }] });
	const left = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), right = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const record = image.symbols.functionAddresses[1] - SYSTEM_ROM_BASE;
	for (const { memory } of [left, right]) memory.writeBytes(target, image.romBytes.subarray(record, record + BLUA32_FUNCTION_RECORD_SIZE));
	const js = left.cpu, ref = right.cpu;
	js.runUntilDepth(0, 500); ref.runUntilDepth(0, 500); assertParity(js, ref);
	const frame = js.rootThread.frameAtDepth(0), entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = frame.decodedPage!.compiledBlocks!.entries[entry]!;
	assert.equal(block.terminal.exit, CompiledBlockExit.CreateClosure); assert.equal(block.sourceWords, 3);
	assert.equal(block.terminal.exitBx, target / BLUA32_FUNCTION_ALIGNMENT); assert.ok(block.terminal.exitBx > 0xffff);
	assert.equal(frame.registers.get(0), frame.registers.get(2));
});

for (const descriptors of [false, true]) test(`hot register CLOSURE preserves its prefix and destination on bus failure (upvalues=${descriptors})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 7, 0, 0); writeInstruction(text, 1, OpCode.GETGL, 0, 0, 0);
	writeInstruction(text, 2, OpCode.WIDE, 4, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C);
	writeInstruction(text, 3, OpCode.CLOSURE, 0, 0, 0); // R256 = closure at u32(R0).
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255); writeInstruction(text, 16, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 257 },
		{ firstWord: 16, wordCount: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 7 }] }], globalNames: ['target'] });
	const left = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), right = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const target = image.symbols.functionAddresses[1], bad = 0xdead0000;
	for (const { cpu } of [left, right]) {
		cpu.setGlobalByKey(cpu.stringPool.find('target')!, valueInteger(target)); cpu.runUntilDepth(0, 32 * (BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.GETGL] + BASE_CYCLES[OpCode.CLOSURE] + 1 + BASE_CYCLES[OpCode.JMP]));
	}
	const js = left.cpu, ref = right.cpu, frame = js.rootThread.frameAtDepth(0);
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[entry]!.terminal.exit, CompiledBlockExit.CreateClosure);
	for (const { cpu, memory } of [left, right]) {
		if (descriptors) {
			const offset = target - SYSTEM_ROM_BASE;
			memory.writeBytes(DYNAMIC_RAM_BASE, image.romBytes.subarray(offset, offset + BLUA32_FUNCTION_RECORD_SIZE));
			memory.writeMappedU32LE(DYNAMIC_RAM_BASE + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, bad);
		}
		cpu.setGlobalByKey(cpu.stringPool.find('target')!, valueInteger(descriptors ? DYNAMIC_RAM_BASE : bad));
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
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: source + 1 },
		{ firstWord: 16, wordCount: 1 }, { firstWord: 16, wordCount: 1, staticClosure: false }], globalNames: ['target'] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		cpu.setGlobalByKey(cpu.stringPool.find('target')!, valueInteger(image.symbols.functionAddresses[1]));
		cpu.runUntilDepth(0, 400);
	}
	const frame = js.rootThread.frameAtDepth(0), pc = image.image.functions[0].codeAddress;
	const block = frame.decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	assert.equal(block.terminal.exitBx, source); assert.equal(block.terminal.exitA, source);
	for (const index of [2, 1, 2, 2, 1]) {
		for (const cpu of [js, ref]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			cpu.setGlobalByKey(cpu.stringPool.find('target')!, valueInteger(image.symbols.functionAddresses[index]));
		}
		assert.equal(js.runUntilDepth(0, 4), ref.runUntilDepth(0, 4)); assertParity(js, ref);
		assert.equal(frame.registers.getClosure(source, js.gc).functionAddress, image.symbols.functionAddresses[index]);
	}
});

for (const range of [false, true]) test(`compiled concatenation allocation failure retains its destination and exact fault prefix (range=${range})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 8, 0, 0);
	writeInstruction(text, 1, range ? OpCode.CONCATN : OpCode.CONCAT, 0, 1, 2);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255); writeInstruction(text, 32, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 16 }, { firstWord: 32, wordCount: 1 }], exceptionFunctionIndex: 1 });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		cpu.rootThread.frameAtDepth(0).registers.setInteger(1, 1); cpu.rootThread.frameAtDepth(0).registers.setInteger(2, 2);
		cpu.runUntilDepth(0, range ? 396 : 320);
		cpu.luaHeap.restoreState({ trackedBytes: cpu.luaHeap.usedBytes(), nextCollectionBytes: cpu.luaHeap.capacity() });
		const r = cpu.rootThread.frameAtDepth(0).registers, id = cpu.stringPool.intern('x'.repeat(2 * 1024 * 1024));
		r.setString(1, id); r.setString(2, id); r.setInteger(0, 73); cpu.rootThread.frameAtDepth(0).top = 0;
	}
	const frame = js.rootThread.frameAtDepth(0), pc = image.image.functions[0].codeAddress;
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!.terminal.exit,
		range ? CompiledBlockExit.ConcatRange : CompiledBlockExit.Concat);
	const strings = js.stringPool.captureState();
	// Only the root Thread and closure are objects. The Thread is remarked;
	// all directory slots and allocated text are examined once at sweep.
	const gcCycles = 4 * ceilDiv4(64 + js.rootThread.stackRegisters.capacity() * 5) + 2 * 4
		+ strings.slots + strings.entries.reduce((sum, entry) => sum + (entry.tracked ? ceilDiv4(utf8ByteLength(entry.value)) : 0), 0);
	assert.equal(js.runUntilDepth(0, range ? 5 : 4), ref.runUntilDepth(0, range ? 5 : 4)); assertParity(js, ref);
	assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY); assert.equal(js.readEpcWord(), pc + INSTRUCTION_BYTES);
	assert.equal(js.instructionBudgetRemaining, -4 * 1024 * 1024 - (range ? 2 : 0) - gcCycles, 'allocation faults retain complete logical text-work and pre-request collection charges');
	assert.equal(frame.registers.getInteger(0), 73); assert.equal(frame.top, 9);
});
