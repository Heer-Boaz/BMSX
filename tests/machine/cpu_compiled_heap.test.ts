import { GC_LAST_EPOCH_WORK } from '../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { GC_COLOR_OFFSET } from '../../machine/ts/machine/cpu/gc_object';
import { textToByteString } from '../../machine/ts/common/byte_string';
import { numberConstantFromHost } from '../../toolchain/ts/lua/number';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CPU, CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { COMPILED_BLOCK_THRESHOLD, CompiledBlockExit, CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { valueBool, valueBuiltinFunction, valueFloat, valueFloatBits, valueInteger, valueNil, valueString, ValueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { CLOSURE_ADDRESS_REGISTER_WIDE_C, INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { DYNAMIC_RAM_BASE, MAIN_RAM_SIZE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { HEAP_SERVICE_IMAGE_FLAG } from '../../machine/ts/spec/bmsx/heap_service';
import { createTestSystemCpu, linkRawTestSystemBlua32, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';

function assertParity(js: CPU, ref: CPU): void {
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()), 'full values, heap graph, roots, frame extents and control latches');
	assert.equal(js.instructionBudgetRemaining, ref.instructionBudgetRemaining);
	assert.equal(js.readCurrentInstructionPc(), ref.readCurrentInstructionPc());
	assert.equal(js.lastPc, ref.lastPc);
}

test('a warm JavaScript NEWT exit yields to the bound BIOS before its compiled continuation', t => {
	const image = linkTestSystemBlua32(compileHeapServiceSystem('local t = {40, answer = 2}\nreturn t[1] + t.answer', 0));
	assert.ok(image.image.header.flags & HEAP_SERVICE_IMAGE_FLAG);
	const functionAddress = image.vectors.entryFunctionAddress;
	const pc = image.image.functions[image.symbols.functionAddresses.indexOf(functionAddress)].codeAddress;
	const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
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
	const entry = (pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = frame.decodedPage!.compiledBlocks!.entries[entry]!;
	const { terminal, region } = block;
	assert.equal(terminal.exit, CompiledBlockExit.AllocateTable);
	assert.ok(terminal.resumesFrame);
	assert.ok(block.page.compiledBlocks!.entries[(terminal.nextPc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES],
		'the generated region includes a warm continuation');
	assert.ok(terminal.exitB > 0 && terminal.exitC > 0, 'the compound reservation includes both backings');
	const execute = region.execute;
	let returnedExit: CompiledBlockExit | undefined;
	const compiled = t.mock.method(region, 'execute', (...args: Parameters<typeof execute>) => {
		const exitIndex = execute(...args);
		returnedExit = region.exits[exitIndex].exit;
		return exitIndex;
	});
	enter();
	frame.registers.setInteger(terminal.exitA, 73);
	assert.equal(grant(), RunResult.Yielded);
	assert.equal(compiled.mock.callCount(), 1);
	assert.equal(returnedExit, CompiledBlockExit.AllocateTable);
	assert.equal(cpu.heapServiceActive(), true);
	assert.equal(frame.pc, terminal.currentPc);
	assert.equal(frame.registers.getInteger(terminal.exitA), 73, 'destination was not committed at launch');
	retireService();
	assert.equal(compiled.mock.callCount(), 1, 'allocator grants ran only the pinned BIOS lane');
	assert.equal(frame.pc, terminal.nextPc);
	assert.equal(frame.registers.getTag(terminal.exitA), ValueTag.Table);
	assert.equal(grant(), RunResult.Halted);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	assert.deepEqual(values, [valueInteger(42)]);
});

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
				case 0: r.setString(0, cpu.stringPool.intern(textToByteString('λ\0🍻'))); break;
				case 1: r.setTable(0, cpu.createTable(0, 0)); break;
				case 2: r.setClosure(0, root.closure); break;
				case 3: r.setThread(0, cpu.rootThread.address); break;
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
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 8 }], constants: [numberConstantFromHost(-0), textToByteString('🍻')] });
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
		if (count === 513) {
			assert.equal(js.rootThread.frameAtDepth(0).registers.get(513), valueBool(false));
			const pending = js.captureRuntimeState().concat!;
			assert.equal(pending.registersLeft, count);
			assert.equal(pending.length, 0);
			js.runUntilDepth(0, count); ref.runUntilDepth(0, count); assertParity(js, ref);
			js.runUntilDepth(0, expected.length); ref.runUntilDepth(0, expected.length); assertParity(js, ref);
		}
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
		closureRelocations: closure ? [{ wordIndex: 3, functionIndex: 1 }] : [] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	const pc = image.image.functions[0].codeAddress;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers; r.setInteger(9, 1); r.setInteger(1, 2); r.setInteger(2, 3);
		cpu.runUntilDepth(0, closure ? 405 : 400);
	}
	const entry = (pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(js.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries[entry]!.terminal.exit,
		closure ? CompiledBlockExit.CreateClosure : CompiledBlockExit.Concat);
	for (const cpu of [js, ref]) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		const root = cpu.rootThread.frameAtDepth(0), r = root.registers, table = cpu.createTable(1024, 1);
		cpu.gc.tables.setStringKey(table, cpu.stringPool.intern('payload'), valueString(cpu.stringPool.intern('retained')));
		r.setTable(9, table); r.setString(1, cpu.stringPool.intern('fresh-')); r.setString(2, cpu.stringPool.intern('result'));
		root.top = 0;
		const trackedBytes = cpu.luaHeap.usedBytes();
		cpu.luaHeap.setCollectionTarget(trackedBytes);
	}
	assert.equal(js.runUntilDepth(0, 516), ref.runUntilDepth(0, 516)); assertParity(js, ref);
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers, retained = r.getPayload(7);
		assert.ok(cpu.gc.active(), 'allocation started the configured collection assist');
		assert.equal(cpu.gc.memory.readRamRecordByte(retained + GC_COLOR_OFFSET), 3, 'the allocating operation traced the published reference before returning');
		cpu.gc.collect();
		assert.equal(cpu.gc.tables.getStringKey(retained, cpu.stringPool.find('payload')!), valueString(cpu.stringPool.find('retained')!));
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
		closureRelocations: [{ wordIndex: 2, functionAddress: target }, { wordIndex: 5, functionAddress: target }] }, BLUA32_FUNCTION_RECORD_SIZE);
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
		assert.equal(js.captureClosureBinding(frame.registers.getClosure(source, js.gc)).functionAddress, image.symbols.functionAddresses[index]);
	}
});

for (const range of [false, true]) for (const bytes of [3 << 19, (2 << 20) - 1, 2 << 20, (2 << 20) + 1])
test(`compiled concatenation retains the exact fault prefix (range=${range}, operand bytes=${bytes})`, t => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 8, 0, 0);
	writeInstruction(text, 1, range ? OpCode.CONCATN : OpCode.CONCAT, 0, 1, 2);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255); writeInstruction(text, 32, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 16 }, { firstWord: 32, wordCount: 1 }], exceptionFunctionIndex: 1, constants: ['12'] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		cpu.rootThread.frameAtDepth(0).registers.setInteger(1, 1); cpu.rootThread.frameAtDepth(0).registers.setInteger(2, 2);
		cpu.runUntilDepth(0, range ? 396 : 320);
		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
		const r = cpu.rootThread.frameAtDepth(0).registers, id = cpu.stringPool.intern('x'.repeat(bytes));
		r.setString(1, id); r.setString(2, id); r.setInteger(0, 73); cpu.rootThread.frameAtDepth(0).top = 0;
	}
	const frame = js.rootThread.frameAtDepth(0), pc = image.image.functions[0].codeAddress;
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!.terminal.exit,
		range ? CompiledBlockExit.ConcatRange : CompiledBlockExit.Concat);
	const lastWorkAt = js.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET + GC_LAST_EPOCH_WORK;
	const beforeWork = js.memory.readRamRecordWord(lastWorkAt);
	const reads = 2 * bytes >= MAIN_RAM_SIZE ? t.mock.method(js.stringPool, 'copyBytes') : null;
	assert.equal(js.runUntilDepth(0, range ? 5 : 4), ref.runUntilDepth(0, range ? 5 : 4)); assertParity(js, ref);
	if (reads !== null) assert.equal(reads.mock.callCount(), 0, 'no payload reads before the size fault');
	else {
		assert.equal(js.instructionBudgetRemaining, range ? -2 : 0);
		js.runUntilDepth(0, 2 * bytes); ref.runUntilDepth(0, 2 * bytes); assertParity(js, ref);
	}
	assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY); assert.equal(js.readEpcWord(), pc + INSTRUCTION_BYTES);
	const afterWork = js.memory.readRamRecordWord(lastWorkAt);
	const recoverableSize = 2 * bytes + BLUA32_STRING_RECORD_HEADER_SIZE <= js.luaHeap.capacity();
	const work = recoverableSize ? afterWork : 0;
	if (recoverableSize) assert.ok(work > 0);
	else assert.equal(afterWork, beforeWork, 'size fault does not run a recovery epoch');
	assert.equal(js.instructionBudgetRemaining, (2 * bytes < MAIN_RAM_SIZE ? 0 : -MAIN_RAM_SIZE - (range ? 2 : 0)) - 3 * work);
	assert.equal(frame.registers.getInteger(0), 73); assert.equal(frame.top, 9);
});

for (const over of [false, true]) test(`CONCATN admits the exact mixed byte length before reading payloads (over=${over})`, t => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.CONCATN, 0, 1, 32);
	writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 33 },
		{ firstWord: 1, wordCount: 1 }], exceptionFunctionIndex: 1 });
	const { cpu } = createTestSystemCpu(image);
	const frame = cpu.rootThread.currentFrame!, id = cpu.stringPool.intern('x'.repeat(135300));
	for (let i = 1; i <= 31; ++i) frame.registers.setString(i, id);
	// Four bytes remain: nil fits, false does not.
	frame.registers.set(32, over ? valueBool(false) : valueNil());
	const reads = t.mock.method(cpu.stringPool, 'copyBytes');
	cpu.runUntilDepth(0, BASE_CYCLES[OpCode.CONCATN]);
	if (!over) { assert.equal(cpu.instructionBudgetRemaining, -32); cpu.runUntilDepth(0, MAIN_RAM_SIZE - 1); }
	assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
	assert.equal(cpu.instructionBudgetRemaining, over ? -MAIN_RAM_SIZE - 32 : 0);
	if (over) assert.equal(reads.mock.callCount(), 0);
	assert.equal(frame.registers.get(0), valueNil());
});
