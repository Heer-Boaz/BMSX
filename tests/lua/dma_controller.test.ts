import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	BUS_FAULT_UNMAPPED,
	DMA_CONTROL_BLOCK_WORDS_16,
	DMA_CONTROL_READ_INCREMENT,
	DMA_CONTROL_REQUEST_DISABLED,
	DMA_CONTROL_REQUEST_FORCE,
	DMA_CONTROL_REQUEST_GX_READ,
	DMA_CONTROL_REQUEST_GX_WRITE,
	DMA_CONTROL_WRITE_INCREMENT,
	DMA_STATUS_BUSY,
	DMA_STATUS_DONE,
	DMA_TRIGGER_START,
	IO_DMA_CONTROL,
	IO_DMA_READ_ADDR,
	IO_DMA_STATUS,
	IO_DMA_TRANSFER_COUNT,
	IO_DMA_TRIGGER,
	IO_DMA_WRITE_ADDR,
	IO_GX_GPU_GP0,
	IO_IRQ_FLAGS,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IRQ_DMA_DONE,
} from '../../machine/ts/machine/bus/io';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { DmaController, type DmaControllerState } from '../../machine/ts/machine/devices/dma/controller';
import {
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
	GX_GPU_DMA_DIRECTION_FIFO,
	GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU,
	GX_GPU_DMA_DIRECTION_OFF,
	GX_GPU_GP0_CPU_TO_VRAM_FIRST,
	GX_GPU_GP0_FILL_RECTANGLE,
	GX_GPU_GP0_VRAM_TO_CPU_FIRST,
	GX_GPU_GP1_DMA_DIRECTION,
	GX_GPU_STATUS_READY_TO_RECEIVE_DMA,
	GxGpu,
} from '../../machine/ts/machine/devices/gx/gpu';
import {
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE1_SINT,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CART_ROM_BASE, PROGRAM_STATIC_RAM_BASE, RAM_END } from '../../machine/ts/machine/memory/map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/machine/model_registry';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';

type DmaGpuFixture = {
	memory: Memory;
	dma: DmaController;
	gpu: GxGpu;
	scheduler: DeviceScheduler;
};

const RAM_COPY_CONTROL = DMA_CONTROL_READ_INCREMENT
	| DMA_CONTROL_WRITE_INCREMENT
	| DMA_CONTROL_REQUEST_FORCE
	| DMA_CONTROL_BLOCK_WORDS_16;
const GP0_WRITE_CONTROL = DMA_CONTROL_READ_INCREMENT | DMA_CONTROL_REQUEST_GX_WRITE | DMA_CONTROL_BLOCK_WORDS_16;
const GP0_READ_CONTROL = DMA_CONTROL_WRITE_INCREMENT | DMA_CONTROL_REQUEST_GX_READ;

function createDmaGpuFixture(): DmaGpuFixture {
	const memory = new Memory({
		systemRom: new Uint8Array(),
		cartRom: new Uint8Array([0x44, 0x33, 0x22, 0x11, 0x88, 0x77, 0x66, 0x55]),
	});
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq);
	const scheduler = new DeviceScheduler(cpu);
	const dma = new DmaController(memory, cpu, irq, scheduler);
	const gpu = new GxGpu(memory, irq, scheduler, dma);
	dma.reset();
	gpu.reset();
	irq.reset();
	dma.setTiming(1, 16, 0, 0, 0);
	const smode1Address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(smode1Address, memory.readMappedU32LE(smode1Address) | GX_GPU_PCRTC_SMODE1_SINT);
	gpu.onService(0);
	return { memory, dma, gpu, scheduler };
}

function setStandardTiming(dma: DmaController, scheduler: DeviceScheduler): void {
	dma.setTiming(
		PSX_MACHINE_SPEC.cpuFreqHz,
		PSX_MACHINE_SPEC.dmaWordsPerSec,
		PSX_MACHINE_SPEC.dmaRamRowReopenCycles,
		PSX_MACHINE_SPEC.dmaRomWaitCyclesPerWord,
		scheduler.nowCycles,
	);
}

test('fly-by combines RAM row cost and ROM wait-state cost per word', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, scheduler } = fixture;
	const ramSource = PROGRAM_STATIC_RAM_BASE + 0x80;
	const ramDestination = PROGRAM_STATIC_RAM_BASE + 0xa0;
	const romDestination = PROGRAM_STATIC_RAM_BASE + 0xc0;
	memory.writeMappedU32LE(ramSource, 0x99aabbcc);
	memory.writeMappedU32LE(ramSource + 4, 0xddeeff00);
	setStandardTiming(dma, scheduler);

	// RAM<->RAM is the one fly-by exception: a single-ported chip can't serve
	// both addresses in one cycle, so the two sides' costs sum instead of
	// taking the slower one. Word 0 is a cold row on both sides (4 base + 12
	// reopen each = 32); word 1 stays in the same row on both sides (4 + 4 = 8).
	programTransfer(memory, ramSource, ramDestination, 2, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 40, 'RAM<->RAM sums both sides\' row-aware cost');
	runNextDmaService(fixture);
	assert.equal(memory.readMappedU32LE(ramDestination), 0x99aabbcc);
	assert.equal(memory.readMappedU32LE(ramDestination + 4), 0xddeeff00);

	// Cartridge ROM has no row locality (flat 10 cycles/word). The RAM write
	// side starts a fresh row here, so word 0's cold RAM cost (16) beats the
	// flat ROM cost (10); word 1's warm RAM cost (4) loses to ROM's flat 10.
	// Fly-by takes the slower side each time: max(10,16)=16, max(10,4)=10.
	programTransfer(memory, CART_ROM_BASE, romDestination, 2, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 66, 'cartridge-ROM source is fly-by combined with the RAM destination\'s row cost');
	runNextDmaService(fixture);
	assert.equal(memory.readMappedU32LE(romDestination), 0x11223344);
	assert.equal(memory.readMappedU32LE(romDestination + 4), 0x55667788);
});

test('a RAM row hit is cheaper than a reopen', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, scheduler } = fixture;
	const readAddr = PROGRAM_STATIC_RAM_BASE + 0x2000;
	const writeAddr = PROGRAM_STATIC_RAM_BASE + 0x2100;
	setStandardTiming(dma, scheduler);

	programTransfer(memory, readAddr, writeAddr, 1, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 32, 'first touch of a fresh row on both sides pays the reopen tax twice');
	runNextDmaService(fixture);

	programTransfer(memory, readAddr, writeAddr, 1, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 40, 'revisiting the same row on both sides is a hit: only the base cost is charged');
});

test('a RAM row jump repays the reopen tax', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, scheduler } = fixture;
	const readAddr = PROGRAM_STATIC_RAM_BASE + 0x2000;
	const writeAddr = PROGRAM_STATIC_RAM_BASE + 0x2100;
	const nextRowReadAddr = readAddr + 0x40; // one PSX_DMA_RAM_ROW_WORDS row further
	setStandardTiming(dma, scheduler);

	programTransfer(memory, readAddr, writeAddr, 1, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 32, 'first touch of a fresh row on both sides pays the reopen tax twice');
	runNextDmaService(fixture);

	// Read side jumps to a new row (cold again: 16); write side repeats the
	// same address as before (still warm: 4).
	programTransfer(memory, nextRowReadAddr, writeAddr, 1, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 52, 'a row jump on one side repays its reopen tax even while the other side stays warm');
});

test('a fixed MMIO port adds no wait cost beside the RAM side', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, gpu, scheduler } = fixture;
	const source = PROGRAM_STATIC_RAM_BASE + 0x3000;
	memory.writeMappedU32LE(source, 0x01020304);
	memory.writeMappedU32LE(source + 4, 0x05060708);
	setStandardTiming(dma, scheduler);

	programTransfer(memory, source, IO_GX_GPU_GP0, 2, GP0_WRITE_CONTROL);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_FIFO);
	// A fixed GX FIFO port classifies as neither RAM nor ROM and contributes
	// zero wait cost of its own; fly-by leaves only the RAM read side's cost:
	// word 0 cold (16), word 1 warm (4).
	assert.equal(scheduler.nextDeadline(), 20, 'a fixed MMIO port never adds its own wait cost beside the RAM side');
});

test('ROM and RAM sides each win the fly-by on different words', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, scheduler } = fixture;
	const destination = PROGRAM_STATIC_RAM_BASE + 0x4000;
	setStandardTiming(dma, scheduler);

	programTransfer(memory, CART_ROM_BASE, destination, 2, RAM_COPY_CONTROL);
	// word 0: cold RAM (16) beats flat ROM (10) -- RAM gates the word.
	// word 1: warm RAM (4) loses to flat ROM (10) -- ROM gates the word.
	// This proves the combine is a genuine per-word max(), not "source wins"
	// or "destination wins" or a flat sum (10+16=26 for word 0 alone would
	// already differ from the correct max of 16).
	assert.equal(scheduler.nextDeadline(), 26, 'fly-by lets either side gate a given word depending on which is slower');
});

test('RAM row memory survives a save/restore round-trip', () => {
	const sourceFixture = createDmaGpuFixture();
	const readAddr = PROGRAM_STATIC_RAM_BASE + 0x5000;
	const writeAddr = PROGRAM_STATIC_RAM_BASE + 0x5100;
	setStandardTiming(sourceFixture.dma, sourceFixture.scheduler);
	programTransfer(sourceFixture.memory, readAddr, writeAddr, 1, RAM_COPY_CONTROL);
	assert.equal(sourceFixture.scheduler.nextDeadline(), 32, 'first touch of a fresh row on both sides pays the reopen tax twice');
	runNextDmaService(sourceFixture);
	const state: DmaControllerState = sourceFixture.dma.captureState();

	const restoredFixture = createDmaGpuFixture();
	setStandardTiming(restoredFixture.dma, restoredFixture.scheduler);
	restoredFixture.dma.restoreState(state, restoredFixture.scheduler.nowCycles);
	restoredFixture.dma.postLoad();

	programTransfer(restoredFixture.memory, readAddr, writeAddr, 1, RAM_COPY_CONTROL);
	assert.equal(restoredFixture.scheduler.nextDeadline(), 8, 'restored row memory turns the next same-row access into a hit, not a cold reopen');
});

function programTransfer(memory: Memory, readAddress: number, writeAddress: number, wordCount: number, control: number): void {
	memory.writeMappedU32LE(IO_DMA_READ_ADDR, readAddress);
	memory.writeMappedU32LE(IO_DMA_WRITE_ADDR, writeAddress);
	memory.writeMappedU32LE(IO_DMA_TRANSFER_COUNT, wordCount);
	memory.writeMappedU32LE(IO_DMA_CONTROL, control);
	memory.writeMappedU32LE(IO_DMA_TRIGGER, DMA_TRIGGER_START);
}

function runNextDmaService(fixture: DmaGpuFixture): void {
	const deadline = fixture.scheduler.nextDeadline();
	assert.notEqual(deadline, Number.MAX_SAFE_INTEGER);
	fixture.scheduler.advanceTo(deadline);
	fixture.dma.onService(deadline);
}

test('DMA executes one live register channel as timed word bus transactions', () => {
	const fixture = createDmaGpuFixture();
	const { memory } = fixture;
	const source = PROGRAM_STATIC_RAM_BASE + 0x100;
	const destination = PROGRAM_STATIC_RAM_BASE + 0x200;
	memory.writeMappedU32LE(source, 0x11223344);
	memory.writeMappedU32LE(source + 4, 0x55667788);
	memory.writeMappedU32LE(source + 8, 0x99aabbcc);

	programTransfer(memory, source, destination, 3, RAM_COPY_CONTROL);
	assert.equal(memory.readIoU32(IO_DMA_TRIGGER), 0);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY);
	runNextDmaService(fixture);

	assert.equal(memory.readMappedU32LE(destination), 0x11223344);
	assert.equal(memory.readMappedU32LE(destination + 4), 0x55667788);
	assert.equal(memory.readMappedU32LE(destination + 8), 0x99aabbcc);
	assert.equal(memory.readIoU32(IO_DMA_READ_ADDR), source + 12);
	assert.equal(memory.readIoU32(IO_DMA_WRITE_ADDR), destination + 12);
	assert.equal(memory.readIoU32(IO_DMA_TRANSFER_COUNT), 0);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA_DONE, IRQ_DMA_DONE);
});

test('GX FIFO DREQ feeds GP0 and owns the shared port while BUSY', () => {
	const fixture = createDmaGpuFixture();
	const { memory, gpu, scheduler } = fixture;
	const source = PROGRAM_STATIC_RAM_BASE + 0x300;
	const command0 = (GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x3f;
	memory.writeMappedU32LE(source, command0);
	memory.writeMappedU32LE(source + 4, 0x00020010);
	memory.writeMappedU32LE(source + 8, 0x00030020);

	programTransfer(memory, source, IO_GX_GPU_GP0, 3, GP0_WRITE_CONTROL);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), false);
	memory.writeMappedU32LE(IO_DMA_TRIGGER, DMA_TRIGGER_START);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY);

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_FIFO);
	runNextDmaService(fixture);

	const commands = gpu.readDeviceOutput().commandBuffer;
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_FILL_RECTANGLE);
	assert.equal(commands.words[commands.commandWordStart[0]], command0 >>> 0);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), true);
});

test('CPU-to-GP0 DMA streams an A0 payload across programmed blocks', () => {
	const fixture = createDmaGpuFixture();
	const { memory, gpu } = fixture;
	const source = PROGRAM_STATIC_RAM_BASE + 0x380;
	memory.writeMappedU32LE(source, GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	memory.writeMappedU32LE(source + 4, 0);
	memory.writeMappedU32LE(source + 8, (1 << 16) | 34);
	for (let index = 0; index < 17; index += 1) {
		memory.writeMappedU32LE(source + 12 + index * 4, (0x55000000 | index) >>> 0);
	}

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	programTransfer(memory, source, IO_GX_GPU_GP0, 20, GP0_WRITE_CONTROL);
	runNextDmaService(fixture);
	assert.equal(memory.readIoU32(IO_DMA_TRANSFER_COUNT), 4);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY);
	assert.equal(gpu.readStatus() & GX_GPU_STATUS_READY_TO_RECEIVE_DMA, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	runNextDmaService(fixture);

	const commands = gpu.readDeviceOutput().commandBuffer;
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
});

test('an admitted DMA block survives DREQ drop, timing changes, and restore', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, gpu, scheduler } = fixture;
	const source = PROGRAM_STATIC_RAM_BASE + 0x400;
	memory.writeMappedU32LE(source, 0xe1000000);
	memory.writeMappedU32LE(source + 4, 0xe1000001);
	dma.setTiming(4, 1, 0, 0, 0);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	programTransfer(memory, source, IO_GX_GPU_GP0, 2, GP0_WRITE_CONTROL);
	assert.equal(scheduler.nextDeadline(), 8);

	scheduler.advanceTo(3);
	dma.setTiming(8, 1, 0, 0, 3);
	assert.equal(scheduler.nextDeadline(), 8);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_OFF);
	assert.equal(scheduler.nextDeadline(), 8);
	const state = dma.captureState();
	dma.restoreState(state, scheduler.nowCycles);
	dma.postLoad();
	assert.equal(scheduler.nextDeadline(), 8);

	runNextDmaService(fixture);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
});

test('DMA resamples finite GX read DREQ between words and resumes on a later readback', () => {
	const fixture = createDmaGpuFixture();
	const { memory, gpu, scheduler } = fixture;
	const destination = PROGRAM_STATIC_RAM_BASE + 0x500;
	const sentinel = 0xa5a5a5a5;
	memory.writeMappedU32LE(destination, sentinel);
	memory.writeMappedU32LE(destination + 4, sentinel);
	memory.writeMappedU32LE(destination + 8, sentinel);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 3);
	programTransfer(memory, IO_GX_GPU_GP0, destination, 3, GP0_READ_CONTROL);

	scheduler.advanceTo(1);
	gpu.onService(1);
	gpu.presentReadyFrameOnVblankEdge();
	let output = gpu.readDeviceOutput();
	let readback = output.readbackPort;
	readback.pixelBytes[0] = 0x11;
	readback.pixelBytes[1] = 0x11;
	readback.pixelBytes[2] = 0x22;
	readback.pixelBytes[3] = 0x22;
	readback.pixelBytes[4] = 0x33;
	readback.pixelBytes[5] = 0x33;
	assert.equal(readback.claimReadback(output.commandBuffer.presentCommandCount), true);
	readback.completeReadback(readback.token);
	runNextDmaService(fixture);
	runNextDmaService(fixture);

	assert.equal(memory.readMappedU32LE(destination), 0x22221111);
	assert.equal(memory.readMappedU32LE(destination + 4), 0x00003333);
	assert.equal(memory.readMappedU32LE(destination + 8), sentinel);
	assert.equal(memory.readIoU32(IO_DMA_TRANSFER_COUNT), 1);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);

	gpu.retirePresentedCommands();
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 2);
	const readbackDeadline = scheduler.nextDeadline();
	scheduler.advanceTo(readbackDeadline);
	gpu.onService(readbackDeadline);
	gpu.presentReadyFrameOnVblankEdge();
	output = gpu.readDeviceOutput();
	readback = output.readbackPort;
	readback.pixelBytes[0] = 0x55;
	readback.pixelBytes[1] = 0x55;
	readback.pixelBytes[2] = 0x66;
	readback.pixelBytes[3] = 0x66;
	assert.equal(readback.claimReadback(output.commandBuffer.presentCommandCount), true);
	readback.completeReadback(readback.token);
	runNextDmaService(fixture);

	assert.equal(memory.readMappedU32LE(destination + 8), 0x66665555);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
});

test('DMA bus faults remain Memory-owned and do not abort channel progress', () => {
	const fixture = createDmaGpuFixture();
	const { memory } = fixture;
	const destination = PROGRAM_STATIC_RAM_BASE + 0x600;
	memory.writeMappedU32LE(destination, 0xdeadbeef);

	programTransfer(memory, RAM_END - 2, destination, 1, RAM_COPY_CONTROL);
	runNextDmaService(fixture);

	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), RAM_END - 2);
	assert.equal(memory.readMappedU32LE(destination), 0);
	assert.equal(memory.readIoU32(IO_DMA_READ_ADDR), RAM_END + 2);
	assert.equal(memory.readIoU32(IO_DMA_WRITE_ADDR), destination + 4);
	assert.equal(memory.readIoU32(IO_DMA_TRANSFER_COUNT), 0);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
});

test('self-DMA register writes take effect before channel address and count writeback', () => {
	const fixture = createDmaGpuFixture();
	const { memory, scheduler } = fixture;
	const source = PROGRAM_STATIC_RAM_BASE + 0x700;
	const runningControl = DMA_CONTROL_READ_INCREMENT | DMA_CONTROL_REQUEST_FORCE;
	memory.writeMappedU32LE(source, DMA_CONTROL_REQUEST_DISABLED);
	memory.writeMappedU32LE(source + 4, runningControl);

	programTransfer(memory, source, IO_DMA_CONTROL, 2, runningControl);
	runNextDmaService(fixture);
	assert.equal(memory.readIoU32(IO_DMA_CONTROL), DMA_CONTROL_REQUEST_DISABLED);
	assert.equal(memory.readIoU32(IO_DMA_READ_ADDR), source + 4);
	assert.equal(memory.readIoU32(IO_DMA_TRANSFER_COUNT), 1);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);

	memory.writeMappedU32LE(IO_DMA_CONTROL, runningControl);
	runNextDmaService(fixture);
	assert.equal(memory.readIoU32(IO_DMA_TRANSFER_COUNT), 0);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
});

test('a zero-count trigger completes synchronously', () => {
	const { memory } = createDmaGpuFixture();
	programTransfer(memory, 0, 0, 0, DMA_CONTROL_REQUEST_DISABLED);
	assert.equal(memory.readIoU32(IO_DMA_TRIGGER), 0);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA_DONE, IRQ_DMA_DONE);
});
