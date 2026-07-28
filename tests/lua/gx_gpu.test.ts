import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IO_GX_GPU_GP0,
	IO_GX_GPU_GP1,
	IO_GX_GTE_PLUS_BASE,
	IO_GX_PCRTC_TIMING_BASE,
	IO_IRQ_ACK,
	IO_IRQ_FLAGS,
	IRQ_GPU,
	IRQ_GX_PCRTC,
	IRQ_VBLANK,
} from '../../machine/ts/spec/bmsx/io';
import {
	GX_GPU_DRAW_MODE_DITHER_ENABLED,
	GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH,
	GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP,
	GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP,
	GX_GPU_TEXTURE_MODE_DIRECT16,
	GX_GPU_TEXTURE_MODE_PALETTE4,
	GX_GPU_TEXTURE_MODE_PALETTE8,
	gxGpuPolygonDrawModeWord,
	gxGpuPolygonTexturePageWordIndex,
	gxGpuTextureAttribute,
	gxGpuTransferHeight,
	gxGpuTransferWidth,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuSigned11,
} from '../../machine/ts/spec/gx/gp0';
import {
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_SKIPPED_LINE_NONE,
	GX_GPU_READBACK_IDLE,
	GX_GPU_READBACK_PENDING,
	GX_GPU_READBACK_READY,
	GX_GPU_READBACK_SUBMITTED,
	GxGpuCommandBuffer,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { GX_GPU_VRAM_BYTE_COUNT, GX_GPU_VRAM_WIDTH } from '../../machine/ts/spec/gx/vram';
import { GX_GPU_COMMAND_FIFO_WORD_CAPACITY } from '../../machine/ts/spec/gx/gp0';
import {
	GX_GPU_PCRTC_BGCOLOR_LOW,
	GX_GPU_PCRTC_CONFIG_WORD_COUNT,
	GX_GPU_PCRTC_COMPOSE_GENERIC,
	GX_GPU_PCRTC_CSR_FIELD,
	GX_GPU_PCRTC_CSR_FLUSH,
	GX_GPU_PCRTC_CSR_HIGH,
	GX_GPU_PCRTC_CSR_LOW,
	GX_GPU_PCRTC_CSR_RESET,
	GX_GPU_PCRTC_CSR_SIGNAL,
	GX_GPU_PCRTC_CSR_VSINT,
	GX_GPU_PCRTC_DISPFB1_HIGH,
	GX_GPU_PCRTC_DISPFB1_LOW,
	GX_GPU_PCRTC_DISPFB2_HIGH,
	GX_GPU_PCRTC_DISPFB2_LOW,
	GX_GPU_PCRTC_DISPLAY1_HIGH,
	GX_GPU_PCRTC_DISPLAY1_LOW,
	GX_GPU_PCRTC_DISPLAY2_HIGH,
	GX_GPU_PCRTC_DISPLAY2_LOW,
	GX_GPU_PCRTC_IMR_EVENT_MASK,
	GX_GPU_PCRTC_IMR_FIXED_BITS,
	GX_GPU_PCRTC_IMR_HIGH,
	GX_GPU_PCRTC_IMR_LOW,
	GX_GPU_PCRTC_PMODE_AMOD,
	GX_GPU_PCRTC_PMODE_EN1,
	GX_GPU_PCRTC_PMODE_EN2,
	GX_GPU_PCRTC_PMODE_LOW,
	GX_GPU_PCRTC_PMODE_MMOD,
	GX_GPU_PCRTC_PMODE_SLBG,
	GX_GPU_PCRTC_SAMPLE_LINEAR_GX16,
	GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB,
	GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA,
	GX_GPU_PCRTC_STORAGE_CT32,
	GX_GPU_PCRTC_RESET_CSR_WORD,
	GX_GPU_PCRTC_RESET_IMR_WORD,
	GX_GPU_PCRTC_SMODE1_HIGH,
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE1_SINT,
	GX_GPU_PCRTC_SMODE2_FFMD,
	GX_GPU_PCRTC_SMODE2_INT,
	GX_GPU_PCRTC_SMODE2_LOW,
	GX_GPU_PCRTC_SYNCH1_HIGH,
	GX_GPU_PCRTC_SYNCH1_LOW,
	GX_GPU_PCRTC_SYNCH2_LOW,
	GX_GPU_PCRTC_SYNCV_HIGH,
	GX_GPU_PCRTC_SYNCV_LOW,
	gxGpuPcrtcRegisterAddress,
	GxGpuPcrtcScanout,
	GxGpuPcrtcTiming,
} from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import {
	GX_GPU_PSGPU24,
	GX_GPU_PSMCT16,
	GX_GPU_PSMCT16S,
	GX_GPU_PSMCT24,
	GX_GPU_PSMCT32,
	GX_GPU_PSMGX16,
	gxGpuLocalMemoryAddress16,
	gxGpuLocalMemoryAddress16S,
	gxGpuLocalMemoryAddress32,
	gxGpuLocalMemoryAddressGpu24,
	gxGpuLocalMemoryAddressGx16,
} from '../../machine/ts/machine/devices/gx/gpu_local_memory';
import {
	GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT,
	GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT,
	GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD,
	GX_GPU_RESET_DISPLAY_MODE_WORD,
	GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
	gxGpuDisplayStartX,
	gxGpuDisplayStartY,
	gxGpuDisplayModeScreenWidth,
	gxGpuScanoutField,
	gxGpuScanoutSourceLineStep,
	gxGpuVerticalDisplayRangeEnd,
	gxGpuVerticalDisplayRangeStart,
	gxGpuVerticalVisibleLines,
} from '../../machine/ts/machine/devices/gx/gpu_display';
import {
	gxGpuCommandTextureEnabled,
	gxGpuCommandRawTextureEnabled,
	gxGpuCommandSemiTransparencyEnabled,
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuDrawModeTexturePageBaseY,
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
	gxGpuTexturedBatchDrawModeWord,
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
	GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK,
	GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
	GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES,
	gxGpuTriangleAttributePlane,
	gxGpuVramLogicalAreaOverlapsBounds,
} from '../../machine/ts/render/backend/gx_gpu_render_rules';
import {
	GX_GPU_DISPLAY_START_MASK,
	GX_GPU_DISPLAY_MODE_MASK,
	GX_GPU_DRAWING_AREA_MASK,
	GX_GPU_DRAWING_OFFSET_MASK,
	GX_GPU_DRAW_MODE_GPUSTAT_MASK,
	GX_GPU_DRAW_MODE_MASK,
	GX_GPU_INFO_GPU_TYPE_V2,
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
	GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION,
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
	GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH,
	GX_GPU_TEXTURE_WINDOW_MASK,
	GX_GPU_VERTICAL_DISPLAY_RANGE_MASK,
	GxGpu,
} from '../../machine/ts/machine/devices/gx/gpu';
import {
	GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
	GX_GPU_DMA_DIRECTION_FIFO,
	GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU,
	GX_GPU_GP0_CPU_TO_VRAM_FIRST,
	GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT,
	GX_GPU_GP0_DRAWING_AREA_TOP_LEFT,
	GX_GPU_GP0_DRAWING_OFFSET,
	GX_GPU_GP0_DRAW_MODE,
	GX_GPU_GP0_FILL_RECTANGLE,
	GX_GPU_GP0_IRQ_REQUEST,
	GX_GPU_GP0_LINE_FIRST,
	GX_GPU_GP0_MASK_BIT,
	GX_GPU_GP0_POLYGON_FIRST,
	GX_GPU_GP0_RECTANGLE_FIRST,
	GX_GPU_GP0_RENDER_GOURAUD_BIT,
	GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT,
	GX_GPU_GP0_RENDER_TEXTURE_BIT,
	GX_GPU_GP0_TEXTURE_WINDOW,
	GX_GPU_GP0_VRAM_TO_CPU_FIRST,
	GX_GPU_GP0_VRAM_TO_VRAM_FIRST,
} from '../../machine/ts/spec/gx/gp0';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { PSX_GPU_DISPLAY_MODE_PAL_WORD } from '../../machine/ts/machine/model_registry';
import { executeGxGpuSoftwareVramCommands, renderGxGpuSoftwareFrame } from '../../machine/ts/render/backend/software/gx_gpu';
import { executeGxGpuSoftwareCommands } from '../../machine/ts/render/backend/software/gx_gpu_commands';
import { scanoutGxGpuSoftwareVram } from '../../machine/ts/render/backend/software/gx_gpu_scanout';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import {
	gxGpuSoftwareBlendRgb555,
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
	const output = gpu.readDeviceOutput();
	assert.equal(output.commandBuffer.presentCommandCount, 0);
	new HeadlessGPUBackend().executeGxGpuReadback(gpu);

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
	const positionWord = (1023 << 16) | 1023;
	const sizeWord = (2 << 16) | 2;
	const vramBytes = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);
	let byteIndex = (1023 * GX_GPU_VRAM_WIDTH + 1023) << 1;
	vramBytes[byteIndex] = 0x11;
	vramBytes[byteIndex + 1] = 0x11;
	byteIndex = (1023 * GX_GPU_VRAM_WIDTH) << 1;
	vramBytes[byteIndex] = 0x22;
	vramBytes[byteIndex + 1] = 0x22;
	byteIndex = 1023 << 1;
	vramBytes[byteIndex] = 0x33;
	vramBytes[byteIndex + 1] = 0x33;
	vramBytes[0] = 0x44;
	vramBytes[1] = 0x44;
	gpu.replaceVramSnapshotBytes(vramBytes);
	gpu.writeGp1((GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24) | 1);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(positionWord);
	gpu.writeGp0(sizeWord);
	completeGpuCommands(gpu);
	new HeadlessGPUBackend().executeGxGpuReadback(gpu);
	assert.equal(gpu.readGp0(), 0x22221111);
	assert.equal(gpu.readGp0(), 0x44443333);
});

test('GX-GPU open Y gate exposes installed upper VRAM storage', () => {
	const { gpu } = createGpu();
	const vramBytes = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);
	vramBytes[0] = 0x34;
	vramBytes[1] = 0x12;
	gpu.replaceVramSnapshotBytes(vramBytes);
	gpu.writeGp1((GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24) | 1);
	gpu.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	gpu.writeGp0(512 << 16);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0(0x0000abcd);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_VRAM_FIRST << 24);
	gpu.writeGp0(512 << 16);
	gpu.writeGp0(513 << 16);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(513 << 16);
	gpu.writeGp0((1 << 16) | 1);
	completeGpuCommands(gpu);
	new HeadlessGPUBackend().executeGxGpuReadback(gpu);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x1234);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 512)], 0xabcd);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 513)], 0xabcd);
	assert.equal(gpu.readGp0(), 0xabcd);
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
	executeGxGpuSoftwareVramCommands(output, output.commandBuffer.presentCommandCount);
	gpu.retirePresentedCommands();
	assert.equal(gpu.readGp0(), 0x00001111);

	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	output = gpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output, output.commandBuffer.presentCommandCount);
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
	executeGxGpuSoftwareVramCommands(output, output.commandBuffer.presentCommandCount);
	assert.equal(output.readbackPort.phase, GX_GPU_READBACK_PENDING);
	assert.equal(gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM, 0);
	gpu.retirePresentedCommands();
	assert.equal(output.readbackPort.fenceCommandCount, 2);

	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	output = gpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output, output.commandBuffer.presentCommandCount);
	assert.equal(gpu.readGp0(), 0x00001234);
});

test('GX-GPU GP1 clear FIFO aborts a pending GPUREAD without dropping prior commands', () => {
	const { gpu } = createGpu();
	const powerOnWord16 = gpu.readVramSnapshotBytes()[32]! | (gpu.readVramSnapshotBytes()[33]! << 8);
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
	const vramSnapshotSerial = output.vramSnapshotSerial;
	const readbackToken = readback.token;
	assert.equal(commandBuffer.commandCount, 2);
	assert.equal(readback.phase, GX_GPU_READBACK_PENDING);

	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);

	assert.equal(commandBuffer.commandCount, 1);
	assert.equal(commandBuffer.presentCommandCount, 1);
	assert.equal(commandBuffer.wordCount, 3);
	assert.equal(commandBuffer.serial, commandSerial);
	assert.equal(gpu.readVramSnapshotSerial(), vramSnapshotSerial);
	assert.equal(readback.phase, GX_GPU_READBACK_IDLE);
	assert.notEqual(readback.token, readbackToken);
	assert.equal(gpu.readGp0(), GX_GPU_INFO_GPU_TYPE_V2);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);

	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(readback.phase, GX_GPU_READBACK_IDLE);
	const presentOutput = gpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(presentOutput, presentOutput.commandBuffer.presentCommandCount);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(16, 0)], powerOnWord16);
});

test('GX-GPU GP1 clear FIFO aborts a ready GPUREAD and its queued suffix', () => {
	const { gpu } = createGpu();
	const powerOnWord16 = gpu.readVramSnapshotBytes()[32]! | (gpu.readVramSnapshotBytes()[33]! << 8);
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
	let output = gpu.readDeviceOutput();
	const commandBuffer = output.commandBuffer;
	const readback = output.readbackPort;
	new HeadlessGPUBackend().executeGxGpuReadback(gpu);
	const readbackToken = readback.token;
	assert.equal(readback.phase, GX_GPU_READBACK_READY);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM) >>> 0, GX_GPU_STATUS_READY_TO_SEND_VRAM);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, GX_GPU_STATUS_DMA_DATA_REQUEST);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(commandBuffer.presentCommandCount, readback.fenceCommandCount);
	gpu.retirePresentedCommands();
	assert.equal(commandBuffer.commandCount, 0);
	assert.equal(readback.fenceCommandCount, 0);
	const commandSerialBeforeAbort = commandBuffer.serial;
	const vramSnapshotSerial = gpu.readVramSnapshotSerial();

	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);

	assert.equal(commandBuffer.commandCount, 0);
	assert.equal(commandBuffer.presentCommandCount, 0);
	assert.equal(commandBuffer.wordCount, 0);
	assert.notEqual(commandBuffer.serial, commandSerialBeforeAbort);
	assert.equal(gpu.readVramSnapshotSerial(), vramSnapshotSerial);
	assert.equal(readback.phase, GX_GPU_READBACK_IDLE);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_READY_TO_SEND_VRAM) >>> 0, 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, 0);
	assert.equal(gpu.readGp0(), GX_GPU_INFO_GPU_TYPE_V2);

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
	executeGxGpuSoftwareVramCommands(output, output.commandBuffer.presentCommandCount);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(16, 0)], powerOnWord16);
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
	assert.equal(commandBuffer.presentCommandCount, 0);
	new HeadlessGPUBackend().executeGxGpuReadback(gpu);
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

function gxGpuVramDigest(bytes: Uint8Array): number {
	let digest = 0x811c9dc5;
	for (let index = 0; index < bytes.byteLength; index += 1) {
		digest = Math.imul((digest ^ bytes[index]!) >>> 0, 0x01000193) >>> 0;
	}
	return digest;
}

function createGpu(): { memory: Memory; cpu: CPU; scheduler: DeviceScheduler; dma: DmaController; gpu: GxGpu } {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() });
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory));
	const scheduler = new DeviceScheduler(cpu);
	const dma = new DmaController(memory, cpu, irq, scheduler);
	const gpu = new GxGpu(memory, cpu, irq, scheduler, dma);
	dma.reset();
	gpu.reset();
	irq.reset();
	return { memory, cpu, scheduler, dma, gpu };
}

function stopPcrtc(memory: Memory, gpu: GxGpu, scheduler: DeviceScheduler): void {
	const address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(address, memory.readMappedU32LE(address) | GX_GPU_PCRTC_SMODE1_SINT);
	gpu.onService(scheduler.currentNowCycles());
}

function runGpuAtNextDeadline(gpu: GxGpu, scheduler: DeviceScheduler): number {
	const deadline = scheduler.nextDeadline();
	scheduler.advanceTo(deadline);
	return gpu.onService(deadline);
}

const standaloneCommandBufferDma = createGpu().dma;

test('GX-GPU decodes PSX GP0 signed vertex and rectangle size words', () => {
	assert.equal(gxGpuSigned11(0x000003ff), 1023);
	assert.equal(gxGpuSigned11(0x00000400), -1024);
	assert.equal(gxGpuSigned11(0x000007ff), -1);

	assert.equal(gxGpuSigned11(0x000007ff), -1);
	assert.equal(gxGpuVertexY(0x07ff0000), -1);
	assert.equal(gxGpuDisplayStartX(123 | (456 << 10)), 123);
	assert.equal(gxGpuDisplayStartY(123 | (456 << 10), 0), 456);
	assert.equal(gxGpuScanoutField(GX_GPU_STATUS_INTERLACED_FIELD), 0);
	assert.equal(gxGpuScanoutField(0), 1);
	assert.equal(gxGpuScanoutSourceLineStep(0), 0);
	assert.equal(gxGpuScanoutSourceLineStep(GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT), 1);
	assert.equal(gxGpuScanoutSourceLineStep(GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT | GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT), 2);
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
	assert.equal(gxGpuVramWrappedHeight(500, 12, 0), 12);
	assert.equal(gxGpuVramWrappedHeight(511, 511, 0), 1);
	assert.equal(gxGpuVramWrappedHeight(0, 511, 0), 511);
	assert.equal(gxGpuVramLogicalAreaOverlapsBounds(1008, 500, 32, 24, 0, 0, 8, 8, 0), true);
	assert.equal(gxGpuVramLogicalAreaOverlapsBounds(1008, 500, 32, 24, 512, 256, 520, 264, 0), false);
	assert.equal(gxGpuVramLogicalAreaOverlapsBounds(60, 8, 1, 1, 60, 520, 61, 521, 0), true);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 12, 24, 32, 16), true);
	assert.equal(gxGpuVramCopyChunkHeight(20, 24, 16), 4);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 10, 24, 32, 16), false);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 12, 20, 32, 16), false);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 50, 24, 32, 16), false);
	assert.equal(gxGpuVramCopyNeedsChunking(10, 20, 12, 40, 32, 16), false);
	assert.equal(gxGpuVramCopyChunkHeight(20, 80, 16), 16);
	const uvPlane = new Uint32Array(2 * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
	uvPlane.set([1, 2, 17, 2, 1, 18]);
	gxGpuTriangleAttributePlane(uvPlane, 0, 2, 256, 0, 0, 16, 0, 0, 16);
	assert.deepEqual([...uvPlane], [6144, 10240, 4096, 0, 0, 4096]);
	assert.equal((uvPlane[0] & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS, 1);
	assert.equal(((uvPlane[0] + uvPlane[2] * 16) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS, 17);
	assert.equal(((uvPlane[1] + uvPlane[5] * 16) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS, 18);

	assert.equal(gxGpuTransferX(0x01ff03ff), 1023);
	assert.equal(gxGpuTransferY(0x01ff03ff, 0), 511);
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
	assert.equal(gxGpuCommandTextureEnabled(0x24), true);
	assert.equal(gxGpuCommandTextureEnabled(0x20), false);
	assert.equal(gxGpuDrawModeTexturePageBaseY(GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, 0), 0);
	assert.equal(gxGpuDrawModeTexturePageBaseY(GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, 1), 512);
	assert.equal(gxGpuDrawModeDitherEnabled(GX_GPU_DRAW_MODE_DITHER_ENABLED), true);
	assert.equal(gxGpuDrawModeDitherEnabled(0), false);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_GOURAUD_BIT), true);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED, GX_GPU_GP0_POLYGON_FIRST), false);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT), true);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED | GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT), true);
	assert.equal(gxGpuDitheredPolygon(GX_GPU_DRAW_MODE_DITHER_ENABLED | GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_TEXTURE_BIT | GX_GPU_GP0_RENDER_GOURAUD_BIT), true);
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
	assert.equal(gxGpuTextureClutBaseY(0x01c3ab56, 0), 7);
	assert.equal(gxGpuDrawModeTexturePageBaseX(0x0013), 192);
	assert.equal(gxGpuDrawModeTexturePageBaseY(0x0013, 0), 256);
	assert.equal(gxGpuDrawModeTexturePageBaseY(0x0810, 0), 256);
	assert.equal(gxGpuDrawModeTextureMode(0x0100), GX_GPU_TEXTURE_MODE_DIRECT16);
	assert.equal(gxGpuDrawModeTransparencyMode(0x0060), 3);
	assert.equal(gxGpuTexturedBatchDrawModeWord(0x3b83, false), 0x0180);
	assert.equal(gxGpuTexturedBatchDrawModeWord(0x3be3, true), 0x01e0);
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
	assert.equal(gxGpuDrawingAreaTop(12 | (34 << 10), 20 | (40 << 10), 0), 34);
	assert.equal(gxGpuDrawingAreaRightExclusive(12 | (34 << 10), 20 | (40 << 10)), 21);
	assert.equal(gxGpuDrawingAreaBottomExclusive(12 | (34 << 10), 20 | (40 << 10), 0), 41);
	assert.equal(gxGpuDrawingAreaLeft(20 | (34 << 10), 12 | (40 << 10)), 0);
	assert.equal(gxGpuDrawingAreaRightExclusive(20 | (34 << 10), 12 | (40 << 10)), 0);
	assert.equal(gxGpuDrawingAreaTop(12 | (40 << 10), 20 | (34 << 10), 0), 0);
	assert.equal(gxGpuDrawingAreaBottomExclusive(12 | (40 << 10), 20 | (34 << 10), 0), 0);
	assert.equal(gxGpuDrawingAreaTop(12 | (600 << 10), 20 | (700 << 10), 1), 600);
	assert.equal(gxGpuDrawingAreaBottomExclusive(12 | (600 << 10), 20 | (700 << 10), 1), 701);
});

test('GX-GPU PCRTC decodes native PSX and PS2 output resolutions from raw words', () => {
	const words = new Uint32Array(GX_GPU_PCRTC_CONFIG_WORD_COUNT);
	words[GX_GPU_PCRTC_PMODE_LOW] = 0x0000ff21;
	words[GX_GPU_PCRTC_SMODE1_HIGH] = 0x00000007;
	words[GX_GPU_PCRTC_SYNCH1_LOW] = 0x1fc83030;
	words[GX_GPU_PCRTC_SYNCH1_HIGH] = 0x0007f5c2;
	words[GX_GPU_PCRTC_SYNCH2_LOW] = 0x003484bc;
	words[GX_GPU_PCRTC_SYNCV_HIGH] = 0x00a90005;
	const timing = new GxGpuPcrtcTiming();
	const scanout = new GxGpuPcrtcScanout();
	const modes = [
		[256, 240, 4, 0],
		[320, 240, 4, 0],
		[368, 240, 4, 0],
		[512, 240, 4, 0],
		[640, 240, 4, 0],
		[640, 480, 4, 1],
		[640, 448, 4, 1],
		[640, 512, 4, 1],
		[720, 480, 2, 0],
		[656, 576, 2, 0],
		[1280, 720, 1, 0],
		[1920, 1080, 1, 1],
	] as const;

	for (const [width, height, signalStep, interlaced] of modes) {
		words[GX_GPU_PCRTC_SMODE1_LOW] = ((0x40806504 & ~(0xf << 21)) | (signalStep << 21)) >>> 0;
		words[GX_GPU_PCRTC_SMODE2_LOW] = interlaced * GX_GPU_PCRTC_SMODE2_INT;
		words[GX_GPU_PCRTC_SYNCV_LOW] = interlaced !== 0 ? 0x02101401 : 0x02101404;
		words[GX_GPU_PCRTC_DISPLAY1_LOW] = (signalStep - 1) << 23;
		words[GX_GPU_PCRTC_DISPLAY1_HIGH] = (width * signalStep - 1) | ((height - 1) << 12);
		timing.update(words);
		scanout.update(words, timing);
		assert.equal(scanout.outputActive, true);
		assert.equal(scanout.outputWidth, width);
		assert.equal(scanout.outputHeight, height);
		assert.equal(scanout.interlaced, interlaced !== 0);
		assert.equal(scanout.circuits[0].sourceAdvanceX, 1);
	}

	words[GX_GPU_PCRTC_PMODE_LOW] = 0x0000ff23;
	words[GX_GPU_PCRTC_SMODE1_LOW] = 0x40206504;
	words[GX_GPU_PCRTC_SMODE2_LOW] = 0;
	words[GX_GPU_PCRTC_DISPLAY1_LOW] = 0;
	words[GX_GPU_PCRTC_DISPLAY1_HIGH] = 0;
	words[GX_GPU_PCRTC_DISPLAY2_LOW] = 0x0fff | (0x07ff << 12);
	words[GX_GPU_PCRTC_DISPLAY2_HIGH] = 0x0fff | (0x07ff << 12);
	timing.update(words);
	scanout.update(words, timing);
	assert.equal(scanout.outputWidth, 8191);
	assert.equal(scanout.outputHeight, 4095);
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

test('GX-GPU owns deterministic power-on VRAM across reset, save-state, and machine recreation', () => {
	const first = createGpu().gpu;
	const firstBytes = first.readVramSnapshotBytes();
	const firstSerial = first.readVramSnapshotSerial();
	const firstReplacementSerial = first.readVramReplacementSerial();
	const powerOnWord0 = firstBytes[0]! | (firstBytes[1]! << 8);

	assert.equal(firstBytes[0], 38);
	assert.equal(firstBytes[31], 144);
	assert.equal(firstBytes[32], 185);
	assert.equal(firstBytes[255], 162);
	assert.equal(firstBytes[256], 51);
	assert.equal(firstBytes[4095], 83);
	assert.equal(firstBytes[4096], 130);
	assert.equal(firstBytes[65535], 92);
	assert.equal(firstBytes[65536], 58);
	assert.equal(firstBytes[GX_GPU_VRAM_BYTE_COUNT - 1], 187);
	assert.equal(gxGpuVramDigest(firstBytes), 0xb3ba77ea);

	let output = first.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output, output.commandBuffer.presentCommandCount);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], powerOnWord0);
	first.writeGp0(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	first.writeGp0(0);
	first.writeGp0((1 << 16) | 1);
	first.writeGp0(0x00001234);
	completeGpuCommands(first);
	first.presentReadyFrameOnVblankEdge();
	output = first.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output, output.commandBuffer.presentCommandCount);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x1234);

	const second = createGpu().gpu;
	assert.ok(second.readVramSnapshotSerial() > firstSerial);
	assert.ok(second.readVramReplacementSerial() > firstReplacementSerial);
	output = second.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output, output.commandBuffer.presentCommandCount);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], powerOnWord0);

	const gp1Serial = second.readVramSnapshotSerial();
	const gp1ReplacementSerial = second.readVramReplacementSerial();
	second.writeGp1(GX_GPU_GP1_RESET << 24);
	assert.equal(second.readVramSnapshotSerial(), gp1Serial);
	assert.equal(second.readVramReplacementSerial(), gp1ReplacementSerial);
	assert.equal(gxGpuVramDigest(second.readVramSnapshotBytes()), 0xb3ba77ea);
	second.reset();
	assert.ok(second.readVramSnapshotSerial() > gp1Serial);
	assert.ok(second.readVramReplacementSerial() > gp1ReplacementSerial);
	assert.equal(gxGpuVramDigest(second.readVramSnapshotBytes()), 0xb3ba77ea);

	const restoredBytes = second.readVramSnapshotBytes().slice();
	const upperByteIndex = GX_GPU_VRAM_BYTE_COUNT >> 1;
	restoredBytes[0] = 0x5a;
	restoredBytes[upperByteIndex] = 0xa5;
	second.replaceVramSnapshotBytes(restoredBytes);
	const saveState = second.captureSaveState();
	const savedSerial = second.readVramSnapshotSerial();
	const savedReplacementSerial = second.readVramReplacementSerial();
	second.reset();
	second.restoreSaveState(saveState);
	assert.ok(second.readVramSnapshotSerial() > savedSerial);
	assert.ok(second.readVramReplacementSerial() > savedReplacementSerial);
	assert.equal(second.readVramSnapshotBytes()[0], 0x5a);
	assert.equal(second.readVramSnapshotBytes()[upperByteIndex], 0xa5);
});

test('GX-GPU GP1 reset restores registers and preserves accepted GPU work', () => {
	const { gpu } = createGpu();
	const commandBuffer = gpu.readDeviceOutput().commandBuffer;
	const commandSerial = commandBuffer.serial;
	const vramSnapshotSerial = gpu.readVramSnapshotSerial();

	gpu.writeGp1((GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24) | 1);
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
	assert.equal(gpu.readVramSnapshotSerial(), vramSnapshotSerial);
	assert.equal(gpu.readGp0(), 0x00054321);
	assert.equal(gpu.readVramYAddressExtensionWord(), 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH) >>> 0, 0);
	assert.equal(gpu.readDisplayModeWord(), GX_GPU_RESET_DISPLAY_MODE_WORD);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_PAL_MODE) >>> 0, GX_GPU_STATUS_PAL_MODE);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_RESET_WORD) >>> 0, GX_GPU_STATUS_RESET_WORD);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH);
	completeGpuCommands(gpu);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH) >>> 0, GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH);
	gpu.presentReadyFrameOnVblankEdge();
	gxGpuSoftwareVram.fill(0);
	assert.equal(executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount), 2);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(32, 0)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(33, 0)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(34, 0)], 0);

	gpu.reset();
	assert.equal(commandBuffer.commandCount, 0);
	assert.ok(gpu.readVramSnapshotSerial() > vramSnapshotSerial);
	assert.equal(gpu.readGp0(), 0);
});

test('GX-GPU mirrors type-2 GP1 display mode fields into GPUSTAT bits', () => {
	const { gpu } = createGpu();

	gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00ffffff);

	assert.equal(gpu.readDisplayModeWord(), GX_GPU_DISPLAY_MODE_MASK);
	assert.equal(
		(gpu.readStatus() & (
			GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2
			| GX_GPU_STATUS_VERTICAL_RESOLUTION
			| GX_GPU_STATUS_PAL_MODE
			| GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24
			| GX_GPU_STATUS_VERTICAL_INTERLACE
		)) >>> 0,
		(
			GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2
			| GX_GPU_STATUS_VERTICAL_RESOLUTION
			| GX_GPU_STATUS_PAL_MODE
			| GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24
			| GX_GPU_STATUS_VERTICAL_INTERLACE
		) >>> 0,
	);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_REVERSE_FLAG) >>> 0, 0);
	assert.equal((gpu.readStatus() & (0x3 << 17)) >>> 0, 0x3 << 17);
});

test('GX-GPU mirrors PSX GPUSTAT interlaced field and scanout line bits', () => {
	const { memory, scheduler, gpu } = createGpu();
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCV_LOW), 0x02101401);
	gpu.setTiming(5_000_000, 0);
	gpu.onService(0);
	gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00000000);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, 0);

	scheduler.advanceTo(320);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, GX_GPU_STATUS_DISPLAY_LINE_LSB >>> 0);
	gpu.writeGp1((GX_GPU_GP1_DISPLAY_START << 24) | (7 << 10));
	gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00000024);
	gpu.onService(320);
	runGpuAtNextDeadline(gpu, scheduler);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(gpu.lastFrameCommitted(), true);
	runGpuAtNextDeadline(gpu, scheduler);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_INTERLACED_FIELD) >>> 0, 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, GX_GPU_STATUS_DISPLAY_LINE_LSB >>> 0);
	runGpuAtNextDeadline(gpu, scheduler);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_INTERLACED_FIELD) >>> 0, 0);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0, 0);

	runGpuAtNextDeadline(gpu, scheduler);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(gpu.lastFrameCommitted(), true);

	gpu.reset();
	assert.equal(
		(gpu.readStatus() & (GX_GPU_STATUS_INTERLACED_FIELD | GX_GPU_STATUS_DISPLAY_LINE_LSB)) >>> 0,
		GX_GPU_STATUS_INTERLACED_FIELD >>> 0,
	);
	assert.equal(gpu.readDeviceOutput().displayModeWord, GX_GPU_RESET_DISPLAY_MODE_WORD);
	assert.equal(gpu.lastFrameCommitted(), false);
});

test('GX-GPU state restore preserves interlaced field latches', () => {
	const { memory, gpu, scheduler } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCV_LOW), 0x02101401);
	gpu.setTiming(5_000_000, 0);
	gpu.onService(0);
	gpu.writeGp1((GX_GPU_GP1_DISPLAY_START << 24) | (7 << 10));
	gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00000024);
	runGpuAtNextDeadline(gpu, scheduler);
	runGpuAtNextDeadline(gpu, scheduler);
	runGpuAtNextDeadline(gpu, scheduler);
	const saved = gpu.captureState();
	assert.equal(
		(gpu.readStatus() & (GX_GPU_STATUS_INTERLACED_FIELD | GX_GPU_STATUS_DISPLAY_LINE_LSB)) >>> 0,
		GX_GPU_STATUS_DISPLAY_LINE_LSB >>> 0,
	);

	runGpuAtNextDeadline(gpu, scheduler);
	runGpuAtNextDeadline(gpu, scheduler);
	runGpuAtNextDeadline(gpu, scheduler);
	assert.equal(
		(gpu.readStatus() & (GX_GPU_STATUS_INTERLACED_FIELD | GX_GPU_STATUS_DISPLAY_LINE_LSB)) >>> 0,
		(GX_GPU_STATUS_INTERLACED_FIELD | GX_GPU_STATUS_DISPLAY_LINE_LSB) >>> 0,
	);

	gpu.restoreState(saved);
	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00010203);
	gpu.writeGp0(0);
	gpu.writeGp0(1);
	gpu.writeGp0(2);
	assert.equal(commands.commandSkippedLineParity[0], 0);
	assert.equal(
		(gpu.readStatus() & (GX_GPU_STATUS_INTERLACED_FIELD | GX_GPU_STATUS_DISPLAY_LINE_LSB)) >>> 0,
		GX_GPU_STATUS_DISPLAY_LINE_LSB >>> 0,
	);
});

test('GX-GPU tags PSX interlaced render commands with active field parity', () => {
	const { gpu } = createGpu();
	const commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp1((GX_GPU_GP1_DISPLAY_START << 24) | (7 << 10));
	gpu.writeGp1((GX_GPU_GP1_DISPLAY_MODE << 24) | 0x00000024);
	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00010203);
	gpu.writeGp0(0x00000000);
	gpu.writeGp0(0x00000001);
	gpu.writeGp0(0x00000002);

	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandSkippedLineParity[0], 1);
	completeGpuCommands(gpu);

	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | (1 << 10));
	gpu.writeGp0((GX_GPU_GP0_POLYGON_FIRST << 24) | 0x00010203);
	gpu.writeGp0(0x00000000);
	gpu.writeGp0(0x00000001);
	gpu.writeGp0(0x00000002);
	completeGpuCommands(gpu);

	assert.equal(commands.commandCount, 2);
	assert.equal(commands.commandSkippedLineParity[1], GX_GPU_SKIPPED_LINE_NONE);
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
	assert.equal(executeGxGpuSoftwareCommands(commands, 0, commands.presentCommandCount), 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.presentCommandCount, 0);

	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(executeGxGpuSoftwareCommands(commands, 0, commands.presentCommandCount), 1);
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
	assert.equal(executeGxGpuSoftwareCommands(commands, 0, commands.presentCommandCount), 1);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0x001f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(32, 0)], 0);

	gpu.retirePresentedCommands();
	assert.deepEqual([commands.commandCount, commands.presentCommandCount], [1, 0]);
	completeGpuCommands(gpu);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(executeGxGpuSoftwareCommands(commands, 0, commands.presentCommandCount), 1);
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

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_FIFO);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DIRECTION_MASK) >>> 0, GX_GPU_DMA_DIRECTION_FIFO << GX_GPU_STATUS_DMA_DIRECTION_SHIFT);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, GX_GPU_STATUS_DMA_DATA_REQUEST);

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
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_READY_TO_SEND_VRAM) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, 0);

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, 0);

	gpu.writeGp0(0x00000000);
	gpu.writeGp0(0x00000001);
	gpu.writeGp0(0x00000002);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, GX_GPU_STATUS_DMA_DATA_REQUEST);
	for (let index = 0; index < 4; index += 1) {
		gpu.writeGp0(0x03000000);
	}
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, 0);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_FIFO);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, GX_GPU_STATUS_DMA_DATA_REQUEST);
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

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	gpu.writeGp0(((GX_GPU_GP0_LINE_FIRST | GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) << 24) | 0x0000ff);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, 0);
	gpu.writeGp0(0x00010002);
	gpu.writeGp0(0x00020003);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, 0);
	gpu.writeGp0(0x50005000);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	assert.equal((status & GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0, GX_GPU_STATUS_DMA_DATA_REQUEST);
	assert.equal(commands.commandCount, 3);
	completeGpuCommands(gpu);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);

	gpu.writeGp0(GX_GPU_GP0_FILL_RECTANGLE << 24);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	status = gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
});

test('GX-GPU command timing gates GPUSTAT idle and the VBLANK execution frontier', () => {
	const { memory, gpu, scheduler } = createGpu();
	stopPcrtc(memory, gpu, scheduler);
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

test('GX-GPU ingress bypasses the physical FIFO only at command boundaries', () => {
	const { memory, gpu, scheduler } = createGpu();
	stopPcrtc(memory, gpu, scheduler);

	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000aa);
	gpu.writeGp0((GX_GPU_GP0_DRAWING_AREA_TOP_LEFT << 24) | 0x00012345);
	gpu.writeGp0((1 << 16) | 1);
	assert.equal(gpu.readDrawingAreaTopLeftWord(), 0);
	assert.equal(gpu.captureState().gp0FifoWords.length, 3);
	for (let index = 0; index < GX_GPU_COMMAND_FIFO_WORD_CAPACITY * 2; index += 1) {
		gpu.writeGp0(0);
	}
	gpu.writeGp0(0x04000000);
	gpu.writeGp0(0x1e000000);
	gpu.writeGp0(0xe0000000);
	gpu.writeGp0(0xe7000000);
	gpu.writeGp0(0xef000000);
	gpu.writeGp0((GX_GPU_GP0_DRAWING_AREA_TOP_LEFT << 24) | 0x00054321);
	gpu.writeGp0((GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT << 24) | 0x00023456);
	gpu.writeGp0((GX_GPU_GP0_DRAWING_OFFSET << 24) | 0x00345678);
	const bypassedState = gpu.captureState();
	assert.equal(bypassedState.gp0FifoWords.length, 3);
	assert.equal(gpu.readDrawingAreaTopLeftWord(), 0x00054321 & GX_GPU_DRAWING_AREA_MASK);
	assert.equal(gpu.readDrawingAreaBottomRightWord(), 0x00023456 & GX_GPU_DRAWING_AREA_MASK);
	assert.equal(gpu.readDrawingOffsetWord(), 0x00345678 & GX_GPU_DRAWING_OFFSET_MASK);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), true);
	assert.equal(scheduler.nextDeadline(), 29);
	for (let index = 3; index < GX_GPU_COMMAND_FIFO_WORD_CAPACITY; index += 1) {
		gpu.writeGp0(0x03000000 | index);
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
	gpu.writeGp1((GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24) | 0x00ffffff);

	assert.equal(gpu.readDisplayStartWord(), GX_GPU_DISPLAY_START_MASK);
	assert.equal(gpu.readHorizontalDisplayRangeWord(), GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readVerticalDisplayRangeWord(), GX_GPU_VERTICAL_DISPLAY_RANGE_MASK);
	assert.equal(gpu.readVramYAddressExtensionWord(), 1);

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

test('GX-GPU does not mirror undefined GP1 40h to reset', () => {
	const { gpu } = createGpu();

	gpu.writeGp1(GX_GPU_GP1_DISPLAY_MODE << 24);
	gpu.writeGp1(0x40000000);
	assert.equal(gpu.readDisplayModeWord(), 0);
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

test('GX-GPU PCRTC owns live CSR events, IMR masking, and its separate IRQ source', () => {
	const { memory, gpu, scheduler } = createGpu();
	gpu.setTiming(5_000_000, 0);
	gpu.onService(0);
	const csrLow = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_CSR_LOW);
	const csrHigh = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_CSR_HIGH);
	const imrLow = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_IMR_LOW);
	const imrHigh = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_IMR_HIGH);
	assert.equal(memory.readMappedU32LE(csrLow), GX_GPU_PCRTC_RESET_CSR_WORD);
	assert.equal(memory.readMappedU32LE(imrLow), GX_GPU_PCRTC_RESET_IMR_WORD);
	assert.equal(memory.readMappedU32LE(csrHigh), 0);
	assert.equal(memory.readMappedU32LE(imrHigh), 0);
	memory.writeMappedU32LE(csrHigh, 0xffffffff);
	memory.writeMappedU32LE(imrHigh, 0xffffffff);
	memory.writeMappedU32LE(csrLow, 0xfffffc00);
	assert.equal(memory.readMappedU32LE(csrLow), GX_GPU_PCRTC_RESET_CSR_WORD);
	assert.equal(memory.readMappedU32LE(imrLow), GX_GPU_PCRTC_RESET_IMR_WORD);

	runGpuAtNextDeadline(gpu, scheduler);
	runGpuAtNextDeadline(gpu, scheduler);
	runGpuAtNextDeadline(gpu, scheduler);
	const firstVsyncCsr = memory.readMappedU32LE(csrLow);
	assert.equal(firstVsyncCsr & (GX_GPU_PCRTC_CSR_FIELD | GX_GPU_PCRTC_CSR_VSINT), GX_GPU_PCRTC_CSR_FIELD | GX_GPU_PCRTC_CSR_VSINT);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & (IRQ_GX_PCRTC | IRQ_VBLANK), 0);
	const unmaskVsync = GX_GPU_PCRTC_IMR_EVENT_MASK & ~(GX_GPU_PCRTC_CSR_VSINT << 8);
	memory.writeMappedU32LE(imrLow, unmaskVsync);
	assert.equal(memory.readMappedU32LE(imrLow), (unmaskVsync | GX_GPU_PCRTC_IMR_FIXED_BITS) >>> 0);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & (IRQ_GX_PCRTC | IRQ_VBLANK), IRQ_GX_PCRTC);
	memory.writeMappedU32LE(IO_IRQ_ACK, IRQ_GX_PCRTC);
	memory.writeMappedU32LE(imrLow, unmaskVsync);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GX_PCRTC, 0);
	const unmaskVsyncAndSignal = unmaskVsync & ~(GX_GPU_PCRTC_CSR_SIGNAL << 8);
	memory.writeMappedU32LE(imrLow, unmaskVsyncAndSignal);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GX_PCRTC, 0);
	memory.writeMappedU32LE(imrLow, GX_GPU_PCRTC_IMR_EVENT_MASK);
	memory.writeMappedU32LE(imrLow, unmaskVsync);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GX_PCRTC, IRQ_GX_PCRTC);
	memory.writeMappedU32LE(csrLow, GX_GPU_PCRTC_CSR_VSINT);
	assert.equal(memory.readMappedU32LE(csrLow) & GX_GPU_PCRTC_CSR_VSINT, 0);
	assert.equal(memory.readMappedU32LE(csrLow) & GX_GPU_PCRTC_CSR_FIELD, GX_GPU_PCRTC_CSR_FIELD);
	memory.writeMappedU32LE(IO_IRQ_ACK, IRQ_GX_PCRTC);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GX_PCRTC, 0);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SYNCV_LOW), 0x02101405);
	gpu.onService(scheduler.currentNowCycles());
	runGpuAtNextDeadline(gpu, scheduler);
	runGpuAtNextDeadline(gpu, scheduler);
	assert.equal(memory.readMappedU32LE(csrLow) & GX_GPU_PCRTC_CSR_FIELD, 0);
	assert.equal(memory.readMappedU32LE(csrLow) & GX_GPU_PCRTC_CSR_VSINT, GX_GPU_PCRTC_CSR_VSINT);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & (IRQ_GX_PCRTC | IRQ_VBLANK), IRQ_GX_PCRTC);
});

test('GX-GPU PCRTC CSR FLUSH and RESET execute owner actions without latching action bits', () => {
	const { memory, gpu } = createGpu();
	const csrLow = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_CSR_LOW);
	const pmodeLow = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_PMODE_LOW);
	gpu.presentReadyFrameOnVblankEdge();
	gpu.retirePresentedCommands();
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(gpu.lastFrameCommitted(), false);
	gpu.writeGp0(GX_GPU_GP0_POLYGON_FIRST << 24);
	assert.equal(gpu.captureState().gp0CommandWordCount, 1);
	memory.writeMappedU32LE(csrLow, GX_GPU_PCRTC_CSR_FLUSH);
	assert.equal(gpu.captureState().gp0CommandWordCount, 0);
	assert.equal(memory.readMappedU32LE(csrLow) & GX_GPU_PCRTC_CSR_FLUSH, 0);
	memory.writeMappedU32LE(pmodeLow, GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2);
	assert.equal(memory.readMappedU32LE(pmodeLow), GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2);
	memory.writeMappedU32LE(csrLow, GX_GPU_PCRTC_CSR_RESET);
	assert.equal(memory.readMappedU32LE(pmodeLow), 0);
	assert.equal(memory.readMappedU32LE(csrLow), GX_GPU_PCRTC_RESET_CSR_WORD);
	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_IMR_LOW)), GX_GPU_PCRTC_RESET_IMR_WORD);
	assert.equal(gpu.readDeviceOutput().pcrtcScanout.outputActive, false);
	assert.deepEqual([gpu.readDeviceOutput().pcrtcScanout.outputWidth, gpu.readDeviceOutput().pcrtcScanout.outputHeight], [0, 0]);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(gpu.lastFrameCommitted(), true);
	gpu.retirePresentedCommands();
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(gpu.lastFrameCommitted(), false);
});

test('GX-GPU handles PSX GP0 draw mode and mask-bit environment commands', () => {
	const { gpu } = createGpu();

	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x00ffffff);
	completeGpuCommands(gpu);

	assert.equal(gpu.readDrawModeWord(), GX_GPU_DRAW_MODE_MASK);
	assert.equal((gpu.readStatus() & GX_GPU_DRAW_MODE_GPUSTAT_MASK) >>> 0, GX_GPU_DRAW_MODE_GPUSTAT_MASK);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH) >>> 0, GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_DITHER_ENABLED) >>> 0, GX_GPU_DRAW_MODE_DITHER_ENABLED);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP);

	gpu.writeGp1((GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24) | 1);
	assert.equal(gpu.readVramYAddressExtensionWord(), 1);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH) >>> 0, GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x00ffffff);
	completeGpuCommands(gpu);
	assert.equal(gpu.readDrawModeWord(), GX_GPU_DRAW_MODE_MASK);
	assert.equal((gpu.readStatus() & GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH) >>> 0, GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH);

	gpu.writeGp0((GX_GPU_GP0_MASK_BIT << 24) | 0x00000003);
	completeGpuCommands(gpu);
	assert.equal(gpu.readMaskBitModeWord(), 3);
	assert.equal((gpu.readStatus() & ((1 << 11) | (1 << 12))) >>> 0, (3 << 11) >>> 0);
	assert.equal((gpu.readDrawModeWord() & GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH) >>> 0, GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH);
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
	assert.equal(gpu.readGpuReadWord(), GX_GPU_INFO_GPU_TYPE_V2);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x0a);
	assert.equal(gpu.readGpuReadWord(), GX_GPU_INFO_GPU_TYPE_V2);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x08);
	assert.equal(gpu.readGpuReadWord(), 0);
	gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO_LAST << 24) | 0x07);
	assert.equal(gpu.readGpuReadWord(), GX_GPU_INFO_GPU_TYPE_V2);
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

test('GX-GPU supervisor context preserves a partial CPU-to-VRAM packet exactly', () => {
	const { gpu } = createGpu();
	const commandWord = (GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24) >>> 0;
	const destinationWord = 0x00010002;
	const sizeWord = 4 | (1 << 16);
	const firstPayloadWord = 0x22221111;
	const finalPayloadWord = 0x44443333;
	gpu.writeGp0(commandWord);
	gpu.writeGp0(destinationWord);
	gpu.writeGp0(sizeWord);
	gpu.writeGp0(firstPayloadWord);
	const partial = gpu.captureState();
	assert.equal(partial.gp0ImageLoadWordsRemaining, 1);
	assert.equal(partial.commandBuffer.commandCount, 0);
	assert.deepEqual(partial.commandBuffer.words, [commandWord, destinationWord, sizeWord, firstPayloadWord]);

	gpu.beginSupervisorControlQuiesce();
	gpu.beginSupervisorQuiesce();
	assert.equal(gpu.supervisorQuiescent(), true);
	gpu.enterSupervisorContext();
	assert.equal(gpu.captureState().commandBuffer.wordCount, 0);
	gpu.leaveSupervisorContext();

	const restored = gpu.captureState();
	assert.equal(restored.gp0IngressPhase, partial.gp0IngressPhase);
	assert.equal(restored.gp0ImageLoadWordsRemaining, partial.gp0ImageLoadWordsRemaining);
	assert.equal(restored.gp0ImageLoadCommandWordStart, partial.gp0ImageLoadCommandWordStart);
	assert.equal(restored.gp0ImageLoadCommandWordCount, partial.gp0ImageLoadCommandWordCount);
	assert.equal(restored.gp0ImageLoadCommandOpcode, partial.gp0ImageLoadCommandOpcode);
	assert.deepEqual(restored.commandBuffer.words, partial.commandBuffer.words);

	gpu.writeGp0(finalPayloadWord);
	const commands = gpu.readDeviceOutput().commandBuffer;
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(commands.commandWordCount[0], 5);
	assert.deepEqual(
		Array.from(commands.words.subarray(commands.commandWordStart[0], commands.commandWordStart[0] + 5)),
		[commandWord, destinationWord, sizeWord, firstPayloadWord, finalPayloadWord],
	);
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
	imageGpu.writeGp0((GX_GPU_GP0_DRAWING_AREA_TOP_LEFT << 24) | 0x00123456);
	imageGpu.writeGp0((2 << 16) | 2);
	imageGpu.writeGp0((GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT << 24) | 0x001f03e0);
	assert.equal(imageGpu.readDrawingAreaTopLeftWord(), 0);
	assert.equal(imageGpu.readDrawingAreaBottomRightWord(), 0);

	const { gpu: restoredImageGpu } = createGpu();
	restoredImageGpu.restoreState(imageGpu.captureState());
	restoredImageGpu.writeGp0((GX_GPU_GP0_DRAWING_OFFSET << 24) | 0x0000ffff);
	const imageCommands = restoredImageGpu.readDeviceOutput().commandBuffer;
	assert.equal(imageCommands.commandCount, 1);
	assert.equal(imageCommands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
	assert.equal(imageCommands.commandWordCount[0], 5);
	assert.equal(imageCommands.words[imageCommands.commandWordStart[0] + 3], ((GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT << 24) | 0x001f03e0) >>> 0);
	assert.equal(imageCommands.words[imageCommands.commandWordStart[0] + 4], ((GX_GPU_GP0_DRAWING_OFFSET << 24) | 0x0000ffff) >>> 0);
	assert.equal(restoredImageGpu.readDrawingAreaTopLeftWord(), 0);
	assert.equal(restoredImageGpu.readDrawingAreaBottomRightWord(), 0);
	assert.equal(restoredImageGpu.readDrawingOffsetWord(), 0);

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

	const { gpu: gouraudPolylineGpu } = createGpu();
	gouraudPolylineGpu.writeGp0((0x58 << 24) | 0x0000ff);
	gouraudPolylineGpu.writeGp0(0x00010002);
	gouraudPolylineGpu.writeGp0(0x00010203);
	gouraudPolylineGpu.writeGp0(0x00020003);
	gouraudPolylineGpu.writeGp0(0x00040506);

	const { gpu: restoredGouraudPolylineGpu } = createGpu();
	restoredGouraudPolylineGpu.restoreState(gouraudPolylineGpu.captureState());
	restoredGouraudPolylineGpu.writeGp0(0x50005000);
	assert.equal(restoredGouraudPolylineGpu.readDeviceOutput().commandBuffer.commandCount, 0);
	restoredGouraudPolylineGpu.writeGp0(0x50005000);
	const gouraudPolylineCommands = restoredGouraudPolylineGpu.readDeviceOutput().commandBuffer;
	assert.equal(gouraudPolylineCommands.commandCount, 1);
	assert.equal(gouraudPolylineCommands.commandKind[0], GX_GPU_COMMAND_DRAW_POLYLINE);
	assert.equal(gouraudPolylineCommands.commandWordCount[0], 6);
	assert.equal(gouraudPolylineCommands.words[gouraudPolylineCommands.commandWordStart[0] + 5], 0x50005000);
});

test('GX-GPU save-state restores command time and FIFO suffix relative to scheduler time', () => {
	const { memory, gpu, scheduler } = createGpu();
	stopPcrtc(memory, gpu, scheduler);
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 1);
	gpu.writeGp0((GX_GPU_GP0_DRAW_MODE << 24) | 0x000123);
	scheduler.advanceTo(10);
	const state = gpu.captureState();
	assert.equal(state.gp0FifoWords.length, 1);
	assert.deepEqual(state.gp0FifoWords, [((GX_GPU_GP0_DRAW_MODE << 24) | 0x000123) >>> 0]);
	assert.equal(state.pendingCommandCycles, 19);
	assert.equal(state.commandBuffer.executedCommandCount, 0);

	const restored = createGpu();
	restored.scheduler.advanceTo(100);
	restored.gpu.restoreState(state);
	restored.gpu.onService(100);
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

test('GX-GPU GP1 clear completes accepted draws and cuts C0 at the execution frontier', () => {
	const active = createGpu();
	stopPcrtc(active.memory, active.gpu, active.scheduler);
	active.gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x07);
	active.gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	active.gpu.writeGp0(0);
	active.gpu.writeGp0((1 << 16) | 1);
	active.gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	active.gpu.writeGp0(0);
	active.gpu.writeGp0((1 << 16) | 1);
	const fillDeadline = active.scheduler.nextDeadline();
	active.scheduler.advanceTo(fillDeadline);
	active.gpu.onService(fillDeadline);
	const activeCommands = active.gpu.readDeviceOutput().commandBuffer;
	assert.equal(activeCommands.commandCount, 2);
	assert.equal(activeCommands.executedCommandCount, 1);
	assert.equal(activeCommands.readback.phase, GX_GPU_READBACK_IDLE);
	assert.equal(active.scheduler.nextDeadline(), fillDeadline + 1);

	active.gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	assert.equal(activeCommands.commandCount, 1);
	assert.equal(activeCommands.executedCommandCount, 1);
	assert.equal(activeCommands.wordCount, 3);
	assert.equal(activeCommands.readback.phase, GX_GPU_READBACK_IDLE);
	assert.equal(active.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	assert.equal(active.gpu.readGp0(), GX_GPU_INFO_GPU_TYPE_V2);
	const status = active.gpu.readStatus();
	assert.equal((status & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
	assert.equal((status & GX_GPU_STATUS_READY_TO_SEND_VRAM) >>> 0, 0);
	assert.equal((status & GX_GPU_STATUS_READY_TO_RECEIVE_DMA) >>> 0, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);

	const queued = createGpu();
	stopPcrtc(queued.memory, queued.gpu, queued.scheduler);
	queued.gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	queued.gpu.writeGp0(0);
	queued.gpu.writeGp0((1 << 16) | 1);
	queued.gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	queued.gpu.writeGp0(0);
	queued.gpu.writeGp0((1 << 16) | 1);
	queued.gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
	const queuedCommands = queued.gpu.readDeviceOutput().commandBuffer;
	assert.equal(queuedCommands.commandCount, 1);
	assert.equal(queuedCommands.executedCommandCount, 1);
	assert.equal(queued.gpu.captureState().gp0FifoWords.length, 0);
	assert.equal(queued.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	assert.equal(queuedCommands.readback.phase, GX_GPU_READBACK_IDLE);
	assert.equal((queued.gpu.readStatus() & GX_GPU_STATUS_GPU_IDLE) >>> 0, GX_GPU_STATUS_GPU_IDLE);
});

test('GX-GPU GP1 reset cancels a restored active C0 deadline', () => {
	const source = createGpu();
	stopPcrtc(source.memory, source.gpu, source.scheduler);
	source.gpu.writeGp1((GX_GPU_GP1_GET_GPU_INFO << 24) | 0x07);
	source.gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	source.gpu.writeGp0(0);
	source.gpu.writeGp0((1 << 16) | 1);
	const saved = source.gpu.captureState();
	assert.equal(saved.commandBuffer.commandCount, 1);
	assert.equal(saved.commandBuffer.executedCommandCount, 0);

	const restored = createGpu();
	restored.scheduler.advanceTo(100);
	restored.gpu.restoreState(saved);
	restored.gpu.onService(100);
	const snapshotSerial = restored.gpu.readVramSnapshotSerial();
	assert.equal(restored.scheduler.nextDeadline(), 101);
	restored.gpu.writeGp1(GX_GPU_GP1_RESET << 24);
	const reset = restored.gpu.captureState();
	assert.equal(reset.commandBuffer.commandCount, 0);
	assert.equal(reset.commandBuffer.executedCommandCount, 0);
	assert.equal(reset.commandBuffer.readbackPhase, GX_GPU_READBACK_IDLE);
	assert.equal(restored.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	assert.equal(restored.gpu.readGp0(), GX_GPU_INFO_GPU_TYPE_V2);
	assert.equal(restored.gpu.readVramSnapshotSerial(), snapshotSerial);
	assert.equal((restored.gpu.readStatus() & GX_GPU_STATUS_RESET_WORD) >>> 0, GX_GPU_STATUS_RESET_WORD);
});

test('GX-GPU GP1 clear FIFO clears partial GP0 packets and flushes partial CPU-to-VRAM uploads', () => {
	const { memory, gpu, scheduler } = createGpu();
	stopPcrtc(memory, gpu, scheduler);
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
	assert.equal(commands.executedCommandCount, 1);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
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
const GX_GPU_SOFTWARE_TEST_PCRTC_WORDS = new Uint32Array([
	0x0000ff21, 0,
	(16 << 9) | (GX_GPU_PSMGX16 << 15), 0,
	3 << 23, 1023 | (255 << 12),
	0, 0,
	0, 0,
	0, 0,
	0x40806504, 0x00000007,
	0, 0,
	0x1fc83030, 0x0007f5c2,
	0x003484bc, 0,
	0x02101404, 0x00a90005,
]);
const GX_GPU_SOFTWARE_TEST_PCRTC_TIMING = new GxGpuPcrtcTiming();
const GX_GPU_SOFTWARE_TEST_PCRTC_SCANOUT = new GxGpuPcrtcScanout();
GX_GPU_SOFTWARE_TEST_PCRTC_TIMING.update(GX_GPU_SOFTWARE_TEST_PCRTC_WORDS);
GX_GPU_SOFTWARE_TEST_PCRTC_SCANOUT.update(GX_GPU_SOFTWARE_TEST_PCRTC_WORDS, GX_GPU_SOFTWARE_TEST_PCRTC_TIMING);

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
	skippedLineParity = GX_GPU_SKIPPED_LINE_NONE,
	vramYAddressExtensionWord = 0,
): void {
	const wordStart = commandBuffer.appendWords(words, words.length);
	commandBuffer.pushCommand(kind, opcode, wordStart, words.length, drawModeWord, vramYAddressExtensionWord, textureWindowWord, drawingAreaTopLeftWord, drawingAreaBottomRightWord, drawingOffsetWord, maskBitModeWord, skippedLineParity);
	commandBuffer.completeCommandExecution(commandBuffer.commandCount);
	commandBuffer.sealCommandsForPresentation();
}

function assertRgbaPixel(pixels: Uint8Array, x: number, y: number, r: number, g: number, b: number, a = 0): void {
	const offset = (y * GX_GPU_SOFTWARE_TEST_WIDTH + x) * 4;
	assert.equal(pixels[offset], r);
	assert.equal(pixels[offset + 1], g);
	assert.equal(pixels[offset + 2], b);
	assert.equal(pixels[offset + 3], a);
}

test('GX-GPU software backend owns texture modulation math', () => {
	assert.equal(gxGpuSoftwareTextureModulationPreDither(31, 128), 248);
	assert.equal(gxGpuSoftwareTextureModulationChannel5(31, 128, 0), 31);
	assert.equal(gxGpuSoftwareTextureModulationChannel5(31, 255, 3), 31);
	assert.equal(gxGpuSoftwareTextureModulationChannel5(1, 16, -4), 0);
	assert.equal(gxGpuSoftwareTextureModulationChannel5(12, 96, 0), 9);
});

test('GX-GPU software backend packed RGB555 blend matches channel arithmetic', () => {
	const destinationWords = new Uint16Array([
		0x0000,
		0x0001,
		0x001f,
		0x03e0,
		0x7c00,
		0x7fff,
		0x8000,
		0xffff,
	]);
	for (let source = 0; source < 0x8000; source += 1) {
		for (let destinationIndex = 0; destinationIndex <= destinationWords.length; destinationIndex += 1) {
			const destination = destinationIndex < destinationWords.length
				? destinationWords[destinationIndex]
				: ((source * 1103515245 + 12345) >>> 8) & 0xffff;
			for (let mode = 0; mode < 4; mode += 1) {
				let expected = 0;
				for (let shift = 0; shift <= 10; shift += 5) {
					const sourceChannel = (source >>> shift) & 0x1f;
					const destinationChannel = (destination >>> shift) & 0x1f;
					let channel: number;
					switch (mode) {
						case 0:
							channel = (sourceChannel + destinationChannel) >>> 1;
							break;
						case 1: {
							const sum = sourceChannel + destinationChannel;
							channel = sum < 31 ? sum : 31;
							break;
						}
						case 2:
							channel = destinationChannel > sourceChannel ? destinationChannel - sourceChannel : 0;
							break;
						default: {
							const sum = destinationChannel + (sourceChannel >>> 2);
							channel = sum < 31 ? sum : 31;
							break;
						}
					}
					expected |= channel << shift;
				}
				assert.equal(gxGpuSoftwareBlendRgb555(source, destination, mode), expected);
			}
		}
	}
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
	commandBuffer.pushCommand(GX_GPU_COMMAND_FILL_RECTANGLE, GX_GPU_GP0_FILL_RECTANGLE, wordStart, words.length, 0, 0, 0, 0, GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
	commandBuffer.completeCommandExecution(commandBuffer.commandCount);

	gxGpuSoftwareVram.fill(0);
	assert.equal(executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount), 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(4, 5)], 0);

	commandBuffer.sealCommandsForPresentation();
	assert.equal(executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount), 1);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(4, 5)], 0x001f);
});

test('GX-GPU software backend captures live VRAM into save-state snapshot', () => {
	const { gpu } = createGpu();
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0((5 << 16) | 4);
	gpu.writeGp0((1 << 16) | 1);
	completeGpuCommands(gpu);
	const output = gpu.readDeviceOutput();
	const backend = new HeadlessGPUBackend();
	backend.captureGxGpuVramSnapshot(gpu);
	assert.equal(output.commandBuffer.commandCount, 0);
	assert.equal(output.commandBuffer.presentCommandCount, 0);
	const saveState = gpu.captureSaveState();
	const byteIndex = gxGpuSoftwareVramIndex(4, 5) << 1;
	assert.equal(saveState.vramBytes.length, GX_GPU_VRAM_BYTE_COUNT);
	assert.equal(saveState.vramBytes[byteIndex], 0x1f);
	assert.equal(saveState.vramBytes[byteIndex + 1], 0x00);
	gpu.writeGp1(GX_GPU_GP1_RESET << 24);
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(gpu.lastFrameCommitted(), true);
	gpu.retirePresentedCommands();
	gpu.presentReadyFrameOnVblankEdge();
	assert.equal(gpu.lastFrameCommitted(), false);
});

test('GX-GPU software backend preserves vertical Gouraud packet order through fixed-point steps', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	commandBuffer.reset();
	const opcode = GX_GPU_GP0_LINE_FIRST | GX_GPU_GP0_RENDER_GOURAUD_BIT;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x000008) >>> 0,
		(10 << 16) | 40,
		0x000027,
		(16 << 16) | 40,
	]), GX_GPU_COMMAND_DRAW_LINE, opcode);

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 10)], 0x0001);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 13)], 0x0002);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 16)], 0x0004);
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
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

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
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

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
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

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
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

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
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

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
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

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
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(600 << 16) | 60,
		((((100 << 6) | (320 >> 4)) << 16) >>> 0),
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, GX_GPU_TEXTURE_MODE_PALETTE4 | GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, 0, 0, 1023 | (1023 << 10), 0, 0, GX_GPU_SKIPPED_LINE_NONE, 1);
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((opcode << 24) | 0x808080) >>> 0,
		(600 << 16) | 61,
		((((512 << 6) | (320 >> 4)) << 16) >>> 0),
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, GX_GPU_TEXTURE_MODE_PALETTE4 | 0x0f, 0, 0, 1023 | (1023 << 10), 0, 0, GX_GPU_SKIPPED_LINE_NONE, 1);

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
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)] = 0x0002;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 512)] = 0x0001;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(320, 100)] = 0x7fff;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(321, 100)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(322, 100)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(960, 0)] = 0x0002;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(322, 512)] = 0x7c00;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(60, 60)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(61, 60)] = 0x03e0;
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

	assert.deepEqual([
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 10)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(11, 10)],
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(10, 11)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(11, 11)],
	], [0x001f, 0x03e0, 0x7c00, 0x7fff]);
	assert.deepEqual([
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(20, 20)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(21, 20)],
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(30, 30)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(30, 31)],
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(40, 40)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(41, 40)],
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(50, 50)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(51, 50)],
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(60, 60)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(61, 60)],
		gxGpuSoftwareVram[gxGpuSoftwareVramIndex(60, 600)], gxGpuSoftwareVram[gxGpuSoftwareVramIndex(61, 600)],
	], [0x001f, 0x03e0, 0x001f, 0x03e0, 0x001f, 0x03e0, 0x001f, 0x03e0, 0x03e0, 0x03e0, 0x001f, 0x7c00]);
});

test('GX-GPU software backend applies drawing offsets, raw drawing areas, and coordinate wrap', () => {
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
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_RECTANGLE_FIRST << 24) | 0x0000ff) >>> 0,
		(520 << 16) | 60,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST, 0, 0, 60 | (520 << 10), 60 | (520 << 10));
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_RECTANGLE_FIRST << 24) | 0x00ff00) >>> 0,
		(8 << 16) | 60,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST, 0, 0, 60 | (520 << 10), 60 | (520 << 10));
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_RECTANGLE_FIRST << 24) | 0x0000ff) >>> 0,
		(520 << 16) | 61,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST, 0, 0, 0, 1023 | (1023 << 10));
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((GX_GPU_GP0_RECTANGLE_FIRST << 24) | 0x00ff00) >>> 0,
		(8 << 16) | 61,
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_DRAW_RECTANGLE, GX_GPU_GP0_RECTANGLE_FIRST, 0, 0, 0, 1023 | (1023 << 10));
	const aliasedQuadOpcode = GX_GPU_GP0_POLYGON_FIRST | GX_GPU_GP0_RENDER_GOURAUD_BIT | GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((aliasedQuadOpcode << 24) | 0x0000ff) >>> 0,
		(1022 << 16) | 105,
		0x0000ff,
		(511 << 16) | 100,
		0x0000ff,
		(511 << 16) | 110,
		0x00ff00,
		105,
	]), GX_GPU_COMMAND_DRAW_POLYGON, aliasedQuadOpcode, 0, 0, 0, 1023 | (1023 << 10));
	const blendedAliasedQuadOpcode = aliasedQuadOpcode | 0x02;
	pushSoftwareCommand(commandBuffer, new Uint32Array([
		((blendedAliasedQuadOpcode << 24) | 0x0000ff) >>> 0,
		(1022 << 16) | 125,
		0x0000ff,
		(511 << 16) | 120,
		0x0000ff,
		(511 << 16) | 130,
		0x00ff00,
		125,
	]), GX_GPU_COMMAND_DRAW_POLYGON, blendedAliasedQuadOpcode, 0, 0, 0, 1023 | (1023 << 10));

	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

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
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(60, 8)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(61, 8)], 0x03e0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(105, 255)], 0x020f);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(125, 255)], 0x0107);
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
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

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

	const pixelWords = new Uint32Array(GX_GPU_SOFTWARE_TEST_WIDTH * GX_GPU_SOFTWARE_TEST_HEIGHT);
	const pixels = new Uint8Array(pixelWords.buffer);
	renderGxGpuSoftwareFrame({
		width: GX_GPU_SOFTWARE_TEST_WIDTH,
		height: GX_GPU_SOFTWARE_TEST_HEIGHT,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		pcrtcScanout: GX_GPU_SOFTWARE_TEST_PCRTC_SCANOUT,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	}, pixelWords);

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
	const pixelWords = new Uint32Array(256 * 212);
	const pixels = new Uint8Array(pixelWords.buffer);
	const pcrtcWords = GX_GPU_SOFTWARE_TEST_PCRTC_WORDS.slice();
	const pcrtcTiming = new GxGpuPcrtcTiming();
	const pcrtcScanout = new GxGpuPcrtcScanout();
	const state = {
		width: 256,
		height: 192,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 900 | (400 << 10),
		vramYAddressExtensionWord: 0,
		pcrtcScanout,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	};
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 900 | (400 << 11);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 1023 | (191 << 12);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	gxGpuSoftwareVram.fill(0);
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(900, 400)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(131, 401)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(900, 591)] = 0x7c00;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(900, 611)] = 0x7fff;
	scanoutGxGpuSoftwareVram(state, pixelWords);

	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);
	assertRgbaPixel(pixels, 255, 0, 0, 255, 0);
	assertRgbaPixel(pixels, 0, 191, 0, 0, 255);

	state.height = 212;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 1023 | (211 << 12);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assertRgbaPixel(pixels, 0, 211, 255, 255, 255);

	state.height = 192;
	state.displayStartWord = 900 | (768 << 10);
	state.vramYAddressExtensionWord = 1;
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 900 | (768 << 11);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 1023 | (191 << 12);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(900, 768)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(131, 769)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(900, 959)] = 0x7c00;
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);
	assertRgbaPixel(pixels, 255, 0, 0, 255, 0);
	assertRgbaPixel(pixels, 0, 191, 0, 0, 255);
});

test('GX-GPU PCRTC composes source-alpha terminal cells over retained circuit-two pixels', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	const pcrtcWords = GX_GPU_SOFTWARE_TEST_PCRTC_WORDS.slice();
	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2;
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_LOW] = 1 | (16 << 9) | (GX_GPU_PSMGX16 << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_LOW] = 3 << 23;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 11;
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = (16 << 9) | (GX_GPU_PSMGX16 << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_LOW] = 3 << 23;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_HIGH] = 11;
	pcrtcWords[GX_GPU_PCRTC_BGCOLOR_LOW] = 0;
	const pcrtcTiming = new GxGpuPcrtcTiming();
	const pcrtcScanout = new GxGpuPcrtcScanout();
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	const pixelWords = new Uint32Array(3);
	const pixels = new Uint8Array(pixelWords.buffer);
	const state = {
		width: 3,
		height: 1,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: 0,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		pcrtcScanout,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	};
	gxGpuSoftwareVram.fill(0);
	gxGpuSoftwareVram[0] = 0x001f;
	gxGpuSoftwareVram[1] = 0x03e0;
	gxGpuSoftwareVram[2] = 0xfc00;
	gxGpuSoftwareVram[4096] = 0;
	gxGpuSoftwareVram[4097] = 0x8000;
	gxGpuSoftwareVram[4098] = 0xffff;
	scanoutGxGpuSoftwareVram(state, pixelWords);

	assert.deepEqual(Array.from(pixels), [
		255, 0, 0, 0,
		0, 0, 0, 128,
		255, 255, 255, 128,
	]);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		255, 0, 0, 0,
		0, 0, 0, 0,
		255, 255, 255, 128,
	]);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN1
		| GX_GPU_PCRTC_PMODE_EN2
		| GX_GPU_PCRTC_PMODE_MMOD
		| GX_GPU_PCRTC_PMODE_AMOD
		| (64 << 8);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		191, 0, 0, 0,
		0, 191, 0, 0,
		64, 64, 255, 128,
	]);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_MMOD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		255, 0, 0, 0,
		0, 255, 0, 128,
		0, 0, 255, 128,
	]);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] |= GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		255, 0, 0, 0,
		0, 255, 0, 0,
		0, 0, 255, 128,
	]);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] |= 255 << 8;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		0, 0, 0, 0,
		0, 0, 0, 0,
		255, 255, 255, 128,
	]);
});

test('GX-GPU PCRTC projects display signals and samples the source at circuit magnification', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	const pcrtcWords = GX_GPU_SOFTWARE_TEST_PCRTC_WORDS.slice();
	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN1
		| GX_GPU_PCRTC_PMODE_MMOD
		| GX_GPU_PCRTC_PMODE_SLBG
		| (255 << 8);
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_LOW] = 1 | (1 << 9) | (GX_GPU_PSMCT16S << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 2 | (1 << 11);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_LOW] = (1 << 12) | (1 << 23) | (1 << 27);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 7 | (1 << 12);
	pcrtcWords[GX_GPU_PCRTC_BGCOLOR_LOW] = 0x00010203;
	const pcrtcTiming = new GxGpuPcrtcTiming();
	const pcrtcScanout = new GxGpuPcrtcScanout();
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	assert.deepEqual({
		magnificationX: pcrtcScanout.circuits[0].magnificationX,
		magnificationY: pcrtcScanout.circuits[0].magnificationY,
		displaySignalX: pcrtcScanout.circuits[0].displaySignalX,
		displaySignalY: pcrtcScanout.circuits[0].displaySignalY,
		displayX: pcrtcScanout.circuits[0].displayX,
		displayY: pcrtcScanout.circuits[0].displayY,
		displayWidth: pcrtcScanout.circuits[0].displayWidth,
		displayHeight: pcrtcScanout.circuits[0].displayHeight,
		sourceAdvanceX: pcrtcScanout.circuits[0].sourceAdvanceX,
		sourceRemainderStepX: pcrtcScanout.circuits[0].sourceRemainderStepX,
		outputWidth: pcrtcScanout.outputWidth,
		outputHeight: pcrtcScanout.outputHeight,
	}, {
		magnificationX: 2,
		magnificationY: 2,
		displaySignalX: 0,
		displaySignalY: 1,
		displayX: 0,
		displayY: 0,
		displayWidth: 2,
		displayHeight: 2,
		sourceAdvanceX: 2,
		sourceRemainderStepX: 0,
		outputWidth: 2,
		outputHeight: 2,
	});

	const pixelWords = new Uint32Array(4);
	gxGpuSoftwareVram.fill(0);
	gxGpuSoftwareVram[gxGpuLocalMemoryAddress16S(4096, 1, 2, 1)] = 0x001f;
	gxGpuSoftwareVram[gxGpuLocalMemoryAddress16S(4096, 1, 4, 1)] = 0x7c00;
	scanoutGxGpuSoftwareVram({
		width: 2,
		height: 2,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: 0,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		pcrtcScanout,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	}, pixelWords);
	assert.deepEqual(Array.from(new Uint8Array(pixelWords.buffer)), [
		255, 0, 0, 0, 0, 0, 255, 0,
		255, 0, 0, 0, 0, 0, 255, 0,
	]);
});

test('GX-GPU PCRTC keeps mixed-magnification circuits on one signal grid', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	const pcrtcWords = GX_GPU_SOFTWARE_TEST_PCRTC_WORDS.slice();
	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN1
		| GX_GPU_PCRTC_PMODE_EN2
		| GX_GPU_PCRTC_PMODE_MMOD;
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_LOW] = 1 | (1 << 9) | (GX_GPU_PSMCT16S << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_LOW] = 680 | (37 << 12) | (3 << 23);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 11 | (1 << 12);
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 2 | (1 << 9) | (GX_GPU_PSMCT16S << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_LOW] = 684 | (38 << 12) | (1 << 23);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_HIGH] = 7 | (1 << 12);
	const pcrtcTiming = new GxGpuPcrtcTiming();
	const pcrtcScanout = new GxGpuPcrtcScanout();
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	assert.deepEqual({
		displayX: pcrtcScanout.circuits[1].displayX,
		displayY: pcrtcScanout.circuits[1].displayY,
		displayRight: pcrtcScanout.circuits[1].displayRight,
		displayBottom: pcrtcScanout.circuits[1].displayBottom,
		sourceAdvanceX: pcrtcScanout.circuits[1].sourceAdvanceX,
		sourceRemainderStepX: pcrtcScanout.circuits[1].sourceRemainderStepX,
	}, {
		displayX: 1,
		displayY: 1,
		displayRight: 3,
		displayBottom: 3,
		sourceAdvanceX: 2,
		sourceRemainderStepX: 0,
	});
	const pixelWords = new Uint32Array(9);
	gxGpuSoftwareVram.fill(0);
	gxGpuSoftwareVram[gxGpuLocalMemoryAddress16S(8192, 1, 0, 0)] = 0x001f;
	gxGpuSoftwareVram[gxGpuLocalMemoryAddress16S(8192, 1, 2, 0)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuLocalMemoryAddress16S(8192, 1, 0, 1)] = 0x7c00;
	gxGpuSoftwareVram[gxGpuLocalMemoryAddress16S(8192, 1, 2, 1)] = 0x7fff;
	scanoutGxGpuSoftwareVram({
		width: 3,
		height: 3,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: 0,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		pcrtcScanout,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	}, pixelWords);
	assert.deepEqual(Array.from(pixelWords), [
		0x00000000, 0x00000000, 0x00000000,
		0x00000000, 0x000000ff, 0x0000ff00,
		0x00000000, 0x00ff0000, 0x00ffffff,
	]);

	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_LOW] = 684 | (38 << 12) | (7 << 23);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	assert.deepEqual([
		pcrtcScanout.circuits[1].displayX,
		pcrtcScanout.circuits[1].displayRight,
	], [1, 3]);
});

test('GX-GPU PCRTC keeps circuit-one source phase independent from circuit-two crop', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	const pcrtcWords = GX_GPU_SOFTWARE_TEST_PCRTC_WORDS.slice();
	const circuitOnePmode = GX_GPU_PCRTC_PMODE_EN1
		| GX_GPU_PCRTC_PMODE_MMOD
		| GX_GPU_PCRTC_PMODE_SLBG
		| (255 << 8);
	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = circuitOnePmode;
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_LOW] = 1 | (1 << 9) | (GX_GPU_PSMCT16S << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_LOW] = 681 | (3 << 23);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 7;
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 2 | (1 << 9) | (GX_GPU_PSMCT16S << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_LOW] = 680 | (3 << 23);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_HIGH] = 7;
	const pcrtcTiming = new GxGpuPcrtcTiming();
	const pcrtcScanout = new GxGpuPcrtcScanout();
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	const pixelWords = new Uint32Array(4);
	const state = {
		width: 4,
		height: 1,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: 0,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		pcrtcScanout,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	};
	gxGpuSoftwareVram.fill(0);
	gxGpuSoftwareVram[gxGpuLocalMemoryAddress16S(4096, 1, 0, 0)] = 0x001f;
	gxGpuSoftwareVram[gxGpuLocalMemoryAddress16S(4096, 1, 1, 0)] = 0x03e0;
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pcrtcScanout.circuits[0].sourcePhaseX, 3);
	assert.deepEqual(Array.from(pixelWords), [0x000000ff, 0x0000ff00, 0, 0]);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = circuitOnePmode | GX_GPU_PCRTC_PMODE_EN2;
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pcrtcScanout.circuits[0].sourcePhaseX, 3);
	assert.deepEqual(Array.from(pixelWords), [0, 0x000000ff, 0x0000ff00, 0]);

	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_LOW] = 676 | (3 << 23);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pcrtcScanout.circuits[0].sourcePhaseX, 3);
	assert.deepEqual(Array.from(pixelWords), [0, 0, 0x000000ff, 0x0000ff00]);
});

test('GX-GPU local memory follows the GS page, block, column and PSGPU24 word layouts', () => {
	assert.equal(gxGpuLocalMemoryAddress32(0x1000, 5, 13, 9), 0x1196);
	assert.equal(gxGpuLocalMemoryAddress16(0x1000, 5, 13, 9), 0x1097);
	assert.equal(gxGpuLocalMemoryAddress16S(0x1000, 5, 13, 9), 0x1097);
	assert.equal(gxGpuLocalMemoryAddress32(0x1000, 5, 63, 31), 0x1ffe);
	assert.equal(gxGpuLocalMemoryAddress16(0x1000, 5, 63, 31), 0x17ff);
	assert.equal(gxGpuLocalMemoryAddress16S(0x1000, 5, 63, 31), 0x1dff);
	assert.equal(gxGpuLocalMemoryAddress32(0x1000, 5, 0, 32), 0x6000);
	assert.equal(gxGpuLocalMemoryAddress16(0x1000, 5, 0, 32), 0x1800);
	assert.equal(gxGpuLocalMemoryAddress16S(0x1000, 5, 0, 32), 0x1200);
	assert.deepEqual([
		gxGpuLocalMemoryAddressGpu24(0, 1, 0, 0, 0),
		gxGpuLocalMemoryAddressGpu24(0, 1, 0, 0, 1),
	], [0x0, 0x2]);
	assert.deepEqual([
		gxGpuLocalMemoryAddressGpu24(0, 1, 1, 0, 0),
		gxGpuLocalMemoryAddressGpu24(0, 1, 1, 0, 1),
	], [0x2, 0x8]);
	assert.deepEqual([
		gxGpuLocalMemoryAddressGpu24(0, 1, 0, 1, 0),
		gxGpuLocalMemoryAddressGpu24(0, 1, 0, 1, 1),
	], [0x4, 0x6]);
	assert.deepEqual([
		gxGpuLocalMemoryAddressGpu24(0, 1, 0, 64, 0),
		gxGpuLocalMemoryAddressGpu24(0, 1, 0, 64, 1),
	], [0x1000, 0x1002]);
	assert.deepEqual([
		gxGpuLocalMemoryAddressGpu24(0x1000, 5, 13, 9, 0),
		gxGpuLocalMemoryAddressGpu24(0x1000, 5, 13, 9, 1),
	], [0x118e, 0x1194]);
	assert.equal(gxGpuLocalMemoryAddress32(0x1ff000, 32, 0, 1), 0xff004);
	assert.equal(gxGpuLocalMemoryAddressGx16(0xfff00, 1024, 900, 1), 0x00684);
});

test('GX-GPU PCRTC reads supported DISPFB storage and rejects PSGPU24 on circuit two', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	const pcrtcWords = GX_GPU_SOFTWARE_TEST_PCRTC_WORDS.slice();
	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 1 | (1 << 9);
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_HIGH] = 3 | (2 << 11);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_LOW] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_BGCOLOR_LOW] = 0x00332211;
	const pcrtcTiming = new GxGpuPcrtcTiming();
	const pcrtcScanout = new GxGpuPcrtcScanout();
	const pixelWords = new Uint32Array(1);
	const state = {
		width: 1,
		height: 1,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: 0,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		pcrtcScanout,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	};
	gxGpuSoftwareVram.fill(0);
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 1 | (1 << 9) | (GX_GPU_PSMCT32 << 15);
	let address = gxGpuLocalMemoryAddress32(4096, 1, 3, 2);
	gxGpuSoftwareVram[address] = 0x2211;
	gxGpuSoftwareVram[address + 1] = 0x4433;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x44332211);

	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 0x1ff | (32 << 9) | (GX_GPU_PSMCT32 << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_HIGH] = 1 << 11;
	address = gxGpuLocalMemoryAddress32(0x1ff000, 32, 0, 1);
	gxGpuSoftwareVram[address] = 0x6655;
	gxGpuSoftwareVram[address + 1] = 0x8877;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x88776655);
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_HIGH] = 3 | (2 << 11);

	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 1 | (1 << 9) | (GX_GPU_PSMCT24 << 15);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x80332211);

	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 1 | (1 << 9) | (GX_GPU_PSMCT16 << 15);
	gxGpuSoftwareVram[gxGpuLocalMemoryAddress16(4096, 1, 3, 2)] = 0x801f;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x800000ff);

	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 1 | (1 << 9) | (GX_GPU_PSMCT16S << 15);
	gxGpuSoftwareVram[gxGpuLocalMemoryAddress16S(4096, 1, 3, 2)] = 0x03e0;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x0000ff00);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN1
		| GX_GPU_PCRTC_PMODE_MMOD
		| GX_GPU_PCRTC_PMODE_SLBG
		| (0xff << 8);
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_LOW] = 1 | (1 << 9) | (GX_GPU_PSGPU24 << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 3 | (2 << 11);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_LOW] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 0;
	gxGpuSoftwareVram[gxGpuLocalMemoryAddressGpu24(4096, 1, 3, 2, 0)] = 0x1100;
	gxGpuSoftwareVram[gxGpuLocalMemoryAddressGpu24(4096, 1, 3, 2, 1)] = 0x3322;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x80332211);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 1 | (1 << 9) | (GX_GPU_PSGPU24 << 15);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0);

	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 1 | (1 << 9) | (GX_GPU_PSMGX16 << 15);
	gxGpuSoftwareVram[gxGpuLocalMemoryAddressGx16(4096, 64, 3, 2)] = 0x7c00;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x00ff0000);

	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 1 | (1 << 9) | (3 << 15);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_SLBG | (0x55 << 8);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x00332211);
});

test('GX-GPU PCRTC executes MMOD and AMOD against full circuit alpha', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	const pcrtcWords = GX_GPU_SOFTWARE_TEST_PCRTC_WORDS.slice();
	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2;
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_LOW] = 1 | (1 << 9) | (GX_GPU_PSMCT32 << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_LOW] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 2 | (1 << 9) | (GX_GPU_PSMCT32 << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_LOW] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_BGCOLOR_LOW] = 0;
	const pcrtcTiming = new GxGpuPcrtcTiming();
	const pcrtcScanout = new GxGpuPcrtcScanout();
	const pixelWords = new Uint32Array(1);
	const state = {
		width: 1,
		height: 1,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: 0,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		pcrtcScanout,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	};
	gxGpuSoftwareVram.fill(0);
	gxGpuSoftwareVram[4096] = 0x786e;
	gxGpuSoftwareVram[4097] = 0x4082;
	gxGpuSoftwareVram[8192] = 0x140a;
	gxGpuSoftwareVram[8193] = 0x281e;

	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x4050463c);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] |= GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x2850463c);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_MMOD | (64 << 8);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x40372d23);

	pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] |= GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	assert.deepEqual({
		circuit1SamplePath: pcrtcScanout.circuits[0].samplePath,
		circuit2SamplePath: pcrtcScanout.circuits[1].samplePath,
		circuit1OutputPath: pcrtcScanout.circuit1OutputPath,
		circuit2OutputPath: pcrtcScanout.circuit2OutputPath,
		compositionPath: pcrtcScanout.compositionPath,
	}, {
		circuit1SamplePath: GX_GPU_PCRTC_STORAGE_CT32,
		circuit2SamplePath: GX_GPU_PCRTC_STORAGE_CT32,
		circuit1OutputPath: GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB,
		circuit2OutputPath: GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA,
		compositionPath: GX_GPU_PCRTC_COMPOSE_GENERIC,
	});
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.equal(pixelWords[0], 0x28372d23);
});

test('GX-GPU PCRTC follows the PMODE underlay and output-alpha truth table', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	const pcrtcWords = GX_GPU_SOFTWARE_TEST_PCRTC_WORDS.slice();
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_LOW] = 1 | (1 << 9) | (GX_GPU_PSMCT32 << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_LOW] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_LOW] = 2 | (1 << 9) | (GX_GPU_PSMCT32 << 15);
	pcrtcWords[GX_GPU_PCRTC_DISPFB2_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_LOW] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY2_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_BGCOLOR_LOW] = 0x00332211;
	const pcrtcTiming = new GxGpuPcrtcTiming();
	const pcrtcScanout = new GxGpuPcrtcScanout();
	const pixelWords = new Uint32Array(1);
	const state = {
		width: 1,
		height: 1,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: 0,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		pcrtcScanout,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	};
	gxGpuSoftwareVram.fill(0);
	gxGpuSoftwareVram[4096] = 0xbbaa;
	gxGpuSoftwareVram[4097] = 0x80cc;
	gxGpuSoftwareVram[8192] = 0x5544;
	gxGpuSoftwareVram[8193] = 0x7766;

	for (const [pmode, expected] of [
		[0x55 << 8, 0x00332211],
		[GX_GPU_PCRTC_PMODE_EN2 | (0x55 << 8), 0x00665544],
		[GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_SLBG | (0x55 << 8), 0x00332211],
		[GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_AMOD | GX_GPU_PCRTC_PMODE_SLBG, 0x77332211],
		[GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_MMOD | (0xff << 8), 0x80ccbbaa],
		[GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_MMOD | GX_GPU_PCRTC_PMODE_AMOD | (0xff << 8), 0x77ccbbaa],
		[GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_EN2 | GX_GPU_PCRTC_PMODE_MMOD | GX_GPU_PCRTC_PMODE_AMOD | GX_GPU_PCRTC_PMODE_SLBG | (0xff << 8), 0x77ccbbaa],
		[GX_GPU_PCRTC_PMODE_EN1, 0x80ccbbaa],
		[GX_GPU_PCRTC_PMODE_EN1 | GX_GPU_PCRTC_PMODE_AMOD | (0x55 << 8), 0x00ccbbaa],
	] as const) {
		pcrtcWords[GX_GPU_PCRTC_PMODE_LOW] = pmode;
		pcrtcTiming.update(pcrtcWords);
		pcrtcScanout.update(pcrtcWords, pcrtcTiming);
		scanoutGxGpuSoftwareVram(state, pixelWords);
		assert.equal(pixelWords[0], expected);
	}
});

test('GX-GPU software scanout weaves the current 480i field into retained output lines', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	const pixelWords = new Uint32Array(4);
	const pixels = new Uint8Array(pixelWords.buffer);
	const pcrtcWords = GX_GPU_SOFTWARE_TEST_PCRTC_WORDS.slice();
	const pcrtcTiming = new GxGpuPcrtcTiming();
	const pcrtcScanout = new GxGpuPcrtcScanout();
	const state = {
		width: 1,
		height: 4,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: GX_GPU_STATUS_INTERLACED_FIELD,
		displayModeWord: GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT | GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT,
		displayStartWord: 1023 | (510 << 10),
		vramYAddressExtensionWord: 0,
		pcrtcScanout,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 1n,
		vramReplacementSerial: 1n,
	};
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 1023 | (510 << 11);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 3 << 12;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	gxGpuSoftwareVram.fill(0);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	pcrtcWords[GX_GPU_PCRTC_SMODE2_LOW] = GX_GPU_PCRTC_SMODE2_INT | GX_GPU_PCRTC_SMODE2_FFMD;
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	assert.deepEqual({
		samplePath: pcrtcScanout.circuits[0].samplePath,
		evenFieldHeight: pcrtcScanout.evenFieldHeight,
		oddFieldHeight: pcrtcScanout.oddFieldHeight,
		fieldHeight: pcrtcScanout.fieldHeight,
		fieldOffset: pcrtcScanout.fieldOffset,
		fieldDisplayY: pcrtcScanout.circuits[0].fieldDisplayY,
		fieldDisplayLineStart: pcrtcScanout.circuits[0].fieldDisplayLineStart,
		fieldDisplayLineCount: pcrtcScanout.circuits[0].fieldDisplayLineCount,
	}, {
		samplePath: GX_GPU_PCRTC_SAMPLE_LINEAR_GX16,
		evenFieldHeight: 2,
		oddFieldHeight: 2,
		fieldHeight: 2,
		fieldOffset: 0,
		fieldDisplayY: 0,
		fieldDisplayLineStart: 0,
		fieldDisplayLineCount: 2,
	});
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 510)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 511)] = 0x7c00;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 512)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 513)] = 0x7fff;
	scanoutGxGpuSoftwareVram(state, pixelWords);

	assert.deepEqual(Array.from(pixels), [
		255, 0, 0, 0,
		0, 0, 0, 0,
		0, 0, 255, 0,
		0, 0, 0, 0,
	]);

	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 510)] = 0x7fff;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 511)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 512)] = 0x7fff;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 513)] = 0x03e0;
	state.statusWord = 0;
	pcrtcScanout.setField(1);
	assert.deepEqual({
		fieldHeight: pcrtcScanout.fieldHeight,
		fieldOffset: pcrtcScanout.fieldOffset,
		fieldDisplayY: pcrtcScanout.circuits[0].fieldDisplayY,
		fieldDisplayLineStart: pcrtcScanout.circuits[0].fieldDisplayLineStart,
		fieldDisplayLineCount: pcrtcScanout.circuits[0].fieldDisplayLineCount,
	}, {
		fieldHeight: 2,
		fieldOffset: 2,
		fieldDisplayY: 1,
		fieldDisplayLineStart: 0,
		fieldDisplayLineCount: 2,
	});
	scanoutGxGpuSoftwareVram(state, pixelWords);

	assert.deepEqual(Array.from(pixels), [
		255, 0, 0, 0,
		255, 255, 255, 0,
		0, 0, 255, 0,
		255, 0, 0, 0,
	]);

	state.statusWord = GX_GPU_STATUS_DISPLAY_DISABLE | GX_GPU_STATUS_INTERLACED_FIELD;
	pcrtcScanout.setField(0);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		255, 255, 255, 0,
		255, 255, 255, 0,
		255, 0, 0, 0,
		255, 0, 0, 0,
	]);

	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 510)] = 0x7c00;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 511)] = 0x7fff;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 512)] = 0x7fff;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 513)] = 0x7c00;
	state.statusWord = 0;
	pcrtcScanout.setField(1);
	state.vramSnapshotSerial = 2n;
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		255, 255, 255, 0,
		0, 0, 255, 0,
		255, 0, 0, 0,
		255, 255, 255, 0,
	]);

	state.vramReplacementSerial = 2n;
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		0, 0, 0, 0,
		0, 0, 255, 0,
		0, 0, 0, 0,
		255, 255, 255, 0,
	]);
});

test('GX-GPU software scanout maps FIELD phases and FRAME rows', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	const pixelWords = new Uint32Array(4);
	const pixels = new Uint8Array(pixelWords.buffer);
	const pcrtcWords = GX_GPU_SOFTWARE_TEST_PCRTC_WORDS.slice();
	const pcrtcTiming = new GxGpuPcrtcTiming();
	const pcrtcScanout = new GxGpuPcrtcScanout();
	const state = {
		width: 1,
		height: 4,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT,
		displayStartWord: 1023 | (510 << 10),
		vramYAddressExtensionWord: 0,
		pcrtcScanout,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 1n,
		vramReplacementSerial: 1n,
	};
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 1023 | (510 << 11);
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 3 << 12;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	gxGpuSoftwareVram.fill(0);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	pcrtcWords[GX_GPU_PCRTC_SMODE2_LOW] = GX_GPU_PCRTC_SMODE2_INT;
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 510)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 511)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 512)] = 0x7c00;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(1023, 513)] = 0x7fff;
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		255, 0, 0, 0,
		0, 0, 0, 0,
		0, 0, 255, 0,
		0, 0, 0, 0,
	]);

	pcrtcScanout.setField(1);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		255, 0, 0, 0,
		0, 255, 0, 0,
		0, 0, 255, 0,
		255, 255, 255, 0,
	]);

	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_LOW] |= 1 << 12;
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		255, 0, 0, 0,
		255, 0, 0, 0,
		0, 0, 255, 0,
		0, 0, 255, 0,
	]);

	pcrtcScanout.setField(0);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		0, 255, 0, 0,
		255, 0, 0, 0,
		255, 255, 255, 0,
		0, 0, 255, 0,
	]);

	state.displayModeWord |= GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT;
	pcrtcWords[GX_GPU_PCRTC_SMODE2_LOW] |= GX_GPU_PCRTC_SMODE2_FFMD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	pcrtcScanout.setField(1);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixels), [
		255, 0, 0, 0,
		255, 0, 0, 0,
		0, 255, 0, 0,
		0, 255, 0, 0,
	]);
});

test('GX-GPU software scanout retains the final even line at odd interlaced height', () => {
	const commandBuffer = new GxGpuCommandBuffer(standaloneCommandBufferDma);
	const pixelWords = new Uint32Array(5);
	const pcrtcWords = GX_GPU_SOFTWARE_TEST_PCRTC_WORDS.slice();
	const pcrtcTiming = new GxGpuPcrtcTiming();
	const pcrtcScanout = new GxGpuPcrtcScanout();
	const state = {
		width: 1,
		height: 5,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: 0,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		pcrtcScanout,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 1n,
		vramReplacementSerial: 1n,
	};
	pcrtcWords[GX_GPU_PCRTC_DISPFB1_HIGH] = 0;
	pcrtcWords[GX_GPU_PCRTC_DISPLAY1_HIGH] = 3 | (4 << 12);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	gxGpuSoftwareVram.fill(0);
	scanoutGxGpuSoftwareVram(state, pixelWords);
	pcrtcWords[GX_GPU_PCRTC_SMODE2_LOW] = GX_GPU_PCRTC_SMODE2_INT | GX_GPU_PCRTC_SMODE2_FFMD;
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)] = 0x001f;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 1)] = 0x03e0;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 2)] = 0x7c00;
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixelWords), [0x000000ff, 0, 0x0000ff00, 0, 0x00ff0000]);

	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)] = 0x7fff;
	gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 1)] = 0x001f;
	pcrtcScanout.setField(1);
	state.vramSnapshotSerial = 2n;
	scanoutGxGpuSoftwareVram(state, pixelWords);
	assert.deepEqual(Array.from(pixelWords), [0x000000ff, 0x00ffffff, 0x0000ff00, 0x000000ff, 0x00ff0000]);
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
		vramYAddressExtensionWord: 0,
		pcrtcScanout: GX_GPU_SOFTWARE_TEST_PCRTC_SCANOUT,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	};
	const pixelWords = new Uint32Array(GX_GPU_SOFTWARE_TEST_WIDTH * GX_GPU_SOFTWARE_TEST_HEIGHT);
	const pixels = new Uint8Array(pixelWords.buffer);
	renderGxGpuSoftwareFrame(state, pixelWords);
	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);

	commandBuffer.retireCommandsPreservingVram(commandBuffer.presentCommandCount);
	renderGxGpuSoftwareFrame(state, pixelWords);
	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);

	pushSoftwareCommand(commandBuffer, new Uint32Array([
		(GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x00ff00,
		16 | (1 << 16),
		(1 << 16) | 1,
	]), GX_GPU_COMMAND_FILL_RECTANGLE, GX_GPU_GP0_FILL_RECTANGLE);
	renderGxGpuSoftwareFrame(state, pixelWords);
	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);
	assertRgbaPixel(pixels, 16, 1, 0, 255, 0);

	commandBuffer.reset();
	renderGxGpuSoftwareFrame(state, pixelWords);
	assertRgbaPixel(pixels, 0, 0, 255, 0, 0);
	assertRgbaPixel(pixels, 16, 1, 0, 255, 0);
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

	const pixelWords = new Uint32Array(GX_GPU_SOFTWARE_TEST_WIDTH * GX_GPU_SOFTWARE_TEST_HEIGHT);
	const pixels = new Uint8Array(pixelWords.buffer);
	renderGxGpuSoftwareFrame({
		width: GX_GPU_SOFTWARE_TEST_WIDTH,
		height: GX_GPU_SOFTWARE_TEST_HEIGHT,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		pcrtcScanout: GX_GPU_SOFTWARE_TEST_PCRTC_SCANOUT,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	}, pixelWords);

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

	const pixelWords = new Uint32Array(GX_GPU_SOFTWARE_TEST_WIDTH * GX_GPU_SOFTWARE_TEST_HEIGHT);
	const pixels = new Uint8Array(pixelWords.buffer);
	renderGxGpuSoftwareFrame({
		width: GX_GPU_SOFTWARE_TEST_WIDTH,
		height: GX_GPU_SOFTWARE_TEST_HEIGHT,
		commandBuffer,
		readbackPort: commandBuffer.readback,
		statusWord: 0,
		displayModeWord: PSX_GPU_DISPLAY_MODE_PAL_WORD,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		pcrtcScanout: GX_GPU_SOFTWARE_TEST_PCRTC_SCANOUT,
		vramSnapshotBytes: GX_GPU_SOFTWARE_TEST_VRAM_SNAPSHOT,
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	}, pixelWords);

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
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

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
	executeGxGpuSoftwareCommands(commandBuffer, 0, commandBuffer.presentCommandCount);

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

test('GX-GPU PCRTC publishes raw words and maps retained user circuit one under the supervisor', () => {
	const { gpu, memory } = createGpu();
	assert.equal(IO_GX_GTE_PLUS_BASE, 0x08010380);
	assert.equal(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_PMODE_LOW), 0x08010350);
	assert.equal(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPFB1_LOW), 0x08010358);
	assert.equal(IO_GX_PCRTC_TIMING_BASE, 0x080103a8);
	assert.equal(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW), IO_GX_PCRTC_TIMING_BASE);
	const userDispFbLow = 7 | (16 << 9) | (GX_GPU_PSMGX16 << 15);
	const userDispFbHigh = 0x0012389a;
	const userDisplayLow = 0x018252a8;
	const userDisplayHigh = 0x000ef4ff;
	const userDispFb2Low = 0x11 | (16 << 9) | (GX_GPU_PSMGX16 << 15);
	const userDispFb2High = 0x00045023;
	const userDisplay2Low = 0x018252a8;
	const userDisplay2High = 0x000ef4ff;
	const userBackground = 0x00563412;
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_PMODE_LOW), 0x0000ff23);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPFB1_LOW), userDispFbLow);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPFB1_HIGH), userDispFbHigh);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_LOW), userDisplayLow);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_HIGH), userDisplayHigh);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPFB2_LOW), userDispFb2Low);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPFB2_HIGH), userDispFb2High);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY2_LOW), userDisplay2Low);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY2_HIGH), userDisplay2High);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_BGCOLOR_LOW), userBackground);

	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPFB1_HIGH)), userDispFbHigh);
	let output = gpu.readDeviceOutput();
	assert.equal(output.pcrtcWords[GX_GPU_PCRTC_PMODE_LOW], 0);
	assert.deepEqual([output.pcrtcScanout.outputWidth, output.pcrtcScanout.outputHeight], [0, 0]);
	gpu.presentReadyFrameOnVblankEdge();
	output = gpu.readDeviceOutput();
	assert.equal(output.pcrtcWords[GX_GPU_PCRTC_PMODE_LOW], 0x0000ff23);
	assert.equal(output.pcrtcScanout.outputActive, true);
	assert.deepEqual([output.pcrtcScanout.outputWidth, output.pcrtcScanout.outputHeight], [320, 240]);

	gpu.enterSupervisorContext();
	output = gpu.readDeviceOutput();
	let words = output.pcrtcWords;
	assert.equal(words[GX_GPU_PCRTC_PMODE_LOW], 2);
	assert.deepEqual([output.pcrtcScanout.outputWidth, output.pcrtcScanout.outputHeight], [320, 240]);
	assert.equal(words[GX_GPU_PCRTC_DISPFB2_LOW], userDispFbLow);
	assert.equal(words[GX_GPU_PCRTC_DISPFB2_HIGH], userDispFbHigh);
	assert.equal(words[GX_GPU_PCRTC_DISPLAY2_LOW], userDisplayLow);
	assert.equal(words[GX_GPU_PCRTC_DISPLAY2_HIGH], userDisplayHigh);
	assert.notEqual(words[GX_GPU_PCRTC_DISPFB2_LOW], userDispFb2Low);
	assert.equal(words[GX_GPU_PCRTC_BGCOLOR_LOW], userBackground);

	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPFB1_LOW), 0xc0 | (16 << 9) | (GX_GPU_PSMGX16 << 15));
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPFB1_HIGH), 0x001a0300);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_LOW), 0x018252a8);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_HIGH), 0x000bf3ff);
	memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_PMODE_LOW), 3);
	gpu.presentReadyFrameOnVblankEdge();
	output = gpu.readDeviceOutput();
	words = output.pcrtcWords;
	assert.equal(words[GX_GPU_PCRTC_PMODE_LOW], 3);
	assert.equal(words[GX_GPU_PCRTC_DISPFB2_LOW], userDispFbLow);
	assert.deepEqual([output.pcrtcScanout.outputWidth, output.pcrtcScanout.outputHeight], [320, 240]);

	gpu.leaveSupervisorContext();
	output = gpu.readDeviceOutput();
	words = output.pcrtcWords;
	assert.equal(words[GX_GPU_PCRTC_PMODE_LOW], 0x0000ff23);
	assert.equal(words[GX_GPU_PCRTC_DISPFB1_LOW], userDispFbLow);
	assert.equal(words[GX_GPU_PCRTC_DISPFB2_LOW], userDispFb2Low);
	assert.equal(words[GX_GPU_PCRTC_DISPFB2_HIGH], userDispFb2High);
	assert.equal(words[GX_GPU_PCRTC_DISPLAY2_LOW], userDisplay2Low);
	assert.equal(words[GX_GPU_PCRTC_DISPLAY2_HIGH], userDisplay2High);
	assert.deepEqual([output.pcrtcScanout.outputWidth, output.pcrtcScanout.outputHeight], [320, 240]);
	assert.equal(memory.readMappedU32LE(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_DISPLAY1_LOW)), userDisplayLow);
});
