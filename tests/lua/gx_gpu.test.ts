import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IO_GX_GPU_GP0, IO_GX_GPU_GP1, IO_IRQ_ACK, IO_IRQ_FLAGS, IRQ_GPU } from '../../machine/ts/machine/bus/io';
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
	GX_GPU_READBACK_IDLE,
	GX_GPU_READBACK_PENDING,
	GX_GPU_READBACK_READY,
	GX_GPU_READBACK_SUBMITTED,
	GX_GPU_TEXTURE_MODE_DIRECT16,
	GX_GPU_TEXTURE_MODE_PALETTE8,
	GX_GPU_VRAM_BYTE_COUNT,
	GX_GPU_VRAM_WIDTH,
	gxGpuInterlacedRenderWord,
	gxGpuSkipDrawingToActiveField,
	gxGpuPolygonDrawModeWord,
	gxGpuPolygonTexturePageWordIndex,
	gxGpuTextureAttribute,
	gxGpuTransferHeight,
	gxGpuTransferWidth,
	GxGpuCommandBuffer,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuSigned11,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { GX_GPU_COMMAND_FIFO_WORD_CAPACITY } from '../../machine/ts/machine/devices/gx/gpu_command_fifo';
import {
	GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD,
	GX_GPU_RESET_DISPLAY_MODE_WORD,
	GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
	gxGpuDisplayStartX,
	gxGpuDisplayStartY,
	gxGpuDisplayModeScreenWidth,
	gxGpuVerticalDisplayRangeEnd,
	gxGpuVerticalDisplayRangeStart,
	gxGpuVerticalVisibleLines,
} from '../../machine/ts/machine/devices/gx/gpu_display';
import {
	gxGpuCommandDrawsTexture,
	gxGpuCommandRawTextureEnabled,
	gxGpuCommandSemiTransparencyEnabled,
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuDrawModeTextureDisableEnabled,
	gxGpuDrawingOffsetY,
	gxGpuFillHeight,
	gxGpuFillWidth,
	gxGpuFillX,
	gxGpuTextureClutBaseX,
	gxGpuTextureClutBaseY,
	gxGpuTextureU,
	gxGpuTextureV,
	gxGpuTransferEmittedPixelCount,
	gxGpuTransferPayloadPixelCount,
	gxGpuTransferPixelWord,
	gxGpuTransferX,
	gxGpuTransferY,
	gxGpuVertexY,
	gxGpuVramCopyChunkHeight,
	gxGpuVramCopyNeedsChunking,
	gxGpuVramWrappedHeight,
	gxGpuVramWrappedWidth,
	gxGpuDitheredPolygon,
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
	gxGpuTextureWindowAndX,
	gxGpuTextureWindowAndY,
	gxGpuTextureWindowOrX,
	gxGpuTextureWindowOrY,
	gxGpuTriangleEdgeCoverageMinimum,
	gxGpuTriangleExceedsPrimitiveSize,
	gxGpuTriangleRasterShift,
	GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
	GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES,
	gxGpuTriangleAttributePlane,
	gxGpuTriangleAttributePlaneInterpolants,
	gxGpuTriangleAttributePlaneInterpolantValue,
	gxGpuVramLogicalAreaOverlapsBounds,
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
	GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT,
	GX_GPU_GP0_DRAWING_AREA_TOP_LEFT,
	GX_GPU_GP0_DRAWING_OFFSET,
	GX_GPU_GP0_DRAW_MODE,
	GX_GPU_GP0_MASK_BIT,
	GX_GPU_GP0_TEXTURE_WINDOW,
	GX_GPU_GP0_VRAM_TO_VRAM_FIRST,
	GX_GPU_GP0_VRAM_TO_CPU_FIRST,
	GX_GPU_INFO_GPU_TYPE_208PIN,
	GX_GPU_GP1_RESET,
	GX_GPU_GP1_CLEAR_FIFO,
	GX_GPU_GP1_ACK_INTERRUPT,
	GX_GPU_GP1_GET_GPU_INFO,
	GX_GPU_GP1_GET_GPU_INFO_LAST,
	GX_GPU_GP1_DISPLAY_DISABLE,
	GX_GPU_GP1_DISPLAY_START,
	GX_GPU_GP1_DMA_DIRECTION,
	GX_GPU_GP1_DISPLAY_MODE,
	GX_GPU_GP1_HORIZONTAL_DISPLAY_RANGE,
	GX_GPU_GP1_ALLOW_TEXTURE_DISABLE,
	GX_GPU_GP1_VERTICAL_DISPLAY_RANGE,
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
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { PSX_GPU_DISPLAY_MODE_PAL_WORD } from '../../machine/ts/machine/model_registry';
import { executeGxGpuSoftwareVramCommands, renderGxGpuSoftwareFrame } from '../../machine/ts/render/backend/software/gx_gpu';
import { executeGxGpuSoftwareCommands } from '../../machine/ts/render/backend/software/gx_gpu_commands';
import { scanoutGxGpuSoftwareVram } from '../../machine/ts/render/backend/software/gx_gpu_scanout';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import {
	gxGpuSoftwareTextureModulationChannel5,
	gxGpuSoftwareTextureModulationPreDither,
	gxGpuSoftwareVram,
	gxGpuSoftwareVramIndex,
} from '../../machine/ts/render/backend/software/gx_gpu_vram';

test('GX-GPU GPUREAD fences prior backend work and packs wrapped odd pixels', () => {
	const { gpu } = createGpu();
	const positionWord = (511 << 16) | 1023;
	const sizeWord = (1 << 16) | 3;

	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(positionWord);
	gpu.writeGp0(sizeWord);
	gpu.writeGp0(0x22221111);
	gpu.writeGp0(0x00003333);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(positionWord);
	gpu.writeGp0(sizeWord);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);

	assert.equal(gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM, 0);
	assert.equal(gpu.readStatus() & GX_GPU_STATUS_READY_TO_RECEIVE_DMA, 0);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	const output = gpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands({
		commandBuffer: output.commandBuffer,
		readbackPort: output.readbackPort,
		vramSnapshotBytes: output.vramSnapshotBytes,
		vramSnapshotSerial: output.vramSnapshotSerial,
	});

	assert.equal(gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM, GX_GPU_STATUS_READY_TO_SEND_VRAM);
	assert.equal(gpu.readStatus() & GX_GPU_STATUS_DMA_DATA_REQUEST, GX_GPU_STATUS_DMA_DATA_REQUEST);
	assert.equal(gpu.readGp0(), 0x22221111);
	const saved = gpu.captureState();
	assert.equal(gpu.readGp0(), 0x00003333);
	gpu.restoreState(saved);
	assert.equal(gpu.readGp0(), 0x00003333);
	assert.equal(gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM, 0);
	assert.equal(gpu.readStatus() & GX_GPU_STATUS_DMA_DATA_REQUEST, 0);
	assert.equal(gpu.readGp0(), 0x00003333);
});

test('GX-GPU GPUREAD preserves row-major order across X and Y wrap', () => {
	const { gpu } = createGpu();
	const positionWord = (511 << 16) | 1023;
	const sizeWord = (2 << 16) | 2;
	const vramBytes = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);
	let byteIndex = (511 * GX_GPU_VRAM_WIDTH + 1023) << 1;
	vramBytes[byteIndex] = 0x11;
	vramBytes[byteIndex + 1] = 0x11;
	byteIndex = (511 * GX_GPU_VRAM_WIDTH) << 1;
	vramBytes[byteIndex] = 0x22;
	vramBytes[byteIndex + 1] = 0x22;
	byteIndex = 1023 << 1;
	vramBytes[byteIndex] = 0x33;
	vramBytes[byteIndex + 1] = 0x33;
	vramBytes[0] = 0x44;
	vramBytes[1] = 0x44;
	gpu.replaceVramSnapshotBytes(vramBytes);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(positionWord);
	gpu.writeGp0(sizeWord);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	executeGxGpuSoftwareVramCommands(gpu.readDeviceOutput());
	assert.equal(gpu.readGp0(), 0x22221111);
	assert.equal(gpu.readGp0(), 0x44443333);
});

test('GX-GPU queues a later C0 transfer behind the active GPUREAD fence', () => {
	const { gpu } = createGpu();
	const sizeWord = (1 << 16) | 1;
	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 2);
	gpu.writeGp0(0x22221111);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0(sizeWord);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(1);
	gpu.writeGp0(sizeWord);
	completeGpuCommands(gpu);
	const queuedOutput = gpu.readDeviceOutput();
	assert.equal(queuedOutput.readbackPort.x, 0);
	assert.equal(queuedOutput.readbackPort.phase, GX_GPU_READBACK_PENDING);

	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	let output = gpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output);
	gpu.retirePresentedCommands();
	assert.equal(gpu.readGp0(), 0x00001111);

	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	output = gpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output);
	assert.equal(gpu.readGp0(), 0x00002222);
});

test('GX-GPU does not claim a C0 appended after the published frame fence', () => {
	const { gpu } = createGpu();
	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(10);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0(0x0000aaaa);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();

	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0(0x00001234);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	completeGpuCommands(gpu);
	let output = gpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output);
	assert.equal(output.readbackPort.phase, GX_GPU_READBACK_PENDING);
	assert.equal(gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM, 0);
	gpu.retirePresentedCommands();
	assert.equal(output.readbackPort.fenceCommandCount, 2);

	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	output = gpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output);
	assert.equal(gpu.readGp0(), 0x00001234);
});

test('GX-GPU GP1 clear FIFO aborts a pending GPUREAD without dropping prior commands', () => {
	const { gpu } = createGpu();
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x07);
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x00ff00);
	gpu.writeGp0(16);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(16);
	gpu.writeGp0((1 << 16) | 1);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	const output = gpu.readDeviceOutput();
	const commandBuffer = output.commandBuffer;
	const readback = output.readbackPort;
	const commandSerial = commandBuffer.serial;
	const vramClearSerial = commandBuffer.vramClearSerial;
	const readbackToken = readback.token;
	assert.equal(commandBuffer.commandCount, 2);
	assert.equal(readback.phase, GX_GPU_READBACK_PENDING);

	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);

	assert.equal(commandBuffer.commandCount, 1);
	assert.equal(commandBuffer.presentCommandCount, 1);
	assert.equal(commandBuffer.wordCount, 3);
	assert.equal(commandBuffer.serial, commandSerial);
	assert.equal(commandBuffer.vramClearSerial, vramClearSerial);
	assert.equal(readback.phase, GX_GPU_READBACK_IDLE);
	assert.notEqual(readback.token, readbackToken);
	assert.equal(gpu.readGp0(), GX_GPU_INFO_GPU_TYPE_208PIN);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);

	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(readback.phase, GX_GPU_READBACK_IDLE);
	executeGxGpuSoftwareVramCommands(gpu.readDeviceOutput());
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(16, 0)], 0);
});

test('GX-GPU GP1 clear FIFO aborts a ready GPUREAD and its queued suffix', () => {
	const { gpu } = createGpu();
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x07);
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x00ff00);
	gpu.writeGp0(16);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	let output = gpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output);
	const commandBuffer = output.commandBuffer;
	const readback = output.readbackPort;
	const readbackToken = readback.token;
	assert.equal(readback.phase, GX_GPU_READBACK_READY);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM) >>> 0, GX_GPU_STATUS_READY_TO_SEND_VRAM);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, GX_GPU_STATUS_DMA_DATA_REQUEST);
	gpu.retirePresentedCommands();
	assert.equal(commandBuffer.commandCount, 0);
	assert.equal(readback.fenceCommandCount, 0);
	const commandSerialBeforeAbort = commandBuffer.serial;
	const vramClearSerial = commandBuffer.vramClearSerial;

	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);

	assert.equal(commandBuffer.commandCount, 0);
	assert.equal(commandBuffer.presentCommandCount, 0);
	assert.equal(commandBuffer.wordCount, 0);
	assert.notEqual(commandBuffer.serial, commandSerialBeforeAbort);
	assert.equal(commandBuffer.vramClearSerial, vramClearSerial);
	assert.equal(readback.phase, GX_GPU_READBACK_IDLE);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM) >>> 0, 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, 0);
	assert.equal(gpu.readGp0(), GX_GPU_INFO_GPU_TYPE_208PIN);

	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(32);
	gpu.writeGp0((1 << 16) | 1);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(readback.claimReadback(commandBuffer.presentCommandCount), true);
	const currentReadbackToken = readback.token;
	assert.equal(readback.phase, GX_GPU_READBACK_SUBMITTED);
	readback.completeReadback(readbackToken);
	assert.equal(readback.phase, GX_GPU_READBACK_SUBMITTED);
	readback.completeReadback(currentReadbackToken);
	assert.equal(readback.phase, GX_GPU_READBACK_READY);
	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	assert.equal(readback.phase, GX_GPU_READBACK_IDLE);

	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0xff0000);
	gpu.writeGp0(32);
	gpu.writeGp0((1 << 16) | 1);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	output = gpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(16, 0)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(32, 0)], 0x7c00);
});

test('GX-GPU restore re-arms submitted GPUREAD and reset clears its retained request', () => {
	const { gpu } = createGpu();
	const vramBytes = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);
	vramBytes[0] = 0x34;
	vramBytes[1] = 0x12;
	gpu.replaceVramSnapshotBytes(vramBytes);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	const output = gpu.readDeviceOutput();
	const commandBuffer = output.commandBuffer;
	const readback = output.readbackPort;
	assert.equal(readback.claimReadback(commandBuffer.presentCommandCount), true);
	assert.equal(readback.phase, GX_GPU_READBACK_SUBMITTED);
	const staleToken = readback.token;
	gpu.retirePresentedCommands();
	assert.equal(readback.fenceCommandCount, 0);
	const submitted = gpu.captureState();
	assert.equal(submitted.commandBuffer.readbackPhase, GX_GPU_READBACK_PENDING);
	assert.equal(submitted.commandBuffer.readbackPixelBytes.byteLength, 0);
	gpu.restoreState(submitted);
	assert.equal(readback.phase, GX_GPU_READBACK_PENDING);
	readback.completeReadback(staleToken);
	assert.equal(readback.phase, GX_GPU_READBACK_PENDING);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(gpu.lastFrameCommitted(), true);
	executeGxGpuSoftwareVramCommands(gpu.readDeviceOutput());
	assert.equal(gpu.readGp0(), 0x00001234);

	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0(0);
	gpu.reset();
	readback.completeReadback(staleToken);
	const resetState = gpu.captureState().commandBuffer;
	assert.equal(resetState.readbackPhase, 0);
	assert.equal(resetState.readbackFenceCommandCount, 0);
	assert.equal(resetState.readbackPixelCursor, 0);
	assert.equal(resetState.readbackWidth, 0);
	assert.equal(resetState.readbackHeight, 0);
	assert.equal(resetState.readbackPixelBytes.byteLength, 0);
});

function completeGpuCommands(gpu: GxGpu): void {
	gpu.onService(Number.MAX_SAFE_INTEGER);
}

function createGpu(): { memory: Memory; cpu: CPU; scheduler: DeviceScheduler; dma: DmaController; gpu: GxGpu } {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const scheduler = new DeviceScheduler(cpu);
	const irq = new IrqController(memory);
	const dma = new DmaController(memory, irq, scheduler);
	const gpu = new GxGpu(memory, irq, scheduler, dma);
	dma.reset();
	gpu.reset();
	irq.reset();
	return { memory, cpu, scheduler, dma, gpu };
}

const standaloneCommandBufferDma = createGpu().dma;

test('GX-GPU decodes PSX GP0 signed vertex and rectangle size words', () => {
	assert.equal(gxGpuSigned11(0x000003ff), 1023);
	assert.equal(gxGpuSigned11(0x00000400), -1024);
	assert.equal(gxGpuSigned11(0x000007ff), -1);

	assert.equal(gxGpuSigned11(0x000007ff), -1);
	assert.equal(gxGpuVertexY(0x07ff0000), -1);
	assert.equal(gxGpuDisplayStartX(123 | (456 << 10)), 123);
	assert.equal(gxGpuDisplayStartY(123 | (456 << 10)), 456);
	assert.equal(gxGpuDisplayModeScreenWidth(0), 256);
	assert.equal(gxGpuDisplayModeScreenWidth(1), 320);
	assert.equal(gxGpuDisplayModeScreenWidth(2), 512);
	assert.equal(gxGpuDisplayModeScreenWidth(3), 640);
	assert.equal(gxGpuDisplayModeScreenWidth(0x40), 368);
	assert.equal(gxGpuDisplayModeScreenWidth(0x41), 368);
	assert.equal(GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD, 0x00c60260);
	assert.equal(gxGpuDisplayModeScreenWidth(GX_GPU_RESET_DISPLAY_MODE_WORD), 320);
	assert.equal(gxGpuVerticalDisplayRangeStart((227 << 10) | 35), 35);
	assert.equal(gxGpuVerticalDisplayRangeEnd((227 << 10) | 35), 227);
	assert.equal(gxGpuVerticalVisibleLines((227 << 10) | 35, 0x08), 192);
	assert.equal(gxGpuVerticalVisibleLines((275 << 10) | 35, 0x08), 240);
	assert.equal(gxGpuVerticalVisibleLines((275 << 10) | 35, 0x28), 480);
	assert.equal(gxGpuVerticalVisibleLines((35 << 10) | 227, 0x08), -192);
	assert.equal(gxGpuVerticalVisibleLines(GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD, GX_GPU_RESET_DISPLAY_MODE_WORD), 240);
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
	assert.equal(gxGpuVramLogicalAreaOverlapsBounds(1008, 500, 32, 24, 0, 0, 8, 8), true);
	assert.equal(gxGpuVramLogicalAreaOverlapsBounds(1008, 500, 32, 24, 512, 256, 520, 264), false);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 12, 24, 32, 16), true);
	assert.equal(gxGpuVramCopyChunkHeight(20, 24, 16), 4);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 10, 24, 32, 16), false);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 12, 20, 32, 16), false);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 50, 24, 32, 16), false);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 12, 40, 32, 16), false);
	assert.equal(gxGpuVramCopyChunkHeight(20, 80, 16), 16);
	const uvPlane = new Float64Array(2 * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
	uvPlane.set([1, 2, 17, 2, 1, 18]);
	const uvInterpolants = new Float32Array(33);
	uvInterpolants[10] = 1;
	uvInterpolants[21] = 1;
	uvInterpolants[32] = 1;
	gxGpuTriangleAttributePlane(uvPlane, 0, 2, 256, 0, 0, 16, 0, 0, 16);
	gxGpuTriangleAttributePlaneInterpolants(uvInterpolants, 0, 11, uvPlane, 2, 0, 0, 16, 0, 0, 16);
	assert.equal(uvInterpolants[10], 1);
	assert.equal(uvInterpolants[21], 1);
	assert.equal(uvInterpolants[6], 1);
	assert.equal(uvInterpolants[17], 17);
	assert.equal(uvInterpolants[29], 18);
	assert.equal(gxGpuTriangleAttributePlaneInterpolantValue(uvInterpolants, 0, 2) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS, 1);
	assert.equal(gxGpuTriangleAttributePlaneInterpolantValue(uvInterpolants, 11, 2) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS, 17);
	assert.equal(gxGpuTriangleAttributePlaneInterpolantValue(uvInterpolants, 23, 2) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS, 18);

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
	assert.equal(gxGpuSegmentExceedsPrimitiveSize(0, 0, 1023, 0), false);
	assert.equal(gxGpuSegmentExceedsPrimitiveSize(0, 0, 1024, 0), true);
	assert.equal(gxGpuSegmentExceedsPrimitiveSize(0, 0, 0, 511), false);
	assert.equal(gxGpuSegmentExceedsPrimitiveSize(0, 0, 0, 512), true);
	assert.equal(gxGpuTriangleExceedsPrimitiveSize(0, 0, 1023, 0, 0, 511), false);
	assert.equal(gxGpuTriangleExceedsPrimitiveSize(0, 0, 1024, 0, 0, 511), true);
	assert.equal(gxGpuTriangleExceedsPrimitiveSize(0, 0, 1023, 0, 0, 512), true);
	assert.equal(gxGpuTriangleExceedsPrimitiveSize(-512, -256, 511, 255, 0, 0), false);
	assert.equal(gxGpuTriangleExceedsPrimitiveSize(-513, -256, 511, 255, 0, 0), true);
	assert.equal(gxGpuTriangleRasterShift(-1025, -1024, -1), 2048);
	assert.equal(gxGpuTriangleRasterShift(-1024, 0, 1024), 0);
	assert.equal(gxGpuTriangleEdgeCoverageMinimum(1, -4), 0);
	assert.equal(gxGpuTriangleEdgeCoverageMinimum(0, 4), 0);
	assert.equal(gxGpuTriangleEdgeCoverageMinimum(-1, 4), 1);
	assert.equal(gxGpuTriangleEdgeCoverageMinimum(0, -4), 1);
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

	assert.equal(gpu.readDisplayModeWord(), GX_GPU_RESET_DISPLAY_MODE_WORD);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, GX_GPU_STATUS_PAL_MODE);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_RESET_WORD) >>> 0, GX_GPU_STATUS_RESET_WORD);

	assert.equal(gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00000000), GX_GPU_GP1_DISPLAY_MODE);

	assert.equal(gpu.readDisplayModeWord(), 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);
});

test('GX-GPU GP1 reset restores registers and preserves accepted GPU work', () => {
	const { gpu } = createGpu();
	const commandBuffer = gpu.readDeviceOutput().commandBuffer;
	const commandSerial = commandBuffer.serial;
	const vramClearSerial = commandBuffer.vramClearSerial;

	gpu.writeGp1((GX_GPU_GP1_ALLOW_TEXTURE_DISABLE << 24) | 1);
	gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00000000);
	gpu.writeGp0((GX_GPU_GP0_DRAWING_AREA_TOP_LEFT << 24) | 0x00054321);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x03);
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(32);
	gpu.writeGp0((1 << 16) | 4);
	gpu.writeGp0(0x03e0001f);
	completeGpuCommands(gpu);
	assert.equal(gpu.readDisplayModeWord(), 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);
	assert.equal(commandBuffer.commandCount, 1);

	assert.equal(gpu.writeGp1(GX_GPU_GP1_RESET << 24), GX_GPU_GP1_RESET);

	assert.equal(commandBuffer.commandCount, 2);
	assert.equal(commandBuffer.serial, commandSerial);
	assert.equal(commandBuffer.vramClearSerial, vramClearSerial);
	assert.equal(gpu.readGp0(), 0x00054321);
	assert.equal(gpu.readTextureDisableAllowedWord(), 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_DISABLE) >>> 0, 0);
	assert.equal(gpu.readDisplayModeWord(), GX_GPU_RESET_DISPLAY_MODE_WORD);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, GX_GPU_STATUS_PAL_MODE);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_RESET_WORD) >>> 0, (GX_GPU_STATUS_RESET_WORD & ~GX_GPU_STATUS_GPU_IDLE) >>> 0);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	gxGpuSoftwareVram.fill(0);
	assert.equal(executeGxGpuSoftwareCommands(commandBuffer, 0), 2);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(32, 0)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(33, 0)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(34, 0)], 0);

	gpu.reset();
	assert.equal(commandBuffer.commandCount, 0);
	assert.notEqual(commandBuffer.vramClearSerial, vramClearSerial);
	assert.equal(gpu.readGp0(), 0);
});

test('GX-GPU mirrors PSX GP1 display mode fields into GPUSTAT bits', () => {
	const { gpu } = createGpu();

	gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00ffffff);

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

	gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00000000);
	gpu.setScanoutTiming(false, 0, 100, 10);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, 0);

	scheduler.advanceTo(30);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, GX_GPU_STATUS_DISPLAY_LINE_LSB >>> 0);

	gpu.writeGp1((GX_GPU_GP1_DISPLAY_START << 24) | (7 << 10));
	gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00000024);
	gpu.setScanoutTiming(true, 90, 100, 10);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, GX_GPU_STATUS_DISPLAY_LINE_LSB >>> 0);
	gpu.setScanoutTiming(false, 0, 100, 10);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_INTERLACED_FIELD) >>> 0, 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, 0);
});

test('GX-GPU state restore preserves interlaced field latches', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp1((GX_GPU_GP1_DISPLAY_START << 24) | (7 << 10));
	gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00000024);
	gpu.setScanoutTiming(true, 90, 100, 10);
	gpu.setScanoutTiming(false, 0, 100, 10);
	const saved = gpu.captureState();
	assert.equal((gpu.readStatus() & (GX_GPU_STATUS_INTERLACED_FIELD | GX_GPU_STATUS_DISPLAY_LINE_LSB)) >>> 0, 0);

	gpu.setScanoutTiming(true, 90, 100, 10);
	gpu.setScanoutTiming(false, 0, 100, 10);
	assert.equal(
		(gpu.readStatus() & (GX_GPU_STATUS_INTERLACED_FIELD | GX_GPU_STATUS_DISPLAY_LINE_LSB)) >>> 0,
		(GX_GPU_STATUS_INTERLACED_FIELD | GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0,
	);

	gpu.restoreState(saved);
	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00010203);
	gpu.writeGp0(0);
	gpu.writeGp0(1);
	gpu.writeGp0(2);
	assert.equal(commands.commandInterlacedRenderWord[0], GX_GPU_INTERLACED_RENDER_ENABLE);
	assert.equal((gpu.readStatus() & (GX_GPU_STATUS_INTERLACED_FIELD | GX_GPU_STATUS_DISPLAY_LINE_LSB)) >>> 0, 0);
});

test('GX-GPU tags PSX interlaced render commands with active field parity', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	assert.equal(gxGpuSkipDrawingToActiveField(GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE), true);
	assert.equal(gxGpuSkipDrawingToActiveField(GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE | (1 << 10)), false);
	assert.equal(gxGpuInterlacedRenderWord(GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE, 1), GX_GPU_INTERLACED_RENDER_ENABLE | GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB);
	assert.equal(gxGpuInterlacedRenderWord(GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE | (1 << 10), 1), 0);

	gpu.writeGp1((GX_GPU_GP1_DISPLAY_START << 24) | (7 << 10));
	gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00000024);
	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00010203);
	gpu.writeGp0(0x00000000);
	gpu.writeGp0(0x00000001);
	gpu.writeGp0(0x00000002);

	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandInterlacedRenderWord[0], GX_GPU_INTERLACED_RENDER_ENABLE | GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB);
	completeGpuCommands(gpu);

	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | (1 << 10));
	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00010203);
	gpu.writeGp0(0x00000000);
	gpu.writeGp0(0x00000001);
	gpu.writeGp0(0x00000002);
	completeGpuCommands(gpu);

	assert.equal(commands.commandCount, 2);
	assert.equal(commands.commandInterlacedRenderWord[1], 0);
});

test('GX-GPU command log is presentable only after VBLANK frame seal', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00010203);
	gpu.writeGp0(0x00000000);
	gpu.writeGp0(0x00000001);
	gpu.writeGp0(0x00000002);

	assert.deepEqual([commands.commandCount, commands.presentCommandCount], [1, 0]);
	assert.equal(gpu.lastFrameCommitted(), false);

	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.presentCommandCount, 1);
	assert.equal(gpu.lastFrameCommitted(), true);

	gpu.retirePresentedCommands();
	assert.equal(commands.commandCount, 0);
	assert.equal(commands.presentCommandCount, 0);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(gpu.lastFrameCommitted(), false);

	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00040506);
	gpu.writeGp0(0x00000003);
	gpu.writeGp0(0x00000004);
	gpu.writeGp0(0x00000005);

	assert.deepEqual([commands.commandCount, commands.presentCommandCount], [1, 0]);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(commands.presentCommandCount, 1);
});

test('GX-GPU partial presentation snapshot does not expose queued commands', () => {
	const { gpu } = createGpu();

	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);

	const output = gpu.readDeviceOutput();
	const commands = output.commandBuffer;
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.presentCommandCount, 0);

	gxGpuSoftwareVram.fill(0);
	assert.equal(executeGxGpuSoftwareCommands(commands, 0), 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.presentCommandCount, 0);

	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(executeGxGpuSoftwareCommands(commands, 0), 1);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x001f);

	gpu.retirePresentedCommands();
	assert.deepEqual([commands.commandCount, commands.presentCommandCount], [0, 0]);
});

test('GX-GPU retire preserves commands appended after the sealed VBLANK snapshot', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();

	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x00ff00);
	gpu.writeGp0(32);
	gpu.writeGp0((1 << 16) | 1);

	gxGpuSoftwareVram.fill(0);
	assert.equal(executeGxGpuSoftwareCommands(commands, 0), 1);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(32, 0)], 0);

	gpu.retirePresentedCommands();
	assert.deepEqual([commands.commandCount, commands.presentCommandCount], [1, 0]);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(executeGxGpuSoftwareCommands(commands, 0), 1);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(32, 0)], 0x03e0);
});

test('GX-GPU handles PSX GP1 display disable and DMA direction status bits', () => {
	const { gpu } = createGpu();

	gpu.writeGp1(GX_GPU_GP1_DISPLAY_DISABLE << 24);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0, 0);
	assert.equal((gpu.readDeviceOutput().statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0, GX_GPU_STATUS_DISPLAY_DISABLE);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal((gpu.readDeviceOutput().statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0, 0);

	gpu.writeGp1((GX_GPU_GP1_DISPLAY_DISABLE << 24) | 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0, GX_GPU_STATUS_DISPLAY_DISABLE);
	assert.equal((gpu.readDeviceOutput().statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0, 0);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal((gpu.readDeviceOutput().statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0, GX_GPU_STATUS_DISPLAY_DISABLE);
	assert.equal(gpu.lastFrameCommitted(), true);

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DIRECTION_MASK) >>> 0, GX_GPU_DMA_DIRECTION_CPU_TO_GP0 << GX_GPU_STATUS_DMA_DIRECTION_SHIFT);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, GX_GPU_STATUS_DMA_DATA_REQUEST);

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
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

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00010203);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	assert.equal((status & GX_GPU_STATUS_READY_TO_SEND_VRAM) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, GX_GPU_STATUS_DMA_DATA_REQUEST);

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, 0);

	gpu.writeGp0(0x00000000);
	gpu.writeGp0(0x00000001);
	gpu.writeGp0(0x00000002);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.executedCommandCount, 0);
	completeGpuCommands(gpu);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
	assert.equal(commands.executedCommandCount, 1);

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
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal(commands.commandCount, 2);
	completeGpuCommands(gpu);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);

	gpu.writeGp0(((GX_GPU_GP0_LINE_FIRST | GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) << 24) | 0x0000ff);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00020003);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	gpu.writeGp0(0x50005000);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal(commands.commandCount, 3);
	completeGpuCommands(gpu);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);

	gpu.writeGp0(GX_GPU_GP0_FILL_RECTANGLE << 24);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
});

test('GX-GPU command timing gates GPUSTAT idle and the VBLANK execution frontier', () => {
	const { gpu, scheduler } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);

	assert.equal(commands.commandCount, 1);
	assert.equal(commands.executedCommandCount, 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal(scheduler.nextDeadline(), 29);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(commands.presentCommandCount, 0);

	scheduler.advanceTo(28);
	gpu.onService(28);
	assert.equal(commands.executedCommandCount, 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);

	scheduler.advanceTo(29);
	gpu.onService(29);
	assert.equal(commands.executedCommandCount, 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(commands.presentCommandCount, 1);
});

test('GX-GPU drives the GP0 MMIO write-ready line from FIFO capacity', () => {
	const { memory, gpu, scheduler } = createGpu();

	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	for (let index = 0; index < GX_GPU_COMMAND_FIFO_WORD_CAPACITY; index += 1) {
		gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | index);
	}

	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), false);
	scheduler.advanceTo(29);
	gpu.onService(29);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), true);
});

test('GX-GPU latches PSX GP1 CRTC range registers as masked raw words', () => {
	const { gpu } = createGpu();

	gpu.writeGp1((GX_GPU_GP1_DISPLAY_START << 24) | 0x00000001);
	assert.equal(gpu.readDisplayStartWord(), 0);
	gpu.writeGp1((GX_GPU_GP1_DISPLAY_START << 24) | 0x00ffffff);
	gpu.writeGp1((GX_GPU_GP1_HORIZONTAL_DISPLAY_RANGE << 24) | 0x00ffffff);
	gpu.writeGp1((GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24) | 0x00ffffff);
	gpu.writeGp1((GX_GPU_GP1_ALLOW_TEXTURE_DISABLE << 24) | 0x00ffffff);

	assert.equal(gpu.readDisplayStartWord(), GX_GPU_DISPLAY_START_MASK);
	assert.equal(gpu.readHorizontalDisplayRangeWord(), GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readVerticalDisplayRangeWord(), GX_GPU_VERTICAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readTextureDisableAllowedWord(), 1);

	assert.equal(gpu.readDeviceOutput().displayStartWord, 0);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(gpu.readDeviceOutput().displayModeWord, gpu.readDisplayModeWord());
	assert.equal(gpu.readDeviceOutput().statusWord, gpu.readStatus());
	assert.equal(gpu.readDeviceOutput().displayStartWord, GX_GPU_DISPLAY_START_MASK);
	assert.equal(gpu.readDeviceOutput().horizontalDisplayRangeWord, GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readDeviceOutput().verticalDisplayRangeWord, GX_GPU_VERTICAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.lastFrameCommitted(), true);
});

test('GX-GPU handles PSX GP0 IRQ request and GP1 interrupt acknowledge', () => {
	const { memory, gpu } = createGpu();

	gpu.writeGp0(GX_GPU_GP0_IRQ_REQUEST << 24);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_INTERRUPT_REQUEST) >>> 0, GX_GPU_STATUS_INTERRUPT_REQUEST);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) >>> 0, IRQ_GPU);
	completeGpuCommands(gpu);

	memory.writeMappedU32LE(IO_IRQ_ACK, IRQ_GPU);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) >>> 0, 0);
	gpu.writeGp0(GX_GPU_GP0_IRQ_REQUEST << 24);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) >>> 0, 0);
	completeGpuCommands(gpu);

	gpu.writeGp1(GX_GPU_GP1_ACK_INTERRUPT << 24);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_INTERRUPT_REQUEST) >>> 0, 0);

	gpu.writeGp0(GX_GPU_GP0_IRQ_REQUEST << 24);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) >>> 0, IRQ_GPU);
	gpu.writeGp1(GX_GPU_GP1_ACK_INTERRUPT << 24);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU) >>> 0, IRQ_GPU);
});

test('GX-GPU handles PSX GP0 draw mode and mask-bit environment commands', () => {
	const { gpu } = createGpu();

	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x00ffffff);
	completeGpuCommands(gpu);

	assert.equal(gpu.readDrawModeWord(), GX_GPU_DRAW_MODE_MASK & ~GX_GPU_DRAW_MODE_TEXTURE_DISABLE);
	assert.equal((gpu.readStatus() & GX_GPU_DRAW_MODE_GPUSTAT_MASK) >>> 0, GX_GPU_DRAW_MODE_GPUSTAT_MASK);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_DISABLE) >>> 0, 0);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_DITHER_ENABLED) >>> 0, GX_GPU_DRAW_MODE_DITHER_ENABLED);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP);

	gpu.writeGp1((GX_GPU_GP1_ALLOW_TEXTURE_DISABLE << 24) | 1);
	assert.equal(gpu.readTextureDisableAllowedWord(), 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_DISABLE) >>> 0, 0);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x00ffffff);
	completeGpuCommands(gpu);
	assert.equal(gpu.readDrawModeWord(), GX_GPU_DRAW_MODE_MASK);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_DISABLE) >>> 0, GX_GPU_STATUS_TEXTURE_DISABLE);

	gpu.writeGp0((GX_GPU_GP0_MASK_BIT << 24) | 0x00000003);
	completeGpuCommands(gpu);
	assert.equal(gpu.readMaskBitModeWord(), 3);
	assert.equal((gpu.readStatus() & ((1 << 11) | (1 << 12))) >>> 0, (3 << 11) >>> 0);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_DISABLE) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_DISABLE);
});

test('GX-GPU handles PSX GP0 environment registers and GP1 GPU-info queries', () => {
	const { memory, gpu } = createGpu();

	gpu.writeGp0((GX_GPU_GP0_TEXTURE_WINDOW << 24) | 0x00ffffff);
	gpu.writeGp0((GX_GPU_GP0_DRAWING_AREA_TOP_LEFT << 24) | 0x00ffffff);
	gpu.writeGp0((GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT << 24) | 0x00abcdef);
	gpu.writeGp0((GX_GPU_GP0_DRAWING_OFFSET << 24) | 0x00ffffff);
	completeGpuCommands(gpu);

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
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x07);
	const status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_READY_TO_SEND_VRAM) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, 0);
});

test('GX-GPU emits PSX GP0 fixed-length render and blit packets into the GPU command buffer', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x0000ff);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x123456);
	gpu.writeGp0(0x00020003);

	assert.equal(commands.commandCount, 0);
	assert.equal(gpu.readDrawModeWord(), 0);

	gpu.writeGp0(0x00040005);
	completeGpuCommands(gpu);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_DRAW_POLYGON);
	assert.equal(commands.commandOpcode[0], GX_GPU_GP0_POLYGON_FIRST);
	assert.equal(commands.commandWordCount[0], 4);
	assert.equal(commands.words[commands.commandWordStart[0] + 1], ((GX_GPU_GP0_DRAW_MODE << 24) | 0x123456) >>> 0);
	assert.equal(gpu.readDrawModeWord(), 0);

	const texturedGouraudQuad = GX_GPU_GP0_POLYGON_FIRST
		| GX_GPU_GP0_RENDER_TEXTURE_BIT
		| GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT
		| GX_GPU_GP0_RENDER_GOURAUD_BIT;
	gpu.writeGp0(texturedGouraudQuad << 24);
	for (let index = 1; index < 12; index += 1) {
		gpu.writeGp0(index === 5 ? 0x01830055 : index === 6 ? ((GX_GPU_GP0_DRAW_MODE << 24) | 0x000345) : index);
	}
	completeGpuCommands(gpu);
	assert.equal(commands.commandCount, 2);
	assert.equal(commands.commandKind[1], GX_GPU_COMMAND_DRAW_POLYGON);
	assert.equal(commands.commandOpcode[1], texturedGouraudQuad);
	assert.equal(commands.commandWordCount[1], 12);
	assert.equal(commands.commandDrawModeWord[1], 0x0183);
	assert.equal(gpu.readDrawModeWord(), 0x0183);

	gpu.writeGp0(GX_GPU_GP0_FILL_RECTANGLE << 24);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000222);
	assert.equal(commands.commandCount, 2);
	gpu.writeGp0(0x000c000d);
	completeGpuCommands(gpu);
	assert.equal(commands.commandCount, 3);
	assert.equal(commands.commandKind[2], GX_GPU_COMMAND_FILL_RECTANGLE);
	assert.equal(commands.commandWordCount[2], 3);

	gpu.writeGp0((GX_GPU_GP0_RECTANGLE_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT) << 24);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000333);
	gpu.writeGp0(0x00030004);
	gpu.writeGp0(0x00050006);
	completeGpuCommands(gpu);
	assert.equal(commands.commandCount, 4);
	assert.equal(commands.commandKind[3], GX_GPU_COMMAND_DRAW_RECTANGLE);
	assert.equal(commands.commandWordCount[3], 4);

	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_VRAM_FIRST << 24);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000444);
	gpu.writeGp0(0x00030004);
	gpu.writeGp0(0x00050006);
	completeGpuCommands(gpu);
	assert.equal(commands.commandCount, 5);
	assert.equal(commands.commandKind[4], GX_GPU_COMMAND_COPY_VRAM_TO_VRAM);
	assert.equal(commands.commandWordCount[4], 4);

	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x0007ff);
	completeGpuCommands(gpu);
	assert.equal(commands.commandCount, 5);
	assert.equal(gpu.readDrawModeWord(), 0x0007ff);

	gpu.writeGp0(0x40 << 24);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00030004);
	completeGpuCommands(gpu);
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

	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000111);
	gpu.writeGp0((GX_GPU_GP0_MASK_BIT << 24) | 0x000003);
	assert.equal(commands.commandCount, 0);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000222);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.commandOpcode[0], GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	assert.equal(commands.commandWordCount[0], 6);
	assert.equal(commands.words[commands.commandWordStart[0] + 3], ((GX_GPU_GP0_DRAW_MODE << 24) | 0x000111) >>> 0);
	assert.equal(commands.words[commands.commandWordStart[0] + 5], ((GX_GPU_GP0_DRAW_MODE << 24) | 0x000222) >>> 0);
	assert.equal(gpu.readDrawModeWord(), 0);
	assert.equal(gpu.readMaskBitModeWord(), 0);
	completeGpuCommands(gpu);

	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x0007ff);
	completeGpuCommands(gpu);
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
	completeGpuCommands(gpu);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_DRAW_POLYLINE);
	assert.equal(commands.commandOpcode[0], 0x48);
	assert.equal(commands.commandWordCount[0], 3);
	assert.equal(commands.words[commands.commandWordStart[0] + 1], 0x00010002);
	assert.equal(gpu.readDrawModeWord(), 0);

	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000222);
	completeGpuCommands(gpu);
	assert.equal(commands.commandCount, 1);
	assert.equal(gpu.readDrawModeWord(), 0x000222);

	gpu.writeGp0(((0x40 | GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT | GX_GPU_GP0_RENDER_GOURAUD_BIT) << 24) | 0x0000ff);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00010000);
	gpu.writeGp0(0x00020003);
	assert.equal(commands.commandCount, 1);
	gpu.writeGp0(0x50005000);
	completeGpuCommands(gpu);
	assert.equal(commands.commandCount, 2);
	assert.equal(commands.commandKind[1], GX_GPU_COMMAND_DRAW_POLYLINE);
	assert.equal(commands.commandOpcode[1], 0x58);
	assert.equal(commands.commandWordCount[1], 4);
	assert.equal(commands.words[commands.commandWordStart[1] + 2], 0x00010000);

	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000333);
	assert.equal(commands.commandCount, 2);
	assert.equal(gpu.readDrawModeWord(), 0x000333);
});

test('GX-GPU save-state restores in-progress GP0 packet assembly', () => {
	const { gpu } = createGpu();
	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x0000ff);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00030004);

	const { gpu: restoredPacketGpu } = createGpu();
	restoredPacketGpu.restoreState(gpu.captureState());
	restoredPacketGpu.writeGp0(0x00050006);
	const packetCommands = restoredPacketGpu.readDeviceOutput().commandBuffer;
	assert.equal(packetCommands.commandCount, 1);
	assert.equal(packetCommands.commandKind[0], GX_GPU_COMMAND_DRAW_POLYGON);
	assert.equal(packetCommands.commandWordCount[0], 4);
	assert.equal(packetCommands.words[packetCommands.commandWordStart[0] + 2], 0x00030004);

	const { gpu: imageGpu } = createGpu();
	imageGpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	imageGpu.writeGp0(0x00000000);
	imageGpu.writeGp0((2 << 16) | 2);
	imageGpu.writeGp0(0x001f03e0);

	const { gpu: restoredImageGpu } = createGpu();
	restoredImageGpu.restoreState(imageGpu.captureState());
	restoredImageGpu.writeGp0(0x7c00ffff);
	const imageCommands = restoredImageGpu.readDeviceOutput().commandBuffer;
	assert.equal(imageCommands.commandCount, 1);
	assert.equal(imageCommands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(imageCommands.commandWordCount[0], 5);
	assert.equal(imageCommands.words[imageCommands.commandWordStart[0] + 3], 0x001f03e0);
	assert.equal(imageCommands.words[imageCommands.commandWordStart[0] + 4], 0x7c00ffff);

	const { gpu: polylineGpu } = createGpu();
	polylineGpu.writeGp0((0x48 << 24) | 0x0000ff);
	polylineGpu.writeGp0(0x00010002);
	polylineGpu.writeGp0(0x00020003);

	const { gpu: restoredPolylineGpu } = createGpu();
	restoredPolylineGpu.restoreState(polylineGpu.captureState());
	restoredPolylineGpu.writeGp0(0x50005000);
	const polylineCommands = restoredPolylineGpu.readDeviceOutput().commandBuffer;
	assert.equal(polylineCommands.commandCount, 1);
	assert.equal(polylineCommands.commandKind[0], GX_GPU_COMMAND_DRAW_POLYLINE);
	assert.equal(polylineCommands.commandWordCount[0], 3);
	assert.equal(polylineCommands.words[polylineCommands.commandWordStart[0] + 2], 0x00020003);
});

test('GX-GPU save-state restores command time and FIFO suffix relative to scheduler time', () => {
	const { gpu, scheduler } = createGpu();
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000123);
	scheduler.advanceTo(10);
	const state = gpu.captureState();
	assert.equal(state.gp0FifoWordCount, 1);
	assert.deepEqual(state.gp0FifoWords, [((GX_GPU_GP0_DRAW_MODE << 24) | 0x000123) >>> 0]);
	assert.equal(state.pendingCommandCycles, 19);
	assert.equal(state.commandBuffer.executedCommandCount, 0);

	const restored = createGpu();
	restored.scheduler.advanceTo(100);
	restored.gpu.restoreState(state);
	assert.equal(restored.scheduler.nextDeadline(), 119);
	restored.scheduler.advanceTo(118);
	restored.gpu.onService(118);
	assert.equal(restored.gpu.readDrawModeWord(), 0);
	restored.scheduler.advanceTo(119);
	restored.gpu.onService(119);
	assert.equal(restored.gpu.readDrawModeWord(), 0x000123);
	assert.equal(restored.gpu.readDeviceOutput().commandBuffer.executedCommandCount, 1);
	assert.equal(restored.scheduler.nextDeadline(), 120);
	restored.scheduler.advanceTo(120);
	restored.gpu.onService(120);
	assert.equal((restored.gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
});

test('GX-GPU GP1 clear FIFO clears partial GP0 packets and flushes partial CPU-to-VRAM uploads', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x0000ff);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000111);
	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	assert.equal(commands.commandCount, 0);
	assert.equal(commands.wordCount, 0);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000222);
	completeGpuCommands(gpu);
	assert.equal(gpu.readDrawModeWord(), 0x000222);

	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00020003);
	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	assert.equal(commands.commandCount, 0);
	assert.equal(commands.wordCount, 0);
	gpu.writeGp0((GX_GPU_GP0_MASK_BIT << 24) | 0x000003);
	completeGpuCommands(gpu);
	assert.equal(gpu.readMaskBitModeWord(), 3);

	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00020003);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000111);
	gpu.writeGp0((GX_GPU_GP0_MASK_BIT << 24) | 0x000002);
	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.commandOpcode[0], GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	assert.equal(commands.commandWordCount[0], 5);
	assert.equal(commands.wordCount, 5);
	assert.equal(commands.words[commands.commandWordStart[0] + 3], ((GX_GPU_GP0_DRAW_MODE << 24) | 0x000111) >>> 0);
	assert.equal(commands.words[commands.commandWordStart[0] + 4], ((GX_GPU_GP0_MASK_BIT << 24) | 0x000002) >>> 0);
	assert.equal(gpu.readDrawModeWord(), 0x000222);
	assert.equal(gpu.readMaskBitModeWord(), 3);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	completeGpuCommands(gpu);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);

	gpu.writeGp0((0x48 << 24) | 0x0000ff);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00020003);
	gpu.writeGp0(0x00030004);
	assert.equal(commands.wordCount, 9);
	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.wordCount, 5);

	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(32);
	gpu.writeGp0((1 << 16) | 1);
	assert.equal(commands.commandCount, 2);
	assert.equal(commands.commandWordStart[1], 5);

	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000444);
	assert.equal(commands.commandCount, 2);
	completeGpuCommands(gpu);
	assert.equal(gpu.readDrawModeWord(), 0x000444);
});

const GX_GPU_SOFTWARE_TEST_WIDTH = 256;
const GX_GPU_SOFTWARE_TEST_HEIGHT = 256;
const GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD = 1023 | (511 << 10);
const GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);

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
	commandBuffer.completeCommandExecution(commandBuffer.commandCount);
	commandBuffer.sealCommandsForPresentation();
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

test('GX-GPU software backend consumes only presentable commands', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	commandBuffer.reset();
	const words = new Uint32Array([
		(GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff,
		(5 << 16) | 4,
		(1 << 16) | 1,
	]);
	const wordStart = commandBuffer.appendWords(words, words.length);
	commandBuffer.pushCommand(GX_GPU_COMMAND_FILL_RECTANGLE, GX_GPU_GP0_FILL_RECTANGLE, wordStart, words.length, 0, 0, 0, GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD, 0, 0, 0);
	commandBuffer.completeCommandExecution(commandBuffer.commandCount);

	gxGpuSoftwareVram.fill(0);
	assert.equal(executeGxGpuSoftwareCommands(commandBuffer, 0), 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(4, 5)], 0);

	commandBuffer.sealCommandsForPresentation();
	assert.equal(executeGxGpuSoftwareCommands(commandBuffer, 0), 1);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(4, 5)], 0x001f);
});

test('GX-GPU software backend captures live VRAM into save-state snapshot', () => {
	const { gpu } = createGpu();
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0((5 << 16) | 4);
	gpu.writeGp0((1 << 16) | 1);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	const output = gpu.readDeviceOutput();
	const pixels = new Uint8Array(GX_GPU_SOFTWARE_TEST_WIDTH * GX_GPU_SOFTWARE_TEST_HEIGHT * 4);
	renderGxGpuSoftwareFrame({
		width: GX_GPU_SOFTWARE_TEST_WIDTH,
		height: GX_GPU_SOFTWARE_TEST_HEIGHT,
		commandBuffer: output.commandBuffer,
		readbackPort: output.readbackPort,
		statusWord: output.statusWord,
		displayModeWord: output.displayModeWord,
		displayStartWord: output.displayStartWord,
		vramSnapshotBytes: output.vramSnapshotBytes,
		vramSnapshotSerial: output.vramSnapshotSerial,
	}, pixels);

	const backend = new HeadlessGPUBackend();
	backend.captureGxGpuVramSnapshot(gpu);
	const saveState = gpu.captureSaveState();
	const byteIndex = gxGpuSoftwareVramIndex(4, 5) << 1;
	assert.equal(saveState.vramBytes.length, GX_GPU_VRAM_BYTE_COUNT);
	assert.equal(saveState.vramBytes[byteIndex], 0x1f);
	assert.equal(saveState.vramBytes[byteIndex + 1], 0x00);
});

test('GX-GPU software backend rasterizes Gouraud lines with PSX fixed-point steps', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	commandBuffer.reset();
	const opcode = GX_GPU_GP0_LINE_FIRST | GX_GPU_GP0_RENDER_GOURAUD_BIT;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x0000ff) >>> 0,
		(10 << 16) | 40,
		0x00ff00,
		(14 << 16) | 40,
	]), GX_GPU_COMMAND_DRAW_LINE, opcode);

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 10)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 12)], 0x0210);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 14)], 0x03e0);
});

test('GX-GPU software backend owns PSX line DDA, sample wrap, and polyline joints', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_LINE_FIRST << 24) | 0x0000ff) >>> 0,
		(10 << 16) | 10,
		(12 << 16) | 14,
	]), GX_GPU_COMMAND_DRAW_LINE, GX_GPU_GP0_LINE_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_LINE_FIRST << 24) | 0x00ff00) >>> 0,
		(10 << 16) | 20,
		(14 << 16) | 22,
	]), GX_GPU_COMMAND_DRAW_LINE, GX_GPU_GP0_LINE_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_LINE_FIRST << 24) | 0x00ffff) >>> 0,
		0x001d000c,
		0x00200004,
	]), GX_GPU_COMMAND_DRAW_LINE, GX_GPU_GP0_LINE_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_LINE_FIRST << 24) | 0x0000ff) >>> 0,
		0xfc00fc00,
		0xfc02fc02,
	]), GX_GPU_COMMAND_DRAW_LINE, GX_GPU_GP0_LINE_FIRST, 0, 0, 0, GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD, 0x002fffff);
	const semiTransparentPolylineOpcode = GX_GPU_GP0_LINE_FIRST | GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT | 0x02;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((semiTransparentPolylineOpcode << 24) | 0x0000f8) >>> 0,
		(40 << 16) | 40,
		(40 << 16) | 42,
		(42 << 16) | 42,
	]), GX_GPU_COMMAND_DRAW_POLYLINE, semiTransparentPolylineOpcode);
	const polylineOpcode = GX_GPU_GP0_LINE_FIRST | GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((polylineOpcode << 24) | 0xff0000) >>> 0,
		0x0046ffff,
		0x004603ff,
		0x004a03fb,
	]), GX_GPU_COMMAND_DRAW_POLYLINE, polylineOpcode);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((polylineOpcode << 24) | 0x00ff00) >>> 0,
		0xffff0032,
		0x01ff0032,
		0x01fb0036,
	]), GX_GPU_COMMAND_DRAW_POLYLINE, polylineOpcode);

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	for (const [x, y] of [[10, 10], [11, 11], [12, 11], [13, 12], [14, 12]]) {
		assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(x, y)], 0x001f);
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(11, 10)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(12, 12)], 0);
	for (const [x, y] of [[20, 10], [20, 11], [21, 12], [21, 13], [22, 14]]) {
		assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(x, y)], 0x03e0);
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(21, 11)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(22, 13)], 0);
	for (const [x, y] of [[11, 29], [12, 29], [8, 30], [9, 30], [10, 30], [6, 31], [7, 31], [4, 32], [5, 32]]) {
		assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(x, y)], 0x03ff);
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(4, 31)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(12, 30)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 511)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 40)], 0x000f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(41, 40)], 0x000f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(42, 40)], 0x0017);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(42, 41)], 0x000f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(42, 42)], 0x000f);
	for (let step = 0; step < 5; step += 1) {
		assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023 - step, 70 + step)], 0x7c00);
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 70)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(512, 70)], 0);
	for (let step = 0; step < 5; step += 1) {
		assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(50 + step, 511 - step)], 0x03e0);
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(50, 0)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(50, 256)], 0);
});

test('GX-GPU software backend blends untextured semi-transparent rectangles with all PSX draw modes', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
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

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 20)], 0x7def);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(20, 20)], 0x7fff);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(30, 20)], 0x0000);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 20)], 0x7ce7);
});

test('GX-GPU software backend owns PSX triangle edges and quad seams exactly once', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x0000ff) >>> 0,
		(4 << 16) | 4,
		(4 << 16) | 8,
		(8 << 16) | 4,
	]), GX_GPU_COMMAND_DRAW_POLYGON, GX_GPU_GP0_POLYGON_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00ff00) >>> 0,
		(4 << 16) | 12,
		(8 << 16) | 12,
		(4 << 16) | 16,
	]), GX_GPU_COMMAND_DRAW_POLYGON, GX_GPU_GP0_POLYGON_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_POLYGON_FIRST << 24) | 0xff0000) >>> 0,
		(4 << 16) | 32,
		(5 << 16) | 34,
		(6 << 16) | 32,
	]), GX_GPU_COMMAND_DRAW_POLYGON, GX_GPU_GP0_POLYGON_FIRST);
	const semiTransparentQuadOpcode = GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT | 0x02;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((semiTransparentQuadOpcode << 24) | 0x0000ff) >>> 0,
		(20 << 16) | 20,
		(20 << 16) | 24,
		(24 << 16) | 20,
		(24 << 16) | 24,
	]), GX_GPU_COMMAND_DRAW_POLYGON, semiTransparentQuadOpcode);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((semiTransparentQuadOpcode << 24) | 0x0000ff) >>> 0,
		(30 << 16) | 30,
		(30 << 16) | 34,
		(34 << 16) | 30,
		(31 << 16) | 31,
	]), GX_GPU_COMMAND_DRAW_POLYGON, semiTransparentQuadOpcode);

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	for (let row = 0; row < 4; row += 1) {
		for (let column = 0; column < 4 - row; column += 1) {
			assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(4 + column, 4 + row)], 0x001f);
			assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(12 + column, 4 + row)], 0x03e0);
		}
		assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(8 - row, 4 + row)], 0);
		assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(16 - row, 4 + row)], 0);
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(32, 4)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(32, 5)], 0x7c00);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(33, 5)], 0x7c00);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(34, 5)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(32, 6)], 0);
	for (let y = 20; y < 24; y += 1) {
		for (let x = 20; x < 24; x += 1) {
			assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(x, y)], 0x000f);
		}
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(24, 20)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(20, 24)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(30, 31)], 0x000f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(31, 31)], 0x0017);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(32, 31)], 0x0017);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(31, 32)], 0x0017);
});

test('GX-GPU software Gouraud triangles use PSX fixed-12 color planes before storage and texture modulation', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		0,
		(1 << 16) | 1,
		0x00000010,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	const gouraudOpcode = GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_GOURAUD_BIT;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		gouraudOpcode << 24,
		(10 << 16) | 10,
		0x0000ff,
		(11 << 16) | 17,
		0,
		(19 << 16) | 12,
	]), GX_GPU_COMMAND_DRAW_POLYGON, gouraudOpcode);
	const texturedGouraudOpcode = gouraudOpcode | GX_GPU_GP0_RENDER_TEXTURE_BIT;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		texturedGouraudOpcode << 24,
		(30 << 16) | 30,
		0,
		0x0000ff,
		(31 << 16) | 37,
		0,
		0,
		(39 << 16) | 32,
		0,
	]), GX_GPU_COMMAND_DRAW_POLYGON, texturedGouraudOpcode, GX_GPU_TEXTURE_MODE_DIRECT16 << 7);

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(13, 13)], 0x000b);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(33, 33)], 0x000b);
});

test('GX-GPU software polygons wrap the raster bucket after drawing offset and primitive-size rejection', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x0000ff) >>> 0,
		0x000a03f8,
		0x000a03fc,
		0x000e03f8,
	]), GX_GPU_COMMAND_DRAW_POLYGON, GX_GPU_GP0_POLYGON_FIRST, 0, 0, 0, GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD, 0x00000004);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		0,
		(1 << 16) | 4,
		0x03e0001f,
		0x7fff7c00,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	const rawTexturedPolygonOpcode = GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedPolygonOpcode << 24) | 0x808080) >>> 0,
		0x00140400,
		0x00000000,
		0x00140404,
		0x01000004,
		0x00180400,
		0x00000400,
	]), GX_GPU_COMMAND_DRAW_POLYGON, rawTexturedPolygonOpcode, GX_GPU_TEXTURE_MODE_DIRECT16 << 7, 0, 0, GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD, 0x000007fc);
	const gouraudPolygonOpcode = GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_GOURAUD_BIT;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((gouraudPolygonOpcode << 24) | 0x0000ff) >>> 0,
		0x05fc000a,
		0x0000ff00,
		0x05fc000e,
		0x00ff0000,
		0x0600000a,
	]), GX_GPU_COMMAND_DRAW_POLYGON, gouraudPolygonOpcode, 0, 0, 0x0007f40b, 0x0007f80c, 0x00200000);

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	for (let row = 0; row < 4; row += 1) {
		for (let column = 0; column < 4 - row; column += 1) {
			assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1020 + column, 10 + row)], 0x001f);
		}
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 10)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1020, 20)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1021, 20)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1022, 20)], 0x7c00);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 20)], 0x7fff);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 20)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(11, 509)], 0x2110);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(12, 509)], 0x2208);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(11, 510)], 0x4108);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 509)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(12, 510)], 0);
});

test('GX-GPU software textured polygons use PSX fixed-point UV gradients and half-texel seed', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		0,
		(1 << 16) | 2,
		0x03e0001f,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		0,
		(2 << 16) | 1,
		0x03e0001f,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	const opcode = GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(10 << 16) | 10,
		0,
		(10 << 16) | 12,
		0x01000001,
		(12 << 16) | 10,
		0,
	]), GX_GPU_COMMAND_DRAW_POLYGON, opcode, GX_GPU_TEXTURE_MODE_DIRECT16 << 7);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(20 << 16) | 20, 0,
		(20 << 16) | 26, 0x01000001,
		(26 << 16) | 20, 0,
	]), GX_GPU_COMMAND_DRAW_POLYGON, opcode, GX_GPU_TEXTURE_MODE_DIRECT16 << 7);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(30 << 16) | 30, 1,
		(30 << 16) | 36, 0x01000000,
		(36 << 16) | 30, 1,
	]), GX_GPU_COMMAND_DRAW_POLYGON, opcode, GX_GPU_TEXTURE_MODE_DIRECT16 << 7);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(500 << 16) | 1016, 0,
		(500 << 16) | 1022, 0x01000001,
		(506 << 16) | 1016, 0,
	]), GX_GPU_COMMAND_DRAW_POLYGON, opcode, GX_GPU_TEXTURE_MODE_DIRECT16 << 7);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(500 << 16) | 100, 0,
		(500 << 16) | 106, 0,
		(506 << 16) | 100, 0x00000100,
	]), GX_GPU_COMMAND_DRAW_POLYGON, opcode, GX_GPU_TEXTURE_MODE_DIRECT16 << 7);

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 10)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(11, 10)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 11)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(12, 10)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(23, 20)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(24, 20)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(33, 30)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(34, 30)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1019, 500)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1020, 500)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(100, 503)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(100, 504)], 0x03e0);
});

test('GX-GPU software texture sampling owns window, page, packed texel, and CLUT wrap edges', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	commandBuffer.reset();
	const opcode = GX_GPU_GP0_RECTANGLE_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(10 << 16) | 10,
		0x00000707,
		(2 << 16) | 2,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, GX_GPU_TEXTURE_MODE_DIRECT16 << 7, 0x00008421);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(20 << 16) | 20,
		0x00001e3f,
		(1 << 16) | 2,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, (GX_GPU_TEXTURE_MODE_DIRECT16 << 7) | 0x0f);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(30 << 16) | 30,
		0x0000ff05,
		(2 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, (GX_GPU_TEXTURE_MODE_DIRECT16 << 7) | 0x11);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(40 << 16) | 40,
		0x0f3f3200,
		(1 << 16) | 2,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, (GX_GPU_TEXTURE_MODE_PALETTE8 << 7) | 0x02);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(50 << 16) | 50,
		0x140146ff,
		(1 << 16) | 2,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, 0x0f);

	gxGpuSoftwareVram.fill(0);
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(15, 15)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(8, 15)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(15, 8)] = 0x7c00;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(8, 8)] = 0x7fff;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 30)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 30)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(69, 511)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(69, 256)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(128, 50)] = 0x100f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 60)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 60)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 70)] = 0x1000;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(960, 70)] = 0x0002;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(17, 80)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(18, 80)] = 0x03e0;
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	assert.deepEqual([
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 10)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(11, 10)],
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 11)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(11, 11)],
	], [0x001f, 0x03e0, 0x7c00, 0x7fff]);
	assert.deepEqual([
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(20, 20)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(21, 20)],
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(30, 30)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(30, 31)],
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 40)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(41, 40)],
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(50, 50)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(51, 50)],
	], [0x001f, 0x03e0, 0x001f, 0x03e0, 0x001f, 0x03e0, 0x001f, 0x03e0]);
});

test('GX-GPU software backend applies drawing offsets, inclusive drawing areas, and rectangle coordinate wrap', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x0000ff) >>> 0,
		0x07fe07fe,
		0x07fe0006,
		0x000607fe,
	]), GX_GPU_COMMAND_DRAW_POLYGON, GX_GPU_GP0_POLYGON_FIRST, 0, 0, 12 | (12 << 10), 15 | (15 << 10), 12 | (12 << 11));
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_RECTANGLE_FIRST << 24) | 0x00ff00) >>> 0,
		(18 << 16) | 18,
		(10 << 16) | 10,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST, 0, 0, 20 | (20 << 10), 25 | (25 << 10));
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(2 << 16) | 66,
		(1 << 16) | 1,
		0x0000001f,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(2 << 16) | 71,
		(1 << 16) | 1,
		0x000003e0,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(7 << 16) | 66,
		(1 << 16) | 1,
		0x00007c00,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(7 << 16) | 71,
		(1 << 16) | 1,
		0x00007fff,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	const texturedRectangleOpcode = GX_GPU_GP0_RECTANGLE_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((texturedRectangleOpcode << 24) | 0x808080) >>> 0,
		(18 << 16) | 28,
		0,
		(10 << 16) | 10,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, texturedRectangleOpcode, (GX_GPU_TEXTURE_MODE_DIRECT16 << 7) | 1, 0, 30 | (20 << 10), 35 | (25 << 10));
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_LINE_FIRST << 24) | 0x0000ff) >>> 0,
		0x07fe07fe,
		0x00080008,
	]), GX_GPU_COMMAND_DRAW_LINE, GX_GPU_GP0_LINE_FIRST, 0, 0, 40 | (20 << 10), 45 | (25 << 10), 40 | (20 << 11));
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_RECTANGLE_FIRST << 24) | 0xffffff) >>> 0,
		0x04000400,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST, 0, 0, 0, GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD, 0x00200400);

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	for (let row = 0; row < 4; row += 1) {
		for (let column = 0; column < 4 - row; column += 1) {
			assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(12 + column, 12 + row)], 0x001f);
		}
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(11, 12)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(12, 11)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(16, 12)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(12, 16)], 0);
	for (let y = 20; y <= 25; y += 1) {
		for (let x = 20; x <= 25; x += 1) {
			assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(x, y)], 0x03e0);
		}
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(19, 20)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(26, 25)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(20, 19)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(25, 26)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(30, 20)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(35, 20)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(30, 25)], 0x7c00);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(35, 25)], 0x7fff);
	for (let coord = 0; coord < 6; coord += 1) {
		assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40 + coord, 20 + coord)], 0x001f);
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(39, 19)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(46, 26)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x7fff);
});

test('GX-GPU software fill bypasses drawing-area and mask-bit drawing state', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	commandBuffer.reset();
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(30 << 16) | 80,
		(1 << 16) | 1,
		0x0000801f,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x00ff00) >>> 0,
		(30 << 16) | 80,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_FILL_RECTANGLE, GX_GPU_GP0_FILL_RECTANGLE, 0, 0, 0, 0, 0, 3);

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	for (let x = 80; x < 96; x += 1) {
		assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(x, 30)], 0x03e0);
	}
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(79, 30)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(96, 30)], 0);
});

test('GX-GPU software scanout consumes CPU upload, VRAM copy, and fill commands', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
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
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 0,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0,
	}, pixels);

	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);
	assertRgbaPixel(pixels, 1, 0, 0, 255, 0);
	assertRgbaPixel(pixels, 2, 0, 255, 0, 0);
	assertRgbaPixel(pixels, 3, 0, 0, 255, 0);
	assertRgbaPixel(pixels, 0, 1, 0, 0, 255);
	assertRgbaPixel(pixels, 15, 1, 0, 0, 255);
	assertRgbaPixel(pixels, 16, 1, 0, 0, 0);
});

test('GX-GPU software scanout renders the native target without host scaling', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	const pixels = new Uint8Array(256 * 212 * 4);
	const state = {
		width: 256,
		height: 192,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 900 | (400 << 10),
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0,
	};
	gxGpuSoftwareVram.fill(0);
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(900, 400)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(131, 400)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(900, 79)] = 0x7c00;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(900, 99)] = 0x7fff;
	scanoutGxGpuSoftwareVram(state, pixels);

	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);
	assertRgbaPixel(pixels, 255, 0, 0, 255, 0);
	assertRgbaPixel(pixels, 0, 191, 0, 0, 255);

	state.height = 212;
	scanoutGxGpuSoftwareVram(state, pixels);
	assertRgbaPixel(pixels, 0, 211, 255, 255, 255);
});

test('GX-GPU software backend retires consumed command logs without clearing VRAM', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
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
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 0,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0,
	};
	const pixels = new Uint8Array(GX_GPU_SOFTWARE_TEST_WIDTH * GX_GPU_SOFTWARE_TEST_HEIGHT * 4);
	renderGxGpuSoftwareFrame(state, pixels);
	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);

	commandBuffer.retireCommandsPreservingVram();
	renderGxGpuSoftwareFrame(state, pixels);
	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);

	pushSoftwareCommand(commandBuffer, new Uint32Array([
		(GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x00ff00,
		16 | (1 << 16),
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_FILL_RECTANGLE, GX_GPU_GP0_FILL_RECTANGLE);
	renderGxGpuSoftwareFrame(state, pixels);
	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);
	assertRgbaPixel(pixels, 16, 1, 0, 255, 0);

	commandBuffer.reset();
	renderGxGpuSoftwareFrame(state, pixels);
	assertRgbaPixel(pixels, 0, 0, 0, 0, 0);
	assertRgbaPixel(pixels, 16, 1, 0, 0, 0);
});

test('GX-GPU software scanout consumes solid polygon, rectangle, and line commands', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
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
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 0,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0,
	}, pixels);

	assertRgbaPixel(pixels, 5, 5, 255, 0, 0);
	assertRgbaPixel(pixels, 13, 13, 0, 0, 0);
	assertRgbaPixel(pixels, 20, 5, 0, 255, 0);
	assertRgbaPixel(pixels, 22, 6, 0, 255, 0);
	assertRgbaPixel(pixels, 30, 6, 0, 0, 255);
	assertRgbaPixel(pixels, 34, 6, 0, 0, 255);
});

test('GX-GPU software scanout consumes textured primitives', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
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
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 0,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0,
	}, pixels);

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
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(62, 20)], 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(60, 22)], 0);
});

test('GX-GPU software commands preserve texture mask, blend, and mask-test store semantics', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
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
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(30 << 16) | 10,
		(1 << 16) | 1,
		0x0000fc00,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(30 << 16) | 20,
		(1 << 16) | 1,
		0x0000fc00,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		(((GX_GPU_GP0_RECTANGLE_FIRST | 0x02) << 24) | 0x0000ff) >>> 0,
		(30 << 16) | 10,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST | 0x02);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		(((GX_GPU_GP0_RECTANGLE_FIRST | 0x02) << 24) | 0x0000ff) >>> 0,
		(30 << 16) | 20,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST | 0x02, 0, 0, 0, GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD, 0, 2);
	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 20)], 0x81ef);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(11, 20)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(12, 20)], 0x7c00);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(13, 20)], 0x801f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 30)], 0x3c0f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(20, 30)], 0xfc00);
});

test('GX-GPU software commands sample palette8, rectangle flip, and dithered modulation', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
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
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(4 << 16) | 64,
		(1 << 16) | 1,
		0x0000001f,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24,
		(4 << 16) | 319,
		(1 << 16) | 1,
		0x000003e0,
	]), GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, GX_GPU_GP0_CPU_TO_VRAM_FIRST);

	const rawTexturedRectangleOpcode = GX_GPU_GP0_RECTANGLE_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01;
	const palette8FlipPageWord = (GX_GPU_TEXTURE_MODE_PALETTE8 << 7) | GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP | 1;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedRectangleOpcode << 24) | 0x808080) >>> 0,
		(20 << 16) | 30,
		(0x0541 << 16) | (2 << 8) | 1,
		(1 << 16) | 2,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, rawTexturedRectangleOpcode, palette8FlipPageWord);
	const direct16FlipPageWord = (GX_GPU_TEXTURE_MODE_DIRECT16 << 7) | GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP | 1;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((rawTexturedRectangleOpcode << 24) | 0x808080) >>> 0,
		(20 << 16) | 40,
		4 << 8,
		(1 << 16) | 2,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, rawTexturedRectangleOpcode, direct16FlipPageWord);

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

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0);

	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(30, 20)], 0x7c00);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(31, 20)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 20)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(41, 20)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(22, 41)], 0x0010);
});

test('GX-GPU MMIO uses PSX GP0 data and GP1 status addresses', () => {
	const { memory } = createGpu();

	memory.writeMappedU32LE(IO_GX_GPU_GP0, 0x12345678);
	memory.writeMappedU32LE(IO_GX_GPU_GP1, (GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00000000);

	assert.equal(memory.readMappedU32LE(IO_GX_GPU_GP0), 0);
	assert.equal((memory.readMappedU32LE(IO_GX_GPU_GP1) & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	assert.equal((memory.readMappedU32LE(IO_GX_GPU_GP1) & GX_GPU_STATUS_PAL_MODE) >>> 0, 0);
});
