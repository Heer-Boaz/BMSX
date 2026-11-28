import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abortFixtureCompletionCall, runCpuParity } from '../helpers/cpu_execution';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { readLE32, writeLE32 } from '../../machine/ts/common/endian';
import { COMPILED_BLOCK_THRESHOLD, CompiledBlockExit, CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { COP0_CONTEXT, COP0_STATUS, CPU_CAUSE_CODE_DATA_BUS_ERROR,
	CPU_STATUS_INTERRUPT_ENABLE_CURRENT, CPU_STATUS_USER_MODE_CURRENT, LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { valueBool, valueNil, valueInteger, valueFloat, valueFloatBits, ValueTag } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { writeInstruction, INSTRUCTION_BYTES, MAX_LOW_BX } from '../../machine/ts/spec/blua32/instruction_format';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE } from '../../machine/ts/spec/blua32/image_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { CPU_FIXED_VALUE_END, CPU_RESET_BANK_ADDRESS, DYNAMIC_RAM_BASE, IO_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BUS_FAULT_UNMAPPED, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { MAPPED_BUS_MASTER_DMA } from '../../machine/ts/machine/memory/bus_signals';
import { RAM_CODE_FIXTURE_BYTES, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { reserveThreadFrameReference } from '../helpers/thread_allocation_reference';

function memoryLoop(op: OpCode, kind: MemoryAccessKind, displacement = 0) {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.K1, 4, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, op, 0, 1, kind, displacement);
	writeInstruction(text, 3, OpCode.MOV, 6, 0, 0);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	writeInstruction(text, 5, OpCode.HALT, 0, 0, 0);
	return linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 5, maxStack: 8 }, { firstWord: 5, wordCount: 1 },
	], exceptionFunctionIndex: 1 }, RAM_CODE_FIXTURE_BYTES);
}

const widths = [4, 1, 2, 4, 4, 8];

test('counted memory writes commit the available prefix before an absent source register', () => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.STORE_MEM_WORDS, 0, 63, 2, 56); // RK(B) = K0.
	writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	const address = DYNAMIC_RAM_BASE + 0x100;
	const image = linkRawTestSystemBlua32({ text, constants: [integerConstant(address)], exceptionFunctionIndex: 1,
		functions: [{ firstWord: 0, wordCount: 1, maxStack: 1 }, { firstWord: 1, wordCount: 1 }] }, RAM_CODE_FIXTURE_BYTES);
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu, memory } = createTestHeapServiceCpu(image, backend);
		const pc = cpu.rootThread.currentFrame!.pc;
		cpu.rootThread.currentFrame!.registers.setInteger(0, 123);
		memory.writeMappedU32LE(address + 4, 456);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
		assert.equal(cpu.readEpcWord(), pc);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.STORE_MEM_WORDS] - 2);
		assert.equal(memory.readMappedU32LE(address), 123);
		assert.equal(memory.readMappedU32LE(address + 4), 456);
	}
});

test('compiled memory exits retain the computed raw guest address', () => {
	for (const op of [OpCode.LOAD_MEM, OpCode.LOAD_MEM_D, OpCode.STORE_MEM, OpCode.STORE_MEM_D,
		OpCode.STORE_MEM_WORDS, OpCode.STORE_MEM_WORDS_D]) {
		const displaced = op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM_D || op === OpCode.STORE_MEM_WORDS_D;
		const image = memoryLoop(op, MemoryAccessKind.F64LE, displaced ? 255 : 0);
		const { cpu } = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript);
		const frame = cpu.rootThread.frameAtDepth(0);
		for (let i = 0; i < 5; ++i) frame.registers.setInteger(i, i);
		frame.registers.setInteger(1, DYNAMIC_RAM_BASE + 0x1000 - (displaced ? 1020 : 0));
		cpu.runUntilDepth(0, 2400);
		const page = frame.decodedPage!;
		const block = page.compiledBlocks!.entries[(image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
		assert.ok(block, 'the test must execute an adopted generated body');
		const expected = op === OpCode.LOAD_MEM || op === OpCode.LOAD_MEM_D ? CompiledBlockExit.ReadMemory
			: op === OpCode.STORE_MEM_WORDS || op === OpCode.STORE_MEM_WORDS_D ? CompiledBlockExit.WriteWords
				: CompiledBlockExit.WriteMemory;
		for (const address of [IO_BASE, 0xfffffffc, 0xfffffffd]) {
			frame.registers.setInteger(1, (address - (displaced ? 1020 : 0)) >>> 0);
			const run = { remainingCycles: 100, registerTop: frame.top, effectiveAddress: 0 };
			const exit = block.region.exits[block.region.execute(frame.registers, frame.executionImage.constWords, page, frame, block.entry, run)];
			assert.equal(exit.exit, expected);
			assert.equal(run.effectiveAddress, address, 'cold paths publish the post-displacement u32 without executing the transfer');
		}
	}
});

for (const op of [OpCode.LOAD_MEM_D, OpCode.STORE_MEM_D, OpCode.STORE_MEM_WORDS_D]) {
	test(`warm memory transfers respect the installed CPU data boundary (${op})`, () => {
		const fence = RAM_BASE + MAIN_RAM_SIZE;
		const counted = op === OpCode.STORE_MEM_WORDS_D, load = op === OpCode.LOAD_MEM_D;
		const image = memoryLoop(op, counted ? 2 : MemoryAccessKind.F64LE, 1);
		const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript).cpu;
		const ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
		const start = image.image.functions[0].codeAddress;
		const loopCycles = BASE_CYCLES[OpCode.K1] + BASE_CYCLES[op] + 2 + BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP];
		for (const cpu of [js, ref]) {
			const frame = cpu.rootThread.frameAtDepth(0);
			frame.registers.setInteger(0, 29);
			frame.registers.setInteger(1, DYNAMIC_RAM_BASE + 0x1000 - 4);
		}
		assert.equal(runCpuParity(js, ref, (COMPILED_BLOCK_THRESHOLD + 2) * loopCycles), RunResult.Yielded);
		const entry = (start & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
		assert.ok(js.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries[entry]);
		for (const cpu of [js, ref]) {
			const frame = cpu.rootThread.frameAtDepth(0);
			cpu.memory.writeMappedU32LE(fence - 4, 0x12345678);
			frame.registers.setInteger(0, 29);
			frame.registers.setInteger(1, fence - 8);
		}
		assert.equal(runCpuParity(js, ref, BASE_CYCLES[OpCode.K1] + 1), RunResult.Yielded);
		for (const cpu of [js, ref]) {
			const frame = cpu.rootThread.frameAtDepth(0);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_DATA_BUS_ERROR);
			assert.equal(cpu.readEpcWord(), start + INSTRUCTION_BYTES);
			assert.equal(cpu.memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
			assert.equal(cpu.memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), fence);
			assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[op] - 2);
			assert.equal(frame.registers.get(0), valueInteger(29), 'the faulting load does not commit its destination');
			assert.equal(cpu.memory.readMappedU32LE(fence - 4), load ? 0x12345678 : counted ? 29 : 0,
				'only the completed low half of a store commits');
		}
		assert.deepEqual(js.captureRuntimeState(), ref.captureRuntimeState());
	});
}

test('cached values reach field, memory and fault owners without stale tags or noncanonical numeric bits', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.MOV, 0, 1, 0);
	writeInstruction(text, 1, OpCode.GETFIELD, 2, 0, 0);
	writeInstruction(text, 2, OpCode.K0, 3, 0, 0);
	writeInstruction(text, 3, OpCode.DIV, 4, 12, 13);
	writeInstruction(text, 4, OpCode.SETFIELD, 0, 1, 4);
	writeInstruction(text, 5, OpCode.STORE_MEM, 4, 5, MemoryAccessKind.F64LE);
	writeInstruction(text, 6, OpCode.K1, 6, 0, 0);
	writeInstruction(text, 7, OpCode.ADD, 7, 6, 2);
	writeInstruction(text, 8, OpCode.MOV, 8, 0, 0);
	writeInstruction(text, 9, OpCode.MOV, 9, 7, 0);
	writeInstruction(text, 10, OpCode.GETFIELD, 10, 8, 1);
	writeInstruction(text, 11, OpCode.MOV, 11, 10, 0);
	writeInstruction(text, 12, OpCode.JMP, 0, 63, 51, 255);
	writeInstruction(text, 13, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 13, maxStack: 14 }, { firstWord: 13, wordCount: 1 },
	], constants: ['stable', 'result'], exceptionFunctionIndex: 1 }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	const address = DYNAMIC_RAM_BASE + 0x1000;
	const loopCycles = [OpCode.MOV, OpCode.GETFIELD, OpCode.K0, OpCode.DIV, OpCode.SETFIELD, OpCode.STORE_MEM,
		OpCode.K1, OpCode.ADD, OpCode.MOV, OpCode.MOV, OpCode.GETFIELD, OpCode.MOV, OpCode.JMP]
		.reduce((cycles, op) => cycles + BASE_CYCLES[op], 2); // Second bus transfer for F64LE.
	for (const { cpu } of machines) {
		const table = createReferenceTable(cpu, 0, 2);
		nativeHeapReference(cpu).gc.tables.storeStringKey(table, nativeHeapReference(cpu).stringPool.intern('stable'), ValueTag.Integer, 22);
		nativeHeapReference(cpu).gc.tables.storeStringKey(table, nativeHeapReference(cpu).stringPool.intern('result'), ValueTag.Integer, 0);
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setTable(1, table); frame.registers.setInteger(5, address);
		frame.registers.setFloat(12, Infinity); frame.registers.setFloat(13, Infinity);
		cpu.runUntilDepth(0, (COMPILED_BLOCK_THRESHOLD + 1) * loopCycles);
	}
	const frame = machines[0].cpu.rootThread.frameAtDepth(0), page = frame.decodedPage!;
	const entry = image.image.functions[0].codeAddress;
	const block = page.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
	assert.equal(block.sourceWords, 13);
	assert.equal(block.region.exits[block.region.execute(frame.registers, frame.executionImage.constWords, page, frame, block.entry, { remainingCycles: loopCycles, registerTop: frame.top, effectiveAddress: 0 })].nextPc, image.image.functions[0].codeAddress);
	machines[1].cpu.runUntilDepth(0, loopCycles);
	assert.equal(machines[0].memory.readMappedWord(address), 0);
	assert.equal(machines[0].memory.readMappedWord(address + 4), 0x7ff80000);
	assert.equal(Buffer.compare(machines[0].memory.ramData(), machines[1].memory.ramData()), 0,
		'float stores consume the canonical guest number');
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	for (const { cpu } of machines) {
		const current = cpu.rootThread.frameAtDepth(0);
		current.registers.setInteger(1, 5); current.top = 0;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assert.equal(current.registers.getInteger(0), 5, 'the field fault sees the new cached base, not the old table slot');
		assert.equal(current.registers.getInteger(2), 22, 'the failed field destination remains unchanged');
		assert.equal(current.top, 1);
		assert.equal(cpu.readEpcWord(), entry + INSTRUCTION_BYTES);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

for (let format = 0; format <= 5; ++format) for (const displaced of [false, true]) {
	test(`generated RAM format ${format}, displaced ${displaced}: data, aliases and short grants`, () => {
		const image = memoryLoop(displaced ? OpCode.STORE_MEM_D : OpCode.STORE_MEM, format, displaced ? 255 : 0);
		const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript);
		const ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter);
		const entry = image.image.functions[0].codeAddress;
		const address = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 4;
		for (const machine of [js, ref]) {
			machine.cpu.rootThread.frameAtDepth(0).registers.setInteger(1, address - (displaced ? 1020 : 0));
			machine.cpu.rootThread.frameAtDepth(0).registers.setInteger(0, 1);
			machine.cpu.runUntilDepth(0, 1200);
		}
		const frame = js.cpu.rootThread.frameAtDepth(0), page = frame.decodedPage!;
		const block = page.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
		assert.equal(block.sourceWords, 5);
		const loopCycles = BASE_CYCLES[OpCode.K1] + BASE_CYCLES[displaced ? OpCode.STORE_MEM_D : OpCode.STORE_MEM]
			+ BASE_CYCLES[OpCode.MOV] + BASE_CYCLES[OpCode.JMP] + (format === MemoryAccessKind.F64LE ? 2 : 0);
		assert.equal(block.region.exits[block.region.execute(frame.registers, frame.executionImage.constWords, page, frame, block.entry, { remainingCycles: loopCycles, registerTop: frame.top, effectiveAddress: 0 })].nextPc, image.image.functions[0].codeAddress,
			'RAM and dependent instructions stay in the generated function');
		for (const value of [valueInteger(-1), valueInteger(16777217), valueFloat(-0), valueFloat(0.25), valueFloat(-1.75),
			valueFloat(2 ** 32 + 512), valueFloat(-(2 ** 32) - 512), valueFloatBits(0x7f7fffff), valueFloatBits(1),
			...(format >= MemoryAccessKind.F32LE ? [valueFloat(Infinity), valueFloat(-Infinity), valueFloatBits(0xffa12345)] : [])]) {
			for (const grant of [1, 2, 3, 4, 5, 9, 33, 256]) {
				for (const machine of [js, ref]) {
					machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
					machine.cpu.rootThread.frameAtDepth(0).registers.set(0, value);
				}
				runCpuParity(js.cpu, ref.cpu, grant);
				assert.deepEqual(js.cpu.captureRuntimeState(), ref.cpu.captureRuntimeState());
				assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
			}
		}
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.LOAD_MEM, 1, 1, format);
		writeInstruction(text, 1, OpCode.MOV, 2, 1, 0);
		writeInstruction(text, 2, OpCode.MOV, 1, 3, 0);
		writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
		const loads = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 4 }] }, RAM_CODE_FIXTURE_BYTES);
		for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
			const machine = createTestHeapServiceCpu(loads, backend);
			machine.cpu.rootThread.frameAtDepth(0).registers.setInteger(1, machine.memory.ramBusEnd() - widths[format]);
			machine.cpu.rootThread.frameAtDepth(0).registers.setInteger(3, machine.memory.ramBusEnd() - widths[format]);
			machine.cpu.runUntilDepth(0, 1200);
			assert.equal(machine.cpu.readFrameRegister(0, 2), format >= MemoryAccessKind.F32LE ? valueFloat(0) : valueInteger(0));
			if (backend === CpuExecutionBackend.JavaScript) assert.ok(machine.cpu.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.sourceUnits > 0);
		}
	});
}

test('an invalid scalar store faults at WIDE without writing either half or executing the next MOV', () => {
	for (const format of [MemoryAccessKind.Word, MemoryAccessKind.F32LE, MemoryAccessKind.F64LE]) {
		const image = memoryLoop(OpCode.STORE_MEM, format);
		const pc = image.image.functions[0].codeAddress + INSTRUCTION_BYTES;
		const invalid = [valueNil(), valueBool(true)];
		if (format === MemoryAccessKind.Word) invalid.push(valueFloatBits(0xffa12345), valueFloat(Infinity));
		for (const source of invalid) {
			const js = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript);
			const ref = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter);
			for (const { cpu, memory } of [js, ref]) {
				const frame = cpu.rootThread.frameAtDepth(0);
				frame.registers.setInteger(0, 1); frame.registers.setInteger(1, DYNAMIC_RAM_BASE);
				for (let i = 0; i <= COMPILED_BLOCK_THRESHOLD; ++i) {
					cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
					cpu.runUntilDepth(0, 1);
				}
				if (cpu === js.cpu) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]);
				frame.registers.set(0, source); frame.registers.setInteger(6, 37);
				memory.writeMappedWord(DYNAMIC_RAM_BASE, 0x11223344); memory.writeMappedWord(DYNAMIC_RAM_BASE + 4, 0x55667788);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			}
			runCpuParity(js.cpu, ref.cpu, 1);
			for (const { cpu, memory } of [js, ref]) {
				assert.equal(cpu.readEpcWord(), pc); assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
				assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.STORE_MEM] - (format === MemoryAccessKind.F64LE ? 2 : 0));
				assert.equal(cpu.rootThread.frameAtDepth(0).registers.getInteger(6), 37);
				assert.equal(memory.readMappedWord(DYNAMIC_RAM_BASE), 0x11223344);
				assert.equal(memory.readMappedWord(DYNAMIC_RAM_BASE + 4), 0x55667788);
			}
			assert.deepEqual(js.cpu.captureRuntimeState(), ref.cpu.captureRuntimeState());
		}
	}
});

test('a generated MMIO store checks readiness before width faults or source consumption', () => {
	const image = memoryLoop(OpCode.STORE_MEM, MemoryAccessKind.U16LE);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(0, 12); frame.registers.setInteger(1, DYNAMIC_RAM_BASE + 0x1000);
		cpu.runUntilDepth(0, 1200);
		const target = RAM_BASE + 0x5000;
		const device = { ready: false, writes: 0 };
		memory.mapIoWrite(target, device, state => { ++state.writes; });
		memory.mapIoWriteReady(target, (state: typeof device) => state.ready);
		frame.top = 0; frame.registers.setInteger(1, target);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
		assert.equal(cpu.captureRuntimeState().memoryWriteBlocked, true);
		assert.equal(memory.readBusFaultSequence(), 0);
		assert.equal(frame.top, 5);
		assert.equal(device.writes, 0);
		device.ready = true;
		cpu.resumeMemoryWrite(target);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
		assert.equal(memory.readBusFaultSequence(), 1);
		assert.equal(device.writes, 0, 'the attempted U16 store faults rather than becoming a register write');
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

test('a generated F64 load retains its destination when the second bus transfer faults', () => {
	const image = memoryLoop(OpCode.LOAD_MEM_D, MemoryAccessKind.F64LE, 255);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(1, DYNAMIC_RAM_BASE + 0x404 - 1020);
		cpu.runUntilDepth(0, 1200);
		frame.registers.setInteger(0, 73); frame.top = 0;
		frame.registers.setInteger(1, RAM_BASE + MAIN_RAM_SIZE - 4 - 1020);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
		assert.equal(frame.registers.getInteger(0), 73);
		assert.equal(frame.top, 5);
		assert.equal(cpu.captureRuntimeState().epcWord, image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
		assert.equal(memory.readBusFaultSequence(), 1);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

test('a watched RAM store retires its own generated source only after returning', () => {
	const image = memoryLoop(OpCode.STORE_MEM, MemoryAccessKind.U32LE);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const [index, { cpu, memory }] of machines.entries()) {
		const frame = cpu.rootThread.frameAtDepth(0);
		const entry = image.image.functions[0].codeAddress;
		memory.writeBytes(DYNAMIC_RAM_BASE, image.romBytes.subarray(entry, entry + MAPPED_PAGE_BYTE_SIZE));
		frame.registers.setInteger(0, 7); frame.registers.setInteger(1, DYNAMIC_RAM_BASE + 0x1000);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1200);
		const page = frame.decodedPage!;
		if (index === 0) assert.ok(page.compiledBlocks!.entries[0]);
		const replacement = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(replacement, 0, OpCode.HALT, 0, 0, 0);
		frame.top = 0; frame.registers.setInteger(0, readLE32(replacement, 0));
		frame.registers.setInteger(1, DYNAMIC_RAM_BASE + 2 * INSTRUCTION_BYTES);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		assert.equal(cpu.runUntilDepth(0, 5), RunResult.Yielded);
		assert.equal(frame.pc, DYNAMIC_RAM_BASE + 3 * INSTRUCTION_BYTES);
		assert.equal(frame.top, 5);
		assert.equal(frame.registers.getInteger(6), 7, 'the future MOV was not executed');
		if (index === 0) assert.ok(page.compiledBlocks!.entries[0] === null);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	assert.deepEqual(machines[0].memory.ramData(), machines[1].memory.ramData());
});

test('a late physical byte watch routes an already generated store to the normal writer', () => {
	const image = memoryLoop(OpCode.STORE_MEM, MemoryAccessKind.U32LE);
	const { cpu, memory } = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript);
	const frame = cpu.rootThread.frameAtDepth(0), entry = image.image.functions[0].codeAddress;
	const target = DYNAMIC_RAM_BASE + 0x1000;
	frame.registers.setInteger(0, 7);
	frame.registers.setInteger(1, target);
	cpu.runUntilDepth(0, 2400);
	const page = frame.decodedPage!;
	const site = (entry & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2;
	const block = page.compiledBlocks!.entries[site]!;
	assert.ok(block);
	const writes: number[] = [], offset = target - RAM_BASE + 1;
	const unsubscribe = memory.onRamWrite(written => {
		assert.equal(written, offset);
		writes.push(memory.readRamRecordByte(written));
	});
	memory.watchRamByte(offset);
	frame.registers.setInteger(0, 0x2300);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
	const run = { remainingCycles: 100, registerTop: frame.top, effectiveAddress: 0 };
	const exit = block.region.exits[block.region.execute(frame.registers, frame.executionImage.constWords, page, frame, block.entry, run)];
	assert.equal(exit.exit, CompiledBlockExit.WriteMemory);
	assert.equal(memory.readMappedU32LE(target), 7);
	assert.deepEqual(writes, []);
	assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.K1] + BASE_CYCLES[OpCode.STORE_MEM]), RunResult.Yielded);
	assert.equal(cpu.instructionBudgetRemaining, 0);
	assert.deepEqual(writes, [0x23]);
	assert.equal(page.compiledBlocks!.entries[site], block, 'data observation does not invalidate machine code');
	memory.unwatchRamByte(offset);
	unsubscribe();
});

test('warm ordinary Value accesses inline both lanes and retire watched, aliased and denied accesses in order', () => {
	const context = DYNAMIC_RAM_BASE, frame = context + 0x100, values = context + 0x300;
	const target = context + MAPPED_PAGE_BYTE_SIZE - 4, source = target + 0x104;
	const constants: number[] = [];
	const marks: number[] = [];
	const words: [OpCode, number, number, number, number?][] = [];
	function load(reg: number, value: number) {
		const index = constants.push(value) - 1;
		words.push([OpCode.LOADK, reg, index >>> 6, index & 63]);
	}
	function store(addr: number, value: number) {
		load(0, value); load(1, addr);
		words.push([OpCode.STORE_MEM, 0, 1, MemoryAccessKind.Word]);
	}
	store(context + ThreadField.StackBlock, values);
	store(context + ThreadField.StackCapacity, 16);
	store(context + ThreadField.FrameBlock, frame);
	store(context + ThreadField.FrameCapacity, 2);
	store(context + ThreadField.FrameDepth, 1);
	store(context + ThreadField.StackTop, 4);
	marks.push(constants.length);
	store(frame + FrameField.Function, -2);
	marks.push(constants.length);
	store(frame + FrameField.Pc, -3);
	store(frame + FrameField.StackCapacity, 4);
	store(source, 0x7fc0f123);
	store(source + 4, ValueTag.Float);
	store(target + 4, 0x44332200);
	load(0, context);
	words.push([OpCode.MTC0, 0, COP0_CONTEXT, 0], [OpCode.RET, 0, 1, 0]);
	const bootEnd = words.length;
	load(1, source);
	load(2, target - 4);
	load(0, CPU_STATUS_INTERRUPT_ENABLE_CURRENT);
	words.push([OpCode.MTC0, 0, COP0_STATUS, 0]);
	words.push([OpCode.LOAD_MEM, 3, 1, MemoryAccessKind.Value], [OpCode.STORE_MEM_D, 3, 2, MemoryAccessKind.Value, 1]);
	words.push([OpCode.JMP, 0, (MAX_LOW_BX - 2) >>> 6, (MAX_LOW_BX - 2) & 63, 255]);
	const programEnd = words.length;
	words.push([OpCode.RFE, 0, 0, 0]);
	const text = new Uint8Array(INSTRUCTION_BYTES * words.length);
	for (const [i, op] of words.entries()) writeInstruction(text, i, ...op);
	const image = linkRawTestSystemBlua32({
		constants: constants.map(integerConstant), text,
		functions: [{ firstWord: 0, wordCount: bootEnd, maxStack: 4 },
			{ firstWord: bootEnd, wordCount: programEnd - bootEnd, maxStack: 4 },
			{ firstWord: programEnd, wordCount: 1, maxStack: 1 }],
		irqFunctionIndex: 2, exceptionFunctionIndex: 2, verifiedControlFlow: true,
	});
	const base = image.image.header.constantTableAddress + BLUA32_CONSTANT_PAYLOAD_OFFSET;
	const program = image.image.functions[1];
	for (const [i, value] of [program.address, program.codeAddress].entries())
		writeLE32(image.romBytes, base + BLUA32_CONSTANT_RECORD_SIZE * marks[i], value);
	const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const reference = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
	const memory = js.memory;
	let reads = 0, writes = 0;
	const read = memory.readMappedValueOffset.bind(memory), write = memory.writeMappedValue.bind(memory);
	memory.readMappedValueOffset = (addr, aperture) => { reads++; return read(addr, aperture); };
	memory.writeMappedValue = (addr, payload, tag, aperture) => { writes++; return write(addr, payload, tag, aperture); };
	for (let step = 0; step < 1024 && js.cpu.rootThread.address === CPU_RESET_BANK_ADDRESS; ++step)
		runCpuParity(js.cpu, reference.cpu, 1);
	assert.equal(js.cpu.rootThread.address, context);
	for (let step = 0; step < 20; ++step) runCpuParity(js.cpu, reference.cpu, 32);
	assert.ok(reads > 0 && writes > 0, 'cold route uses the sequential memory owner');
	const loop = program.codeAddress + 4 * INSTRUCTION_BYTES;
	for (let step = 0; step < 3 && js.cpu.activeThread.currentFrame!.pc !== loop; ++step) runCpuParity(js.cpu, reference.cpu, 1);
	assert.equal(js.cpu.activeThread.currentFrame!.pc, loop);
	const loopCycles = BASE_CYCLES[OpCode.LOAD_MEM] + BASE_CYCLES[OpCode.STORE_MEM_D] + BASE_CYCLES[OpCode.JMP];
	const before = [reads, writes];
	for (const rt of [js, reference]) {
		assert.equal(rt.memory.readRamRecordWord(target), 0x7fc0f123);
		rt.memory.writeRamRecordWord(source, 0xc365a281);
		rt.memory.writeRamRecordByte(source + 4, ValueTag.Nil);
	}
	for (let step = 0; step < 12; ++step) runCpuParity(js.cpu, reference.cpu, 4 * loopCycles);
	assert.deepEqual([reads, writes], before, 'warm generated read and write transfer new data without entering the owner');
	assert.equal(memory.readRamRecordWord(target), 0xc365a281);
	assert.equal(memory.readRamRecordWord(target + 4), 0x44332200);
	let observations = 0;
	memory.watchRamByte(target + 4 - RAM_BASE);
	const stopObserving = memory.onRamWrite(() => {
		assert.equal(memory.readRamRecordWord(target), 0x80000000);
		assert.equal(memory.readRamRecordWord(target + 4), 0x44332204);
		observations++;
	});
	for (const rt of [js, reference]) {
		rt.memory.writeRamRecordWord(source, 0x80000000);
		rt.memory.writeRamRecordByte(source + 4, ValueTag.Float);
	}
	for (let step = 0; step < 4; ++step) runCpuParity(js.cpu, reference.cpu, 4 * loopCycles);
	assert.ok(writes > before[1] && observations > 0, 'tag-page watch sends the complete instruction to the owner');
	assert.equal(reads, before[0], 'read still executes directly');
	memory.unwatchRamByte(target + 4 - RAM_BASE);
	stopObserving();

	// A load that reads the executing frame itself must see the already
	// published successor PC, not the raw PC at the generated block entry.
	for (const { cpu } of [js, reference])
		cpu.activeThread.currentFrame!.registers.setInteger(1, frame + FrameField.Pc);
	runCpuParity(js.cpu, reference.cpu, loopCycles);
	assert.equal(reads, before[0] + 1, 'a frame-backing alias uses the retiring CPU path');
	for (const rt of [js, reference]) {
		assert.equal(rt.memory.readRamRecordWord(target), loop + INSTRUCTION_BYTES);
		rt.cpu.activeThread.currentFrame!.registers.setInteger(1, source);
		rt.cpu.activeThread.currentFrame!.registers.setInteger(2, context + ThreadField.ErrorWord - 4);
	}
	const priorWrites = writes;
	runCpuParity(js.cpu, reference.cpu, loopCycles);
	assert.equal(writes, priorWrites + 1, 'a selected context record alias uses the retiring CPU path');
	for (const rt of [js, reference]) {
		assert.equal(rt.memory.readRamRecordWord(context + ThreadField.ErrorWord), 0x80000000);
		assert.equal(rt.memory.readRamRecordWord(context + ThreadField.ErrorKind), ValueTag.Float);
		rt.cpu.activeThread.currentFrame!.registers.setInteger(2, target - 4);
	}
	runCpuParity(js.cpu, reference.cpu, loopCycles);

	// User mode shares ordinary RAM, but the same compiled instructions
	// must hand an architectural control overlap to the ordered bus owner.
	const transferCounts = [reads, writes];
	for (const { cpu } of [js, reference]) {
		cpu.activeThread.currentFrame!.registers.setInteger(0, CPU_STATUS_INTERRUPT_ENABLE_CURRENT | CPU_STATUS_USER_MODE_CURRENT);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, program.address, loop - INSTRUCTION_BYTES);
	}
	runCpuParity(js.cpu, reference.cpu, BASE_CYCLES[OpCode.MTC0] + 2 * loopCycles);
	assert.ok(js.cpu.isUserMode());
	assert.deepEqual([reads, writes], transferCounts, 'the same warmed body can transfer both Value lanes in User mode');
	const busSequence = memory.readBusFaultSequence();
	const address = CPU_FIXED_VALUE_END;
	for (const [pc, expected, register, operand] of [
		[loop, CompiledBlockExit.ReadMemory, 1, address],
		[loop + INSTRUCTION_BYTES, CompiledBlockExit.WriteMemory, 2, address - 4],
	] as const) {
		for (const { cpu } of [js, reference]) cpu.activeThread.currentFrame!.registers.setInteger(register, operand);
		const caller = js.cpu.activeThread.currentFrame!, page = caller.decodedPage!;
		const block = page.compiledBlocks!.entries[(pc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
		assert.ok(block);
		const run = { remainingCycles: loopCycles, registerTop: caller.top, effectiveAddress: 0 };
		const exit = block.region.exits[block.region.execute(caller.registers, caller.executionImage.constWords, page, caller, block.entry, run)];
		assert.equal(exit.exit, expected);
		assert.equal(run.effectiveAddress, address);
		runCpuParity(js.cpu, reference.cpu, 1);
		for (const { cpu } of [js, reference]) {
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_DATA_BUS_ERROR);
			assert.equal(cpu.readEpcWord(), pc);
			cpu.writeEpcWord(pc + INSTRUCTION_BYTES);
		}
		runCpuParity(js.cpu, reference.cpu, 1);
		for (const { cpu } of [js, reference])
			cpu.activeThread.currentFrame!.registers.setInteger(register, register === 1 ? source : target - 4);
	}
	assert.equal(memory.readBusFaultSequence(), busSequence + 2);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), address);
	assert.equal(memory.readRamRecordWord(target), 0x80000000);
	assert.equal(memory.readRamRecordWord(target + 4), 0x44332204);
});

test('a DMA memory span retires generated RAM code before its next execution', () => {
	const image = memoryLoop(OpCode.LOAD_MEM, MemoryAccessKind.U32LE);
	for (const backend of [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter]) {
		const { cpu, memory } = createTestHeapServiceCpu(image, backend);
		const frame = cpu.rootThread.frameAtDepth(0), entry = image.image.functions[0].codeAddress;
		memory.writeBytes(DYNAMIC_RAM_BASE, image.romBytes.subarray(entry, entry + MAPPED_PAGE_BYTE_SIZE));
		frame.registers.setInteger(1, DYNAMIC_RAM_BASE + 0x1000);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1200);
		const page = frame.decodedPage!;
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(page.compiledBlocks!.entries[0]);
		const replacement = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(replacement, 0, OpCode.K1, 0, 0, 0);
		writeInstruction(replacement, 1, OpCode.HALT, 0, 0, 0);
		const source = DYNAMIC_RAM_BASE + 0x2000;
		memory.writeBytes(source, replacement);
		memory.transferDmaBlock(source, DYNAMIC_RAM_BASE, 2, 4, 4, MAPPED_BUS_MASTER_DMA, MAPPED_BUS_MASTER_DMA);
		if (backend === CpuExecutionBackend.JavaScript) assert.equal(page.compiledBlocks!.entries[0], null);
		frame.registers.setInteger(0, 0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assert.equal(frame.registers.getInteger(0), 1);
	}
});

test('a continuously rewritten instruction stays outside stable compiled prefixes', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.STORE_MEM_D, 0, 1, MemoryAccessKind.U32LE);
	writeInstruction(text, 1, OpCode.K1, 6, 0, 0);
	writeInstruction(text, 2, OpCode.BXOR, 0, 0, 4);
	writeInstruction(text, 3, OpCode.ADD, 7, 6, 2);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	writeInstruction(text, 8, OpCode.K0, 6, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(0, readLE32(text, INSTRUCTION_BYTES));
		frame.registers.setInteger(1, DYNAMIC_RAM_BASE + INSTRUCTION_BYTES);
		frame.registers.setInteger(2, 1);
		frame.registers.setInteger(4, readLE32(text, INSTRUCTION_BYTES) ^ readLE32(text, 8 * INSTRUCTION_BYTES));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1200);
	}
	const page = machines[0].cpu.rootThread.frameAtDepth(0).decodedPage!;
	assert.ok(page.compiledBlocks!.entries[1] === null, 'the repeatedly rewritten instruction stays outside the region');
	const stable = page.compiledBlocks!.entries[2];
	assert.ok(stable);
	for (const grant of [1200, 1, 2, 3, 9, 33, 256]) {
		runCpuParity(machines[0].cpu, machines[1].cpu, grant);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.deepEqual(machines[0].memory.ramData(), machines[1].memory.ramData());
	}
	assert.ok(page.compiledBlocks!.entries[2] === stable);
	assert.ok(page.compiledBlocks!.entries[1] === null, 'the repeatedly rewritten instruction stays outside the region');
});

for (const grant of [5, 9]) test(`an MMIO read can retire its source and resume a hot continuation (grant=${grant})`, () => {
	const image = memoryLoop(OpCode.LOAD_MEM, MemoryAccessKind.U32LE);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	for (const [index, { cpu, memory }] of machines.entries()) {
		const entry = image.image.functions[0].codeAddress;
		memory.writeBytes(DYNAMIC_RAM_BASE, image.romBytes.subarray(entry, entry + MAPPED_PAGE_BYTE_SIZE));
		memory.writeMappedWord(DYNAMIC_RAM_BASE + 0x1000, 7);
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(1, DYNAMIC_RAM_BASE + 0x1000);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1200);
		for (let visit = 0; visit < 10; ++visit) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE + 3 * INSTRUCTION_BYTES);
			cpu.runUntilDepth(0, 2);
		}
		const page = frame.decodedPage!;
		if (index === 0) assert.ok(page.compiledBlocks!.entries[0]);
		const replacement = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(replacement, 0, OpCode.HALT, 0, 0, 0);
		const device = { reads: 0 };
		const port = RAM_BASE + 0x5000;
		memory.mapIoRead(port, device, state => {
			++state.reads;
			memory.writeBytes(DYNAMIC_RAM_BASE + 2 * INSTRUCTION_BYTES, replacement);
			return 11;
		});
		frame.top = 0; frame.registers.setInteger(1, port);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
		assert.equal(frame.pc, DYNAMIC_RAM_BASE + (grant === 5 ? 3 * INSTRUCTION_BYTES : 0));
		assert.equal(frame.registers.getInteger(0), 11);
		assert.equal(frame.registers.getInteger(6), grant === 5 ? 7 : 11);
		assert.equal(frame.top, grant === 5 ? 5 : 7);
		assert.equal(device.reads, 1);
		if (index === 0) assert.ok(page.compiledBlocks!.entries[0] === null);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

test('fatal helper errors unwind after the completed generated prefix, without retrying IO', () => {
	for (const backend of [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter]) {
		const image = memoryLoop(OpCode.LOAD_MEM, MemoryAccessKind.U32LE);
		const { cpu, memory } = createTestHeapServiceCpu(image, backend);
		const entry = image.image.functions[0].codeAddress, frame = cpu.rootThread.frameAtDepth(0);
		memory.writeMappedWord(DYNAMIC_RAM_BASE + 0x1000, 7);
		frame.registers.setInteger(1, DYNAMIC_RAM_BASE + 0x1000);
		cpu.runUntilDepth(0, 1200);
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]);
		const failure = new Error('test device failure'), device = { fail: true, reads: 0 };
		const address = RAM_BASE + 0x5000;
		memory.mapIoRead(address, device, state => {
			++state.reads;
			assert.equal(frame.pc, entry + 3 * INSTRUCTION_BYTES, 'the mapped device sees the continuation PC during the instruction');
			assert.equal(cpu.lastPc, entry + 2 * INSTRUCTION_BYTES, 'the executed WIDE body remains separately identifiable');
			assert.equal(frame.top, state.reads === 3 ? 7 : 5, 'the mapped device sees the completed register frontier');
			assert.equal(frame.registers.getInteger(4), 1);
			if (state.fail) throw failure;
			return 11;
		});
		frame.top = 0; frame.registers.setInteger(1, address);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
		assert.throws(() => cpu.runUntilDepth(0, 9), error => error === failure, 'the original host exception is preserved');
		assert.equal(device.reads, 1); assert.equal(frame.pc, entry + 3 * INSTRUCTION_BYTES);
		assert.equal(frame.top, 5); assert.equal(cpu.instructionBudgetRemaining, 4);
		assert.equal(frame.registers.getInteger(0), 7); assert.equal(frame.registers.getInteger(6), 7);
		device.fail = false;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
		assert.equal(cpu.runUntilDepth(0, 18), RunResult.Yielded);
		assert.equal(device.reads, 3);
		assert.equal(frame.registers.getInteger(0), 11); assert.equal(frame.registers.getInteger(6), 11);
	}
});

test('word producers, overwrites and externally entered continuations preserve full scalar state', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	const code = [
		[OpCode.LOADK, 0, 0, 4], [OpCode.MOV, 1, 0, 0], [OpCode.BAND, 2, 1, 62, 7],
		[OpCode.MOV, 3, 2, 0], [OpCode.BNOT, 4, 3, 0], [OpCode.ADD, 2, 2, 60, 7],
		[OpCode.BXOR, 5, 2, 61, 7], [OpCode.MOV, 2, 12, 0], [OpCode.BAND, 6, 2, 62, 7],
		[OpCode.LOADNIL, 0, 2, 0], [OpCode.BNOT, 7, 1, 0],
		[OpCode.LOAD_MEM, 8, 13, MemoryAccessKind.U32LE], [OpCode.BNOT, 9, 8, 0],
		[OpCode.STORE_MEM, 9, 14, MemoryAccessKind.U32LE], [OpCode.MOV, 10, 9, 0],
		[OpCode.JMPIF, 15, 0, 1], [OpCode.MOV, 10, 12, 0], [OpCode.BAND, 11, 10, 62, 7],
		[OpCode.JMP, 0, 63, 45, 255],
	];
	for (let i = 0; i < code.length; ++i) {
		const [op, a, b, c, ext = 0] = code[i];
		writeInstruction(text, i, op, a, b, c, ext);
	}
	for (const constant of [integerConstant(-1), { kind: 'float', word: 0x40400000 } as const]) {
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: code.length, maxStack: 16 }],
			constants: [integerConstant(-2147483648), integerConstant(-1), integerConstant(0), integerConstant(7), constant] }, RAM_CODE_FIXTURE_BYTES);
		const generated = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript);
		const reference = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter);
		const machines = [generated, reference];
		const inputAddress = DYNAMIC_RAM_BASE + 0x1000, outputAddress = inputAddress + 4;
		for (const { cpu, memory } of machines) {
			const r = cpu.rootThread.frameAtDepth(0).registers;
			r.setInteger(12, 5); r.setInteger(13, inputAddress); r.setInteger(14, outputAddress); r.setBoolean(15, true);
			memory.writeMappedWord(inputAddress, 0x80000000);
		}
		runCpuParity(generated.cpu, reference.cpu, 2048);
		const start = image.image.functions[0].codeAddress;
		assert.ok(generated.cpu.rootThread.frameAtDepth(0).decodedPage!.compiledBlocks!.entries[(start & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES],
			'the producer/consumer loop is compiled before boundary mutations');
		for (const incoming of [valueInteger(5), valueInteger(0x7fffffff), valueInteger(-2147483648), valueInteger(-1), valueFloat(-1), valueFloat(0), valueFloat(16777216)])
		for (const entry of [0, 3, 8, 12, 14, 17]) for (const grant of [1, 2, 19, 67]) {
			for (const { cpu, memory } of machines) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], start + entry * INSTRUCTION_BYTES);
				const frame = cpu.rootThread.frameAtDepth(0), r = frame.registers;
				for (let i = 0; i < 13; ++i) {
					r.set(i, incoming);
				}
				r.setBoolean(15, (grant & 1) !== 0); frame.top = 0;
				memory.writeMappedWord(inputAddress, (entry & 1) === 0 ? 0xffffffff : 0x80000000);
			}
			runCpuParity(generated.cpu, reference.cpu, grant);
			assert.deepEqual(generated.cpu.captureRuntimeState(), reference.cpu.captureRuntimeState());
			assert.equal(Buffer.compare(generated.memory.ramData(), reference.memory.ramData()), 0);
		}
	}
});


test('a ready edge completes the latched store without refetching rewritten code or paying its base twice', () => {
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const image = memoryLoop(OpCode.STORE_MEM, MemoryAccessKind.Word);
		const { cpu, memory } = createTestHeapServiceCpu(image, backend);
		const code = DYNAMIC_RAM_BASE + 0x1000;
		const source = image.image.functions[0].codeAddress;
		memory.ramData().set(image.romBytes.subarray(source, source + MAPPED_PAGE_BYTE_SIZE), code - RAM_BASE);
		const frame = cpu.rootThread.frameAtDepth(0);
		frame.registers.setInteger(0, 0x12345678);
		frame.registers.setInteger(1, code + 0x2000);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], code);
		cpu.runUntilDepth(0, 2400);
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.sourceUnits > 0);
		const device = { ready: false, writes: [] as number[] };
		const port = IO_BASE + 0x5000;
		memory.mapIoWrite(port, device, (state, _address, value) => { state.writes.push(value); });
		memory.mapIoWriteReady(port, (state: typeof device) => state.ready);
		frame.registers.setInteger(1, port);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], code);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
		const saved = cpu.captureRuntimeState();
		const replacement = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(replacement, 0, OpCode.K1, 0, 0, 0);
		memory.writeMappedU32LE(code + 2 * INSTRUCTION_BYTES, readLE32(replacement, 0));
		cpu.restoreRuntimeState(saved);
		device.ready = true;
		cpu.resumeMemoryWrite(port);
		cpu.runUntilDepth(0, 0);
		assert.deepEqual(device.writes, [], 'a zero grant does not resume the pending instruction');
		cpu.requestYield();
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.deepEqual(device.writes, [], 'a requested yield precedes the pending side effect');
		cpu.runUntilDepth(0, 1);
		assert.deepEqual(device.writes, [0x12345678]);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.MOV]);
		assert.equal(cpu.readFramePc(0), code + 4 * INSTRUCTION_BYTES, 'the successor MOV uses the new grant');
	}
});


test('external call entry and active-PC redirection flush an unaccepted physical store latch', () => {
	const port = IO_BASE + 0x5000;
	const text = new Uint8Array(8 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.STORE_MEM, 0, 1, MemoryAccessKind.Word);
	writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 2, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 3, OpCode.RET, 0, 2, 0);
	writeInstruction(text, 4, OpCode.LOADK, 0, 0, 0);
	writeInstruction(text, 5, OpCode.LOADK, 1, 0, 1);
	writeInstruction(text, 6, OpCode.STORE_MEM, 0, 1, MemoryAccessKind.Word);
	writeInstruction(text, 7, OpCode.RET, 0, 1, 0);
	const image = linkRawTestSystemBlua32({ text, constants: [integerConstant(0x87654321), integerConstant(port)], functions: [
		{ firstWord: 0, wordCount: 2, maxStack: 2 }, { firstWord: 2, wordCount: 2, maxStack: 1 },
		{ firstWord: 4, wordCount: 4, maxStack: 2 },
	] }, RAM_CODE_FIXTURE_BYTES);
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		for (const takeover of ['call-blocked', 'call-ready', 'redirect', 'abort-call']) {
			const { cpu, memory } = createTestHeapServiceCpu(image, backend);
			const thread = cpu.rootThread;
			reserveThreadFrameReference(cpu, thread, thread.stackTop + 8);
			const device = { ready: false, writes: [] as number[] };
			memory.mapIoWrite(port, device, (state, _address, word) => { state.writes.push(word); });
			memory.mapIoWriteReady(port, (state: typeof device) => state.ready);
			const frame = cpu.rootThread.frameAtDepth(0);
			frame.registers.setInteger(0, 0x12345678); frame.registers.setInteger(1, port);
			assert.equal(cpu.runUntilDepth(0, 10), RunResult.Halted);
			if (takeover === 'call-ready' || takeover === 'redirect') { device.ready = true; cpu.resumeMemoryWrite(port); }
			if (takeover === 'redirect') {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
				cpu.runUntilDepth(0, 10);
				assert.deepEqual(device.writes, [], 'setting the active PC does not execute the abandoned store');
			} else if (takeover === 'abort-call') {
				cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[2]);
				cpu.runUntilDepth(1, 20);
				assert.equal(cpu.isMemoryWriteBlocked(), true);
				abortFixtureCompletionCall(cpu, 1);
				device.ready = true;
				cpu.runUntilDepth(0, 20);
				assert.deepEqual(device.writes, [0x12345678], 'unwinding abandons the callee wait, not the caller instruction');
				assert.equal(cpu.getFrameDepth(), 1);
			} else {
				cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[1]);
				assert.equal(cpu.runUntilDepth(1, 10), RunResult.Halted);
				assert.equal(cpu.getFrameDepth(), 1);
				assert.deepEqual(device.writes, [], 'the suspended access does not execute in the injected call');
				device.ready = true;
				cpu.runUntilDepth(0, 10);
				assert.deepEqual(device.writes, [0x12345678], 'the caller starts a fresh store at its retained PC');
			}
		}
	}
});
