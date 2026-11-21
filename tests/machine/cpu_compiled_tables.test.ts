import { textToByteString } from '../../machine/ts/common/byte_string';
import { TableHeader } from '../../machine/ts/machine/cpu/table';
import { DYNAMIC_RAM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runCpuParity } from '../helpers/cpu_execution';
import { isDeepStrictEqual } from 'node:util';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { ValueTag, valueBool, valueFloat, valueFloatBits, valueFromTag, valueInteger, valueNil, valueString, valueTable } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { LUA_FAULT_REASON_INDEX_NIL, LUA_FAULT_REASON_METATABLE_LOOP, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { BASE_CYCLES, OpCode, TABLE_LENGTH_PROBE_CYCLES } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32, RAM_CODE_FIXTURE_BYTES } from '../helpers/blua32';

test('an installed region reads the current LOADK, LOADKR and RK tags and words', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(text, 1, OpCode.LOADKR, 1, 2, 0);
	writeInstruction(text, 2, OpCode.SETI, 3, 1, 63, 7); // RK(C) = K[0].
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	const image = linkRawTestSystemBlua32({ text, constants: [13], functions: [{ firstWord: 0, wordCount: 4, maxStack: 4 }] });
	const pc = image.image.functions[0].codeAddress;
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const scalar = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	const grant = BASE_CYCLES[OpCode.LOADK] + BASE_CYCLES[OpCode.LOADKR] + BASE_CYCLES[OpCode.SETI] + BASE_CYCLES[OpCode.JMP];
	const frames = [js.rootThread.frameAtDepth(0), scalar.rootThread.frameAtDepth(0)];
	const tables = [js, scalar].map((cpu, i) => {
		const table = cpu.createTable(1);
		cpu.gc.tables.setInteger(table, 1, valueInteger(0));
		frames[i].registers.setInteger(2, 0);
		frames[i].registers.setTable(3, table);
		return table;
	});
	runCpuParity(js, scalar, grant * 64);
	const word = (pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const compiled = frames[0].decodedPage!.compiledBlocks!.entries[word];
	assert.ok(compiled);
	for (const [tag, payload] of [[ValueTag.Integer, 13], [ValueTag.Float, 0xffa12345], [ValueTag.False, 37]] as const) {
		for (const frame of frames) {
			frame.executionImage.constTags[0] = tag;
			frame.executionImage.constWords[0] = payload;
		}
		runCpuParity(js, scalar, grant);
		const value = valueFromTag(tag, payload);
		for (const [i, cpu] of [js, scalar].entries()) {
			assert.equal(frames[i].pc, pc);
			assert.equal(frames[i].registers.get(0), value);
			assert.equal(frames[i].registers.get(1), value);
			assert.equal(cpu.gc.tables.getInteger(tables[i], 1), value);
		}
		assert.equal(frames[0].decodedPage!.compiledBlocks!.entries[word], compiled);
	}
});

for (const [op, name] of [[OpCode.GETFIELD, 'GETFIELD'], [OpCode.LEN, 'LEN']] as const) test(`compiled WIDE ${name} observes a dirty physical register word or tag`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 2, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, op, 3, 0, 0);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	const image = linkRawTestSystemBlua32({ text, constants: ['field'], functions: [{ firstWord: 0, wordCount: 4, maxStack: 8 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript), ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const entry = image.image.functions[0].codeAddress;
	for (const { cpu, memory } of [js, ref]) {
		const frame = cpu.rootThread.currentFrame!, r = frame.registers;
		const table = cpu.createTable(op === OpCode.LEN ? 1 : 0, op === OpCode.LEN ? 0 : 1), key = cpu.stringPool.intern('field');
		r.setTable(0, table);
		if (op === OpCode.LEN) cpu.gc.tables.setInteger(table, 1, valueInteger(41));
		else cpu.gc.tables.setStringKey(table, key, valueInteger(41));
		cpu.runUntilDepth(0, 2048);
		const stack = frame.thread.stackRegisters;
		const tagBase = stack.ramOffset() + 4 * stack.capacity() + frame.stackBase;
		const storage = op === OpCode.LEN ? tagBase + 2 - 4 : r.ramOffset() + 4;
		// The single array tag or hash value word lands on register 2.
		// The raw backing uses the physical RAM mirror.
		memory.writeRamRecordWord(table + TableHeader.Storage, storage + MAIN_RAM_SIZE);
		if (op === OpCode.GETFIELD) {
			memory.writeRamRecordWord(storage, key);
			memory.writeRamRecordByte(storage + 12, ValueTag.String);
			memory.writeRamRecordByte(storage + 13, ValueTag.Integer);
		}
	}
	const frame = js.cpu.rootThread.currentFrame!;
	const block = frame.decodedPage!.compiledBlocks!.entries[(entry & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]!;
	const fixed = BASE_CYCLES[OpCode.K1] + BASE_CYCLES[op];
	const grant = fixed + 1;
	assert.ok(block && block.admissionCycles < grant, 'the alias is checked in an admitted generated body');
	for (const { cpu } of [js, ref]) {
		const registers = cpu.rootThread.currentFrame!.registers;
		registers.set(2, op === OpCode.LEN ? valueNil() : valueInteger(73)); registers.setInteger(3, -1);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
	}
	runCpuParity(js.cpu, ref.cpu, grant);
	assert.ok(isDeepStrictEqual(js.cpu.captureRuntimeState(), ref.cpu.captureRuntimeState()));
	assert.equal(frame.registers.getInteger(2), 1);
	assert.equal(frame.registers.getInteger(3), 1, 'the read sees K1, not the stale physical lane at block entry');
	assert.equal(js.cpu.lastPc, entry + (op === OpCode.LEN ? 2 : 3) * INSTRUCTION_BYTES);
	assert.equal(frame.pc, op === OpCode.LEN ? entry + 3 * INSTRUCTION_BYTES : entry);
	assert.equal(js.cpu.instructionBudgetRemaining, 1 - (op === OpCode.LEN ? 2 * TABLE_LENGTH_PROBE_CYCLES : BASE_CYCLES[OpCode.JMP]));
});

test('only positive integer keys enter the array even with a raw high-bit capacity', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.GETT, 3, 0, 1);
	writeInstruction(text, 1, OpCode.SETT, 0, 1, 2);
	writeInstruction(text, 2, OpCode.GETT, 4, 0, 1);
	writeInstruction(text, 3, OpCode.GETT, 6, 5, 7);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }] }, RAM_CODE_FIXTURE_BYTES);
	const pc = image.image.functions[0].codeAddress, key = -0x7ffffffe;
	const capacity = 0x80000010, invalidSlot = 0x80000001;
	const words = DYNAMIC_RAM_BASE + 0x3000, tags = words + (capacity + 3) * 4;
	for (const backend of [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter]) {
		const { cpu } = createTestSystemCpu(image, backend);
		const frame = cpu.rootThread.frameAtDepth(0), r = frame.registers;
		const table = cpu.createTable(1, 1), child = cpu.createTable(), meta = cpu.createTable(0, 1);
		cpu.gc.tables.setInteger(table, 1, valueInteger(61));
		cpu.gc.tables.setStringKey(meta, cpu.stringPool.intern('__index'), valueTable(table));
		cpu.gc.tables.setMetatableAddress(child, meta);
		r.setTable(0, table); r.setInteger(1, 1); r.setInteger(2, 89); r.setTable(5, child); r.setInteger(7, 1);
		cpu.runUntilDepth(0, 1024);
		if (backend === CpuExecutionBackend.JavaScript)
			assert.ok(frame.decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]);
		const memory = cpu.memory;
		memory.writeRamRecordWord(table + TableHeader.Storage, words);
		memory.writeRamRecordWord(table + TableHeader.Array, capacity);
		memory.writeRamRecordWord(words, 61);
		memory.writeRamRecordByte(tags, ValueTag.Integer);
		memory.writeRamRecordWord(words + capacity * 4, key);
		memory.writeRamRecordByte(tags + capacity, ValueTag.Integer);
		memory.writeRamRecordWord(words + (capacity + 1) * 4, 73);
		memory.writeRamRecordByte(tags + capacity + 1, ValueTag.Integer);
		memory.writeRamRecordWord(words + invalidSlot * 4, 47);
		memory.writeRamRecordByte(tags + invalidSlot, ValueTag.Integer);
		r.setInteger(1, key);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.runUntilDepth(0, 3 * BASE_CYCLES[OpCode.GETT] + BASE_CYCLES[OpCode.SETT]);
		assert.equal(r.getInteger(3), 73);
		assert.equal(r.getInteger(4), 89);
		assert.equal(cpu.gc.tables.getInteger(table, key), valueInteger(89));
		assert.equal(memory.readRamRecordWord(words + invalidSlot * 4), 47, 'the invalid array lane remains untouched');
		assert.equal(r.getInteger(6), 61, 'the inherited positive array value uses the unsigned capacity');
		assert.equal(frame.pc, pc + 4 * INSTRUCTION_BYTES);
	}
});

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
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers;
		r.setTable(0, cpu.createTable(4, 1)); r.setInteger(1, 1); r.setInteger(2, 3); cpu.runUntilDepth(0, 896);
	}
	const frame = js.rootThread.frameAtDepth(0), page = frame.decodedPage!;
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = page.compiledBlocks!.entries[entry]!;
	assert.equal(block.sourceWords, 7);
	for (const cpu of [js, ref]) cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
	for (const key of [valueInteger(1), valueInteger(2), valueInteger(4), valueInteger(5), valueInteger(0),
		valueFloat(-0), valueInteger(-7), valueFloat(1), valueFloat(1.5), valueInteger(0x7fffffff), valueInteger(16777217),
		valueFloat(16777216), valueFloat(2 ** 31), valueFloat(2 ** 32), valueFloat(Infinity),
		valueFloat(-Infinity), valueBool(false), valueBool(true), 'field'] as const) {
		for (const value of [valueNil(), valueBool(false), valueBool(true), valueFloat(-0), valueFloatBits(0xffc01234), valueFloat(Infinity), 'value'] as const) {
			for (const cpu of [js, ref]) {
				const r = cpu.rootThread.frameAtDepth(0).registers;
				r.set(1, key === 'field' ? valueString(cpu.stringPool.intern(key)) : key);
				r.set(2, value === 'value' ? valueString(cpu.stringPool.intern(value)) : value);
			}
			runCpuParity(js, ref, 16);
			// Rebuilding can consume the grant before the loop's readback.
			for (let remaining = image.image.functions[0].codeByteCount / INSTRUCTION_BYTES;
				remaining > 0 && frame.pc !== image.image.functions[0].codeAddress; --remaining) runCpuParity(js, ref, 1);
			assert.equal(frame.pc, image.image.functions[0].codeAddress, 'readback completes within one seven-word loop');
			assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()), `generic key ${key}, value ${value}`);
			assert.equal(frame.registers.get(3), frame.registers.get(2));
			assert.equal(frame.registers.getInteger(5), 1, 'the array store forwards its pending numeric source');
		}
	}
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers;
		r.setTable(1, cpu.createTable()); r.setTable(2, cpu.createTable());
	}
	for (const grant of [9, 1, 2, 1, 2, 1, 1, 1, 256]) {
		runCpuParity(js, ref, grant);
		assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()), 'reference keys/values and every short boundary agree');
	}
	assert.ok(page.compiledBlocks!.entries[entry] === block, 'admitted helper continuations do not retranslate the stable table loop');
});

for (const generic of [false, true]) test(`compiled array reads resolve inherited nil slots but bypass inheritance for own values (generic=${generic})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, generic ? OpCode.GETT : OpCode.GETI, 3, 0, 1);
	writeInstruction(text, 1, OpCode.MOV, 4, 3, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3, maxStack: 5 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const own = cpu.createTable(2, 0), parent = cpu.createTable(2, 0), meta = cpu.createTable(0, 1);
		cpu.gc.tables.setInteger(parent, 1, valueInteger(73)); cpu.gc.tables.setStringKey(meta, cpu.stringPool.intern('__index'), valueTable(parent)); cpu.gc.tables.setMetatableAddress(own, meta);
		cpu.rootThread.frameAtDepth(0).registers.setTable(0, own); cpu.rootThread.frameAtDepth(0).registers.setInteger(1, 1);
		cpu.runUntilDepth(0, 32 * (BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.SELF] + BASE_CYCLES[OpCode.JMP]));
	}
	for (const value of [valueBool(false), valueInteger(0), valueNil(), valueBool(true), valueInteger(19), valueNil()]) {
		for (const cpu of [js, ref]) cpu.gc.tables.setInteger(cpu.rootThread.frameAtDepth(0).registers.getPayload(0), 1, value);
		runCpuParity(js, ref, 6);
		assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
		assert.equal(js.readFrameRegister(0, 3), value === valueNil() ? valueInteger(73) : value);
	}
	const frame = js.rootThread.frameAtDepth(0), entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const region = frame.decodedPage!.compiledBlocks!.entries[entry]!.region;
	assert.equal(region.entries[0].sourceWords, 3,
		'the field load and its admitted helper continuation stay in one generated region');
});

test('compiled array stores retain hints and length searches preserve live registers', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 8, 0, 0);
	writeInstruction(text, 1, OpCode.SETI, 0, 2, 2);
	writeInstruction(text, 2, OpCode.LEN, 3, 0, 0);
	writeInstruction(text, 3, OpCode.ADD, 4, 8, 3);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 9 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const table = cpu.createTable(2, 4);
		for (let i = 1; i <= 5; ++i) cpu.gc.tables.setInteger(table, i, valueInteger(i));
		cpu.rootThread.frameAtDepth(0).registers.setTable(0, table); cpu.rootThread.frameAtDepth(0).registers.setInteger(2, 2); cpu.runUntilDepth(0, 605);
	}
	for (const value of [valueNil(), valueBool(false), valueNil(), valueInteger(2)]) {
		for (const cpu of [js, ref]) cpu.rootThread.frameAtDepth(0).registers.set(2, value);
		runCpuParity(js, ref, 11);
		assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
		const boundary = js.rootThread.frameAtDepth(0).registers.getInteger(3);
		const table = js.rootThread.frameAtDepth(0).registers.getPayload(0);
		assert.ok(boundary === 0 || js.gc.tables.get(table, valueInteger(boundary)) !== valueNil());
		assert.equal(js.gc.tables.get(table, valueInteger(boundary + 1)), valueNil());
		if (value !== valueNil()) assert.equal(boundary, 5);
		assert.equal(js.readFrameRegister(0, 4), valueInteger(boundary + 1), 'the live native definition survives the length helper');
	}
});

test('compiled byte length retains live definitions and destination/source aliases', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.KSMI, 4, 0, 7);
	writeInstruction(text, 1, OpCode.MOV, 2, 1, 0);
	writeInstruction(text, 2, OpCode.LEN, 2, 2, 0);
	writeInstruction(text, 3, OpCode.ADD, 3, 2, 4);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 5 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		cpu.rootThread.frameAtDepth(0).registers.setString(1, cpu.stringPool.intern(textToByteString('Aé雪\0😀'))); cpu.runUntilDepth(0, 500);
	}
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	assert.equal(js.readFrameRegister(0, 2), valueInteger(11)); assert.equal(js.readFrameRegister(0, 3), valueInteger(18));
	const frame = js.rootThread.frameAtDepth(0), entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
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
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const table = cpu.createTable(0, 1); cpu.gc.tables.setStringKey(table, cpu.stringPool.intern('method'), valueInteger(73));
		cpu.rootThread.frameAtDepth(0).registers.setTable(9, table); cpu.runUntilDepth(0, 32 * (BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.SELF] + BASE_CYCLES[OpCode.JMP]));
	}
	const frame = js.rootThread.frameAtDepth(0), entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(frame.decodedPage!.compiledBlocks!.entries[entry]!.sourceWords, 3);
	assert.equal(frame.registers.get(7), frame.registers.get(9));
	for (const cpu of [js, ref]) {
		const root = cpu.rootThread.frameAtDepth(0), table = root.registers.getPayload(9), meta = cpu.createTable(0, 1);
		cpu.gc.tables.setStringKey(table, cpu.stringPool.intern('method'), valueNil()); cpu.gc.tables.setStringKey(meta, cpu.stringPool.intern('__index'), valueTable(table));
		cpu.gc.tables.setMetatableAddress(table, meta); root.top = 0;
	}
	runCpuParity(js, ref, 4);
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_METATABLE_LOOP);
	assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
	assert.equal(frame.top, 8); assert.equal(frame.registers.get(7), frame.registers.get(9));
	assert.ok(frame.registers.get(6) === frame.registers.get(9), 'failed lookup does not replace the method destination with a transient missing value');
});

for (const [op, key] of [
	[OpCode.GETT, valueInteger(1)], [OpCode.GETT, valueFloat(1.5)], [OpCode.GETT, valueBool(false)], [OpCode.GETT, 'field'],
	[OpCode.GETI, valueInteger(1)], [OpCode.GETFIELD, 'field'],
] as const) test(`table chain exhaustion preserves the read destination (${op}, ${key})`, () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.MOV, 6, 9, 0);
	writeInstruction(text, 1, op, 3, 0, op === OpCode.GETFIELD ? 0 : 1);
	writeInstruction(text, 2, OpCode.MOV, 4, 3, 0);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	writeInstruction(text, 32, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 10 },
		{ firstWord: 32, wordCount: 1 }], constants: ['field'], exceptionFunctionIndex: 1 });
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const cpu = createTestSystemCpu(image, backend).cpu;
		const frame = cpu.rootThread.frameAtDepth(0), r = frame.registers;
		const table = cpu.createTable(2, 1);
		const encodedKey = key === 'field' ? valueString(cpu.stringPool.intern(key)) : key;
		cpu.gc.tables.set(table, encodedKey, valueInteger(73));
		r.setTable(0, table); r.set(1, encodedKey); r.setInteger(9, 17);
		cpu.runUntilDepth(0, 32 * (2 * BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[op] + BASE_CYCLES[OpCode.JMP]));
		if (backend === CpuExecutionBackend.JavaScript) {
			const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
			assert.ok(frame.decodedPage!.compiledBlocks!.entries[entry], 'exercise an adopted generated loop');
		}
		cpu.gc.tables.set(table, encodedKey, valueNil());
		const meta = cpu.createTable(0, 1);
		cpu.gc.tables.setStringKey(meta, cpu.stringPool.intern('__index'), valueTable(table)); cpu.gc.tables.setMetatableAddress(table, meta);
		r.setInteger(3, 91); r.setInteger(4, 57); frame.top = 0;
		cpu.runUntilDepth(0, 4);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_METATABLE_LOOP);
		assert.equal(cpu.readEpcWord(), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
		assert.equal(r.getInteger(3), 91, 'an exhausted lookup has no result to publish');
		assert.equal(r.getInteger(4), 57, 'the following instruction did not execute');
		assert.equal(r.getInteger(6), 17, 'the completed prefix remains visible');
		assert.equal(frame.top, 7);
	}
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
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const cpu of [js, ref]) {
		const r = cpu.rootThread.frameAtDepth(0).registers;
		r.setTable(0, cpu.createTable(2)); r.setInteger(1, 1); r.setInteger(2, 73); cpu.runUntilDepth(0, 504);
		r.setNil(1); r.setInteger(3, 19); cpu.rootThread.frameAtDepth(0).top = 0;
	}
	runCpuParity(js, ref, 5);
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_INDEX_NIL);
	assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
	assert.equal(js.rootThread.frameAtDepth(0).registers.getInteger(3), 19);
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
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu, ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (let visit = 0; visit < 32; visit++) runCpuParity(js, ref, 1);
	const frame = js.rootThread.frameAtDepth(0), page = frame.decodedPage!, entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.equal(page.compiledBlocks!.entries[entry]!.terminal.exit, CompiledBlockExit.AllocateTable);
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	for (const cpu of [js, ref]) {
		const root = cpu.rootThread.frameAtDepth(0); root.registers.setInteger(8, 73); root.registers.setNil(9); root.top = 9;
		cpu.collectTrackedHeapBytes(); // Discard the tables made while warming the code.
		cpu.rootThread.resizeStack(32); // The exception frame must not allocate during the failed NEWT.
		const retained = cpu.createTable(660000);
		cpu.setGlobalByKey(cpu.stringPool.find('retained')!, valueTable(retained));
		cpu.collectTrackedHeapBytes();
	}
	const beforeGc = captureCpuCheckpoint(ref);
	const gcCycles = ref.gc.collect();
	restoreCpuCheckpoint(ref, beforeGc);
	runCpuParity(js, ref, BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.NEWT]);
	assert.equal(js.instructionBudgetRemaining, -gcCycles, 'failed NEWT pays prefix/base and collection, but no initialization');
	assert.ok(isDeepStrictEqual(js.captureRuntimeState(), ref.captureRuntimeState()));
	assert.equal(js.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
	assert.equal(js.readEpcWord(), image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
	assert.equal(frame.registers.getInteger(8), 73); assert.equal(frame.top, 9);
});

test('compiled and scalar table instructions address the same raw RAM without a host object', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.SETI, 0, 1, 2);
	writeInstruction(text, 1, OpCode.GETI, 3, 0, 1);
	writeInstruction(text, 2, OpCode.LEN, 4, 0, 0);
	writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 5 }] });
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript).cpu;
	const scalar = createTestSystemCpu(image, CpuExecutionBackend.Interpreter).cpu;
	for (const record of [RAM_BASE + 0x20000, RAM_BASE + MAIN_RAM_SIZE - 4]) {
		const body = RAM_BASE + 0x21000;
		for (const cpu of [js, scalar]) {
			cpu.memory.writeRamRecordByte(record, ValueTag.Table);
			assert.equal(cpu.gc.tableRecordAddress(record), 0, 'a header outside an issued slot is not a collector record');
			cpu.memory.writeRamRecordWord(record + TableHeader.Metatable, 0);
			cpu.memory.writeRamRecordWord(record + TableHeader.Storage, body + MAIN_RAM_SIZE);
			cpu.memory.writeRamRecordWord(record + TableHeader.Array, 1);
			cpu.memory.writeRamRecordWord(record + TableHeader.Hash, 0);
			cpu.memory.writeRamRecordWord(record + TableHeader.Length, 0);
			const registers = cpu.rootThread.currentFrame!.registers;
			registers.setTable(0, record + MAIN_RAM_SIZE + 1); registers.setInteger(2, 83);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
		}
		runCpuParity(js, scalar, 1000);
		for (const cpu of [js, scalar]) {
			assert.equal(cpu.rootThread.currentFrame!.registers.get(3), valueInteger(83));
			assert.equal(cpu.rootThread.currentFrame!.registers.get(4), valueInteger(1));
			assert.equal(cpu.memory.readRamRecordWord(body), 83);
			assert.equal(cpu.memory.readRamRecordByte(body + 4), ValueTag.Integer);
		}
	}
	const frame = js.rootThread.currentFrame!;
	const entry = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	assert.ok(frame.decodedPage!.compiledBlocks!.entries[entry], 'the raw record path ran in a warmed block');
});
