import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	DMA_CTRL_START,
	DMA_CTRL_STRICT,
	DMA_STATUS_BUSY,
	DMA_STATUS_CLIPPED,
	DMA_STATUS_DONE,
	DMA_STATUS_ERROR,
	IO_DMA_CTRL,
	IO_DMA_DST,
	IO_DMA_LEN,
	IO_DMA_SRC,
	IO_DMA_STATUS,
	IO_DMA_WRITTEN,
	IO_GX_GPU_GP0,
	IO_IRQ_FLAGS,
	IRQ_DMA_DONE,
	IRQ_DMA_ERROR,
} from '../../machine/ts/machine/bus/io';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { DMA_JOB_QUEUE_CAPACITY, DmaController } from '../../machine/ts/machine/devices/dma/controller';
import {
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_GP0_CPU_TO_VRAM_FIRST,
	GX_GPU_GP0_FILL_RECTANGLE,
	GX_GPU_GP0_DRAW_MODE,
	GX_GPU_GP0_MASK_BIT,
	GX_GPU_GP0_VRAM_TO_CPU_FIRST,
	GX_GPU_STATUS_READY_TO_SEND_VRAM,
	GxGpu,
} from '../../machine/ts/machine/devices/gx/gpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PROGRAM_STATIC_RAM_BASE } from '../../machine/ts/machine/memory/map';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';

type DmaGpuFixture = {
	memory: Memory;
	dma: DmaController;
	gpu: GxGpu;
	scheduler: DeviceScheduler;
};

function createDmaGpuFixture(): DmaGpuFixture {
	const memory = new Memory({ systemRom: new Uint8Array(), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const scheduler = new DeviceScheduler(cpu);
	const irq = new IrqController(memory);
	const dma = new DmaController(memory, cpu, irq, scheduler);
	const gpu = new GxGpu(memory, irq, scheduler, dma);
	dma.reset();
	gpu.reset();
	irq.reset();
	dma.setTiming(1, 64, 0);
	return { memory, dma, gpu, scheduler };
}

test('DMA streams RAM words into the GX-GPU GP0 command port', () => {
	const { memory, dma, gpu } = createDmaGpuFixture();
	const source = PROGRAM_STATIC_RAM_BASE + 0x100;
	const command0 = (GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000003f;
	const command1 = 0x00020010;
	const command2 = 0x00030020;

	memory.writeMappedU32LE(source, command0);
	memory.writeMappedU32LE(source + 4, command1);
	memory.writeMappedU32LE(source + 8, command2);
	memory.writeMappedU32LE(IO_DMA_SRC, source);
	memory.writeMappedU32LE(IO_DMA_DST, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA_LEN, 12);
	memory.writeMappedU32LE(IO_DMA_CTRL, DMA_CTRL_START);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), false);
	dma.accrueCycles(12, 12);
	dma.onService(12);

	const commands = gpu.readDeviceOutput().commandBuffer;
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 12);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA_DONE) >>> 0, IRQ_DMA_DONE);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), true);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_FILL_RECTANGLE);
	assert.equal(commands.commandWordCount[0], 3);
	assert.equal(commands.words[commands.commandWordStart[0]], command0 >>> 0);
	assert.equal(commands.words[commands.commandWordStart[0] + 1], command1);
	assert.equal(commands.words[commands.commandWordStart[0] + 2], command2);
});

test('DMA admits one GP0 FIFO block and resumes the suffix on the GPU ready edge', () => {
	const { memory, dma, gpu, scheduler } = createDmaGpuFixture();
	const source = PROGRAM_STATIC_RAM_BASE + 0x140;
	dma.setTiming(1, 80, 0);
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000003f);
	gpu.writeGp0(0);
	gpu.writeGp0((0x1ff << 16) | 0x3ff);
	const fillDeadline = scheduler.nextDeadline();
	for (let index = 0; index < 20; index += 1) {
		memory.writeMappedU32LE(source + index * 4, ((GX_GPU_GP0_DRAW_MODE << 24) | index) >>> 0);
	}
	memory.writeMappedU32LE(IO_DMA_SRC, source);
	memory.writeMappedU32LE(IO_DMA_DST, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA_LEN, 80);
	memory.writeMappedU32LE(IO_DMA_CTRL, DMA_CTRL_START);
	dma.accrueCycles(80, 1);
	dma.onService(1);

	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 64);
	assert.equal(scheduler.nextDeadline(), fillDeadline);

	scheduler.advanceTo(fillDeadline + 15);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), false);
	assert.equal(scheduler.nextDeadline(), fillDeadline + 15);
	dma.onService(fillDeadline + 15);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 80);
});

test('DMA preserves GP0 CPU-to-VRAM packet assembly across service slices', () => {
	const { memory, dma, gpu } = createDmaGpuFixture();
	const source = PROGRAM_STATIC_RAM_BASE + 0x1c0;
	const command0 = (GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24) >>> 0;
	const command1 = 0x00020010;
	const command2 = 0x00020003;
	const payload0 = 0x22221111;
	const payload1 = 0x44443333;
	const payload2 = 0x66665555;

	dma.setTiming(1, 8, 0);
	memory.writeMappedU32LE(source, command0);
	memory.writeMappedU32LE(source + 4, command1);
	memory.writeMappedU32LE(source + 8, command2);
	memory.writeMappedU32LE(source + 12, payload0);
	memory.writeMappedU32LE(source + 16, payload1);
	memory.writeMappedU32LE(source + 20, payload2);
	memory.writeMappedU32LE(IO_DMA_SRC, source);
	memory.writeMappedU32LE(IO_DMA_DST, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA_LEN, 24);
	memory.writeMappedU32LE(IO_DMA_CTRL, DMA_CTRL_START);

	const commands = gpu.readDeviceOutput().commandBuffer;
	dma.accrueCycles(1, 1);
	dma.onService(1);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 8);
	assert.equal(commands.commandCount, 0);
	const savedDma = dma.captureState();

	dma.accrueCycles(1, 2);
	dma.onService(2);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 16);
	assert.equal(commands.commandCount, 0);
	assert.equal(commands.wordCount, 4);

	dma.accrueCycles(1, 3);
	dma.onService(3);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 24);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA_DONE) >>> 0, IRQ_DMA_DONE);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.commandWordCount[0], 6);
	const wordStart = commands.commandWordStart[0];
	assert.equal(commands.words[wordStart], command0);
	assert.equal(commands.words[wordStart + 1], command1);
	assert.equal(commands.words[wordStart + 2], command2);
	assert.equal(commands.words[wordStart + 3], payload0);
	assert.equal(commands.words[wordStart + 4], payload1);
	assert.equal(commands.words[wordStart + 5], payload2);

	dma.restoreState(savedDma, 3);
	assert.equal(memory.readIoU32(IO_DMA_SRC), source);
	assert.equal(memory.readIoU32(IO_DMA_DST), IO_GX_GPU_GP0);
	assert.equal(memory.readIoU32(IO_DMA_LEN), 24);
	assert.equal(memory.readIoU32(IO_DMA_CTRL), 0);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 8);
});

test('DMA consumes GPUREAD words into RAM only while the readback ready line is asserted', () => {
	const { memory, dma, gpu, scheduler } = createDmaGpuFixture();
	const destination = PROGRAM_STATIC_RAM_BASE + 0x300;
	const sentinel = 0xa5a5a5a5;
	memory.writeMappedU32LE(destination, sentinel);
	memory.writeMappedU32LE(destination + 4, sentinel);
	memory.writeMappedU32LE(destination + 8, sentinel);

	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 3);
	memory.writeMappedU32LE(IO_DMA_SRC, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA_DST, destination);
	memory.writeMappedU32LE(IO_DMA_LEN, 12);
	memory.writeMappedU32LE(IO_DMA_CTRL, DMA_CTRL_START);
	dma.accrueCycles(12, 12);
	dma.onService(12);
	scheduler.advanceTo(1);
	gpu.onService(1);

	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 0);
	assert.equal(memory.readMappedU32LE(destination), sentinel);
	assert.equal(memory.readMappedU32LE(destination + 4), sentinel);
	assert.equal(memory.readMappedU32LE(destination + 8), sentinel);

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
	scheduler.advanceTo(12);
	readback.completeReadback(readback.token);
	assert.equal(gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM, GX_GPU_STATUS_READY_TO_SEND_VRAM);
	assert.equal(scheduler.nextDeadline(), 12);
	const readyDmaState = dma.captureState();
	const readyGpuState = gpu.captureState();
	dma.onService(12);

	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 8);
	assert.equal(memory.readMappedU32LE(destination), 0x22221111);
	assert.equal(memory.readMappedU32LE(destination + 4), 0x00003333);
	assert.equal(memory.readMappedU32LE(destination + 8), sentinel);
	assert.equal(gpu.readGpuReadWord(), 0x00003333);
	assert.equal(gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM, 0);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	dma.restoreState(readyDmaState, 12);
	gpu.restoreState(readyGpuState);
	assert.equal(gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM, GX_GPU_STATUS_READY_TO_SEND_VRAM);
	assert.equal(scheduler.nextDeadline(), 12);
	dma.onService(12);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 8);
	assert.equal(memory.readMappedU32LE(destination + 8), sentinel);
	const stalled = dma.captureState().queue[0]!;
	assert.equal(stalled.src, IO_GX_GPU_GP0);
	assert.equal(stalled.dst, destination + 8);
	assert.equal(stalled.remaining, 4);
	assert.equal(stalled.written, 8);

	gpu.retirePresentedCommands();
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 2);
	scheduler.advanceTo(13);
	gpu.onService(13);
	gpu.presentReadyFrameOnVblankEdge();
	output = gpu.readDeviceOutput();
	readback = output.readbackPort;
	readback.pixelBytes[0] = 0x55;
	readback.pixelBytes[1] = 0x55;
	readback.pixelBytes[2] = 0x66;
	readback.pixelBytes[3] = 0x66;
	assert.equal(readback.claimReadback(output.commandBuffer.presentCommandCount), true);
	scheduler.advanceTo(13);
	readback.completeReadback(readback.token);
	assert.equal(scheduler.nextDeadline(), 13);
	dma.onService(13);

	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 12);
	assert.equal(memory.readMappedU32LE(destination + 8), 0x66665555);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA_DONE) >>> 0, IRQ_DMA_DONE);
});

test('DMA applies GP0 word-length clipping to GPUREAD sources before waiting', () => {
	const { memory, dma } = createDmaGpuFixture();
	const destination = PROGRAM_STATIC_RAM_BASE + 0x380;
	memory.writeMappedU32LE(IO_DMA_SRC, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA_DST, destination);
	memory.writeMappedU32LE(IO_DMA_LEN, 6);
	memory.writeMappedU32LE(IO_DMA_CTRL, DMA_CTRL_START);

	const state = dma.captureState();
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_BUSY | DMA_STATUS_CLIPPED);
	assert.equal(state.queue.length, 1);
	assert.equal(state.queue[0]!.remaining, 4);
});

test('DMA strict mode rejects a non-word GPUREAD source length before consuming the port', () => {
	const { memory, dma } = createDmaGpuFixture();
	const destination = PROGRAM_STATIC_RAM_BASE + 0x3c0;
	memory.writeMappedU32LE(IO_DMA_SRC, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA_DST, destination);
	memory.writeMappedU32LE(IO_DMA_LEN, 6);
	memory.writeMappedU32LE(IO_DMA_CTRL, DMA_CTRL_START | DMA_CTRL_STRICT);

	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE | DMA_STATUS_ERROR | DMA_STATUS_CLIPPED);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 0);
	assert.equal(dma.captureState().queue.length, 0);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA_ERROR) >>> 0, IRQ_DMA_ERROR);
});

test('DMA full-FIFO rejection preserves the queued progress latch', () => {
	const { memory, dma } = createDmaGpuFixture();
	const source = PROGRAM_STATIC_RAM_BASE + 0x240;
	const queue = Array.from({ length: DMA_JOB_QUEUE_CAPACITY }, (_, index) => ({
		src: source + index * 4,
		dst: IO_GX_GPU_GP0,
		remaining: 4,
		written: 0,
		clipped: false,
	}));
	dma.restoreState({
		queue,
		budget: 0,
		carry: 0,
		writtenValue: 37,
		writtenDirty: false,
		sourceRegisterWord: source,
		destinationRegisterWord: IO_GX_GPU_GP0,
		lengthRegisterWord: 4,
		controlRegisterWord: 0,
		statusRegisterWord: DMA_STATUS_BUSY,
		writtenRegisterWord: 37,
	}, 0);

	memory.writeMappedU32LE(IO_DMA_SRC, source);
	memory.writeMappedU32LE(IO_DMA_DST, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA_LEN, 4);
	memory.writeMappedU32LE(IO_DMA_CTRL, DMA_CTRL_START);

	const state = dma.captureState();
	assert.equal(state.queue.length, DMA_JOB_QUEUE_CAPACITY);
	assert.equal(state.writtenValue, 37);
	assert.equal(state.writtenDirty, false);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE | DMA_STATUS_ERROR);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 0);
});

test('DMA clips non-strict GX-GPU GP0 stream lengths to whole words', () => {
	const { memory, dma, gpu } = createDmaGpuFixture();
	const source = PROGRAM_STATIC_RAM_BASE + 0x140;

	memory.writeMappedU32LE(source, (GX_GPU_GP0_DRAW_MODE << 24) | 0x000123);
	memory.writeMappedU32LE(source + 4, (GX_GPU_GP0_MASK_BIT << 24) | 0x000003);
	memory.writeMappedU32LE(IO_DMA_SRC, source);
	memory.writeMappedU32LE(IO_DMA_DST, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA_LEN, 6);
	memory.writeMappedU32LE(IO_DMA_CTRL, DMA_CTRL_START);
	dma.accrueCycles(6, 6);
	dma.onService(6);

	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE | DMA_STATUS_CLIPPED);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 4);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA_DONE) >>> 0, IRQ_DMA_DONE);
	assert.equal(gpu.readDrawModeWord(), 0x000123);
	assert.equal(gpu.readMaskBitModeWord(), 0);
});

test('DMA strict mode rejects non-word GX-GPU GP0 stream lengths before issuing GP0 writes', () => {
	const { memory, gpu } = createDmaGpuFixture();
	const source = PROGRAM_STATIC_RAM_BASE + 0x180;

	memory.writeMappedU32LE(source, (GX_GPU_GP0_DRAW_MODE << 24) | 0x000456);
	memory.writeMappedU32LE(IO_DMA_SRC, source);
	memory.writeMappedU32LE(IO_DMA_DST, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA_LEN, 6);
	memory.writeMappedU32LE(IO_DMA_CTRL, DMA_CTRL_START | DMA_CTRL_STRICT);

	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE | DMA_STATUS_ERROR | DMA_STATUS_CLIPPED);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 0);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA_ERROR) >>> 0, IRQ_DMA_ERROR);
	assert.equal(gpu.readDrawModeWord(), 0);
});
