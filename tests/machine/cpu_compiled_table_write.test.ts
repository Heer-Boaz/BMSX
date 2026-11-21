import { GC_COLOR_OFFSET } from '../../machine/ts/machine/cpu/gc_object';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { readLE32 } from '../../machine/ts/common/endian';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { DecodedInstructionPage } from '../../machine/ts/machine/cpu/execution_image';
import { TableHeader } from '../../machine/ts/machine/cpu/table';
import { ValueTag, valueBool, valueFloat, valueFloatBits, valueInteger, valueNil, valueString, valueTable } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { DYNAMIC_RAM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { createTestSystemCpu, linkRawTestSystemBlua32, RAM_CODE_FIXTURE_BYTES } from '../helpers/blua32';
import { runCpuParity } from '../helpers/cpu_execution';

for (const generic of [false, true]) for (const constant of [false, true]) {
	test(`generated string stores resume through topology changes and keep predicted overwrites inline (generic=${generic}, constant=${constant})`, () => {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.MOV, 8, 3, 0);
		writeInstruction(text, 1, OpCode.MOV, 2, 4, 0);
		writeInstruction(text, 2, generic ? OpCode.SETT : OpCode.SETFIELD, 0, generic ? 1 : 0, constant ? 62 : 2, constant ? 7 : 0);
		writeInstruction(text, 3, OpCode.MOV, 9, 8, 0);
		writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
		const image = linkRawTestSystemBlua32({ text, constants: ['field', false],
			functions: [{ firstWord: 0, wordCount: 5, maxStack: 10 }] });
		const cpu = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
		const frame = cpu.rootThread.frameAtDepth(0), r = frame.registers, key = cpu.stringPool.intern('field');
		r.setTable(0, cpu.createTable(0, 8)); r.setString(1, key); r.setInteger(4, 13);
		cpu.runUntilDepth(0, 600);
		const pc = image.image.functions[0].codeAddress, page = frame.decodedPage!, entry = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		const block = page.compiledBlocks!.entries[entry]!;
		assert.ok(block);
		const parent = cpu.createTable(0, 1); cpu.gc.tables.setStringKey(parent, key, valueInteger(71));
		const meta = cpu.createTable(0, 1); cpu.gc.tables.setStringKey(meta, cpu.stringPool.intern('__index'), valueTable(parent));
		const values = [valueBool(false), valueFloat(-0), valueFloatBits(0xffa12345), valueTable(cpu.createTable()), valueString(key), valueNil()];
		for (let n = 0; n < values.length; n++) {
			const table = cpu.createTable(0, 8); cpu.gc.tables.setMetatableAddress(table, meta);
			for (let prior = 0; prior < n; prior++) cpu.gc.tables.setStringKey(table, cpu.stringPool.intern(`prior_${prior}`), valueInteger(prior));
			for (const value of [values[n], valueNil(), values[n], values[n]]) {
				r.setTable(0, table); r.set(3, values[n]); r.set(4, value);
				const before = cpu.gc.tables.getTrackedHeapBytes(table);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
				cpu.runUntilDepth(0, 24);
				assert.equal(cpu.gc.tables.getStringKey(table, key), constant ? valueBool(false) : value);
				assert.equal(cpu.gc.tables.getTrackedHeapBytes(table), before);
				assert.equal(r.get(8), values[n]); assert.equal(r.get(9), values[n]); assert.equal(r.get(2), value);
				assert.equal(cpu.gc.tables.getStringKey(parent, key), valueInteger(71), 'writes shadow inheritance instead of modifying its source');
				assert.equal(cpu.instructionBudgetRemaining, 0);
				assert.equal(frame.pc, pc, 'the successor executes after a complete semantic or inline store');
			}
		}
		const existing = cpu.createTable(0, 8);
		r.setTable(0, existing); r.setInteger(4, 17);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.runUntilDepth(0, 24);
		r.setInteger(4, 29);
		const inline = { remainingCycles: 24, registerTop: frame.top, memoryAddress: 0, lengthWork: { probes: 0 } };
		const updated = block.region.exits[block.region.execute(r, frame.executionImage.constWords, page, frame, block.entry, inline)];
		assert.equal(updated.exit, CompiledBlockExit.Continue);
		assert.equal(cpu.gc.tables.getStringKey(existing, key), constant ? valueBool(false) : valueInteger(29));
		const empty = cpu.createTable(); r.setTable(0, empty); r.set(3, values[3]); r.set(4, values[3]); r.setNil(9);
		const state = { remainingCycles: 24, registerTop: frame.top, memoryAddress: 0, lengthWork: { probes: 0 } };
		const exit = block.region.exits[block.region.execute(r, frame.executionImage.constWords, page, frame, block.entry, state)];
		assert.equal(exit.exit, generic ? CompiledBlockExit.WriteIndex : CompiledBlockExit.WriteField);
		assert.equal(cpu.gc.tables.storedSlotCount(empty), 0); assert.equal(cpu.gc.tables.getStringKey(empty, key), valueNil());
		assert.equal(r.get(8), values[3]); assert.equal(r.get(2), values[3]); assert.equal(r.get(9), valueNil());
	});
}

for (const dirty of [false, true]) test(`generated WIDE SETI retires before overwriting a cached register plane (dirty=${dirty})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, dirty ? OpCode.K1 : OpCode.MOV, dirty ? 2 : 6, 2, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.SETI, 0, 1, 4);
	writeInstruction(text, 3, OpCode.MOV, 5, 2, 0);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 10 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const entry = image.image.functions[0].codeAddress;
	for (const { cpu, memory } of [js, ref]) {
		const r = cpu.rootThread.currentFrame!.registers, table = cpu.createTable(1);
		r.setTable(0, table); r.setInteger(4, 89);
		cpu.runUntilDepth(0, 1024);
		const storage = r.ramOffset() + 2 * 4;
		memory.writeRamRecordWord(table + TableHeader.Storage, storage);
		memory.writeRamRecordByte(storage + 4, ValueTag.Integer);
	}
	const frame = js.cpu.rootThread.currentFrame!;
	const block = frame.decodedPage!.compiledBlocks!.entries[(entry & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]!;
	const grant = BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.SETI] + BASE_CYCLES[OpCode.MOV] + 1;
	assert.ok(block && block.admissionCycles < grant, 'the combined generated block is actually admissible');
	for (const { cpu } of [js, ref]) {
		const registers = cpu.rootThread.currentFrame!.registers;
		registers.setInteger(2, 73); registers.setInteger(5, 57);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
	}
	runCpuParity(js.cpu, ref.cpu, grant);
	assert.ok(isDeepStrictEqual(js.cpu.captureRuntimeState(), ref.cpu.captureRuntimeState()));
	assert.equal(frame.registers.getInteger(2), 89);
	assert.equal(frame.registers.getInteger(5), 89, 'the successor consumes the physical overwrite, not a resident copy');
	assert.equal(js.cpu.lastPc, entry + 4 * INSTRUCTION_BYTES);
	assert.equal(frame.pc, entry);
	assert.equal(js.cpu.instructionBudgetRemaining, -1);
});

test('a predicted string store refetches the successor when its value aliases watched code', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.SETFIELD, 0, 0, 1);
	writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
	const replacement = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(replacement, 0, OpCode.HALT, 0, 0, 0);
	const halt = readLE32(replacement, 0);
	const image = linkRawTestSystemBlua32({ text, constants: ['field'], functions: [{ firstWord: 0, wordCount: 2, maxStack: 2 }] }, RAM_CODE_FIXTURE_BYTES);
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const code = DYNAMIC_RAM_BASE + 2 * MAPPED_PAGE_BYTE_SIZE, array = MAPPED_PAGE_BYTE_SIZE, hash = 4;
	let generatedPage!: DecodedInstructionPage;
	for (const { cpu, memory } of [js, ref]) {
		const frame = cpu.rootThread.currentFrame!, r = frame.registers;
		const table = cpu.createTable(array, hash), key = cpu.stringPool.intern('field');
		r.setTable(0, table); r.setInteger(1, 73);
		memory.ramData().set(text, code - RAM_BASE);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], code);
		cpu.runUntilDepth(0, 2048);
		const slot = frame.decodedPage!.tableCacheSlots[0];
		assert.ok(slot >= 0, 'warm overwrite prediction');
		if (cpu === js.cpu) generatedPage = frame.decodedPage!;
		const value = code + INSTRUCTION_BYTES - RAM_BASE, storage = value - (array + hash + slot) * 4;
		const keyTag = storage + (array + 3 * hash) * 4 + array + slot;
		memory.writeRamRecordWord(table + TableHeader.Storage, storage);
		memory.writeRamRecordWord(value - 4 * hash, key);
		memory.writeRamRecordByte(keyTag, ValueTag.String);
		memory.writeRamRecordByte(keyTag + hash, ValueTag.Integer);
		r.setInteger(1, halt);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], code);
	}
	const frame = js.cpu.rootThread.currentFrame!;
	const grant = BASE_CYCLES[OpCode.SETFIELD] + 1;
	assert.ok(generatedPage.compiledBlocks!.entries[0]!.admissionCycles < grant);
	assert.equal(runCpuParity(js.cpu, ref.cpu, grant), RunResult.Halted);
	assert.ok(isDeepStrictEqual(js.cpu.captureRuntimeState(), ref.cpu.captureRuntimeState()));
	assert.equal(js.memory.readRamRecordWord(code + INSTRUCTION_BYTES), halt);
	assert.equal(frame.pc, code + 2 * INSTRUCTION_BYTES);
	assert.equal(js.cpu.lastPc, code + INSTRUCTION_BYTES);
	assert.equal(js.cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.HALT]);
	assert.ok(!generatedPage.compiledBlocks?.entries[0], 'the store retires the old compiled source');
});

for (const generic of [false, true]) test(`growing string stores publish moved roots before collection (generic=${generic})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.MOV, 7, 9, 0);
	writeInstruction(text, 1, OpCode.KNIL, 9, 0, 0);
	writeInstruction(text, 2, generic ? OpCode.SETT : OpCode.SETFIELD, 0, generic ? 1 : 0, 7);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	const image = linkRawTestSystemBlua32({ text, constants: ['field'], functions: [{ firstWord: 0, wordCount: 4, maxStack: 16 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers;
		r.setTable(0, cpu.createTable(0, 1)); r.setString(1, cpu.stringPool.intern('field')); r.setInteger(9, 1);
		cpu.runUntilDepth(0, 504);
	}
	const frame = js.rootThread.frameAtDepth(0), entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.ok(frame.decodedPage!.compiledBlocks!.entries[entry], 'growth is reached from adopted generated code');
	for (const cpu of [js, ref]) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
		const frame = cpu.rootThread.frameAtDepth(0), r = frame.registers;
		const retained = cpu.createTable(0, 1); cpu.gc.tables.setStringKey(retained, cpu.stringPool.intern('payload'), valueString(cpu.stringPool.intern('retained')));
		r.setTable(0, cpu.createTable()); r.setTable(9, retained); frame.top = 0;
		const trackedBytes = cpu.luaHeap.usedBytes();
		cpu.luaHeap.setCollectionTarget(trackedBytes);
	}
	runCpuParity(js, ref, 6);
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers, retained = r.getPayload(7);
		assert.ok(cpu.gc.active() && cpu.gc.memory.readRamRecordByte(retained + GC_COLOR_OFFSET) === 3, 'the hash growth assist traced the moved reference');
		assert.equal(cpu.gc.tables.getStringKey(retained, cpu.stringPool.find('payload')!), valueString(cpu.stringPool.find('retained')!));
		assert.equal(cpu.gc.tables.getStringKey(r.getPayload(0), cpu.stringPool.find('field')!), valueTable(retained));
	}
});
