import { HEAP_LOGICAL_OCCUPIED_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { GC_COLOR_OFFSET } from '../../machine/ts/machine/cpu/gc_object';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { CpuRunKind, PendingAllocationKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueBool, valueFloat, valueFloatBits, valueInteger, valueNil, valueString, valueTable } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { INSTRUCTION_BYTES, packInstructionWord, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { BASE_CYCLES, OpCode, TABLE_INDEX_VISIT_CYCLES } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { BUS_FAULT_UNMAPPED, IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runCpuParity } from '../helpers/cpu_execution';

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

for (const wide of [false, true]) test(`NEWT pays the base cycle charge and reserves rounded heap capacity (WIDE=${wide})`, () => {
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
	const frame = generated.rootThread.frameAtDepth(0), pc = frame.pc;
	const cycles = BASE_CYCLES[OpCode.NEWT];
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
	assert.equal(runCpuParity(generated, scalar, cycles), RunResult.Yielded);
	assert.equal(generated.instructionBudgetRemaining, 0);
	assert.equal(frame.pc, pc + successor * INSTRUCTION_BYTES);
	assert.equal(frame.registers.get(1), valueNil());
	const table = frame.registers.getPayload(0), slots = wide ? 128 : 4;
	assert.equal(generated.gc.tables.arrayCapacity(table), 2);
	assert.equal(generated.gc.tables.hashSize(table), slots);
	assert.equal(generated.luaHeap.usedBytes() - before, 32 + 2 * 5 + slots * 10);
});

test('a WIDE SETFIELD hint affects only growth at its original table and follows code replacement', () => {
	const code = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0, 6);
	writeInstruction(code, 1, OpCode.SETFIELD, 0, 0, 1);
	writeInstruction(code, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text: code, constants: ['field'], functions: [{ firstWord: 0, wordCount: 3, maxStack: 2 }] }, 0x10000);
	const machines = [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter].map(mode => createTestSystemCpu(image, mode));
	const pc = DYNAMIC_RAM_BASE, functionAddress = image.symbols.functionAddresses[0], cycles = BASE_CYCLES[OpCode.SETFIELD];
	for (const { cpu, memory } of machines) {
		const key = cpu.stringPool.find('field')!, table = cpu.createTable(0, 1);
		cpu.gc.tables.setStringKey(table, key, valueInteger(9));
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setTable(0, table); frame.registers.setInteger(1, 73);
		memory.writeBytes(pc, code);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, pc);
		cpu.runUntilDepth(0, (cycles + BASE_CYCLES[OpCode.JMP]) * 68);
		assert.equal(cpu.gc.tables.hashSize(table), 1, 'a live overwrite does not change its reservation');
	}
	const frame = machines[0].cpu.rootThread.frameAtDepth(0);
	const decoded = frame.executionImage.decodedPages.get(pc)!;
	assert.ok(decoded.compiledBlocks!.entries[0], 'the first hinted store has a generated entry before code replacement');

	const assign = (capacity: number, value: number | null, throughMetatable: boolean, expected: number, width: number) => {
		const cases = machines.map(({ cpu }) => {
			const tables = cpu.gc.tables, registers = cpu.rootThread.frameAtDepth(0).registers;
			const table = cpu.createTable(0, capacity), oldKey = cpu.stringPool.intern('before'), key = cpu.stringPool.find('field')!;
			tables.setStringKey(table, oldKey, valueInteger(9));
			const source = throughMetatable ? cpu.createTable() : table;
			if (throughMetatable) {
				const meta = cpu.createTable(0, 1);
				tables.setStringKey(meta, cpu.stringPool.intern('__newindex'), valueTable(table));
				tables.setMetatableAddress(source, meta);
			}
			registers.setTable(0, source);
			registers.set(1, value === null ? valueNil() : valueInteger(value));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, pc);
			return { cpu, table, source, oldKey, key };
		});
		assert.equal(runCpuParity(cases[0].cpu, cases[1].cpu, 1), RunResult.Yielded);
		for (const { cpu, table, source, oldKey, key } of cases) {
			const tables = cpu.gc.tables;
			assert.equal(cpu.instructionBudgetRemaining, 1 - cycles - (throughMetatable ? TABLE_INDEX_VISIT_CYCLES : 0));
			assert.equal(cpu.readFramePc(0), pc + width * INSTRUCTION_BYTES);
			assert.equal(tables.hashSize(table), expected);
			assert.equal(tables.getStringKey(table, oldKey), valueInteger(9));
			assert.equal(tables.getStringKey(table, key), value === null ? valueNil() : valueInteger(value));
			if (throughMetatable) assert.equal(tables.getStringKey(source, key), valueNil());
		}
	};
	assign(2, 73, false, 2, 2); // No growth.
	assign(1, null, false, 1, 2); // Nil to missing.
	assign(1, 73, true, 2, 2); // No hint on the forwarded table.
	assign(1, 73, false, 8, 2); // One existing + one insertion + six more.
	for (const { memory } of machines) memory.writeU32(pc, packInstructionWord(OpCode.WIDE, 0, 0, 0, 7));
	assign(1, 73, false, 16, 2); // Only the prefix changed; round 9 up.
	for (const { memory } of machines) memory.writeU32(pc, packInstructionWord(OpCode.SETFIELD, 0, 0, 1));
	assign(1, 73, false, 2, 1); // No retained hint after removing WIDE.
});

for (const pressure of ['budget', 'fragmented', 'exhausted']) test(`hinted SETFIELD under ${pressure} pressure`, () => {
	const code = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0, 31);
	writeInstruction(code, 1, OpCode.SETFIELD, 0, 0, 1);
	writeInstruction(code, 2, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text: code, constants: ['field'], functions: [{ firstWord: 0, wordCount: 3, maxStack: 2 }] }, 0x10000);
	const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const tables = cpu.gc.tables, arena = cpu.heapAllocator, budget = cpu.luaHeap;
	const table = cpu.createTable(512, 1), beforeKey = cpu.stringPool.intern('before'), field = cpu.stringPool.find('field')!;
	tables.setStringKey(table, beforeKey, valueInteger(9));
	const regs = cpu.rootThread.frameAtDepth(0).registers;
	regs.setTable(0, table); regs.setInteger(1, 73);
	budget.setCollectionTarget(budget.capacity());
	const backing = TableRecords.storageBytes(0, 64);
	cpu.createTable(1024, 0); // Recoverable storage for the hinted growth.
	if (pressure === 'budget') {
		const required = TableRecords.allocationCharge(512, 2) - TableRecords.allocationCharge(512, 1);
		cpu.memory.writeRamRecordWord(arena.managementOffset() + HEAP_LOGICAL_OCCUPIED_OFFSET, budget.capacity() - required);
	} else {
		const minimum = TableRecords.storageBytes(0, 2);
		const hole = arena.allocate(minimum, true);
		while (arena.allocate(backing, true) !== 0) {}
		while (arena.allocate(minimum, true) !== 0) {}
		if (pressure === 'fragmented') arena.free(hole);
	}
	const oldStorage = tables.hashAddress(table);
	const pc = cpu.readFramePc(0);
	const used = budget.usedBytes();
	const result = cpu.runUntilDepth(0, 1, cpu.rootThread.address, CpuRunKind.Scheduled);
	if (pressure !== 'exhausted') {
		assert.equal(result, RunResult.Yielded);
		assert.equal(cpu.readFramePc(0), pc + 2 * INSTRUCTION_BYTES);
		assert.equal(tables.hashSize(table), 2);
		assert.equal(tables.getStringKey(table, beforeKey), valueInteger(9));
		assert.equal(tables.getStringKey(table, field), valueInteger(73));
		assert.equal(budget.usedBytes() - used, TableRecords.allocationCharge(512, 2) - TableRecords.allocationCharge(512, 1));
		return;
	}
	assert.equal(result, RunResult.ParkedAllocation);
	assert.equal(tables.hashAddress(table), oldStorage);
	assert.equal(tables.getStringKey(table, field), valueNil());
	const pending = cpu.captureRuntimeState().pendingAllocation;
	assert.ok(pending?.kind === PendingAllocationKind.TableAssignment);
	assert.equal(pending.extraHashSlots, 31);
	const checkpoint = captureCpuCheckpoint(cpu);
	for (let replay = 0; replay < 2; ++replay) {
		for (let work = 0; work < 512 && !cpu.allocationReady(); ++work) cpu.advanceAllocationRecovery();
		assert.ok(cpu.allocationReady(), 'the recovery completes with reclaimable backing');
		cpu.instructionBudgetRemaining = 0;
		cpu.resumeAllocation();
		assert.equal(cpu.instructionBudgetRemaining, 0, 'no second charge or execution on resume');
		assert.ok(!cpu.allocationParked());
		assert.equal(cpu.readFramePc(0), pc + 2 * INSTRUCTION_BYTES);
		assert.equal(tables.hashSize(table), 64);
		assert.equal(tables.getStringKey(table, beforeKey), valueInteger(9));
		assert.equal(tables.getStringKey(table, field), valueInteger(73));
		if (replay === 0) restoreCpuCheckpoint(cpu, checkpoint);
	}
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
		const table = r.getPayload(0), storage = cpu.gc.tables.arrayAddress(table);
		for (const address of [table + TableHeader.ArrayStorage, storage]) {
			memory.clearBusFault();
			memory.writeU32(address, 0);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
		}
		assert.equal(cpu.gc.tables.arrayAddress(table), storage);
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
