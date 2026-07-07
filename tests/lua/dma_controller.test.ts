import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	DMA_CTRL_START,
	DMA_CTRL_STRICT,
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
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { GX_GPU_COMMAND_FILL_RECTANGLE } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_GP0_FILL_RECTANGLE,
	GX_GPU_GP0_SET_DRAW_MODE,
	GX_GPU_GP0_SET_MASK_BIT,
	GxGpu,
} from '../../machine/ts/machine/devices/gx/gpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { VDP } from '../../machine/ts/machine/devices/vdp/vdp';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PROGRAM_STATIC_RAM_BASE } from '../../machine/ts/machine/memory/map';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';

type DmaGpuFixture = {
	memory: Memory;
	dma: DmaController;
	gpu: GxGpu;
};

function createDmaGpuFixture(): DmaGpuFixture {
	const memory = new Memory({ systemRom: new Uint8Array(), cartRom: new Uint8Array(0) });
	const scheduler = new DeviceScheduler(new CPU(memory));
	const irq = new IrqController(memory);
	const vdp = new VDP(memory, scheduler, { width: 16, height: 16 });
	const dma = new DmaController(memory, irq, vdp, scheduler);
	const gpu = new GxGpu(memory, scheduler);
	dma.reset();
	gpu.reset();
	irq.reset();
	dma.setTiming(1, 64, 64, 0);
	return { memory, dma, gpu };
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
	dma.accrueCycles(12, 12);
	dma.onService(12);

	const commands = gpu.readDeviceOutput().commandBuffer;
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 12);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA_DONE) >>> 0, IRQ_DMA_DONE);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_FILL_RECTANGLE);
	assert.equal(commands.commandWordCount[0], 3);
	assert.equal(commands.words[commands.commandWordStart[0]], command0 >>> 0);
	assert.equal(commands.words[commands.commandWordStart[0] + 1], command1);
	assert.equal(commands.words[commands.commandWordStart[0] + 2], command2);
});

test('DMA clips non-strict GX-GPU GP0 stream lengths to whole words', () => {
	const { memory, dma, gpu } = createDmaGpuFixture();
	const source = PROGRAM_STATIC_RAM_BASE + 0x140;

	memory.writeMappedU32LE(source, (GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000123);
	memory.writeMappedU32LE(source + 4, (GX_GPU_GP0_SET_MASK_BIT << 24) | 0x000003);
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

	memory.writeMappedU32LE(source, (GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000456);
	memory.writeMappedU32LE(IO_DMA_SRC, source);
	memory.writeMappedU32LE(IO_DMA_DST, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA_LEN, 6);
	memory.writeMappedU32LE(IO_DMA_CTRL, DMA_CTRL_START | DMA_CTRL_STRICT);

	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE | DMA_STATUS_ERROR | DMA_STATUS_CLIPPED);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 0);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA_ERROR) >>> 0, IRQ_DMA_ERROR);
	assert.equal(gpu.readDrawModeWord(), 0);
});
