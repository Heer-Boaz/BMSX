import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readLE32 } from '../../machine/ts/common/endian';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { MAPPED_BUS_INSTRUCTION_FETCH, MAPPED_BUS_MASTER_CPU, mappedBusSignalsForCartridgeSlot } from '../../machine/ts/machine/memory/bus_signals';
import { MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR } from '../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { BUS_FAULT_ACCESS_READ, BUS_FAULT_ACCESS_U32, BUS_FAULT_UNMAPPED, IO_CART_SELECT, IO_GX_GPU_GP0, IO_SLOT_COUNT, IO_SYS_BUS_FAULT_ACCESS, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_CODE } from '../../machine/ts/spec/bmsx/io';
import { CART_MMIO_BASE, CART_RAM_SIZE, CART_ROM_BASE, IO_BASE, SYSTEM_ROM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';

const system = (() => {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 1, OpCode.HALT, 0, 0, 0);
	return linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }, { firstWord: 1, wordCount: 1 }], exceptionFunctionIndex: 1 });
})();

function machine(backend: CpuExecutionBackend, cartRam = 0) {
	const memory = new Memory({ systemRom: system.romBytes, cartridgeSlots: [
		{ rom: null, ramByteCount: cartRam, mailboxPresent: true },
		{ rom: null, ramByteCount: null, mailboxPresent: true },
	] }, PSX_MACHINE_SPEC.ramBytes);
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory), backend);
	const dma = new DmaController(memory, cpu, irq, new DeviceScheduler(cpu));
	memory.cartridgeController.connect(memory, irq, dma);
	cpu.reset();
	return { cpu, memory };
}

test('instruction fetch select retains data selector and explicit cartridge socket selection', () => {
	const memory = new Memory({ systemRom: system.romBytes, cartridgeSlots: [
		{ rom: new Uint8Array([0x11, 0x22, 0x33, 0x44]), ramByteCount: null, mailboxPresent: false },
		{ rom: new Uint8Array([0x55, 0x66, 0x77, 0x88]), ramByteCount: null, mailboxPresent: false },
	] }, PSX_MACHINE_SPEC.ramBytes);
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory), CpuExecutionBackend.Interpreter);
	const dma = new DmaController(memory, cpu, irq, new DeviceScheduler(cpu));
	memory.cartridgeController.connect(memory, irq, dma);
	for (const selected of [0, 1]) {
		memory.writeMappedU32LE(IO_CART_SELECT, selected);
		const expected = selected === 0 ? 0x44332211 : 0x88776655;
		assert.equal(memory.readMappedBusU32LE(CART_ROM_BASE, MAPPED_BUS_MASTER_CPU), expected);
		assert.equal(memory.readMappedBusU32LE(CART_ROM_BASE, MAPPED_BUS_MASTER_CPU | MAPPED_BUS_INSTRUCTION_FETCH), expected);
		for (const slot of [0, 1]) {
			const signals = mappedBusSignalsForCartridgeSlot(slot);
			assert.equal(memory.readMappedBusU32LE(CART_ROM_BASE, signals | MAPPED_BUS_INSTRUCTION_FETCH), slot === 0 ? 0x44332211 : 0x88776655);
		}
	}
});

test('a warmed native comparison faults before fetching its skipped MMIO successor', () => {
	const { cpu, memory } = machine(CpuExecutionBackend.JavaScript, CART_RAM_SIZE);
	const pc = CART_MMIO_BASE - INSTRUCTION_BYTES;
	const code = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.EQ, 1, 0, 1);
	memory.cartridgeController.writeU32(pc, readLE32(code, 0), mappedBusSignalsForCartridgeSlot(0));
	const frame = cpu.rootThread.frameAtDepth(0);
	frame.registers.setNumber(0, 0); frame.registers.setNumber(1, 0);
	for (let i = 0; i < 10; ++i) {
		jump(cpu, pc);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(frame.pc, CART_MMIO_BASE);
	}
	assert.ok(frame.decodedPage!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) >>> 2]);
	let reads = 0;
	const cartridge = memory.cartridgeController, read = cartridge.readU32.bind(cartridge);
	cartridge.readU32 = (address, signals) => { if (address >= CART_MMIO_BASE) reads += 1; return read(address, signals); };
	frame.registers.setNumber(1, 1);
	jump(cpu, pc);
	assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded);
	fault(cpu, memory, CART_MMIO_BASE, CART_MMIO_BASE);
	assert.equal(reads, 0);
});

function jump(cpu: CPU, pc: number): void {
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, system.symbols.functionAddresses[0], pc);
}

function fault(cpu: CPU, memory: Memory, epc: number, address: number): void {
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR);
	assert.equal(cpu.readEpcWord(), epc);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), address);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS), BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32);
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`system MMIO and cartridge controls are non-executable before reads (${backend})`, () => {
		for (const pc of [IO_GX_GPU_GP0, IO_CART_SELECT]) {
			const { cpu, memory } = machine(backend);
			let reads = 0;
			memory.mapIoRead(pc, memory, () => { reads += 1; return 0; });
			assert.equal(memory.readMappedU32LE(pc), 0);
			assert.equal(reads, 1, 'ordinary data reads still reach the MMIO owner');
			jump(cpu, pc);
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			fault(cpu, memory, pc, pc);
			assert.equal(reads, 1, 'instruction fetch does not call the mapped owner');
		}
	});

	test(`cartridge MMIO fetch faults without reading either selected card (${backend})`, () => {
		for (const selected of [0, 1]) {
			const { cpu, memory } = machine(backend);
			memory.writeMappedU32LE(IO_CART_SELECT, selected);
			const cartridge = memory.cartridgeController;
			assert.equal(cartridge.selectedSlot(), selected, 'the data selector reaches the intended card');
			const read = cartridge.readU32.bind(cartridge);
			let reads = 0;
			cartridge.readU32 = (address, signals) => { reads += 1; return read(address, signals); };
			memory.readMappedU32LE(CART_MMIO_BASE);
			assert.equal(reads, 1);
			jump(cpu, CART_MMIO_BASE);
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			fault(cpu, memory, CART_MMIO_BASE, CART_MMIO_BASE);
			assert.equal(reads, 1, 'forbidden fetch never touches the selected cartridge');
		}
	});

	for (const [op, label] of [[OpCode.WIDE, 'WIDE body'], [OpCode.EQ, 'skipped instruction']] as const) test(`${label} cannot be fetched from cartridge MMIO (${backend})`, () => {
		const { cpu, memory } = machine(backend, CART_RAM_SIZE);
		const pc = CART_MMIO_BASE - INSTRUCTION_BYTES;
		const code = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(code, 0, op, 0, 0, 0);
		memory.cartridgeController.writeU32(pc, readLE32(code, 0), mappedBusSignalsForCartridgeSlot(0));
		let deviceReads = 0;
		const cartridge = memory.cartridgeController, read = cartridge.readU32.bind(cartridge);
		cartridge.readU32 = (address, signals) => { if (address >= CART_MMIO_BASE) deviceReads += 1; return read(address, signals); };
		jump(cpu, pc);
		assert.equal(cpu.runUntilDepth(0, op === OpCode.WIDE ? 1 : 2), RunResult.Yielded);
		fault(cpu, memory, op === OpCode.WIDE ? pc : CART_MMIO_BASE, CART_MMIO_BASE);
		assert.equal(deviceReads, 0);
	});

	test(`unbacked ROM and RAM immediately beyond the I/O decoder retain executable reads (${backend})`, () => {
		const { cpu, memory } = machine(backend);
		for (const pc of [SYSTEM_ROM_SIZE - INSTRUCTION_BYTES, CART_ROM_BASE]) {
			assert.equal(memory.readMappedBusU32LE(pc, mappedBusSignalsForCartridgeSlot(0) | MAPPED_BUS_INSTRUCTION_FETCH), 0);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), 0, 'unbacked executable ROM reads remain zero');
		}
		const empty = new Memory({ systemRom: system.romBytes, cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
		assert.equal(empty.readMappedBusU32LE(CART_ROM_BASE, mappedBusSignalsForCartridgeSlot(1) | MAPPED_BUS_INSTRUCTION_FETCH), 0);
		assert.equal(empty.readIoU32(IO_SYS_BUS_FAULT_CODE), 0, 'an empty socket remains zero-filled');
		const pc = IO_BASE + IO_SLOT_COUNT * 4;
		const code = new Uint8Array(INSTRUCTION_BYTES);
		writeInstruction(code, 0, OpCode.HALT, 0, 0, 0);
		memory.writeU32(pc, readLE32(code, 0));
		jump(cpu, pc);
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readCauseWord(), 0, 'RAM immediately after the decoder remains executable');
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), 0);
	});

	test(`instruction alignment still precedes the MMIO execute fault (${backend})`, () => {
		const { cpu, memory } = machine(backend);
		jump(cpu, IO_GX_GPU_GP0 + 1);
		cpu.runUntilDepth(0, 1);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD);
		assert.equal(cpu.readBadAddressWord(), IO_GX_GPU_GP0 + 1);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), 0);
	});
}
