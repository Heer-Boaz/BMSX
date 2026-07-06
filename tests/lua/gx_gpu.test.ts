import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IO_GX_GPU_GP0, IO_GX_GPU_GP1 } from '../../machine/ts/machine/bus/io';
import {
	GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
	GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU,
	GX_GPU_DISPLAY_START_MASK,
	GX_GPU_DRAWING_AREA_MASK,
	GX_GPU_DRAWING_OFFSET_MASK,
	GX_GPU_DRAW_MODE_GPUSTAT_MASK,
	GX_GPU_DRAW_MODE_MASK,
	GX_GPU_DRAW_MODE_TEXTURE_DISABLE,
	GX_GPU_GP0_IRQ_REQUEST,
	GX_GPU_GP0_SET_DRAWING_AREA_BOTTOM_RIGHT,
	GX_GPU_GP0_SET_DRAWING_AREA_TOP_LEFT,
	GX_GPU_GP0_SET_DRAWING_OFFSET,
	GX_GPU_GP0_SET_DRAW_MODE,
	GX_GPU_GP0_SET_MASK_BIT,
	GX_GPU_GP0_SET_TEXTURE_WINDOW,
	GX_GPU_GP1_RESET,
	GX_GPU_GP1_ACK_INTERRUPT,
	GX_GPU_GP1_GET_GPU_INFO,
	GX_GPU_GP1_SET_DISPLAY_DISABLE,
	GX_GPU_GP1_SET_DISPLAY_START,
	GX_GPU_GP1_SET_DMA_DIRECTION,
	GX_GPU_GP1_SET_DISPLAY_MODE,
	GX_GPU_GP1_SET_HORIZONTAL_DISPLAY_RANGE,
	GX_GPU_GP1_SET_TEXTURE_DISABLE_MASK,
	GX_GPU_GP1_SET_VERTICAL_DISPLAY_RANGE,
	GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK,
	GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24,
	GX_GPU_STATUS_DISPLAY_DISABLE,
	GX_GPU_STATUS_DMA_DATA_REQUEST,
	GX_GPU_STATUS_DMA_DIRECTION_MASK,
	GX_GPU_STATUS_DMA_DIRECTION_SHIFT,
	GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2,
	GX_GPU_STATUS_INTERRUPT_REQUEST,
	GX_GPU_STATUS_PAL_MODE,
	GX_GPU_STATUS_READY_TO_RECEIVE_DMA,
	GX_GPU_STATUS_RESET_WORD,
	GX_GPU_STATUS_REVERSE_FLAG,
	GX_GPU_STATUS_VERTICAL_INTERLACE,
	GX_GPU_STATUS_VERTICAL_RESOLUTION,
	GX_GPU_STATUS_TEXTURE_DISABLE,
	GX_GPU_TEXTURE_WINDOW_MASK,
	GX_GPU_VERTICAL_DISPLAY_RANGE_MASK,
	GxGpu,
} from '../../machine/ts/machine/devices/gx/gpu';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PSX_GPU_DISPLAY_MODE_PAL_WORD } from '../../machine/ts/machine/model_registry';

function createGpu(): { memory: Memory; gpu: GxGpu } {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const gpu = new GxGpu(memory);
	gpu.reset();
	return { memory, gpu };
}

test('GX-GPU exposes PSX GP1 display mode instead of a VDP profile register', () => {
	const { gpu } = createGpu();

	assert.equal(gpu.readDisplayModeWord(), PSX_GPU_DISPLAY_MODE_PAL_WORD);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, GX_GPU_STATUS_PAL_MODE);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_RESET_WORD) >>> 0, GX_GPU_STATUS_RESET_WORD);

	assert.equal(gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x00000000), GX_GPU_GP1_SET_DISPLAY_MODE);

	assert.equal(gpu.readDisplayModeWord(), 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);
});

test('GX-GPU GP1 reset restores PAL display status', () => {
	const { gpu } = createGpu();

	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x00000000);
	assert.equal(gpu.readDisplayModeWord(), 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);

	assert.equal(gpu.writeGp1(GX_GPU_GP1_RESET << 24), GX_GPU_GP1_RESET);

	assert.equal(gpu.readDisplayModeWord(), PSX_GPU_DISPLAY_MODE_PAL_WORD);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, GX_GPU_STATUS_PAL_MODE);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_RESET_WORD) >>> 0, GX_GPU_STATUS_RESET_WORD);
});

test('GX-GPU mirrors PSX GP1 display mode fields into GPUSTAT bits', () => {
	const { gpu } = createGpu();

	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x000000ff);

	assert.equal(
		(gpu.readStatus() & (
			GX_GPU_STATUS_REVERSE_FLAG
			| GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2
			| GX_GPU_STATUS_VERTICAL_RESOLUTION
			| GX_GPU_STATUS_PAL_MODE
			| GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24
			| GX_GPU_STATUS_VERTICAL_INTERLACE
		)) >>> 0,
		(
			GX_GPU_STATUS_REVERSE_FLAG
			| GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2
			| GX_GPU_STATUS_VERTICAL_RESOLUTION
			| GX_GPU_STATUS_PAL_MODE
			| GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24
			| GX_GPU_STATUS_VERTICAL_INTERLACE
		) >>> 0,
	);
	assert.equal((gpu.readStatus() & (0x3 << 17)) >>> 0, 0x3 << 17);
});

test('GX-GPU handles PSX GP1 display disable and DMA direction status bits', () => {
	const { gpu } = createGpu();

	gpu.writeGp1(GX_GPU_GP1_SET_DISPLAY_DISABLE << 24);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0, 0);

	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_DISABLE << 24) | 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0, GX_GPU_STATUS_DISPLAY_DISABLE);

	gpu.writeGp1((GX_GPU_GP1_SET_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DIRECTION_MASK) >>> 0, GX_GPU_DMA_DIRECTION_CPU_TO_GP0 << GX_GPU_STATUS_DMA_DIRECTION_SHIFT);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, GX_GPU_STATUS_DMA_DATA_REQUEST);

	gpu.writeGp1((GX_GPU_GP1_SET_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DIRECTION_MASK) >>> 0, GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU << GX_GPU_STATUS_DMA_DIRECTION_SHIFT);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, 0);
});

test('GX-GPU latches PSX GP1 CRTC range registers as masked raw words', () => {
	const { gpu } = createGpu();

	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_START << 24) | 0x00ffffff);
	gpu.writeGp1((GX_GPU_GP1_SET_HORIZONTAL_DISPLAY_RANGE << 24) | 0x00ffffff);
	gpu.writeGp1((GX_GPU_GP1_SET_VERTICAL_DISPLAY_RANGE << 24) | 0x00ffffff);
	gpu.writeGp1((GX_GPU_GP1_SET_TEXTURE_DISABLE_MASK << 24) | 0x00ffffff);

	assert.equal(gpu.readDisplayStartWord(), GX_GPU_DISPLAY_START_MASK);
	assert.equal(gpu.readHorizontalDisplayRangeWord(), GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readVerticalDisplayRangeWord(), GX_GPU_VERTICAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readTextureDisableMaskWord(), 1);
});

test('GX-GPU handles PSX GP0 IRQ request and GP1 interrupt acknowledge', () => {
	const { gpu } = createGpu();

	gpu.writeGp0(GX_GPU_GP0_IRQ_REQUEST << 24);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_INTERRUPT_REQUEST) >>> 0, GX_GPU_STATUS_INTERRUPT_REQUEST);

	gpu.writeGp1(GX_GPU_GP1_ACK_INTERRUPT << 24);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_INTERRUPT_REQUEST) >>> 0, 0);
});

test('GX-GPU handles PSX GP0 draw mode and mask-bit environment commands', () => {
	const { gpu } = createGpu();

	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x00ffffff);

	assert.equal(gpu.readDrawModeWord(), GX_GPU_DRAW_MODE_MASK);
	assert.equal((gpu.readStatus() & GX_GPU_DRAW_MODE_GPUSTAT_MASK) >>> 0, GX_GPU_DRAW_MODE_GPUSTAT_MASK);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_DISABLE) >>> 0, 0);

	gpu.writeGp1((GX_GPU_GP1_SET_TEXTURE_DISABLE_MASK << 24) | 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_DISABLE) >>> 0, GX_GPU_STATUS_TEXTURE_DISABLE);

	gpu.writeGp0((GX_GPU_GP0_SET_MASK_BIT << 24) | 0x00000003);
	assert.equal(gpu.readMaskBitModeWord(), 3);
	assert.equal((gpu.readStatus() & ((1 << 11) | (1 << 12))) >>> 0, (3 << 11) >>> 0);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_DISABLE) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_DISABLE);
});

test('GX-GPU handles PSX GP0 environment registers and GP1 GPU-info queries', () => {
	const { memory, gpu } = createGpu();

	gpu.writeGp0((GX_GPU_GP0_SET_TEXTURE_WINDOW << 24) | 0x00ffffff);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAWING_AREA_TOP_LEFT << 24) | 0x00ffffff);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAWING_AREA_BOTTOM_RIGHT << 24) | 0x00abcdef);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAWING_OFFSET << 24) | 0x00ffffff);

	assert.equal(gpu.readTextureWindowWord(), GX_GPU_TEXTURE_WINDOW_MASK);
	assert.equal(gpu.readDrawingAreaTopLeftWord(), GX_GPU_DRAWING_AREA_MASK);
	assert.equal(gpu.readDrawingAreaBottomRightWord(), 0x00abcdef & GX_GPU_DRAWING_AREA_MASK);
	assert.equal(gpu.readDrawingOffsetWord(), GX_GPU_DRAWING_OFFSET_MASK);

	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x02);
	assert.equal(gpu.readGpuReadWord(), GX_GPU_TEXTURE_WINDOW_MASK);
	assert.equal(memory.readMappedU32LE(IO_GX_GPU_GP0), GX_GPU_TEXTURE_WINDOW_MASK);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x03);
	assert.equal(gpu.readGpuReadWord(), GX_GPU_DRAWING_AREA_MASK);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x04);
	assert.equal(gpu.readGpuReadWord(), 0x00abcdef & GX_GPU_DRAWING_AREA_MASK);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x05);
	assert.equal(gpu.readGpuReadWord(), GX_GPU_DRAWING_OFFSET_MASK);
});

test('GX-GPU MMIO uses PSX GP0 data and GP1 status addresses', () => {
	const { memory } = createGpu();

	memory.writeMappedU32LE(IO_GX_GPU_GP0, 0x12345678);
	memory.writeMappedU32LE(IO_GX_GPU_GP1, (GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x00000000);

	assert.equal(memory.readMappedU32LE(IO_GX_GPU_GP0), 0x00000400);
	assert.equal((memory.readMappedU32LE(IO_GX_GPU_GP1) & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	assert.equal((memory.readMappedU32LE(IO_GX_GPU_GP1) & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);
});
