import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { reserveThreadFrameReference } from '../helpers/thread_allocation_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompiledBlockExit, CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { TableHeader } from '../../machine/ts/machine/cpu/table';
import { ValueTag, valueBool, valueClosure, valueFloatBits, valueInteger, valueNil, valueString, valueTable } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { COP0_STRING_INDEX_TABLE, LUA_FAULT_REASON_ASSIGN_NON_TABLE, LUA_FAULT_REASON_INDEX_NAN, LUA_FAULT_REASON_INDEX_NIL,
	LUA_FAULT_REASON_INDEX_NON_TABLE, LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode, TABLE_INDEX_VISIT_CYCLES } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32, seedTestRomClosure } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`WIDE __newindex and __len use the ordinary activation and preserve result placement (${backend})`, () => {
		for (const [op, nilStore] of [[OpCode.SETT, false], [OpCode.SETI, false], [OpCode.SETFIELD, false],
			[OpCode.SETFIELD, true], [OpCode.LEN, false]] as const) {
			const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE), length = op === OpCode.LEN;
			writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, 1, OpCode.CLOSURE, 10, 0, 0);
			writeInstruction(text, 2, OpCode.MOV, 6, 0, 0);
			writeInstruction(text, 3, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, 4, op, 6, length ? 6 : op === OpCode.SETFIELD ? 0 : 1, 2);
			writeInstruction(text, 5, OpCode.K1, 8, 0, 0);
			writeInstruction(text, 6, OpCode.JMP, 0, 63, 59, 255);
			writeInstruction(text, 7, OpCode.RET, 0, 3, 0);
			const image = linkRawTestSystemBlua32({ text, constants: ['field'], functions: [
				{ firstWord: 0, wordCount: 7, maxStack: 16 },
				{ firstWord: 7, wordCount: 1, numParams: length ? 2 : 3, maxStack: 8 },
			], closureRelocations: [{ wordIndex: 1, functionIndex: 1 }] });
			const { cpu } = createTestSystemCpu(image, backend);
			reserveThreadFrameReference(cpu, cpu.rootThread, 32); // This raw WIDE fixture exercises placement after admission.
			let frame = cpu.rootThread.currentFrame!;
			const base = frame.pc, loop = base + 2 * INSTRUCTION_BYTES, opcodePc = base + 3 * INSTRUCTION_BYTES;
			const tables = nativeHeapReference(cpu).gc.tables, source = createReferenceTable(cpu, 2, 2), forwarded = createReferenceTable(cpu);
			const outerMeta = createReferenceTable(cpu, 0, 1), innerMeta = createReferenceTable(cpu, 0, 1);
			const selector = nativeHeapReference(cpu).stringPool.intern(length ? '__len' : '__newindex');
			const initialKey = op === OpCode.SETFIELD ? valueString(nativeHeapReference(cpu).stringPool.intern('field')) : valueInteger(1);
			tables.set(source, initialKey, valueBool(false));
			frame.registers.setTable(0, source);
			frame.registers.set(1, initialKey);
			frame.registers.set(2, valueInteger(91));
			frame.registers.set(12, valueInteger(87));
			frame.top = 13;
			seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
			cpu.runUntilDepth(0, BASE_CYCLES[OpCode.CLOSURE]);
			cpu.runUntilDepth(0, (BASE_CYCLES[op] + 6) * 68);
			if (backend === CpuExecutionBackend.JavaScript)
				assert.ok(frame.decodedPage!.compiledBlocks!.entries[(loop & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
			assert.equal(tables.get(source, initialKey), length ? valueBool(false) : valueInteger(91));
			if (!length) tables.set(source, initialKey, valueNil());
			tables.setStringKey(outerMeta, selector, length ? frame.registers.get(10) : valueTable(forwarded));
			tables.setMetatableAddress(source, outerMeta);
			tables.setStringKey(innerMeta, selector, frame.registers.get(10));
			tables.setMetatableAddress(forwarded, innerMeta);
			const originalKey = op === OpCode.SETT ? valueFloatBits(0xffc12345) : initialKey;
			frame.registers.set(1, originalKey);
			if (nilStore) frame.registers.setNil(2);
			frame.registers.setInteger(8, 57);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], loop);
			assert.equal(cpu.runUntilDepth(0, 3), RunResult.Yielded);
			assert.equal(3 - cpu.instructionBudgetRemaining, 2 + BASE_CYCLES[op] + (length ? 2 : 3 + TABLE_INDEX_VISIT_CYCLES));
			assert.equal(cpu.rootThread.frameDepth, 2);
			const callback = cpu.rootThread.currentFrame!;
			assert.equal(callback.callSitePc, opcodePc);
			assert.equal(callback.registers.get(0), valueTable(length ? source : forwarded));
			assert.equal(callback.registers.get(1), length ? valueTable(source) : originalKey);
			if (!length) assert.equal(callback.registers.get(2), nilStore ? valueNil() : valueInteger(91));
			assert.equal(frame.registers.getInteger(8), 57);
			const pending = captureCpuCheckpoint(cpu);
			for (let replay = 0; replay < 2; ++replay) {
				assert.equal(cpu.runUntilDepth(1, 1), RunResult.Halted);
				assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.RET] + (length ? 1 : 0));
				frame = cpu.rootThread.currentFrame!;
				assert.equal(frame.registers.get(0), valueTable(source), 'discarding results did not write the first register');
				assert.equal(frame.registers.get(6), valueTable(source), 'LEN returned the first value without coercion');
				assert.equal(frame.registers.getInteger(12), 87);
				assert.equal(frame.top, 13);
				assert.equal(frame.pc, base + 5 * INSTRUCTION_BYTES);
				if (!length) assert.equal(tables.get(source, originalKey), valueNil(), 'hook did not fall through to raw assignment');
				if (replay === 0) restoreCpuCheckpoint(cpu, pending);
			}
		}
	});

	test(`rawget distinguishes missing arguments from explicit nil and NaN keys (${backend})`, () => {
		for (const [supplied, key, fault] of [
			[1, valueNil(), LUA_FAULT_REASON_INVALID_ARGUMENT],
			[2, valueNil(), 0],
			[2, valueFloatBits(0x7fa12345), 0],
		] as const) {
			const text = new Uint8Array(3 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, OpCode.CALL, 0, supplied + 1, 2);
			writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
			writeInstruction(text, 2, OpCode.HALT, 0, 0, 0);
			const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 8 },
				{ firstWord: 2, wordCount: 1 }], exceptionFunctionIndex: 1 });
			const { cpu } = createTestSystemCpu(image, backend);
			const frame = cpu.rootThread.currentFrame!, table = createReferenceTable(cpu);
			nativeHeapReference(cpu).gc.tables.setInteger(table, 1, valueInteger(87));
			frame.registers.setBuiltinFunction(0, BuiltinFunctionId.RawGet);
			frame.registers.setTable(1, table);
			frame.registers.set(2, key);
			cpu.runUntilDepth(0, 1);
			assert.equal(cpu.readLuaFaultReasonWord(), fault);
			if (fault === 0) assert.equal(frame.registers.get(0), valueNil());
			assert.equal(cpu.gc.tables.getInteger(table, 1), valueInteger(87));
		}
	});

	test(`non-table __index forwarding uses String's installed table and faults at other primitives (${backend})`, () => {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.GETT, 3, 0, 1);
		writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
		writeInstruction(text, 16, OpCode.HALT, 0, 0, 0);
		writeInstruction(text, 17, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 2, maxStack: 12 }, { firstWord: 16, wordCount: 1 },
			{ firstWord: 17, wordCount: 1, numParams: 2, maxStack: 2 },
		], exceptionFunctionIndex: 1 });
		const { cpu } = createTestHeapServiceCpu(image, backend), frame = cpu.rootThread.currentFrame!;
		reserveThreadFrameReference(cpu, cpu.rootThread, 16);
		const record = createReferenceTable(cpu), meta = createReferenceTable(cpu);
		const stringIndex = createReferenceTable(cpu), stringMeta = createReferenceTable(cpu);
		const field = valueString(nativeHeapReference(cpu).stringPool.intern('present')), forwarded = valueString(nativeHeapReference(cpu).stringPool.intern('forward receiver'));
		const indexKey = nativeHeapReference(cpu).stringPool.intern('__index');
		const pc = frame.pc, cycles = BASE_CYCLES[OpCode.GETT];
		const tables = nativeHeapReference(cpu).gc.tables;
		frame.registers.setTable(0, record);
		frame.registers.set(1, field);
		cpu['cop0Words'][COP0_STRING_INDEX_TABLE] = stringIndex;
		tables.set(record, field, valueBool(false));
		cpu.runUntilDepth(0, (cycles + BASE_CYCLES[OpCode.JMP]) * 68);
		if (backend === CpuExecutionBackend.JavaScript)
			assert.ok(frame.decodedPage!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
		for (const key of [valueNil(), valueFloatBits(0x7fa12345)]) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			frame.registers.set(1, key);
			frame.registers.setInteger(3, 17);
			cpu.runUntilDepth(0, 1);
			assert.equal(1 - cpu.instructionBudgetRemaining, cycles);
			assert.equal(frame.registers.get(3), valueNil());
		}
		tables.set(record, field, valueNil());
		tables.setStringKey(meta, indexKey, forwarded);
		tables.setMetatableAddress(record, meta);
		tables.set(stringIndex, field, valueBool(false));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		frame.registers.set(1, field);
		cpu.runUntilDepth(0, 1);
		assert.equal(1 - cpu.instructionBudgetRemaining, cycles + TABLE_INDEX_VISIT_CYCLES);
		assert.equal(frame.registers.get(3), valueBool(false));

		const indexMethod = valueClosure(seedTestRomClosure(cpu, image.symbols.functionAddresses[2]));
		tables.setStringKey(stringMeta, indexKey, indexMethod);
		tables.setMetatableAddress(stringIndex, stringMeta);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		const nan = valueFloatBits(0xffc12345);
		frame.registers.set(1, nan);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(1 - cpu.instructionBudgetRemaining, cycles + TABLE_INDEX_VISIT_CYCLES + 2);
		assert.equal(cpu.rootThread.frameDepth, 2);
		const callback = cpu.rootThread.currentFrame!;
		assert.equal(callback.registers.get(0), forwarded);
		assert.equal(callback.registers.get(1), nan);
		assert.equal(cpu.runUntilDepth(1, 1), RunResult.Halted);
		assert.equal(frame.registers.get(3), forwarded);

		tables.setStringKey(meta, indexKey, valueBool(false));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		frame.registers.setInteger(3, 17);
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INDEX_NON_TABLE);
		assert.equal(cpu.readEpcWord(), pc);
		assert.equal(frame.registers.getInteger(3), 17);
	});

	test(`absent __newindex forwarding reaches raw storage or rejects a non-table receiver (${backend})`, () => {
		const text = new Uint8Array(4 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.SETI, 0, 1, 1);
		writeInstruction(text, 1, OpCode.JMP, 0, 63, 62, 255);
		writeInstruction(text, 2, OpCode.HALT, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: 2, maxStack: 4 }, { firstWord: 2, wordCount: 1 },
		], exceptionFunctionIndex: 1 });
		const { cpu, memory } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!;
		const tables = nativeHeapReference(cpu).gc.tables, source = createReferenceTable(cpu, 2), forwarded = createReferenceTable(cpu, 2), meta = createReferenceTable(cpu);
		const newIndex = nativeHeapReference(cpu).stringPool.intern('__newindex'), pc = frame.pc;
		frame.registers.setTable(0, source);
		frame.registers.setInteger(1, 19);
		cpu.runUntilDepth(0, (BASE_CYCLES[OpCode.SETI] + BASE_CYCLES[OpCode.JMP]) * 68);
		tables.setMetatableAddress(source, meta);
		tables.setInteger(source, 1, valueNil());
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		assert.equal(memory.readRamRecordByte(meta + TableHeader.NewIndexAbsent), 1);
		const checkpoint = captureCpuCheckpoint(cpu);
		if (backend === CpuExecutionBackend.JavaScript) {
			const page = frame.executionImage.decodedPages.get(pc & ~MAPPED_PAGE_BYTE_MASK)!;
			const block = page.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]!;
			const run = { remainingCycles: BASE_CYCLES[OpCode.SETI], registerTop: frame.top, memoryAddress: 0 };
			const exit = block.region.execute(frame.registers, frame.executionImage.constWords, page, frame, block.entry, run);
			assert.notEqual(block.region.exits[exit].exit, CompiledBlockExit.WriteInteger,
				'generated SETI can fill an empty array slot through the absence proof');
			assert.equal(tables.getInteger(source, 1), valueInteger(19));
		} else {
			cpu.runUntilDepth(0, 1);
			assert.equal(tables.getInteger(source, 1), valueInteger(19));
		}
		tables.setStringKey(meta, newIndex, valueTable(forwarded));
		assert.equal(memory.readRamRecordByte(meta + TableHeader.NewIndexAbsent), 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		frame.registers.setInteger(1, 31);
		cpu.runUntilDepth(0, 1);
		assert.equal(tables.getInteger(source, 1), valueInteger(31), 'an own entry is assigned without looking at the hook');
		assert.equal(tables.getInteger(forwarded, 1), valueNil());
		tables.setInteger(source, 1, valueNil());
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.runUntilDepth(0, 1);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.SETI] + TABLE_INDEX_VISIT_CYCLES);
		assert.equal(tables.getInteger(source, 1), valueNil());
		assert.equal(tables.getInteger(forwarded, 1), valueInteger(31), 'the installed own method handles the empty slot');
		tables.setStringKey(meta, newIndex, valueNil());
		assert.equal(memory.readRamRecordByte(meta + TableHeader.NewIndexAbsent), 1, 'raw erase restores the absence proof');
		tables.setStringKey(meta, newIndex, valueBool(false));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_ASSIGN_NON_TABLE);
		assert.equal(tables.getInteger(source, 1), valueNil());

		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(memory.readRamRecordByte(meta + TableHeader.NewIndexAbsent), 1);
		cpu.runUntilDepth(0, 1);
		assert.equal(tables.getInteger(source, 1), valueInteger(19), 'restore reinstates the grant and its raw metatable proof');
	});
}
