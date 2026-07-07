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
	GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB,
	GX_GPU_INTERLACED_RENDER_ENABLE,
	GX_GPU_TEXTURE_MODE_DIRECT16,
	GX_GPU_TEXTURE_MODE_PALETTE8,
	gxGpuDisplayStartY,
	gxGpuInterlacedRenderWord,
	gxGpuSkipDrawingToActiveField,
	gxGpuPolygonDrawModeWord,
	gxGpuPolygonTexturePageWordIndex,
	gxGpuTextureAttribute,
	gxGpuTransferHeight,
	gxGpuTransferWidth,
	GxGpuCommandBuffer,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import {
	gxGpuCommandDrawsTexture,
	gxGpuCommandRawTextureEnabled,
	gxGpuCommandSemiTransparencyEnabled,
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuDisplayStartX,
	gxGpuDisplayModeScreenWidth,
	gxGpuDisplayModeDotClockDivider,
	gxGpuHorizontalDisplayRangeEnd,
	gxGpuHorizontalDisplayRangeStart,
	gxGpuHorizontalVisibleColumns,
	gxGpuDrawModeTextureDisableEnabled,
	gxGpuDrawingOffsetY,
	gxGpuFillHeight,
	gxGpuFillWidth,
	gxGpuFillX,
	gxGpuSigned11,
	gxGpuTextureClutBaseX,
	gxGpuTextureClutBaseY,
	gxGpuTextureU,
	gxGpuTextureV,
	gxGpuTransferEmittedPixelCount,
	gxGpuTransferPayloadPixelCount,
	gxGpuTransferPixelWord,
	gxGpuTransferX,
	gxGpuTransferY,
	gxGpuVertexX,
	gxGpuVertexY,
	gxGpuVramCopyChunkHeight,
	gxGpuVramCopyNeedsChunking,
	gxGpuVramWrappedHeight,
	gxGpuVramWrappedWidth,
	gxGpuDitheredPolygon,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuDrawingAreaX,
	gxGpuDrawingAreaY,
	gxGpuDrawModeDitherEnabled,
	gxGpuDrawModeTextureMode,
	gxGpuDrawModeTexturePageBaseX,
	gxGpuDrawModeTexturePageBaseY,
	gxGpuDrawModeTextureRectangleXFlip,
	gxGpuDrawModeTextureRectangleYFlip,
	gxGpuDrawModeTransparencyMode,
	gxGpuMaskBitCheckBeforeDraw,
	gxGpuMaskBitSetWhileDrawing,
	gxGpuSegmentExceedsPrimitiveSize,
	gxGpuTextureRectangleEdge0,
	gxGpuTextureRectangleEdge1,
	gxGpuTextureWindowAndX,
	gxGpuTextureWindowAndY,
	gxGpuTextureWindowOrX,
	gxGpuTextureWindowOrY,
	gxGpuTriangleExceedsPrimitiveSize,
} from '../../machine/ts/render/backend/gx_gpu_render_rules';
import {
	GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
	GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU,
	GX_GPU_DISPLAY_START_MASK,
	GX_GPU_DISPLAY_MODE_MASK,
	GX_GPU_DRAWING_AREA_MASK,
	GX_GPU_DRAWING_OFFSET_MASK,
	GX_GPU_DRAW_MODE_DITHER_ENABLED,
	GX_GPU_DRAW_MODE_GPUSTAT_MASK,
	GX_GPU_DRAW_MODE_MASK,
	GX_GPU_DRAW_MODE_TEXTURE_DISABLE,
	GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP,
	GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP,
	GX_GPU_GP0_CPU_TO_VRAM_FIRST,
	GX_GPU_GP0_FILL_RECTANGLE,
	GX_GPU_GP0_IRQ_REQUEST,
	GX_GPU_GP0_LINE_FIRST,
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
	GX_GPU_INFO_GPU_TYPE_208PIN,
	GX_GPU_GP1_RESET,
	GX_GPU_GP1_CLEAR_FIFO,
	GX_GPU_GP1_ACK_INTERRUPT,
	GX_GPU_GP1_GET_GPU_INFO,
	GX_GPU_GP1_GET_GPU_INFO_LAST,
	GX_GPU_GP1_SET_DISPLAY_DISABLE,
	GX_GPU_GP1_SET_DISPLAY_START,
	GX_GPU_GP1_SET_DMA_DIRECTION,
	GX_GPU_GP1_SET_DISPLAY_MODE,
	GX_GPU_GP1_SET_HORIZONTAL_DISPLAY_RANGE,
	GX_GPU_GP1_SET_ALLOW_TEXTURE_DISABLE,
	GX_GPU_GP1_SET_VERTICAL_DISPLAY_RANGE,
	GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK,
	GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24,
	GX_GPU_STATUS_DISPLAY_DISABLE,
	GX_GPU_STATUS_DISPLAY_LINE_LSB,
	GX_GPU_STATUS_DMA_DATA_REQUEST,
	GX_GPU_STATUS_DMA_DIRECTION_MASK,
	GX_GPU_STATUS_DMA_DIRECTION_SHIFT,
	GX_GPU_STATUS_GPU_IDLE,
	GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2,
	GX_GPU_STATUS_INTERLACED_FIELD,
	GX_GPU_STATUS_INTERRUPT_REQUEST,
	GX_GPU_STATUS_PAL_MODE,
	GX_GPU_STATUS_READY_TO_RECEIVE_DMA,
	GX_GPU_STATUS_READY_TO_SEND_VRAM,
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
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { PSX_GPU_DISPLAY_MODE_PAL_WORD } from '../../machine/ts/machine/model_registry';
import { renderGxGpuSoftwareFrame } from '../../machine/ts/render/backend/software/gx_gpu';
import { executeGxGpuSoftwareCommands } from '../../machine/ts/render/backend/software/gx_gpu_commands';
import {
	gxGpuSoftwareTextureModulationChannel5,
	gxGpuSoftwareTextureModulationPreDither,
	gxGpuSoftwareVram,
	gxGpuSoftwareVramIndex,
	resetGxGpuSoftwareVram,
} from '../../machine/ts/render/backend/software/gx_gpu_vram';

function createGpu(): { memory: Memory; cpu: CPU; scheduler: DeviceScheduler; gpu: GxGpu } {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const scheduler = new DeviceScheduler(cpu);
	const gpu = new GxGpu(memory, scheduler);
	gpu.reset();
	return { memory, cpu, scheduler, gpu };
}

test('GX-GPU decodes PSX GP0 signed vertex and rectangle size words', () => {
	assert.equal(gxGpuSigned11(0x000003ff), 1023);
	assert.equal(gxGpuSigned11(0x00000400), -1024);
	assert.equal(gxGpuSigned11(0x000007ff), -1);

	assert.equal(gxGpuVertexX(0x000007ff), -1);
	assert.equal(gxGpuVertexY(0x07ff0000), -1);
	assert.equal(gxGpuDisplayStartX(123 | (456 << 10)), 123);
	assert.equal(gxGpuDisplayStartY(123 | (456 << 10)), 456);
	assert.equal(gxGpuDisplayModeScreenWidth(0), 256);
	assert.equal(gxGpuDisplayModeScreenWidth(1), 320);
	assert.equal(gxGpuDisplayModeScreenWidth(2), 512);
	assert.equal(gxGpuDisplayModeScreenWidth(3), 640);
	assert.equal(gxGpuDisplayModeScreenWidth(0x40), 368);
	assert.equal(gxGpuDisplayModeScreenWidth(0x41), 384);
	assert.equal(gxGpuDisplayModeDotClockDivider(0), 10);
	assert.equal(gxGpuDisplayModeDotClockDivider(1), 8);
	assert.equal(gxGpuDisplayModeDotClockDivider(2), 5);
	assert.equal(gxGpuDisplayModeDotClockDivider(3), 4);
	assert.equal(gxGpuDisplayModeDotClockDivider(0x40), 7);
	assert.equal(gxGpuDisplayModeDotClockDivider(0x41), 7);
	assert.equal(gxGpuHorizontalDisplayRangeStart(0x00c60260), 0x260);
	assert.equal(gxGpuHorizontalDisplayRangeEnd(0x00c60260), 0xc60);
	assert.equal(gxGpuHorizontalVisibleColumns(0x00c60260, 1), 320);
	assert.equal(gxGpuHorizontalVisibleColumns((0xc5f << 12) | 0x260, 1), 320);
	assert.equal(gxGpuHorizontalVisibleColumns((0xc3f << 12) | 0x260, 1), 316);
	assert.equal(gxGpuHorizontalVisibleColumns(0x00c60260, 0x40), 364);
	assert.equal(gxGpuHorizontalVisibleColumns(0x00c70260, 0x40), 368);
	assert.equal(gxGpuHorizontalVisibleColumns(0x00ce0260, 0x41), 384);
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
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 12, 24, 32, 16), true);
	assert.equal(gxGpuVramCopyChunkHeight(20, 24, 16), 4);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 10, 24, 32, 16), false);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 12, 20, 32, 16), false);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 50, 24, 32, 16), false);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 12, 40, 32, 16), false);
	assert.equal(gxGpuVramCopyChunkHeight(20, 80, 16), 16);

	assert.equal(gxGpuTransferX(0x01ff03ff), 1023);
	assert.equal(gxGpuTransferY(0x01ff03ff), 511);
	assert.equal(gxGpuTransferWidth(0), 1024);
	assert.equal(gxGpuTransferHeight(0), 512);
	assert.equal(gxGpuTransferWidth(0x012c0007), 7);
	assert.equal(gxGpuTransferHeight(0x012c0007), 300);
	assert.equal(gxGpuTransferPixelWord(0x89abcdef, 0), 0xcdef);
	assert.equal(gxGpuTransferPixelWord(0x89abcdef, 1), 0x89ab);
	assert.equal(gxGpuTransferPayloadPixelCount(3), 0);
	assert.equal(gxGpuTransferPayloadPixelCount(5), 4);
	assert.equal(gxGpuTransferEmittedPixelCount(3, 2, 4), 2);
	assert.equal(gxGpuTransferEmittedPixelCount(3, 2, 5), 4);
	assert.equal(gxGpuTransferEmittedPixelCount(3, 2, 6), 6);
	assert.equal(gxGpuTransferEmittedPixelCount(3, 1, 5), 3);

	assert.equal(gxGpuCommandRawTextureEnabled(0x25), true);
	assert.equal(gxGpuCommandRawTextureEnabled(0x24), false);
	assert.equal(gxGpuCommandSemiTransparencyEnabled(0x22), true);
	assert.equal(gxGpuCommandSemiTransparencyEnabled(0x20), false);
	assert.equal(gxGpuCommandDrawsTexture(0x24, 0), true);
	assert.equal(gxGpuCommandDrawsTexture(0x24, GX_GPU_DRAW_MODE_TEXTURE_DISABLE), false);
	assert.equal(gxGpuCommandDrawsTexture(0x20, 0), false);
	assert.equal(gxGpuDrawModeTextureDisableEnabled(GX_GPU_DRAW_MODE_TEXTURE_DISABLE), true);
	assert.equal(gxGpuDrawModeTextureDisableEnabled(0), false);
	assert.equal(gxGpuDrawModeDitherEnabled(GX_GPU_DRAW_MODE_DITHER_ENABLED), true);
	assert.equal(gxGpuDrawModeDitherEnabled(0), false);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_GOURAUD_BIT), true);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED, GX_GPU_GP0_POLYGON_FIRST), false);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT), true);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED | GX_GPU_DRAW_MODE_TEXTURE_DISABLE, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT), false);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED | GX_GPU_DRAW_MODE_TEXTURE_DISABLE, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | GX_GPU_GP0_RENDER_GOURAUD_BIT), true);
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
	assert.equal(gxGpuSegmentExceedsPrimitiveSize(0, 0, 1023, 0), false);
	assert.equal(gxGpuSegmentExceedsPrimitiveSize(0, 0, 1024, 0), true);
	assert.equal(gxGpuSegmentExceedsPrimitiveSize(0, 0, 0, 511), false);
	assert.equal(gxGpuSegmentExceedsPrimitiveSize(0, 0, 0, 512), true);
	assert.equal(gxGpuTriangleExceedsPrimitiveSize(0, 0, 1023, 0, 0, 511), false);
	assert.equal(gxGpuTriangleExceedsPrimitiveSize(0, 0, 1024, 0, 0, 511), true);
	assert.equal(gxGpuTriangleExceedsPrimitiveSize(0, 0, 1023, 0, 0, 512), true);
	assert.equal(gxGpuTriangleExceedsPrimitiveSize(-512, -256, 511, 255, 0, 0), false);
	assert.equal(gxGpuTriangleExceedsPrimitiveSize(-513, -256, 511, 255, 0, 0), true);
	assert.equal(gxGpuTextureU(0x01c3ab56), 0x56);
	assert.equal(gxGpuTextureV(0x01c3ab56), 0xab);
	assert.equal(gxGpuTextureAttribute(0x01c3ab56), 0x01c3);
	assert.equal(gxGpuTextureClutBaseX(0x01c3ab56), 48);
	assert.equal(gxGpuTextureClutBaseY(0x01c3ab56), 7);
	assert.equal(gxGpuDrawModeTexturePageBaseX(0x0013), 192);
	assert.equal(gxGpuDrawModeTexturePageBaseY(0x0013), 256);
	assert.equal(gxGpuDrawModeTexturePageBaseY(0x0810), 256);
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

	gpu.writeGp1((GX_GPU_GP1_SET_ALLOW_TEXTURE_DISABLE << 24) | 1);
	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x00000000);
	assert.equal(gpu.readDisplayModeWord(), 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);

	assert.equal(gpu.writeGp1(GX_GPU_GP1_RESET << 24), GX_GPU_GP1_RESET);

	assert.equal(gpu.readTextureDisableAllowedWord(), 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_DISABLE) >>> 0, 0);
	assert.equal(gpu.readDisplayModeWord(), PSX_GPU_DISPLAY_MODE_PAL_WORD);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, GX_GPU_STATUS_PAL_MODE);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_RESET_WORD) >>> 0, GX_GPU_STATUS_RESET_WORD);
});

test('GX-GPU mirrors PSX GP1 display mode fields into GPUSTAT bits', () => {
	const { gpu } = createGpu();

	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x00ffffff);

	assert.equal(gpu.readDisplayModeWord(), GX_GPU_DISPLAY_MODE_MASK);
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

test('GX-GPU mirrors PSX GPUSTAT interlaced field and scanout line bits', () => {
	const { scheduler, gpu } = createGpu();

	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x00000000);
	gpu.setScanoutTiming(false, 0, 100, 10);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, 0);

	scheduler.advanceTo(30);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, GX_GPU_STATUS_DISPLAY_LINE_LSB >>> 0);

	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_START << 24) | (7 << 10));
	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x00000024);
	gpu.setScanoutTiming(true, 90, 100, 10);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, GX_GPU_STATUS_DISPLAY_LINE_LSB >>> 0);
	gpu.setScanoutTiming(false, 0, 100, 10);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_INTERLACED_FIELD) >>> 0, 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, 0);
});

test('GX-GPU tags PSX interlaced render commands with active field parity', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	assert.equal(gxGpuSkipDrawingToActiveField(GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE), true);
	assert.equal(gxGpuSkipDrawingToActiveField(GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE | (1 << 10)), false);
	assert.equal(gxGpuInterlacedRenderWord(GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE, 1), GX_GPU_INTERLACED_RENDER_ENABLE | GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB);
	assert.equal(gxGpuInterlacedRenderWord(GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE | (1 << 10), 1), 0);

	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_START << 24) | (7 << 10));
	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x00000024);
	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00010203);
	gpu.writeGp0(0x00000000);
	gpu.writeGp0(0x00000001);
	gpu.writeGp0(0x00000002);

	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandInterlacedRenderWord[0], GX_GPU_INTERLACED_RENDER_ENABLE | GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB);

	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | (1 << 10));
	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00010203);
	gpu.writeGp0(0x00000000);
	gpu.writeGp0(0x00000001);
	gpu.writeGp0(0x00000002);

	assert.equal(commands.commandCount, 2);
	assert.equal(commands.commandInterlacedRenderWord[1], 0);
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

test('GX-GPU GPUSTAT readiness tracks GP0 packet assembly and payload phases', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	let status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	assert.equal((status & GX_GPU_STATUS_READY_TO_SEND_VRAM) >>> 0, 0);

	gpu.writeGp1((GX_GPU_GP1_SET_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00010203);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	assert.equal((status & GX_GPU_STATUS_READY_TO_SEND_VRAM) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, GX_GPU_STATUS_DMA_DATA_REQUEST);

	gpu.writeGp1((GX_GPU_GP1_SET_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, 0);

	gpu.writeGp0(0x00000000);
	gpu.writeGp0(0x00000001);
	gpu.writeGp0(0x00000002);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
	assert.equal(commands.commandCount, 1);

	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00020003);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	gpu.writeGp0(0xaaaaaaaa);
	gpu.writeGp0(0xbbbbbbbb);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	gpu.writeGp0(0xcccccccc);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
	assert.equal(commands.commandCount, 2);

	gpu.writeGp0(((GX_GPU_GP0_LINE_FIRST | GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) << 24) | 0x0000ff);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00020003);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	gpu.writeGp0(0x50005000);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
	assert.equal(commands.commandCount, 3);

	gpu.writeGp0(GX_GPU_GP0_FILL_RECTANGLE << 24);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
});

test('GX-GPU latches PSX GP1 CRTC range registers as masked raw words', () => {
	const { gpu } = createGpu();

	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_START << 24) | 0x00000001);
	assert.equal(gpu.readDisplayStartWord(), 0);
	gpu.writeGp1((GX_GPU_GP1_SET_DISPLAY_START << 24) | 0x00ffffff);
	gpu.writeGp1((GX_GPU_GP1_SET_HORIZONTAL_DISPLAY_RANGE << 24) | 0x00ffffff);
	gpu.writeGp1((GX_GPU_GP1_SET_VERTICAL_DISPLAY_RANGE << 24) | 0x00ffffff);
	gpu.writeGp1((GX_GPU_GP1_SET_ALLOW_TEXTURE_DISABLE << 24) | 0x00ffffff);

	assert.equal(gpu.readDisplayStartWord(), GX_GPU_DISPLAY_START_MASK);
	assert.equal(gpu.readHorizontalDisplayRangeWord(), GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readVerticalDisplayRangeWord(), GX_GPU_VERTICAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readTextureDisableAllowedWord(), 1);

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

	assert.equal(gpu.readDrawModeWord(), GX_GPU_DRAW_MODE_MASK & ~GX_GPU_DRAW_MODE_TEXTURE_DISABLE);
	assert.equal((gpu.readStatus() & GX_GPU_DRAW_MODE_GPUSTAT_MASK) >>> 0, GX_GPU_DRAW_MODE_GPUSTAT_MASK);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_DISABLE) >>> 0, 0);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_DITHER_ENABLED) >>> 0, GX_GPU_DRAW_MODE_DITHER_ENABLED);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP);

	gpu.writeGp1((GX_GPU_GP1_SET_ALLOW_TEXTURE_DISABLE << 24) | 1);
	assert.equal(gpu.readTextureDisableAllowedWord(), 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_DISABLE) >>> 0, 0);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x00ffffff);
	assert.equal(gpu.readDrawModeWord(), GX_GPU_DRAW_MODE_MASK);
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
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO_LAST << 24) | 0x02);
	assert.equal(gpu.readGpuReadWord(), GX_GPU_TEXTURE_WINDOW_MASK);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x12);
	assert.equal(gpu.readGpuReadWord(), GX_GPU_TEXTURE_WINDOW_MASK);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x07);
	assert.equal(gpu.readGpuReadWord(), GX_GPU_INFO_GPU_TYPE_208PIN);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x0a);
	assert.equal(gpu.readGpuReadWord(), GX_GPU_INFO_GPU_TYPE_208PIN);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x08);
	assert.equal(gpu.readGpuReadWord(), 0);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO_LAST << 24) | 0x07);
	assert.equal(gpu.readGpuReadWord(), GX_GPU_INFO_GPU_TYPE_208PIN);
	gpu.writeGp1((GX_GPU_GP1_SET_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x07);
	const status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_READY_TO_SEND_VRAM) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, 0);
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

test('GX-GPU GP1 clear FIFO clears partial GP0 packets and flushes partial CPU-to-VRAM uploads', () => {
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

	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00020003);
	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000111);
	gpu.writeGp0((GX_GPU_GP0_SET_MASK_BIT << 24) | 0x000002);
	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.commandOpcode[0], GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	assert.equal(commands.commandWordCount[0], 5);
	assert.equal(commands.words[commands.commandWordStart[0] + 3], ((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000111) >>> 0);
	assert.equal(commands.words[commands.commandWordStart[0] + 4], ((GX_GPU_GP0_SET_MASK_BIT << 24) | 0x000002) >>> 0);
	assert.equal(gpu.readDrawModeWord(), 0x000222);
	assert.equal(gpu.readMaskBitModeWord(), 3);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);

	gpu.writeGp0((GX_GPU_GP0_SET_DRAW_MODE << 24) | 0x000444);
	assert.equal(commands.commandCount, 1);
	assert.equal(gpu.readDrawModeWord(), 0x000444);
});

const GX_GPU_SOFTWARE_TEST_WIDTH = 256;
const GX_GPU_SOFTWARE_TEST_HEIGHT = 256;
const GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD = 1023 | (511 << 10);

function pushSoftwareCommand(
	commandBuffer: GxGpuCommandBuffer,
	words: Uint32Array,
	kind: number,
	opcode: number,
	drawModeWord = 0,
	textureWindowWord = 0,
	drawingAreaTopLeftWord = 0,
	drawingAreaBottomRightWord = GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
	drawingOffsetWord = 0,
	maskBitModeWord = 0,
	interlacedRenderWord = 0,
): void {
	const wordStart = commandBuffer.appendWords(words, words.length);
	commandBuffer.pushCommand(kind, opcode, wordStart, words.length, drawModeWord, textureWindowWord, drawingAreaTopLeftWord, drawingAreaBottomRightWord, drawingOffsetWord, maskBitModeWord, interlacedRenderWord);
}

function assertRgbaPixel(pixels: Uint8Array, x: number, y: number, r: number, g: number, b: number): void {
	const offset = (y * GX_GPU_SOFTWARE_TEST_WIDTH + x) * 4;
	assert.equal(pixels[offset], r);
	assert.equal(pixels[offset + 1], g);
	assert.equal(pixels[offset + 2], b);
	assert.equal(pixels[offset + 3], 255);
}

test('GX-GPU software backend owns texture modulation math', () => {
	assert.equal(gxGpuSoftwareTextureModulationPreDither(31, 128), 248);
	assert.equal(gxGpuSoftwareTextureModulationChannel5(31, 128, 0), 31);
	assert.equal(gxGpuSoftwareTextureModulationChannel5(31, 255, 3), 31);
	assert.equal(gxGpuSoftwareTextureModulationChannel5(1, 16, -4), 0);
	assert.equal(gxGpuSoftwareTextureModulationChannel5(12, 96, 0), 9);
});

test('GX-GPU software backend rasterizes Gouraud lines with PSX fixed-point steps', () => {
	const commandBuffer = new GxGpuCommandBuffer();
	commandBuffer.reset();
	const opcode = GX_GPU_GP0_LINE_FIRST | GX_GPU_GP0_RENDER_GOURAUD_BIT;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x0000ff) >>> 0,
		(10 << 16) | 40,
		0x00ff00,
		(14 << 16) | 40,
	]), GX_GPU_COMMAND_DRAW_LINE, opcode);

	resetGxGpuSoftwareVram();
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 10)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 12)], 0x0210);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 14)], 0x03e0);
});

test('GX-GPU software backend blends untextured semi-transparent rectangles with all PSX draw modes', () => {
	const commandBuffer = new GxGpuCommandBuffer();
	commandBuffer.reset();
	for (let column = 0; column < 4; column += 1) {
		const x = 10 + column * 10;
		pushSoftwareCommand(commandBuffer, new Uint32Array([
			((GX_GPU_GP0_RECTANGLE_FIRST << 24) | 0xff0000) >>> 0,
			(20 << 16) | x,
			(4 << 16) | 4,
		]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST);
		pushSoftwareCommand(commandBuffer, new Uint32Array([
			(((GX_GPU_GP0_RECTANGLE_FIRST | 0x02) << 24) | 0xffffff) >>> 0,
			(20 << 16) | x,
			(4 << 16) | 4,
		]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST | 0x02, column << 5);
	}

	resetGxGpuSoftwareVram();
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 20)], 0x7def);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(20, 20)], 0x7fff);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(30, 20)], 0x0000);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 20)], 0x7ce7);
});

test('GX-GPU software scanout consumes CPU upload, VRAM copy, and fill commands', () => {
	const commandBuffer = new GxGpuCommandBuffer();
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		0,
		(1 << 16) | 2,
		0x03e0001f,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_VRAM_TO_VRAM_FIRST << 24,
		0,
		2,
		(1 << 16) | 2,
	]), GX_GPU_COMMAND_COPY_VRAM_TO_VRAM, GX_GPU_GP0_VRAM_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		(GX_GPU_GP0_FILL_RECTANGLE << 24) | 0xff0000,
		1 << 16,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_FILL_RECTANGLE, GX_GPU_GP0_FILL_RECTANGLE);

	const pixels = new Uint8Array(GX_GPU_SOFTWARE_TEST_WIDTH * GX_GPU_SOFTWARE_TEST_HEIGHT * 4);
	renderGxGpuSoftwareFrame({
		width: GX_GPU_SOFTWARE_TEST_WIDTH,
		height: GX_GPU_SOFTWARE_TEST_HEIGHT,
		commandBuffer,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 0,
		horizontalDisplayRangeWord: (((638 + 256 * 10) << 12) | 638) >>> 0,
		verticalDisplayRangeWord: (((35 + 256) << 10) | 35) >>> 0,
	}, pixels, GX_GPU_SOFTWARE_TEST_WIDTH, GX_GPU_SOFTWARE_TEST_HEIGHT);

	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);
	assertRgbaPixel(pixels, 1, 0, 0, 255, 0);
	assertRgbaPixel(pixels, 2, 0, 255, 0, 0);
	assertRgbaPixel(pixels, 3, 0, 0, 255, 0);
	assertRgbaPixel(pixels, 0, 1, 0, 0, 255);
	assertRgbaPixel(pixels, 15, 1, 0, 0, 255);
	assertRgbaPixel(pixels, 16, 1, 0, 0, 0);
});

test('GX-GPU software backend retires consumed command logs without clearing VRAM', () => {
	const commandBuffer = new GxGpuCommandBuffer();
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		(GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff,
		0,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_FILL_RECTANGLE, GX_GPU_GP0_FILL_RECTANGLE);
	const state = {
		width: GX_GPU_SOFTWARE_TEST_WIDTH,
		height: GX_GPU_SOFTWARE_TEST_HEIGHT,
		commandBuffer,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 0,
		horizontalDisplayRangeWord: (((638 + 256 * 10) << 12) | 638) >>> 0,
		verticalDisplayRangeWord: (((35 + 256) << 10) | 35) >>> 0,
	};
	const pixels = new Uint8Array(GX_GPU_SOFTWARE_TEST_WIDTH * GX_GPU_SOFTWARE_TEST_HEIGHT * 4);
	renderGxGpuSoftwareFrame(state, pixels, GX_GPU_SOFTWARE_TEST_WIDTH, GX_GPU_SOFTWARE_TEST_HEIGHT);
	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);

	commandBuffer.retireCommandsPreservingVram();
	renderGxGpuSoftwareFrame(state, pixels, GX_GPU_SOFTWARE_TEST_WIDTH, GX_GPU_SOFTWARE_TEST_HEIGHT);
	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);

	pushSoftwareCommand(commandBuffer, new Uint32Array([
		(GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x00ff00,
		16 | (1 << 16),
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_FILL_RECTANGLE, GX_GPU_GP0_FILL_RECTANGLE);
	renderGxGpuSoftwareFrame(state, pixels, GX_GPU_SOFTWARE_TEST_WIDTH, GX_GPU_SOFTWARE_TEST_HEIGHT);
	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);
	assertRgbaPixel(pixels, 16, 1, 0, 255, 0);

	commandBuffer.reset();
	renderGxGpuSoftwareFrame(state, pixels, GX_GPU_SOFTWARE_TEST_WIDTH, GX_GPU_SOFTWARE_TEST_HEIGHT);
	assertRgbaPixel(pixels, 0, 0, 0, 0, 0);
	assertRgbaPixel(pixels, 16, 1, 0, 0, 0);
});

test('GX-GPU software scanout consumes solid polygon, rectangle, and line commands', () => {
	const commandBuffer = new GxGpuCommandBuffer();
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x0000ff) >>> 0,
		(4 << 16) | 4,
		(4 << 16) | 12,
		(12 << 16) | 4,
	]), GX_GPU_COMMAND_DRAW_POLYGON, GX_GPU_GP0_POLYGON_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_RECTANGLE_FIRST << 24) | 0x00ff00) >>> 0,
		(5 << 16) | 20,
		(2 << 16) | 3,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_LINE_FIRST << 24) | 0xff0000) >>> 0,
		(6 << 16) | 30,
		(6 << 16) | 34,
	]), GX_GPU_COMMAND_DRAW_LINE, GX_GPU_GP0_LINE_FIRST);

	const pixels = new Uint8Array(GX_GPU_SOFTWARE_TEST_WIDTH * GX_GPU_SOFTWARE_TEST_HEIGHT * 4);
	renderGxGpuSoftwareFrame({
		width: GX_GPU_SOFTWARE_TEST_WIDTH,
		height: GX_GPU_SOFTWARE_TEST_HEIGHT,
		commandBuffer,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 0,
		horizontalDisplayRangeWord: (((638 + 256 * 10) << 12) | 638) >>> 0,
		verticalDisplayRangeWord: (((35 + 256) << 10) | 35) >>> 0,
	}, pixels, GX_GPU_SOFTWARE_TEST_WIDTH, GX_GPU_SOFTWARE_TEST_HEIGHT);

	assertRgbaPixel(pixels, 5, 5, 255, 0, 0);
	assertRgbaPixel(pixels, 13, 13, 0, 0, 0);
	assertRgbaPixel(pixels, 20, 5, 0, 255, 0);
	assertRgbaPixel(pixels, 22, 6, 0, 255, 0);
	assertRgbaPixel(pixels, 30, 6, 0, 0, 255);
	assertRgbaPixel(pixels, 34, 6, 0, 0, 255);
});

test('GX-GPU software scanout consumes textured primitives', () => {
	const commandBuffer = new GxGpuCommandBuffer();
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		64,
		(1 << 16) | 2,
		0x03e0001f,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		80,
		(1 << 16) | 1,
		0x000003ff,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		20 << 16,
		(1 << 16) | 2,
		0x7c000000,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(1 << 16) | 64,
		(1 << 16) | 1,
		0x00000001,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		72,
		(1 << 16) | 2,
		0x03e0001f,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(1 << 16) | 72,
		(1 << 16) | 2,
		0x03ff7c00,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);

	const rawTexturedRectangleOpcode = GX_GPU_GP0_RECTANGLE_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01;
	const direct16PageWord = (GX_GPU_TEXTURE_MODE_DIRECT16 << 7) | 1;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedRectangleOpcode << 24) | 0x808080) >>> 0,
		(10 << 16) | 40,
		0,
		(1 << 16) | 2,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, rawTexturedRectangleOpcode, direct16PageWord);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedRectangleOpcode << 24) | 0x808080) >>> 0,
		(10 << 16) | 47,
		0,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, rawTexturedRectangleOpcode, direct16PageWord, 0x00000802);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedRectangleOpcode << 24) | 0x808080) >>> 0,
		(10 << 16) | 45,
		0x05000100,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, rawTexturedRectangleOpcode, 1);
	const rawTexturedPolygonOpcode = GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedPolygonOpcode << 24) | 0x808080) >>> 0,
		(12 << 16) | 50,
		0,
		(12 << 16) | 52,
		2,
		(14 << 16) | 50,
		0,
	]), GX_GPU_COMMAND_DRAW_POLYGON, rawTexturedPolygonOpcode, direct16PageWord);
	const rawTexturedQuadOpcode = rawTexturedPolygonOpcode | GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedQuadOpcode << 24) | 0x808080) >>> 0,
		(20 << 16) | 60,
		8,
		(20 << 16) | 62,
		10 | (direct16PageWord << 16),
		(22 << 16) | 60,
		8 | (2 << 8),
		(22 << 16) | 62,
		10 | (2 << 8),
	]), GX_GPU_COMMAND_DRAW_POLYGON, rawTexturedQuadOpcode, direct16PageWord);

	const pixels = new Uint8Array(GX_GPU_SOFTWARE_TEST_WIDTH * GX_GPU_SOFTWARE_TEST_HEIGHT * 4);
	renderGxGpuSoftwareFrame({
		width: GX_GPU_SOFTWARE_TEST_WIDTH,
		height: GX_GPU_SOFTWARE_TEST_HEIGHT,
		commandBuffer,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 0,
		horizontalDisplayRangeWord: (((638 + 256 * 10) << 12) | 638) >>> 0,
		verticalDisplayRangeWord: (((35 + 256) << 10) | 35) >>> 0,
	}, pixels, GX_GPU_SOFTWARE_TEST_WIDTH, GX_GPU_SOFTWARE_TEST_HEIGHT);

	assertRgbaPixel(pixels, 40, 10, 255, 0, 0);
	assertRgbaPixel(pixels, 41, 10, 0, 255, 0);
	assertRgbaPixel(pixels, 45, 10, 0, 0, 255);
	assertRgbaPixel(pixels, 47, 10, 255, 255, 0);
	assertRgbaPixel(pixels, 50, 12, 255, 0, 0);
	assertRgbaPixel(pixels, 51, 12, 0, 255, 0);
	assertRgbaPixel(pixels, 60, 20, 255, 0, 0);
	assertRgbaPixel(pixels, 61, 20, 0, 255, 0);
	assertRgbaPixel(pixels, 60, 21, 0, 0, 255);
	assertRgbaPixel(pixels, 61, 21, 255, 255, 0);
});

test('GX-GPU software commands preserve texture mask, blend, and mask-test store semantics', () => {
	const commandBuffer = new GxGpuCommandBuffer();
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		64,
		(1 << 16) | 3,
		0x0000801f,
		0x00007c00,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_RECTANGLE_FIRST << 24) | 0x00ff00) >>> 0,
		(20 << 16) | 10,
		(1 << 16) | 4,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST);

	const rawTexturedSemiRectangleOpcode = GX_GPU_GP0_RECTANGLE_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x03;
	const direct16PageWord = (GX_GPU_TEXTURE_MODE_DIRECT16 << 7) | 1;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedSemiRectangleOpcode << 24) | 0x808080) >>> 0,
		(20 << 16) | 10,
		0,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, rawTexturedSemiRectangleOpcode, direct16PageWord);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedSemiRectangleOpcode << 24) | 0x808080) >>> 0,
		(20 << 16) | 11,
		1,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, rawTexturedSemiRectangleOpcode, direct16PageWord);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedSemiRectangleOpcode << 24) | 0x808080) >>> 0,
		(20 << 16) | 12,
		2,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, rawTexturedSemiRectangleOpcode, direct16PageWord);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_RECTANGLE_FIRST << 24) | 0x0000ff) >>> 0,
		(20 << 16) | 13,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST, 0, 0, 0, GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD, 0, 1);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_RECTANGLE_FIRST << 24) | 0x00ff00) >>> 0,
		(20 << 16) | 13,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST, 0, 0, 0, GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD, 0, 2);

	resetGxGpuSoftwareVram();
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 20)], 0x81ef);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(11, 20)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(12, 20)], 0x7c00);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(13, 20)], 0x801f);
});

test('GX-GPU software commands sample palette8, rectangle flip, and dithered modulation', () => {
	const commandBuffer = new GxGpuCommandBuffer();
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(2 << 16) | 64,
		(1 << 16) | 1,
		0x00000201,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(21 << 16) | 16,
		(1 << 16) | 3,
		0x03e00000,
		0x00007c00,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(3 << 16) | 64,
		(1 << 16) | 1,
		0x00000008,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);

	const rawTexturedRectangleOpcode = GX_GPU_GP0_RECTANGLE_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01;
	const palette8FlipPageWord = (GX_GPU_TEXTURE_MODE_PALETTE8 << 7) | GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP | 1;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedRectangleOpcode << 24) | 0x808080) >>> 0,
		(20 << 16) | 30,
		(0x0541 << 16) | (2 << 8) | 1,
		(1 << 16) | 2,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, rawTexturedRectangleOpcode, palette8FlipPageWord);

	const texturedPolygonOpcode = GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT;
	const ditheredDirect16PageWord = (GX_GPU_TEXTURE_MODE_DIRECT16 << 7) | GX_GPU_DRAW_MODE_DITHER_ENABLED | 1;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((texturedPolygonOpcode << 24) | 0xffffff) >>> 0,
		(40 << 16) | 20,
		3 << 8,
		(40 << 16) | 30,
		3 << 8,
		(50 << 16) | 20,
		3 << 8,
	]), GX_GPU_COMMAND_DRAW_POLYGON, texturedPolygonOpcode, ditheredDirect16PageWord);

	resetGxGpuSoftwareVram();
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(30, 20)], 0x7c00);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(31, 20)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(22, 41)], 0x0010);
});

test('GX-GPU MMIO uses PSX GP0 data and GP1 status addresses', () => {
	const { memory } = createGpu();

	memory.writeMappedU32LE(IO_GX_GPU_GP0, 0x12345678);
	memory.writeMappedU32LE(IO_GX_GPU_GP1, (GX_GPU_GP1_SET_DISPLAY_MODE << 24) | 0x00000000);

	assert.equal(memory.readMappedU32LE(IO_GX_GPU_GP0), 0x00000400);
	assert.equal((memory.readMappedU32LE(IO_GX_GPU_GP1) & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	assert.equal((memory.readMappedU32LE(IO_GX_GPU_GP1) & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);
});
