import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLE32 } from '../../machine/ts/common/endian';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { writeInstruction, INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

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
	], exceptionFunctionIndex: 1 });
}

const widths = [4, 1, 2, 4, 4, 8];

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
	], constants: ['stable', 'result'], exceptionFunctionIndex: 1 });
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	const address = DYNAMIC_RAM_BASE + 0x1000;
	for (const { cpu } of machines) {
		const table = cpu.createTable(0, 2);
		table.storeStringKey(cpu.stringPool.intern('stable'), ValueTag.Number, 22, null);
		table.storeStringKey(cpu.stringPool.intern('result'), ValueTag.Number, 0, null);
		const frame = cpu.rootThread.frames[0];
		frame.registers.setTable(1, table); frame.registers.setNumber(5, address);
		frame.registers.setNumber(12, Infinity); frame.registers.setNumber(13, Infinity);
		cpu.runUntilDepth(0, 1200);
	}
	const frame = machines[0].cpu.rootThread.frames[0], page = frame.decodedPage!;
	const entry = image.image.functions[0].codeAddress;
	const block = page.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
	assert.equal(block.sourceWords, 13);
	assert.equal(block.exits[block.execute(frame.registers, frame.executionImage.constScalars, page, frame)], block.terminal);
	machines[1].cpu.runUntilDepth(0, 15);
	assert.equal(machines[0].memory.readMappedWord(address), 0);
	assert.equal(machines[0].memory.readMappedWord(address + 4), 0x7ff80000);
	assert.equal(Buffer.compare(machines[0].memory.ramData(), machines[1].memory.ramData()), 0,
		'float stores consume the canonical guest number');
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	for (const { cpu } of machines) {
		const current = cpu.rootThread.frames[0];
		current.registers.setNumber(1, 5); current.top = 0;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
		assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
		assert.equal(current.registers.getNumber(0), 5, 'the field fault sees the new cached base, not the old table slot');
		assert.equal(current.registers.getNumber(2), 22, 'the failed field destination remains unchanged');
		assert.equal(current.top, 1);
		assert.equal(cpu.readEpcWord(), entry + INSTRUCTION_BYTES);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

for (let format = 0; format <= 5; ++format) for (const displaced of [false, true]) {
	test(`generated RAM format ${format}, displaced ${displaced}: data, aliases and short grants`, () => {
		const image = memoryLoop(displaced ? OpCode.STORE_MEM_D : OpCode.STORE_MEM, format, displaced ? 255 : 0);
		const js = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
		const ref = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
		const entry = image.image.functions[0].codeAddress;
		const address = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - 4;
		for (const machine of [js, ref]) {
			machine.cpu.rootThread.frames[0].registers.setNumber(1, address - (displaced ? 1020 : 0));
			machine.cpu.rootThread.frames[0].registers.setNumber(0, 1);
			machine.cpu.runUntilDepth(0, 1200);
		}
		const frame = js.cpu.rootThread.frames[0], page = frame.decodedPage!;
		const block = page.compiledBlocks!.entries[(entry & (MAPPED_PAGE_BYTE_SIZE - 1)) >>> 2]!;
		assert.equal(block.sourceWords, 5);
		assert.equal(block.exits[block.execute(frame.registers, frame.executionImage.constScalars, page, frame)], block.terminal,
			'RAM and dependent instructions stay in the generated function');
		for (const value of [-0, 0.25, -1.75, 4294967295, -4294967296.75, 4294967296.25,
			1e100, -1e100, Number.MIN_VALUE, Infinity, -Infinity, NaN, null, false, true]) {
			for (const grant of [1, 2, 3, 4, 5, 9, 33, 256]) {
				for (const machine of [js, ref]) {
					machine.cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], entry);
					machine.cpu.rootThread.frames[0].registers.set(0, value);
					machine.cpu.runUntilDepth(0, grant);
				}
				assert.deepEqual(js.cpu.captureRuntimeState(), ref.cpu.captureRuntimeState());
				assert.deepEqual(js.memory.ramData(), ref.memory.ramData());
				assert.equal(js.cpu.instructionBudgetRemaining, ref.cpu.instructionBudgetRemaining);
			}
		}
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.LOAD_MEM, 1, 1, format);
		writeInstruction(text, 1, OpCode.MOV, 2, 1, 0);
		writeInstruction(text, 2, OpCode.MOV, 1, 3, 0);
		writeInstruction(text, 3, OpCode.JMP, 0, 63, 60, 255);
		const loads = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 4 }] });
		for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
			const machine = createTestSystemCpu(loads, backend);
			machine.cpu.rootThread.frames[0].registers.setNumber(1, RAM_BASE + PSX_MACHINE_SPEC.ramBytes - widths[format]);
			machine.cpu.rootThread.frames[0].registers.setNumber(3, RAM_BASE + PSX_MACHINE_SPEC.ramBytes - widths[format]);
			machine.cpu.runUntilDepth(0, 1200);
			assert.equal(machine.cpu.readFrameRegister(0, 2), 0);
			if (backend === CpuExecutionBackend.JavaScript) assert.ok(machine.cpu.rootThread.frames[0].decodedPage!.compiledBlocks!.sourceUnits > 0);
		}
	});
}

test('a generated MMIO store checks readiness before width faults or source consumption', () => {
	const image = memoryLoop(OpCode.STORE_MEM, MemoryAccessKind.U16LE);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		const frame = cpu.rootThread.frames[0];
		frame.registers.setNumber(0, 12); frame.registers.setNumber(1, DYNAMIC_RAM_BASE + 0x1000);
		cpu.runUntilDepth(0, 1200);
		const target = RAM_BASE + 0x5000;
		const device = { ready: false, writes: 0 };
		memory.mapIoWrite(target, device, state => { ++state.writes; });
		memory.mapIoWriteReady(target, (state: typeof device) => state.ready);
		frame.top = 0; frame.registers.setNumber(1, target);
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
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		const frame = cpu.rootThread.frames[0];
		frame.registers.setNumber(1, DYNAMIC_RAM_BASE + 0x404 - 1020);
		cpu.runUntilDepth(0, 1200);
		frame.registers.setNumber(0, 73); frame.top = 0;
		frame.registers.setNumber(1, RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 4 - 1020);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
		assert.equal(frame.registers.getNumber(0), 73);
		assert.equal(frame.top, 5);
		assert.equal(cpu.captureRuntimeState().epcWord, image.image.functions[0].codeAddress + INSTRUCTION_BYTES);
		assert.equal(memory.readBusFaultSequence(), 1);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});

test('a watched RAM store retires its own generated source only after returning', () => {
	const image = memoryLoop(OpCode.STORE_MEM, MemoryAccessKind.U32LE);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const [index, { cpu, memory }] of machines.entries()) {
		const frame = cpu.rootThread.frames[0];
		const entry = image.image.functions[0].codeAddress;
		memory.writeBytes(DYNAMIC_RAM_BASE, image.romBytes.subarray(entry, entry + MAPPED_PAGE_BYTE_SIZE));
		frame.registers.setNumber(0, 7); frame.registers.setNumber(1, DYNAMIC_RAM_BASE + 0x1000);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1200);
		const page = frame.decodedPage!;
		if (index === 0) assert.ok(page.compiledBlocks!.entries[0]);
		const replacement = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(replacement, 0, OpCode.HALT, 0, 0, 0);
		frame.top = 0; frame.registers.setNumber(0, readLE32(replacement, 0));
		frame.registers.setNumber(1, DYNAMIC_RAM_BASE + 2 * INSTRUCTION_BYTES);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		assert.equal(cpu.runUntilDepth(0, 3), RunResult.Yielded);
		assert.equal(frame.pc, DYNAMIC_RAM_BASE + 3 * INSTRUCTION_BYTES);
		assert.equal(frame.top, 5);
		assert.equal(frame.registers.getNumber(6), 7, 'the future MOV was not executed');
		if (index === 0) assert.equal(page.compiledBlocks!.entries[0], null);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
	assert.deepEqual(machines[0].memory.ramData(), machines[1].memory.ramData());
});

test('a continuously rewritten instruction stays outside stable compiled prefixes', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.STORE_MEM_D, 0, 1, MemoryAccessKind.U32LE);
	writeInstruction(text, 1, OpCode.K1, 6, 0, 0);
	writeInstruction(text, 2, OpCode.BXOR, 0, 0, 4);
	writeInstruction(text, 3, OpCode.ADD, 7, 6, 2);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	writeInstruction(text, 8, OpCode.K0, 6, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }] });
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const { cpu, memory } of machines) {
		memory.writeBytes(DYNAMIC_RAM_BASE, text);
		const frame = cpu.rootThread.frames[0];
		frame.registers.setNumber(0, readLE32(text, INSTRUCTION_BYTES));
		frame.registers.setNumber(1, DYNAMIC_RAM_BASE + INSTRUCTION_BYTES);
		frame.registers.setNumber(2, 1);
		frame.registers.setNumber(4, readLE32(text, INSTRUCTION_BYTES) ^ readLE32(text, 8 * INSTRUCTION_BYTES));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1200);
	}
	const page = machines[0].cpu.rootThread.frames[0].decodedPage!;
	assert.equal(page.compiledBlocks!.entries[0], null);
	const stable = page.compiledBlocks!.entries[2];
	assert.ok(stable);
	for (const grant of [1200, 1, 2, 3, 9, 33, 256]) {
		for (const { cpu } of machines) cpu.runUntilDepth(0, grant);
		assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
		assert.deepEqual(machines[0].memory.ramData(), machines[1].memory.ramData());
	}
	assert.equal(page.compiledBlocks!.entries[2], stable);
	assert.equal(page.compiledBlocks!.entries[0], null);
});

test('an MMIO read can retire its generated source before the CPU commits the result', () => {
	const image = memoryLoop(OpCode.LOAD_MEM, MemoryAccessKind.U32LE);
	const machines = [createTestSystemCpu(image, CpuExecutionBackend.JavaScript), createTestSystemCpu(image, CpuExecutionBackend.Interpreter)];
	for (const [index, { cpu, memory }] of machines.entries()) {
		const entry = image.image.functions[0].codeAddress;
		memory.writeBytes(DYNAMIC_RAM_BASE, image.romBytes.subarray(entry, entry + MAPPED_PAGE_BYTE_SIZE));
		memory.writeMappedWord(DYNAMIC_RAM_BASE + 0x1000, 7);
		const frame = cpu.rootThread.frames[0];
		frame.registers.setNumber(1, DYNAMIC_RAM_BASE + 0x1000);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		cpu.runUntilDepth(0, 1200);
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
		frame.top = 0; frame.registers.setNumber(1, port);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], DYNAMIC_RAM_BASE);
		assert.equal(cpu.runUntilDepth(0, 3), RunResult.Yielded);
		assert.equal(frame.pc, DYNAMIC_RAM_BASE + 3 * INSTRUCTION_BYTES);
		assert.equal(frame.registers.getNumber(0), 11);
		assert.equal(frame.registers.getNumber(6), 7);
		assert.equal(frame.top, 5);
		assert.equal(device.reads, 1);
		if (index === 0) assert.equal(page.compiledBlocks!.entries[0], null);
		assert.equal(cpu.runUntilDepth(0, 20), RunResult.Halted);
	}
	assert.deepEqual(machines[0].cpu.captureRuntimeState(), machines[1].cpu.captureRuntimeState());
});
