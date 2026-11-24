import { GC_COLOR_OFFSET } from '../../machine/ts/machine/cpu/gc_object';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueBool, valueFloat, valueFloatBits, valueInteger, valueNil, valueString, valueTable } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { BUS_FAULT_UNMAPPED, IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { TableHeader } from '../../machine/ts/machine/cpu/table';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { runCpuParity } from '../helpers/cpu_execution';

test('next charges only the primitive and the receiving range even when traversal crosses vacant slots', () => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.CALL, 0, 3, 3);
	writeInstruction(text, 1, OpCode.K1, 3, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 4 }] });
	for (const capacity of [1, 1024]) {
		const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
		const frame = cpu.rootThread.frameAtDepth(0), pc = frame.pc, table = cpu.createTable(capacity, capacity);
		cpu.gc.tables.setInteger(table, 1, valueBool(false));
		for (const after of [valueNil(), valueInteger(1)]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			frame.registers.setBuiltinFunction(0, BuiltinFunctionId.Next);
			frame.registers.setTable(1, table);
			frame.registers.set(2, after);
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			assert.equal(cpu.instructionBudgetRemaining, 1 - 32 - 1 - 2);
			assert.equal(frame.pc, pc + INSTRUCTION_BYTES);
			assert.equal(frame.registers.get(0), after === valueNil() ? valueInteger(1) : valueNil());
			assert.equal(frame.registers.get(1), after === valueNil() ? valueBool(false) : valueNil());
			assert.equal(frame.registers.get(3), valueNil());
		}
	}
});

for (const wide of [false, true]) test(`NEWT charges request cycles and rounded heap capacity separately (WIDE=${wide})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	let word = 0;
	if (wide) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, word++, OpCode.NEWT, 0, 2, 3, wide ? 1 : 0);
	const successor = word;
	writeInstruction(text, word++, OpCode.K1, 1, 0, 0);
	writeInstruction(text, word, OpCode.JMP, 0, 63, 63 - word, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: word + 1, maxStack: 2 }] });
	const { cpu: generated } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const { cpu: scalar } = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const frame = generated.rootThread.frameAtDepth(0), pc = frame.pc, hash = wide ? 67 : 3;
	const cycles = BASE_CYCLES[OpCode.NEWT] + 2 + 2 * hash;
	runCpuParity(generated, scalar, (cycles + BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.JMP]) * 68);
	const entry = frame.decodedPage!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]!;
	const state = { remainingCycles: 1, registerTop: frame.top, memoryAddress: 0 };
	const exit = entry.region.exits[entry.region.execute(frame.registers, frame.executionImage.constWords, frame.decodedPage!, frame, entry.entry, state)];
	assert.equal(exit.exit, CompiledBlockExit.AllocateTable);
	for (const cpu of [generated, scalar]) {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.rootThread.frameAtDepth(0).registers.setNil(1);
	}
	const before = generated.luaHeap.usedBytes();
	assert.equal(runCpuParity(generated, scalar, 1), RunResult.Yielded);
	assert.equal(generated.instructionBudgetRemaining, 1 - cycles);
	assert.equal(frame.pc, pc + successor * INSTRUCTION_BYTES);
	assert.equal(frame.registers.get(1), valueNil());
	const table = frame.registers.getPayload(0), slots = wide ? 128 : 4;
	assert.equal(generated.gc.tables.arrayCapacity(table), 2);
	assert.equal(generated.gc.tables.hashSize(table), slots);
	assert.equal(generated.luaHeap.usedBytes() - before, 32 + 2 * 5 + slots * 10);
});

test('ordinary bus writes cannot rebind an array or alter its private elements', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.SETI, 0, 1, 1);
	writeInstruction(text, 1, OpCode.GETI, 2, 0, 1);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 3 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const scalar = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const pc = image.image.functions[0].codeAddress;
	for (const { cpu } of [js, scalar]) {
		const r = cpu.rootThread.frameAtDepth(0).registers;
		r.setTable(0, cpu.createTable(4, 0));
		r.setInteger(1, 71);
	}
	runCpuParity(js.cpu, scalar.cpu, 1024);
	const frame = js.cpu.rootThread.frameAtDepth(0);
	const entry = frame.decodedPage!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	assert.ok(entry, 'the JavaScript path adopted a compiled table region');
	for (const { cpu, memory } of [js, scalar]) {
		const r = cpu.rootThread.frameAtDepth(0).registers;
		const table = r.getPayload(0), storage = cpu.gc.tables.storageAddress(table);
		for (const address of [table + TableHeader.Storage, storage]) {
			memory.clearBusFault();
			memory.writeU32(address, 0);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
		}
		assert.equal(cpu.gc.tables.storageAddress(table), storage);
		assert.equal(cpu.gc.tables.getInteger(table, 1), valueInteger(71));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		r.setInteger(1, 89);
	}
	runCpuParity(js.cpu, scalar.cpu, BASE_CYCLES[OpCode.SETI] + BASE_CYCLES[OpCode.GETI]);
	assert.equal(frame.registers.get(2), valueInteger(89));
	assert.ok(isDeepStrictEqual(js.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState()));
});

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
		const inline = { remainingCycles: 24, registerTop: frame.top, memoryAddress: 0 };
		const updated = block.region.exits[block.region.execute(r, frame.executionImage.constWords, page, frame, block.entry, inline)];
		assert.equal(updated.exit, CompiledBlockExit.Continue);
		assert.equal(cpu.gc.tables.getStringKey(existing, key), constant ? valueBool(false) : valueInteger(29));
		const empty = cpu.createTable(); r.setTable(0, empty); r.set(3, values[3]); r.set(4, values[3]); r.setNil(9);
		const state = { remainingCycles: 24, registerTop: frame.top, memoryAddress: 0 };
		const exit = block.region.exits[block.region.execute(r, frame.executionImage.constWords, page, frame, block.entry, state)];
		assert.equal(exit.exit, generic ? CompiledBlockExit.WriteIndex : CompiledBlockExit.WriteField);
		assert.equal(cpu.gc.tables.storedSlotCount(empty), 0); assert.equal(cpu.gc.tables.getStringKey(empty, key), valueNil());
		assert.equal(r.get(8), values[3]); assert.equal(r.get(2), values[3]); assert.equal(r.get(9), valueNil());
	});
}

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
