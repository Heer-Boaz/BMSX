import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { ValueTag, valueString } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { LUA_FAULT_REASON_INDEX_NIL, LUA_FAULT_REASON_METATABLE_LOOP, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

test('compiled generic arrays and string-cache probes retain all kinds across key changes, rehashing and nil writes', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 9, 0, 0);
	writeInstruction(text, 1, OpCode.SETI, 0, 2, 9);
	writeInstruction(text, 2, OpCode.SETT, 0, 1, 2);
	writeInstruction(text, 3, OpCode.GETT, 3, 0, 1);
	writeInstruction(text, 4, OpCode.LEN, 4, 0, 0);
	writeInstruction(text, 5, OpCode.MOV, 5, 9, 0);
	writeInstruction(text, 6, OpCode.JMP, 0, 63, 57, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 7, maxStack: 12 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image).cpu;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frames[0].registers;
		r.setTable(0, cpu.createTable(4, 1)); r.setNumber(1, 1); r.setNumber(2, 3); cpu.runUntilDepth(0, 900);
	}
	const frame = js.rootThread.frames[0], page = frame.decodedPage!;
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = page.compiledBlocks!.entries[entry]!;
	assert.equal(block.sourceWords, 7);
	for (const key of [1, 2, 4, 5, 0, -0, -7, 1.5, 2147483647, 2147483648, 4294967297, NaN, Infinity, -Infinity, false, true, 'field']) {
		for (const value of [null, false, true, -0, NaN, Infinity, 'value']) {
			for (const cpu of [js, ref]) {
				const r = cpu.rootThread.frames[0].registers;
				r.set(1, key === 'field' ? valueString(cpu.stringPool.intern(key)) : key);
				r.set(2, value === 'value' ? valueString(cpu.stringPool.intern(value)) : value);
			}
			assert.equal(js.runUntilDepth(0, 9), ref.runUntilDepth(0, 9));
			assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()), `generic key ${key}, value ${value}`);
			assert.equal(frame.registers.get(3), frame.registers.get(2));
			assert.equal(frame.registers.getNumber(5), 1, 'the array store forwards its pending numeric source');
		}
	}
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frames[0].registers;
		r.setTable(1, cpu.createTable()); r.setTable(2, cpu.createTable());
	}
	for (const grant of [9, 1, 2, 1, 2, 1, 1, 1, 256]) {
		assert.equal(js.runUntilDepth(0, grant), ref.runUntilDepth(0, grant));
		assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()), 'reference keys/values and every short boundary agree');
	}
	assert.equal(page.compiledBlocks!.entries[entry], block, 'storage replacement does not strand the live generated consumer');
});

for (const generic of [false, true]) test(`compiled array reads resolve inherited nil slots but bypass inheritance for own values (generic=${generic})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, generic ? OpCode.GETT : OpCode.GETI, 3, 0, 1);
	writeInstruction(text, 1, OpCode.MOV, 4, 3, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 5 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image).cpu;
	for (const cpu of [js, ref]) {
		const own = cpu.createTable(2, 0), parent = cpu.createTable(2, 0), meta = cpu.createTable(0, 1);
		parent.setInteger(1, 73); meta.setStringKey(cpu.stringPool.intern('__index'), parent); own.metatable = meta;
		cpu.rootThread.frames[0].registers.setTable(0, own); cpu.rootThread.frames[0].registers.setNumber(1, 1);
		cpu.runUntilDepth(0, 300);
	}
	for (const value of [false, 0, null, true, 19, null]) {
		for (const cpu of [js, ref]) cpu.rootThread.frames[0].registers.getTable(0).setInteger(1, value);
		js.runUntilDepth(0, 3); ref.runUntilDepth(0, 3);
		assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
		assert.equal(js.readFrameRegister(0, 3), value === null ? 73 : value);
	}
	const frame = js.rootThread.frames[0], entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[entry]!.sourceWords, 3);
});

test('compiled array stores advance length through hash entries and shorten it on nil without a full register writeback', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 8, 0, 0);
	writeInstruction(text, 1, OpCode.SETI, 0, 2, 2);
	writeInstruction(text, 2, OpCode.LEN, 3, 0, 0);
	writeInstruction(text, 3, OpCode.ADD, 4, 8, 3);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 9 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image).cpu;
	for (const cpu of [js, ref]) {
		const table = cpu.createTable(2, 4);
		for (let i = 1; i <= 5; ++i) table.setInteger(i, i);
		cpu.rootThread.frames[0].registers.setTable(0, table); cpu.rootThread.frames[0].registers.setNumber(2, 2); cpu.runUntilDepth(0, 600);
	}
	for (const value of [null, false, null, 2]) {
		for (const cpu of [js, ref]) cpu.rootThread.frames[0].registers.set(2, value);
		js.runUntilDepth(0, 6); ref.runUntilDepth(0, 6);
		assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
		assert.equal(js.readFrameRegister(0, 3), value === null ? 1 : 5);
	}
});

test('compiled UTF-8 length retains live definitions and destination/source aliases', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.KSMI, 4, 0, 7);
	writeInstruction(text, 1, OpCode.MOV, 2, 1, 0);
	writeInstruction(text, 2, OpCode.LEN, 2, 2, 0);
	writeInstruction(text, 3, OpCode.ADD, 3, 2, 4);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 5 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image).cpu;
	for (const cpu of [js, ref]) {
		cpu.rootThread.frames[0].registers.setStringId(1, cpu.stringPool.intern('Aé雪\0😀')); cpu.runUntilDepth(0, 500);
	}
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	assert.equal(js.readFrameRegister(0, 2), 5); assert.equal(js.readFrameRegister(0, 3), 12);
	const frame = js.rootThread.frames[0], entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[entry]!.sourceWords, 5);
});

test('compiled SELF publishes its original receiver and top before a failing inherited lookup', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.MOV, 6, 9, 0);
	writeInstruction(text, 1, OpCode.SELF, 6, 6, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	writeInstruction(text, 32, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 10 },
		{ firstWord: 32, wordCount: 1 }], constants: ['method'], exceptionFunctionIndex: 1 });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image).cpu;
	for (const cpu of [js, ref]) {
		const table = cpu.createTable(0, 1); table.setStringKey(cpu.stringPool.intern('method'), 73);
		cpu.rootThread.frames[0].registers.setTable(9, table); cpu.runUntilDepth(0, 300);
	}
	const frame = js.rootThread.frames[0], entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[entry]!.sourceWords, 3);
	assert.equal(frame.registers.getTable(7), frame.registers.getTable(9));
	for (const cpu of [js, ref]) {
		const root = cpu.rootThread.frames[0], table = root.registers.getTable(9), meta = cpu.createTable(0, 1);
		table.setStringKey(cpu.stringPool.intern('method'), null); meta.setStringKey(cpu.stringPool.intern('__index'), table);
		table.metatable = meta; root.top = 0;
	}
	assert.equal(js.runUntilDepth(0, 3), ref.runUntilDepth(0, 3));
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_METATABLE_LOOP);
	assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
	assert.equal(frame.top, 8); assert.equal(frame.registers.getTable(7), frame.registers.getTable(9));
});

test('compiled nil-key traps precede any invalid table mutation or destination write', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 7, 0, 0);
	writeInstruction(text, 1, OpCode.SETT, 0, 1, 2);
	writeInstruction(text, 2, OpCode.GETT, 3, 0, 1);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 32, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 8 },
		{ firstWord: 32, wordCount: 1 }], exceptionFunctionIndex: 1 });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image).cpu;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frames[0].registers;
		r.setTable(0, cpu.createTable(2)); r.setNumber(1, 1); r.setNumber(2, 73); cpu.runUntilDepth(0, 500);
		r.setNil(1); r.setNumber(3, 19); cpu.rootThread.frames[0].top = 0;
	}
	js.runUntilDepth(0, 5); ref.runUntilDepth(0, 5);
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_INDEX_NIL);
	assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
	assert.equal(js.rootThread.frames[0].registers.getNumber(3), 19);
});

test('compiled NEWT materializes allocation roots and leaves destination untouched when collection cannot admit a WIDE request', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 7, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 63, 63);
	writeInstruction(text, 2, OpCode.NEWT, 8, 63, 63, 63);
	writeInstruction(text, 3, OpCode.MOV, 9, 8, 0);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	writeInstruction(text, 32, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 16 },
		{ firstWord: 32, wordCount: 1 }], globalNames: ['retained'], exceptionFunctionIndex: 1 });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image).cpu;
	for (const cpu of [js, ref]) cpu.runUntilDepth(0, 100);
	const frame = js.rootThread.frames[0], page = frame.decodedPage!, entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(page.compiledBlocks!.entries[entry]!.terminal.exit, CompiledBlockExit.AllocateTable);
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	for (const cpu of [js, ref]) {
		const root = cpu.rootThread.frames[0]; root.registers.setNumber(8, 73); root.registers.setNil(9); root.top = 0;
		const retained = cpu.createTable(350000);
		cpu.setGlobalByKey(cpu.stringPool.find('retained')!, ValueTag.Table, NaN, retained);
	}
	js.runUntilDepth(0, 4); ref.runUntilDepth(0, 4);
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
	assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
	assert.equal(frame.registers.getNumber(8), 73); assert.equal(frame.top, 8);
});
