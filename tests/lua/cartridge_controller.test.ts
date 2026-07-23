import assert from 'node:assert/strict';
import { test } from 'node:test';

import { writeLE32 } from '../../machine/ts/common/endian';
import {
	DMA_CONTROL_BLOCK_WORDS_SHIFT,
	DMA_CONTROL_READ_INCREMENT,
	DMA_CONTROL_READ_REQUEST_SHIFT,
	DMA_CONTROL_WRITE_INCREMENT,
	DMA_CONTROL_WRITE_REQUEST_SHIFT,
	DMA_REQUEST_CARTRIDGE_SLOT0_WRITE,
	DMA_REQUEST_CARTRIDGE_SLOT1_READ,
	DMA_TRIGGER_START,
	IO_CART_SELECT,
	IO_CART_SLOT0_BOARD,
	IO_CART_SLOT0_RAM_BYTES,
	IO_CART_SLOT1_BOARD,
	IO_CART_SLOT1_RAM_BYTES,
	IO_CART_STATUS,
	IO_DMA0_CONTROL,
	IO_DMA0_READ_ADDR,
	IO_DMA0_TRANSFER_COUNT,
	IO_DMA0_TRIGGER,
	IO_DMA0_WRITE_ADDR,
	IO_IRQ_ACK,
	IO_IRQ_FLAGS,
	IRQ_CARTRIDGE_SLOT0,
	IRQ_CARTRIDGE_SLOT1,
} from '../../machine/ts/machine/bus/io';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import {
	CARTRIDGE_BOARD_MAILBOX,
	CARTRIDGE_BOARD_RAM,
	CARTRIDGE_MAILBOX_CONTROL_DREQ_READ,
	CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE,
	CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER,
	CARTRIDGE_MAILBOX_CONTROL_OFFSET,
	CARTRIDGE_MAILBOX_DATA_OFFSET,
	CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET,
	CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING,
	CARTRIDGE_MAILBOX_STATUS_OFFSET,
	CARTRIDGE_STATUS_SELECTED_SLOT1,
	CARTRIDGE_STATUS_SLOT0_PRESENT,
	CARTRIDGE_STATUS_SLOT0_PROGRAM,
	CARTRIDGE_STATUS_SLOT1_PRESENT,
	CARTRIDGE_STATUS_SLOT1_PROGRAM,
	type CartridgeSlotMediaPair,
} from '../../machine/ts/machine/devices/cartridge/contracts';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import {
	CART_MMIO_BASE,
	CART_RAM_BASE,
	CART_ROM_BASE,
} from '../../machine/ts/machine/memory/map';
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

function createHarness(cartridgeSlots: CartridgeSlotMediaPair): CartridgeHarness {
	const memory = new Memory({
		systemRom: new Uint8Array(0),
		cartridgeSlots,
	});
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq);
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
	boardWord: number,
	ramByteCount: number,
	present: boolean,
	programPresent: boolean,
): CartridgeSlotMediaPair[number] {
	const rom = new Uint8Array(romWords.length * 4);
	for (let index = 0; index < romWords.length; index += 1) {
		writeLE32(rom, index * 4, romWords[index]!);
	}
	return { rom, boardWord, ramByteCount, present, programPresent };
}

test('cartridge bus selects one physical socket and retains the raw selection latch', () => {
	const slot0 = slot([0x11223344], CARTRIDGE_BOARD_RAM, 16, true, true);
	const slot1 = slot([0xaabbccdd], CARTRIDGE_BOARD_MAILBOX, 0, true, true);
	const { memory } = createHarness([slot0, slot1]);

	assert.equal(memory.readMappedU32LE(IO_CART_SELECT), 0);
	assert.equal(memory.readMappedU32LE(CART_ROM_BASE), 0x11223344);
	assert.equal(
		memory.readMappedU32LE(IO_CART_STATUS),
		CARTRIDGE_STATUS_SLOT0_PRESENT
			| CARTRIDGE_STATUS_SLOT1_PRESENT
			| CARTRIDGE_STATUS_SLOT0_PROGRAM
			| CARTRIDGE_STATUS_SLOT1_PROGRAM,
	);
	assert.equal(memory.readMappedU32LE(IO_CART_SLOT0_BOARD), CARTRIDGE_BOARD_RAM);
	assert.equal(memory.readMappedU32LE(IO_CART_SLOT0_RAM_BYTES), 16);
	assert.equal(memory.readMappedU32LE(IO_CART_SLOT1_BOARD), CARTRIDGE_BOARD_MAILBOX);
	assert.equal(memory.readMappedU32LE(IO_CART_SLOT1_RAM_BYTES), 0);

	memory.writeMappedU32LE(IO_CART_SELECT, 0xa5a50001);
	assert.equal(memory.readMappedU32LE(IO_CART_SELECT), 0xa5a50001);
	assert.equal(memory.readMappedU32LE(CART_ROM_BASE), 0xaabbccdd);
	assert.equal(
		memory.readMappedU32LE(IO_CART_STATUS),
		CARTRIDGE_STATUS_SLOT0_PRESENT
			| CARTRIDGE_STATUS_SLOT1_PRESENT
			| CARTRIDGE_STATUS_SLOT0_PROGRAM
			| CARTRIDGE_STATUS_SLOT1_PROGRAM
			| CARTRIDGE_STATUS_SELECTED_SLOT1,
	);
});

test('cartridge RAM, mailbox state, reset, and restore remain socket-local', () => {
	const board = CARTRIDGE_BOARD_RAM | CARTRIDGE_BOARD_MAILBOX;
	const { memory } = createHarness([
		slot([], board, 16, true, false),
		slot([], board, 16, true, true),
	]);

	assert.equal(memory.readMappedU32LE(IO_CART_SELECT), 1);
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
	assert.notEqual(memory.readMappedU32LE(IO_IRQ_FLAGS) & IRQ_CARTRIDGE_SLOT1, 0);

	memory.writeMappedU32LE(IO_CART_SELECT, 0x2468ace0);
	memory.writeMappedU32LE(CART_RAM_BASE, 0x55556666);
	memory.writeMappedU32LE(MAILBOX_DATA_ADDRESS, 0x77778888);
	memory.writeMappedU32LE(
		MAILBOX_CONTROL_ADDRESS,
		CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER | CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE,
	);
	assert.notEqual(memory.readMappedU32LE(IO_IRQ_FLAGS) & IRQ_CARTRIDGE_SLOT0, 0);
	const saved = memory.cartridgeController.captureState();

	memory.writeMappedU32LE(CART_RAM_BASE, 0);
	memory.writeMappedU32LE(MAILBOX_DATA_ADDRESS, 0);
	memory.writeMappedU32LE(MAILBOX_IRQ_ACK_ADDRESS, 1);
	memory.writeMappedU32LE(IO_CART_SELECT, 1);
	memory.cartridgeController.restoreState(saved);

	assert.equal(memory.readMappedU32LE(IO_CART_SELECT), 0x2468ace0);
	assert.equal(memory.readMappedU32LE(CART_RAM_BASE), 0x55556666);
	assert.equal(memory.readMappedU32LE(MAILBOX_DATA_ADDRESS), 0x77778888);
	assert.equal(memory.readMappedU32LE(MAILBOX_STATUS_ADDRESS), CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING);
	memory.writeMappedU32LE(IO_CART_SELECT, 1);
	assert.equal(memory.readMappedU32LE(CART_RAM_BASE), 0x11112222);
	assert.equal(memory.readMappedU32LE(MAILBOX_DATA_ADDRESS), 0x33334444);

	memory.cartridgeController.reset();
	assert.equal(memory.readMappedU32LE(IO_CART_SELECT), 1);
	assert.equal(memory.readMappedU32LE(CART_RAM_BASE), 0x11112222);
	assert.equal(memory.readMappedU32LE(MAILBOX_DATA_ADDRESS), 0);
	assert.equal(memory.readMappedU32LE(MAILBOX_STATUS_ADDRESS), 0);
});

test('mailbox IRQ raises once per cartridge source-latch edge', () => {
	const { memory } = createHarness([
		slot([], CARTRIDGE_BOARD_MAILBOX, 0, true, false),
		slot([], 0, 0, false, false),
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

test('cartridge DREQ selectors override CPU selection independently on both DMA sides', () => {
	const board = CARTRIDGE_BOARD_RAM | CARTRIDGE_BOARD_MAILBOX;
	const { memory, dma, scheduler } = createHarness([
		slot([0x01020304, 0x11121314], board, 16, true, false),
		slot([0xa1a2a3a4, 0xb1b2b3b4], board, 16, true, false),
	]);

	memory.writeMappedU32LE(IO_CART_SELECT, 1);
	memory.writeMappedU32LE(
		MAILBOX_CONTROL_ADDRESS,
		CARTRIDGE_MAILBOX_CONTROL_DREQ_READ,
	);
	memory.writeMappedU32LE(IO_CART_SELECT, 0);
	memory.writeMappedU32LE(
		MAILBOX_CONTROL_ADDRESS,
		CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE,
	);

	const control = DMA_CONTROL_READ_INCREMENT
		| DMA_CONTROL_WRITE_INCREMENT
		| (DMA_REQUEST_CARTRIDGE_SLOT1_READ << DMA_CONTROL_READ_REQUEST_SHIFT)
		| (DMA_REQUEST_CARTRIDGE_SLOT0_WRITE << DMA_CONTROL_WRITE_REQUEST_SHIFT)
		| (1 << DMA_CONTROL_BLOCK_WORDS_SHIFT);
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
