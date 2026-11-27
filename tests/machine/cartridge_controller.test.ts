import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import assert from 'node:assert/strict';
import { MAPPED_BUS_MASTER_CPU } from '../../machine/ts/machine/memory/bus_signals';
import { test } from 'node:test';

import { writeLE32 } from '../../machine/ts/common/endian';
import {
	DMA_CONTROL_READ_SLOT_SHIFT,
	DMA_ROUTE_COPY,
	DMA_TRIGGER_START,
	IO_CART_RAM_BYTE_COUNT,
	IO_CART0_ROM_BYTE_COUNT,
	IO_CART1_ROM_BYTE_COUNT,
	IO_CART_ROM_BYTE_COUNT,
	IO_CART_SELECT,
	IO_CART_STATUS,
	IO_DMA0_CONTROL,
	IO_DMA0_READ_ADDR,
	IO_DMA0_TRANSFER_COUNT,
	IO_DMA0_TRIGGER,
	IO_DMA0_WRITE_ADDR,
	IO_IRQ_ACK,
	IO_IRQ_FLAGS,
	BUS_FAULT_NONE,
	BUS_FAULT_READ_ONLY,
	BUS_FAULT_UNMAPPED,
	IO_SYS_BUS_FAULT_CODE,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_ROM_BYTE_COUNT,
	IO_SLOT_COUNT,
	IRQ_CARTRIDGE_SLOT0,
	IRQ_CARTRIDGE_SLOT1,
} from '../../machine/ts/spec/bmsx/io';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import {
	CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE,
	CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER,
	CARTRIDGE_MAILBOX_CONTROL_OFFSET,
	CARTRIDGE_MAILBOX_DATA_OFFSET,
	CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET,
	CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING,
	CARTRIDGE_MAILBOX_STATUS_OFFSET,
	CARTRIDGE_STATUS_SELECTED_SLOT1,
	CARTRIDGE_STATUS_SLOT0_PRESENT,
	CARTRIDGE_STATUS_SLOT1_PRESENT,
} from '../../machine/ts/spec/bmsx/cartridge';
import type {
	CartridgeCardMedia,
	CartridgeSocketMediaPair,
} from '../../machine/ts/machine/devices/cartridge/contracts';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import {
	CART_MMIO_BASE,
	CART_RAM_BASE,
	CART_ROM_BASE,
	IO_BASE,
	IO_WORD_SIZE,
} from '../../machine/ts/spec/bmsx/memory_map';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';

const MAILBOX_DATA_ADDRESS = CART_MMIO_BASE + CARTRIDGE_MAILBOX_DATA_OFFSET;
const MAILBOX_CONTROL_ADDRESS = CART_MMIO_BASE + CARTRIDGE_MAILBOX_CONTROL_OFFSET;
const MAILBOX_STATUS_ADDRESS = CART_MMIO_BASE + CARTRIDGE_MAILBOX_STATUS_OFFSET;
const MAILBOX_IRQ_ACK_ADDRESS = CART_MMIO_BASE + CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET;

type CartridgeHarness = {
	memory: Memory;
	cpu: CPU;
	dma: DmaController;
	irq: IrqController;
	scheduler: DeviceScheduler;
};

function createHarness(cartridgeSlots: CartridgeSocketMediaPair): CartridgeHarness {
	const memory = new Memory({
		systemRom: new Uint8Array(0),
		cartridgeSlots,
	}, PSX_MACHINE_SPEC.ramBytes);
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory));
	const scheduler = new DeviceScheduler(cpu);
	const dma = new DmaController(memory, cpu, irq, scheduler);
	memory.cartridgeController.connect(memory, irq, dma);
	irq.reset();
	dma.reset();
	memory.cartridgeController.reset();
	dma.setTiming(1, 0, 1, 1, 0, scheduler.nowCycles);
	return { memory, cpu, dma, irq, scheduler };
}

function slot(
	romWords: readonly number[],
	ramByteCount: number | null = null,
	mailboxPresent = false,
): CartridgeCardMedia {
	const rom = new Uint8Array(romWords.length * 4);
	for (let index = 0; index < romWords.length; index += 1) {
		writeLE32(rom, index * 4, romWords[index]!);
	}
	return { rom, ramByteCount, mailboxPresent };
}

test('cartridge bus selects one physical socket and retains the raw selection latch', () => {
	const slot0 = slot([0x11223344], 16);
	const slot1 = slot([0xaabbccdd], null, true);
	const { memory } = createHarness([slot0, slot1]);

	assert.equal(memory.readMappedU32LE(IO_CART_SELECT), 0);
	assert.equal(memory.readMappedU32LE(CART_ROM_BASE), 0x11223344);
	assert.equal(
		memory.readMappedU32LE(IO_CART_STATUS),
		CARTRIDGE_STATUS_SLOT0_PRESENT
			| CARTRIDGE_STATUS_SLOT1_PRESENT,
	);
	memory.writeMappedU32LE(IO_CART_SELECT, 0xa5a50001);
	assert.equal(memory.readMappedU32LE(IO_CART_SELECT), 0xa5a50001);
	assert.equal(memory.readMappedU32LE(CART_ROM_BASE), 0xaabbccdd);
	const view = { bytes: slot0.rom!, byteOffset: 0, byteLength: 0 };
	assert.equal(memory.bindMappedReadView(CART_ROM_BASE, 4, MAPPED_BUS_MASTER_CPU, view), true);
	assert.equal(view.bytes, slot1.rom);
	assert.equal(
		memory.readMappedU32LE(IO_CART_STATUS),
		CARTRIDGE_STATUS_SLOT0_PRESENT
			| CARTRIDGE_STATUS_SLOT1_PRESENT
			| CARTRIDGE_STATUS_SELECTED_SLOT1,
	);
});

test('the byte-count registers expose only the selected socket’s fitted storage', () => {
	const rom = new Uint8Array(7);
	const { memory } = createHarness([
		{ rom, ramByteCount: null, mailboxPresent: false },
		{ rom: null, ramByteCount: 257, mailboxPresent: true },
	]);
	assert.equal(memory.readMappedWord(IO_CART_ROM_BYTE_COUNT), rom.byteLength);
	assert.equal(memory.readMappedWord(IO_CART_RAM_BYTE_COUNT), 0);
	const replacement = new Uint8Array(3);
	memory.cartridgeController.installRom(0, replacement);
	assert.equal(memory.readMappedWord(IO_CART_ROM_BYTE_COUNT), replacement.byteLength);
	memory.writeMappedWord(IO_CART_SELECT, 0x80000001);
	assert.equal(memory.readMappedWord(IO_CART_ROM_BYTE_COUNT), 0);
	assert.equal(memory.readMappedWord(IO_CART_RAM_BYTE_COUNT), 257);
	memory.writeMappedWord(IO_CART_ROM_BYTE_COUNT, 123);
	memory.writeMappedWord(IO_CART_RAM_BYTE_COUNT, 123);
	assert.equal(memory.readMappedWord(IO_CART_ROM_BYTE_COUNT), 0);
	assert.equal(memory.readMappedWord(IO_CART_RAM_BYTE_COUNT), 257);

	const saved = memory.cartridgeController.captureState();
	memory.cartridgeController.reset();
	assert.equal(memory.readMappedWord(IO_CART_ROM_BYTE_COUNT), replacement.byteLength);
	memory.cartridgeController.restoreState(saved);
	assert.equal(memory.readMappedWord(IO_CART_RAM_BYTE_COUNT), 257);

	const empty = createHarness([null, null]).memory;
	assert.equal(empty.readMappedWord(IO_CART_ROM_BYTE_COUNT), 0);
	assert.equal(empty.readMappedWord(IO_CART_RAM_BYTE_COUNT), 0);
});

test('fitted ROM geometry reads current physical backing without changing the selected socket', () => {
	const { memory } = createHarness([
		{ rom: Uint8Array.of(0x11, 2, 3, 4, 5, 6, 7), ramByteCount: null, mailboxPresent: false },
		{ rom: Uint8Array.of(0x22, 2, 3, 4, 5, 6, 7, 8, 9), ramByteCount: null, mailboxPresent: false },
	]);
	const cart = memory.cartridgeController;
	const registers = [IO_SYS_ROM_BYTE_COUNT, IO_CART0_ROM_BYTE_COUNT, IO_CART1_ROM_BYTE_COUNT];
	const fitted = () => registers.map(address => memory.readMappedWord(address));
	assert.deepEqual(registers, [0x080101f4, 0x080101f8, 0x080101fc]);
	assert.equal(IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE, 0x08010448);
	assert.deepEqual(fitted(), [0, 7, 9]);
	memory.installSystemRom(Uint8Array.of(1, 2, 3, 4, 5, 6, 0xa7));
	assert.equal(memory.readMappedU8(6), 0xa7);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_NONE);
	memory.readMappedU8(7);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), 7);
	memory.clearBusFault();
	memory.writeMappedWord(IO_CART_SELECT, 0xa5a50001);
	assert.deepEqual(fitted(), [7, 7, 9]);
	assert.equal(memory.readMappedWord(IO_CART_SELECT), 0xa5a50001);
	assert.equal(memory.readMappedWord(IO_CART_ROM_BYTE_COUNT), 9);
	assert.equal(memory.readMappedU8(CART_ROM_BASE), 0x22);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_NONE);

	const saved = cart.captureState();
	cart.reset();
	assert.equal(memory.readMappedWord(IO_CART_ROM_BYTE_COUNT), 7);
	assert.deepEqual(fitted(), [7, 7, 9]);
	cart.installRom(0, new Uint8Array(11));
	memory.installSystemRom(new Uint8Array(13));
	cart.restoreState(saved);
	assert.deepEqual(fitted(), [13, 11, 9], 'selection restores independently of installed media');
	assert.equal(memory.readMappedWord(IO_CART_SELECT), 0xa5a50001);
	assert.equal(memory.readMappedU8(CART_ROM_BASE), 0x22);

	for (const address of registers) {
		memory.clearBusFault();
		memory.writeMappedWord(address, 42);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_READ_ONLY);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), address);
	}
	assert.deepEqual(fitted(), [13, 11, 9]);
	for (const address of [0x080101f0, 0x08010200, 0x08010448]) {
		memory.clearBusFault();
		memory.writeMappedWord(address, 0x11223344);
		assert.equal(memory.readMappedWord(address), 0x11223344);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_NONE);
	}

	// The retained first beat commits, then the geometry word rejects the second.
	memory.writeMappedF64LE(0x080101f0, 1);
	assert.equal(memory.readMappedWord(0x080101f0), 0);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_READ_ONLY);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), IO_SYS_ROM_BYTE_COUNT);
	assert.equal(memory.readMappedWord(IO_SYS_ROM_BYTE_COUNT), 13);

	const noRom = createHarness([null, { rom: null, ramByteCount: 3, mailboxPresent: false }]).memory;
	assert.equal(noRom.readMappedWord(IO_CART_STATUS), CARTRIDGE_STATUS_SLOT1_PRESENT);
	assert.deepEqual(registers.map(address => noRom.readMappedWord(address)), [0, 0, 0]);
});

test('an empty physical socket remains absent state and faults on the shared aperture', () => {
	const { memory } = createHarness([
		slot([0x11223344]),
		null,
	]);
	memory.writeMappedU32LE(IO_CART_SELECT, 1);
	assert.equal(
		memory.readMappedU32LE(IO_CART_STATUS),
		CARTRIDGE_STATUS_SLOT0_PRESENT | CARTRIDGE_STATUS_SELECTED_SLOT1,
	);
	for (const address of [CART_ROM_BASE, CART_RAM_BASE, CART_MMIO_BASE]) {
		memory.clearBusFault();
		assert.equal(memory.readMappedU32LE(address), 0);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), address);
		memory.clearBusFault();
		memory.writeMappedU32LE(address, 0xffffffff);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
		assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), address);
	}
	assert.equal(memory.cartridgeController.captureState().slots[1], null);
});

test('cartridge RAM, mailbox state, reset, and restore remain socket-local', () => {
	const hardwareCard: CartridgeCardMedia = {
		rom: null,
		ramByteCount: 16,
		mailboxPresent: true,
	};
	const { memory } = createHarness([
		hardwareCard,
		{
			rom: null,
			ramByteCount: 16,
			mailboxPresent: true,
		},
	]);

	assert.equal(memory.readMappedU32LE(IO_CART_SELECT), 0);
	memory.writeMappedU32LE(CART_RAM_BASE, 0x11112222);
	memory.writeMappedU32LE(MAILBOX_DATA_ADDRESS, 0x33334444);
	memory.writeMappedU32LE(
		MAILBOX_CONTROL_ADDRESS,
		0x80000003,
	);
	assert.equal(
		memory.readMappedU32LE(MAILBOX_CONTROL_ADDRESS),
		0x80000002,
	);
	assert.equal(memory.readMappedU32LE(MAILBOX_STATUS_ADDRESS), CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING);
	assert.notEqual(memory.readMappedU32LE(IO_IRQ_FLAGS) & IRQ_CARTRIDGE_SLOT0, 0);

	memory.writeMappedU32LE(IO_CART_SELECT, 0x2468ace1);
	memory.writeMappedU32LE(CART_RAM_BASE, 0x55556666);
	memory.writeMappedU32LE(MAILBOX_DATA_ADDRESS, 0x77778888);
	memory.writeMappedU32LE(
		MAILBOX_CONTROL_ADDRESS,
		CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER | CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE,
	);
	assert.notEqual(memory.readMappedU32LE(IO_IRQ_FLAGS) & IRQ_CARTRIDGE_SLOT1, 0);
	const saved = memory.cartridgeController.captureState();

	memory.writeMappedU32LE(CART_RAM_BASE, 0);
	memory.writeMappedU32LE(MAILBOX_DATA_ADDRESS, 0);
	memory.writeMappedU32LE(MAILBOX_IRQ_ACK_ADDRESS, 1);
	memory.writeMappedU32LE(IO_CART_SELECT, 0);
	memory.cartridgeController.restoreState(saved);

	assert.equal(memory.readMappedU32LE(IO_CART_SELECT), 0x2468ace1);
	assert.equal(memory.readMappedU32LE(CART_RAM_BASE), 0x55556666);
	assert.equal(memory.readMappedU32LE(MAILBOX_DATA_ADDRESS), 0x77778888);
	assert.equal(memory.readMappedU32LE(MAILBOX_STATUS_ADDRESS), CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING);
	memory.writeMappedU32LE(IO_CART_SELECT, 0);
	assert.equal(memory.readMappedU32LE(CART_RAM_BASE), 0x11112222);
	assert.equal(memory.readMappedU32LE(MAILBOX_DATA_ADDRESS), 0x33334444);

	memory.cartridgeController.reset();
	assert.equal(memory.readMappedU32LE(IO_CART_SELECT), 0);
	assert.equal(memory.readMappedU32LE(CART_RAM_BASE), 0x11112222);
	assert.equal(memory.readMappedU32LE(MAILBOX_DATA_ADDRESS), 0);
	assert.equal(memory.readMappedU32LE(MAILBOX_STATUS_ADDRESS), 0);
});

test('mailbox IRQ raises once per cartridge source-latch edge', () => {
	const { memory } = createHarness([
		{ rom: null, ramByteCount: null, mailboxPresent: true },
		null,
	]);

	memory.writeMappedU32LE(MAILBOX_CONTROL_ADDRESS, CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	assert.notEqual(memory.readMappedU32LE(IO_IRQ_FLAGS) & IRQ_CARTRIDGE_SLOT0, 0);
	assert.equal(memory.readMappedU32LE(MAILBOX_STATUS_ADDRESS), CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING);

	memory.writeMappedU32LE(IO_IRQ_ACK, IRQ_CARTRIDGE_SLOT0);
	assert.equal(memory.readMappedU32LE(IO_IRQ_FLAGS) & IRQ_CARTRIDGE_SLOT0, 0);
	memory.writeMappedU32LE(MAILBOX_CONTROL_ADDRESS, CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	assert.equal(
		memory.readMappedU32LE(IO_IRQ_FLAGS) & IRQ_CARTRIDGE_SLOT0,
		0,
		'central IRQ acknowledgement does not clear the cartridge source latch',
	);

	memory.writeMappedU32LE(MAILBOX_IRQ_ACK_ADDRESS, 1);
	assert.equal(memory.readMappedU32LE(MAILBOX_STATUS_ADDRESS), 0);
	memory.writeMappedU32LE(MAILBOX_CONTROL_ADDRESS, CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	assert.notEqual(memory.readMappedU32LE(IO_IRQ_FLAGS) & IRQ_CARTRIDGE_SLOT0, 0);
});

test('DMA socket bits select ROM and RAM independently of CPU selection and device DREQ', () => {
	const { memory, dma, scheduler } = createHarness([
		slot([0x01020304, 0x11121314], 16, true),
		slot([0xa1a2a3a4, 0xb1b2b3b4], 16, true),
	]);

	memory.writeMappedU32LE(IO_CART_SELECT, 0);

	const control = DMA_ROUTE_COPY | (1 << DMA_CONTROL_READ_SLOT_SHIFT);
	memory.writeMappedU32LE(IO_DMA0_READ_ADDR, CART_ROM_BASE);
	memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, CART_RAM_BASE);
	memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, 2);
	memory.writeMappedU32LE(IO_DMA0_CONTROL, control);
	memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	const deadline = scheduler.nextDeadline();
	assert.equal(deadline, 4);
	scheduler.advanceTo(deadline);
	dma.onService(deadline);

	assert.equal(memory.readMappedU32LE(CART_RAM_BASE), 0xa1a2a3a4);
	assert.equal(memory.readMappedU32LE(CART_RAM_BASE + 4), 0xb1b2b3b4);
	memory.writeMappedU32LE(IO_CART_SELECT, 1);
	assert.equal(memory.readMappedU32LE(CART_RAM_BASE), 0);
	assert.equal(memory.readMappedU32LE(CART_RAM_BASE + 4), 0);
});
