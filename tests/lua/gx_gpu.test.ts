import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IO_GX_GPU_GP0, IO_GX_GPU_GP1 } from '../../machine/ts/machine/bus/io';
import {
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_TEXTURE_MODE_DIRECT16,
	gxGpuCommandRawTextureEnabled,
	gxGpuCommandSemiTransparencyEnabled,
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuDisplayStartX,
	gxGpuDisplayStartY,
	gxGpuDitheredPolygon,
	gxGpuDrawModeDitherEnabled,
	gxGpuDrawModeTexturePageYBit9,
	gxGpuDrawModeTextureRectangleXFlip,
	gxGpuDrawModeTextureRectangleYFlip,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuDrawingAreaX,
	gxGpuDrawingAreaY,
	gxGpuDrawModeTextureMode,
	gxGpuDrawModeTransparencyMode,
	gxGpuDrawModeTexturePageBaseX,
	gxGpuDrawModeTexturePageBaseY,
	gxGpuDrawingOffsetY,
	gxGpuFillHeight,
	gxGpuFillWidth,
	gxGpuFillX,
	gxGpuMaskBitCheckBeforeDraw,
	gxGpuMaskBitSetWhileDrawing,
	gxGpuPolygonDrawModeWord,
	gxGpuPolygonTexturePageWordIndex,
	gxGpuSigned11,
	gxGpuTextureAttribute,
	gxGpuTextureClutBaseX,
	gxGpuTextureClutBaseY,
	gxGpuTextureRectangleEdge0,
	gxGpuTextureRectangleEdge1,
	gxGpuTextureU,
	gxGpuTextureV,
	gxGpuTextureWindowAndX,
	gxGpuTextureWindowAndY,
	gxGpuTextureWindowOrX,
	gxGpuTextureWindowOrY,
	gxGpuTransferHeight,
	gxGpuTransferPixelWord,
	gxGpuTransferWidth,
	gxGpuTransferX,
	gxGpuTransferY,
	gxGpuVertexX,
	gxGpuVertexY,
	gxGpuVramWrappedHeight,
	gxGpuVramWrappedWidth,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
	GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU,
	GX_GPU_DISPLAY_START_MASK,
	GX_GPU_DRAWING_AREA_MASK,
	GX_GPU_DRAWING_OFFSET_MASK,
	GX_GPU_DRAW_MODE_DITHER_ENABLED,
	GX_GPU_DRAW_MODE_GPUSTAT_MASK,
	GX_GPU_DRAW_MODE_MASK,
	GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_BIT9,
	GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP,
	GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP,
	GX_GPU_GP0_CPU_TO_VRAM_FIRST,
	GX_GPU_GP0_FILL_RECTANGLE,
	GX_GPU_GP0_IRQ_REQUEST,
	GX_GPU_GP0_POLYGON_FIRST,
	GX_GPU_GP0_RECTANGLE_FIRST,
	GX_GPU_GP0_RENDER_GOURAUD_BIT,
	GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT,
	GX_GPU_GP0_RENDER_TEXTURE_BIT,
	GX_GPU_GP0_SET_DRAWING_AREA_BOTTOM_RIGHT,
	GX_GPU_GP0_SET_DRAWING_AREA_TOP_LEFT,
	GX_GPU_GP0_SET_DRAWING_OFFSET,
	GX_GPU_GP0_SET_DRAW_MODE,
	GX_GPU_GP0_SET_MASK_BIT,
	GX_GPU_GP0_SET_TEXTURE_WINDOW,
	GX_GPU_GP0_VRAM_TO_VRAM_FIRST,
	GX_GPU_GP1_RESET,
	GX_GPU_GP1_CLEAR_FIFO,
	GX_GPU_GP1_ACK_INTERRUPT,
	GX_GPU_GP1_GET_GPU_INFO,
	GX_GPU_GP1_SET_DISPLAY_DISABLE,
	GX_GPU_GP1_SET_DISPLAY_START,
	GX_GPU_GP1_SET_DMA_DIRECTION,
	GX_GPU_GP1_SET_DISPLAY_MODE,
	GX_GPU_GP1_SET_HORIZONTAL_DISPLAY_RANGE,
	GX_GPU_GP1_SET_VRAM_SIZE,
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
	GX_GPU_STATUS_TEXTURE_PAGE_Y_BIT9,
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

test('GX-GPU decodes PSX GP0 signed vertex and rectangle size words', () => {
	assert.equal(gxGpuSigned11(0x000003ff), 1023);
	assert.equal(gxGpuSigned11(0x00000400), -1024);
	assert.equal(gxGpuSigned11(0x000007ff), -1);

	assert.equal(gxGpuVertexX(0x000007ff), -1);
	assert.equal(gxGpuVertexY(0x07ff0000), -1);
	assert.equal(gxGpuDisplayStartX(123 | (456 << 10)), 123);
	assert.equal(gxGpuDisplayStartY(123 | (456 << 10)), 456);
	assert.equal(gxGpuDrawingOffsetY(0x003ff800), -1);

	assert.equal(gxGpuCommandRectangleWidth(GX_GPU_GP0_RECTANGLE_FIRST, 0x012c03ff), 1023);
	assert.equal(gxGpuCommandRectangleHeight(GX_GPU_GP0_RECTANGLE_FIRST, 0x012c03ff), 300);
	assert.equal(gxGpuCommandRectangleWidth(GX_GPU_GP0_RECTANGLE_FIRST | 0x08, 0), 1);
	assert.equal(gxGpuCommandRectangleHeight(GX_GPU_GP0_RECTANGLE_FIRST | 0x08, 0), 1);
	assert.equal(gxGpuCommandRectangleWidth(GX_GPU_GP0_RECTANGLE_FIRST | 0x10, 0), 8);
	assert.equal(gxGpuCommandRectangleHeight(GX_GPU_GP0_RECTANGLE_FIRST | 0x10, 0), 8);
	assert.equal(gxGpuCommandRectangleWidth(GX_GPU_GP0_RECTANGLE_FIRST | 0x18, 0), 16);
	assert.equal(gxGpuCommandRectangleHeight(GX_GPU_GP0_RECTANGLE_FIRST | 0x18, 0), 16);
	assert.equal(gxGpuFillX(0x01ff03ff), 0x03f0);
	assert.equal(gxGpuFillWidth(0), 0);
	assert.equal(gxGpuFillHeight(0), 0);
	assert.equal(gxGpuFillWidth(1), 16);
	assert.equal(gxGpuFillWidth(0x03f0), 1008);
	assert.equal(gxGpuFillWidth(0x03f1), 1024);
	assert.equal(gxGpuFillHeight(0x01ff0000), 511);
	assert.equal(gxGpuVramWrappedWidth(1000, 12), 12);
	assert.equal(gxGpuVramWrappedWidth(1008, 1024), 16);
	assert.equal(gxGpuVramWrappedWidth(0, 1008), 1008);
	assert.equal(gxGpuVramWrappedHeight(500, 12), 12);
	assert.equal(gxGpuVramWrappedHeight(511, 511), 1);
	assert.equal(gxGpuVramWrappedHeight(0, 511), 511);

	assert.equal(gxGpuTransferX(0x01ff03ff), 1023);
	assert.equal(gxGpuTransferY(0x01ff03ff), 511);
	assert.equal(gxGpuTransferWidth(0), 1024);
	assert.equal(gxGpuTransferHeight(0), 512);
	assert.equal(gxGpuTransferWidth(0x012c0007), 7);
	assert.equal(gxGpuTransferHeight(0x012c0007), 300);
	assert.equal(gxGpuTransferPixelWord(0x89abcdef, 0), 0xcdef);
	assert.equal(gxGpuTransferPixelWord(0x89abcdef, 1), 0x89ab);

	assert.equal(gxGpuCommandRawTextureEnabled(0x25), true);
	assert.equal(gxGpuCommandRawTextureEnabled(0x24), false);
	assert.equal(gxGpuCommandSemiTransparencyEnabled(0x22), true);
	assert.equal(gxGpuCommandSemiTransparencyEnabled(0x20), false);
	assert.equal(gxGpuDrawModeTexturePageYBit9(GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_BIT9), 512);
	assert.equal(gxGpuDrawModeDitherEnabled(GX_GPU_DRAW_MODE_DITHER_ENABLED), true);
	assert.equal(gxGpuDrawModeDitherEnabled(0), false);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_GOURAUD_BIT), true);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED, GX_GPU_GP0_POLYGON_FIRST), false);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT), true);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01), false);
	assert.equal(gxGpuDitheredPolygon(0, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_GOURAUD_BIT), false);
	assert.equal(gxGpuDrawModeTextureRectangleXFlip(GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP), true);
	assert.equal(gxGpuDrawModeTextureRectangleXFlip(GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP), false);
	assert.equal(gxGpuDrawModeTextureRectangleYFlip(GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP), true);
	assert.equal(gxGpuDrawModeTextureRectangleYFlip(GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP), false);
	assert.equal(gxGpuTextureRectangleEdge0(7, false), 7);
	assert.equal(gxGpuTextureRectangleEdge1(7, 16, false), 23);
	assert.equal(gxGpuTextureRectangleEdge0(7, true), 8);
	assert.equal(gxGpuTextureRectangleEdge1(8, 16, true), -8);
	assert.equal(gxGpuTextureRectangleEdge0(0, true), 1);
	assert.equal(gxGpuTextureRectangleEdge1(1, 16, true), -15);
	assert.equal(gxGpuTextureU(0x01c3ab56), 0x56);
	assert.equal(gxGpuTextureV(0x01c3ab56), 0xab);
	assert.equal(gxGpuTextureAttribute(0x01c3ab56), 0x01c3);
	assert.equal(gxGpuTextureClutBaseX(0x01c3ab56), 48);
	assert.equal(gxGpuTextureClutBaseY(0x01c3ab56), 7);
	assert.equal(gxGpuDrawModeTexturePageBaseX(0x0013), 192);
	assert.equal(gxGpuDrawModeTexturePageBaseY(0x0013), 256);
	assert.equal(gxGpuDrawModeTexturePageBaseY(0x0810), 768);
	assert.equal(gxGpuDrawModeTextureMode(0x0100), GX_GPU_TEXTURE_MODE_DIRECT16);
	assert.equal(gxGpuDrawModeTransparencyMode(0x0060), 3);
	assert.equal(gxGpuPolygonTexturePageWordIndex(0x24), 4);
	assert.equal(gxGpuPolygonTexturePageWordIndex(0x34), 5);
	assert.equal(gxGpuPolygonDrawModeWord(0x1fff, 0x0000), 0x1600);
	assert.equal(gxGpuPolygonDrawModeWord(0x0000, 0x0183), 0x0183);
	const textureWindowWord = 0x00010000 | 0x00000c00 | 0x00000060 | 0x00000002;
	assert.equal(gxGpuTextureWindowAndX(textureWindowWord), 239);
	assert.equal(gxGpuTextureWindowAndY(textureWindowWord), 231);
	assert.equal(gxGpuTextureWindowOrX(textureWindowWord), 16);
	assert.equal(gxGpuTextureWindowOrY(textureWindowWord), 16);
	assert.equal(gxGpuMaskBitSetWhileDrawing(0x03), true);
	assert.equal(gxGpuMaskBitSetWhileDrawing(0x02), false);
	assert.equal(gxGpuMaskBitCheckBeforeDraw(0x03), true);
	assert.equal(gxGpuMaskBitCheckBeforeDraw(0x01), false);

	assert.equal(gxGpuDrawingAreaX(12 | (34 << 10)), 12);
	assert.equal(gxGpuDrawingAreaY(12 | (34 << 10)), 34);
	assert.equal(gxGpuDrawingAreaLeft(12 | (34 << 10), 20 | (40 << 10)), 12);
	assert.equal(gxGpuDrawingAreaTop(12 | (34 << 10), 20 | (40 << 10)), 34);
	assert.equal(gxGpuDrawingAreaRightExclusive(12 | (34 << 10), 20 | (40 << 10)), 21);
	assert.equal(gxGpuDrawingAreaBottomExclusive(12 | (34 << 10), 20 | (40 << 10)), 41);
	assert.equal(gxGpuDrawingAreaLeft(20 | (34 << 10), 12 | (40 << 10)), 0);
	assert.equal(gxGpuDrawingAreaRightExclusive(20 | (34 << 10), 12 | (40 << 10)), 0);
	assert.equal(gxGpuDrawingAreaTop(12 | (40 << 10), 20 | (34 << 10)), 0);
	assert.equal(gxGpuDrawingAreaBottomExclusive(12 | (40 << 10), 20 | (34 << 10)), 0);
	assert.equal(gxGpuDrawingAreaTop(12 | (600 << 10), 20 | (700 << 10)), 511);
	assert.equal(gxGpuDrawingAreaBottomExclusive(12 | (600 << 10), 20 | (700 << 10)), 512);
});

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

	gpu.writeGp1((GX_GPU_GP1_SET_VRAM_SIZE << 24) | 1);
	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x00000000);
	assert.equal(gpu.readDisplayModeWord(), 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);

	assert.equal(gpu.writeGp1(GX_GPU_GP1_RESET << 24), GX_GPU_GP1_RESET);

	assert.equal(gpu.readVramSizeWord(), 1);
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
	assert.equal((gpu.readDeviceOutput().statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0, 0);

	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_DISABLE << 24) | 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0, GX_GPU_STATUS_DISPLAY_DISABLE);
	assert.equal((gpu.readDeviceOutput().statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0, GX_GPU_STATUS_DISPLAY_DISABLE);

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
	gpu.writeGp1((GX_GPU_GP1_SET_VRAM_SIZE << 24) | 0x00ffffff);

	assert.equal(gpu.readDisplayStartWord(), GX_GPU_DISPLAY_START_MASK);
	assert.equal(gpu.readHorizontalDisplayRangeWord(), GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readVerticalDisplayRangeWord(), GX_GPU_VERTICAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readVramSizeWord(), 1);

	assert.equal(gpu.readDeviceOutput().displayModeWord, gpu.readDisplayModeWord());
	assert.equal(gpu.readDeviceOutput().statusWord, gpu.readStatus());
	assert.equal(gpu.readDeviceOutput().displayStartWord, GX_GPU_DISPLAY_START_MASK);
	assert.equal(gpu.readDeviceOutput().horizontalDisplayRangeWord, GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readDeviceOutput().verticalDisplayRangeWord, GX_GPU_VERTICAL_DISPLAY_RANGE_MASK);
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
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_PAGE_Y_BIT9) >>> 0, GX_GPU_STATUS_TEXTURE_PAGE_Y_BIT9);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_DITHER_ENABLED) >>> 0, GX_GPU_DRAW_MODE_DITHER_ENABLED);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP);

	gpu.writeGp1((GX_GPU_GP1_SET_VRAM_SIZE << 24) | 1);
	assert.equal(gpu.readVramSizeWord(), 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_PAGE_Y_BIT9) >>> 0, GX_GPU_STATUS_TEXTURE_PAGE_Y_BIT9);

	gpu.writeGp0((GX_GPU_GP0_SET_MASK_BIT << 24) | 0x00000003);
	assert.equal(gpu.readMaskBitModeWord(), 3);
	assert.equal((gpu.readStatus() & ((1 << 11) | (1 << 12))) >>> 0, (3 << 11) >>> 0);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_BIT9) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_BIT9);
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

test('GX-GPU emits PSX GP0 fixed-length render and blit packets into the GPU command buffer', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x0000ff);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x123456);
	gpu.writeGp0(0x00020003);

	assert.equal(commands.commandCount, 0);
	assert.equal(gpu.readDrawModeWord(), 0);

	gpu.writeGp0(0x00040005);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_DRAW_POLYGON);
	assert.equal(commands.commandOpcode[0], GX_GPU_GP0_POLYGON_FIRST);
	assert.equal(commands.commandWordCount[0], 4);
	assert.equal(commands.words[commands.commandWordStart[0] + 1], ((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x123456) >>> 0);
	assert.equal(gpu.readDrawModeWord(), 0);

	const texturedGouraudQuad = GX_GPU_GP0_POLYGON_FIRST
		| GX_GPU_GP0_RENDER_TEXTURE_BIT
		| GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT
		| GX_GPU_GP0_RENDER_GOURAUD_BIT;
	gpu.writeGp0(texturedGouraudQuad << 24);
	for (let index = 1; index < 12; index += 1) {
		gpu.writeGp0(index === 5 ? 0x01830055 : index === 6 ? ((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000345) : index);
	}
	assert.equal(commands.commandCount, 2);
	assert.equal(commands.commandKind[1], GX_GPU_COMMAND_DRAW_POLYGON);
	assert.equal(commands.commandOpcode[1], texturedGouraudQuad);
	assert.equal(commands.commandWordCount[1], 12);
	assert.equal(commands.commandDrawModeWord[1], 0x0183);
	assert.equal(gpu.readDrawModeWord(), 0x0183);

	gpu.writeGp0(GX_GPU_GP0_FILL_RECTANGLE << 24);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000222);
	assert.equal(commands.commandCount, 2);
	gpu.writeGp0(0x000c000d);
	assert.equal(commands.commandCount, 3);
	assert.equal(commands.commandKind[2], GX_GPU_COMMAND_FILL_RECTANGLE);
	assert.equal(commands.commandWordCount[2], 3);

	gpu.writeGp0((GX_GPU_GP0_RECTANGLE_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT) << 24);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000333);
	gpu.writeGp0(0x00030004);
	gpu.writeGp0(0x00050006);
	assert.equal(commands.commandCount, 4);
	assert.equal(commands.commandKind[3], GX_GPU_COMMAND_DRAW_RECTANGLE);
	assert.equal(commands.commandWordCount[3], 4);

	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_VRAM_FIRST << 24);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000444);
	gpu.writeGp0(0x00030004);
	gpu.writeGp0(0x00050006);
	assert.equal(commands.commandCount, 5);
	assert.equal(commands.commandKind[4], GX_GPU_COMMAND_COPY_VRAM_TO_VRAM);
	assert.equal(commands.commandWordCount[4], 4);

	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x0007ff);
	assert.equal(commands.commandCount, 5);
	assert.equal(gpu.readDrawModeWord(), 0x0007ff);

	gpu.writeGp0(0x40 << 24);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00030004);
	assert.equal(commands.commandCount, 6);
	assert.equal(commands.commandKind[5], GX_GPU_COMMAND_DRAW_LINE);
	assert.equal(commands.commandDrawModeWord[5], 0x0007ff);
});

test('GX-GPU emits PSX CPU-to-VRAM image payload words into the GPU command buffer', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00020003);
	assert.equal(commands.commandCount, 0);

	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000111);
	gpu.writeGp0((GX_GPU_GP0_SET_MASK_BIT << 24) | 0x000003);
	assert.equal(commands.commandCount, 0);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000222);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.commandOpcode[0], GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	assert.equal(commands.commandWordCount[0], 6);
	assert.equal(commands.words[commands.commandWordStart[0] + 3], ((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000111) >>> 0);
	assert.equal(commands.words[commands.commandWordStart[0] + 5], ((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000222) >>> 0);
	assert.equal(gpu.readDrawModeWord(), 0);
	assert.equal(gpu.readMaskBitModeWord(), 0);

	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x0007ff);
	assert.equal(commands.commandCount, 1);
	assert.equal(gpu.readDrawModeWord(), 0x0007ff);
});

test('GX-GPU emits PSX polyline payload into the GPU command buffer at terminator', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((0x48 << 24) | 0x0000ff);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00020003);
	assert.equal(commands.commandCount, 0);
	gpu.writeGp0(0x50005000);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_DRAW_POLYLINE);
	assert.equal(commands.commandOpcode[0], 0x48);
	assert.equal(commands.commandWordCount[0], 3);
	assert.equal(commands.words[commands.commandWordStart[0] + 1], 0x00010002);
	assert.equal(gpu.readDrawModeWord(), 0);

	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000222);
	assert.equal(commands.commandCount, 1);
	assert.equal(gpu.readDrawModeWord(), 0x000222);

	gpu.writeGp0(((0x40 | GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT | GX_GPU_GP0_RENDER_GOURAUD_BIT) << 24) | 0x0000ff);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00010000);
	gpu.writeGp0(0x00020003);
	assert.equal(commands.commandCount, 1);
	gpu.writeGp0(0x50005000);
	assert.equal(commands.commandCount, 2);
	assert.equal(commands.commandKind[1], GX_GPU_COMMAND_DRAW_POLYLINE);
	assert.equal(commands.commandOpcode[1], 0x58);
	assert.equal(commands.commandWordCount[1], 4);
	assert.equal(commands.words[commands.commandWordStart[1] + 2], 0x00010000);

	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000333);
	assert.equal(commands.commandCount, 2);
	assert.equal(gpu.readDrawModeWord(), 0x000333);
});

test('GX-GPU GP1 clear FIFO clears partial GP0 packet and image transfer state', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x0000ff);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000111);
	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	assert.equal(commands.commandCount, 0);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000222);
	assert.equal(gpu.readDrawModeWord(), 0x000222);

	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00020003);
	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	assert.equal(commands.commandCount, 0);
	gpu.writeGp0((GX_GPU_GP0_SET_MASK_BIT << 24) | 0x000003);
	assert.equal(gpu.readMaskBitModeWord(), 3);
});

test('GX-GPU MMIO uses PSX GP0 data and GP1 status addresses', () => {
	const { memory } = createGpu();

	memory.writeMappedU32LE(IO_GX_GPU_GP0, 0x12345678);
	memory.writeMappedU32LE(IO_GX_GPU_GP1, (GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x00000000);

	assert.equal(memory.readMappedU32LE(IO_GX_GPU_GP0), 0x00000400);
	assert.equal((memory.readMappedU32LE(IO_GX_GPU_GP1) & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	assert.equal((memory.readMappedU32LE(IO_GX_GPU_GP1) & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);
});
