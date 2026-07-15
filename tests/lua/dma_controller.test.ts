import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	BUS_FAULT_UNMAPPED,
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
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { GX_GPU_COMMAND_FILL_RECTANGLE } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
	GX_GPU_DMA_DIRECTION_FIFO,
	GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU,
	GX_GPU_DMA_DIRECTION_OFF,
	GX_GPU_GP0_FILL_RECTANGLE,
	GX_GPU_GP0_VRAM_TO_CPU_FIRST,
	GX_GPU_GP1_DMA_DIRECTION,
	GxGpu,
} from '../../machine/ts/machine/devices/gx/gpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PROGRAM_STATIC_RAM_BASE, RAM_END } from '../../machine/ts/machine/memory/map';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';

type DmaGpuFixture = {
	memory: Memory;
	dma: DmaController;
	gpu: GxGpu;
	scheduler: DeviceScheduler;
};

const RAM_COPY_CONTROL = DMA_CONTROL_READ_INCREMENT
	| DMA_CONTROL_WRITE_INCREMENT
	| DMA_CONTROL_REQUEST_FORCE;
const GP0_WRITE_CONTROL = DMA_CONTROL_READ_INCREMENT | DMA_CONTROL_REQUEST_GX_WRITE;
const GP0_READ_CONTROL = DMA_CONTROL_WRITE_INCREMENT | DMA_CONTROL_REQUEST_GX_READ;

function createDmaGpuFixture(): DmaGpuFixture {
	const memory = new Memory({ systemRom: new Uint8Array(), cartRom: new Uint8Array() });
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq);
	const scheduler = new DeviceScheduler(cpu);
	const dma = new DmaController(memory, cpu, irq, scheduler);
	const gpu = new GxGpu(memory, irq, scheduler, dma);
	dma.reset();
	gpu.reset();
	irq.reset();
	dma.setTiming(1, 16, 0);
	return { memory, dma, gpu, scheduler };
}

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

test('a deasserted DREQ discards its pending grant and rearms from the new edge', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, gpu, scheduler } = fixture;
	const source = PROGRAM_STATIC_RAM_BASE + 0x400;
	memory.writeMappedU32LE(source, 0xe1000000);
	memory.writeMappedU32LE(source + 4, 0xe1000001);
	dma.setTiming(4, 1, 0);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	programTransfer(memory, source, IO_GX_GPU_GP0, 2, GP0_WRITE_CONTROL);
	assert.equal(scheduler.nextDeadline(), 8);

	scheduler.advanceTo(3);
	dma.setTiming(4, 1, 3);
	assert.equal(scheduler.nextDeadline(), 8);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_OFF);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	assert.equal(scheduler.nextDeadline(), 11);

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
	scheduler.advanceTo(3);
	gpu.onService(3);
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
