import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_READ_VRAM_TO_CPU,
	GX_GPU_SKIPPED_LINE_NONE,
	GxGpuCommandBuffer,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { GX_GPU_GP0_FILL_RECTANGLE } from '../../machine/ts/spec/gx/gp0';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { executeGxGpuSoftwareCommands } from '../../machine/ts/render/backend/software/gx_gpu_commands';
import { GxGpuSoftwareState } from '../../machine/ts/render/backend/software/gx_gpu_state';
import { gxGpuSoftwareVramIndex } from '../../machine/ts/render/backend/software/gx_gpu_vram';
import { prepareGpuPacket } from '../../machine/ts/machine/devices/gx/gpu_command_timing';
import { GxGpuPacket } from '../../machine/ts/machine/devices/gx/gpu_packet';

const gxGpuSoftware = new GxGpuSoftwareState(PSX_MACHINE_SPEC.gxGpuVramBytes, 0);
const gxGpuSoftwareVram = gxGpuSoftware.vram;
const GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD = 1023 | (511 << 10);
const commandBufferMemory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
const commandBufferIrq = new IrqController(commandBufferMemory);
const commandBufferCpu = new CPU(commandBufferMemory, commandBufferIrq, new ExecutionAddressSpace(commandBufferMemory));
const commandBufferScheduler = new DeviceScheduler(commandBufferCpu);
const commandBufferDma = new DmaController(commandBufferMemory, commandBufferCpu, commandBufferIrq, commandBufferScheduler);

test('raw high VRAM extension bits survive draw timing, raster, readback and restore', () => {
	const buffer = new GxGpuCommandBuffer(commandBufferDma);
	const rect = new Uint32Array([0x600000ff, 600 << 16, (8 << 16) | 8]);
	const start = buffer.appendWords(rect, rect.length);
	buffer.pushCommand(GX_GPU_COMMAND_DRAW_RECTANGLE, 0x60, start, rect.length, 0, 0x100, 0,
		600 << 10, (620 << 10) | 10, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
	assert.equal(buffer.commandVramYAddressExtensionWord[0], 0x100);
	const packet = new GxGpuPacket();
	packet.words.set(rect);
	prepareGpuPacket(packet, rect.length, {
		drawModeWord: 0, vramYAddressExtensionWord: 0x100, textureWindowWord: 0,
		drawingAreaTopLeftWord: 600 << 10, drawingAreaBottomRightWord: (620 << 10) | 10,
		drawingOffsetWord: 0, maskBitModeWord: 0, skippedLineParity: GX_GPU_SKIPPED_LINE_NONE,
	});
	assert.ok(packet.ticks > 16, 'the packet timing owner consumes the retained nonzero raw word');
	gxGpuSoftwareVram.fill(0);
	executeGxGpuSoftwareCommands(gxGpuSoftware, buffer, 0, 1);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(gxGpuSoftware, 0, 600)], 0x001f);
	const read = new Uint32Array([0xc0000000, 600 << 16, (1 << 16) | 1]);
	const readStart = buffer.appendWords(read, read.length);
	buffer.pushCommand(GX_GPU_COMMAND_READ_VRAM_TO_CPU, 0xc0, readStart, read.length, 0, 0x100, 0, 0, 0, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
	buffer.completeCommandExecution(2);
	assert.equal(buffer.readback.y, 600);
	const saved = buffer.captureState();
	buffer.restoreState(saved);
	assert.equal(buffer.commandVramYAddressExtensionWord[0], 0x100);
	assert.equal(buffer.readback.vramYAddressExtensionWord, 0x100);
});

test('draw operand layouts follow raw commands through restore and prefix retirement', () => {
	const buffer = new GxGpuCommandBuffer(commandBufferDma);
	const commands = [
		[GX_GPU_COMMAND_DRAW_POLYGON, 0x3c, 12],
		[GX_GPU_COMMAND_FILL_RECTANGLE, 0x02, 3],
		[GX_GPU_COMMAND_DRAW_POLYLINE, 0x58, 7],
		[GX_GPU_COMMAND_DRAW_RECTANGLE, 0x7c, 3],
		[GX_GPU_COMMAND_DRAW_LINE, 0x40, 3],
	];
	for (const [kind, opcode, count] of commands) {
		const words = Uint32Array.from({ length: count }, (_, index) => (0xf0000000 | index) >>> 0);
		const start = buffer.appendWords(words, count);
		buffer.pushCommand(kind, opcode, start, count, 0, 0, 0, 0, 0, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
	}
	assert.deepEqual(Array.from(buffer.commandDrawIndex.subarray(0, 5)), [0, 1, 1, 2, 3]);
	assert.deepEqual(Array.from(buffer.drawVertexCount.subarray(0, 4)), [4, 3, 1, 2]);
	assert.deepEqual(Array.from(buffer.drawPositionStride.subarray(0, 4)), [3, 2, 1, 1]);
	assert.deepEqual(Array.from(buffer.drawColorStride.subarray(0, 4)), [3, 2, 0, 0]);
	assert.equal(buffer.drawSizeOffset[2], 2);
	const saved = buffer.captureState();
	buffer.restoreState(saved);
	assert.deepEqual(Array.from(buffer.drawVertexCount.subarray(0, 4)), [4, 3, 1, 2]);
	buffer.completeCommandExecution(5);
	buffer.retireCommandsPreservingVram(2);
	assert.deepEqual(Array.from(buffer.commandDrawIndex.subarray(0, 3)), [0, 1, 2]);
	assert.deepEqual(Array.from(buffer.drawVertexCount.subarray(0, 3)), [3, 1, 2]);
	assert.equal(buffer.words[buffer.commandWordStart[0] + 5], 0xf0000005);
	const longRectangle = new Uint32Array(300);
	const start = buffer.appendWords(longRectangle, longRectangle.length);
	buffer.pushCommand(GX_GPU_COMMAND_DRAW_RECTANGLE, 0x60, start, longRectangle.length, 0, 0, 0, 0, 0, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
	assert.equal(buffer.drawSizeOffset[buffer.commandDrawIndex[3]], 299, 'a representable span keeps its full size-word offset');
	const longLine = new Uint32Array(7);
	const lineStart = buffer.appendWords(longLine, longLine.length);
	buffer.pushCommand(GX_GPU_COMMAND_DRAW_LINE, 0x50, lineStart, longLine.length, 0, 0, 0, 0, 0, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
	assert.equal(buffer.drawVertexCount[buffer.commandDrawIndex[4]], 2, 'a single line retains two vertices even if its span has additional words');
});

test('polygon draw layouts retain every flat, textured, Gouraud and quad packet layout', () => {
	const buffer = new GxGpuCommandBuffer(commandBufferDma);
	const cases = [
		[0x20, 1, 0, 3], [0x24, 2, 0, 3], [0x28, 1, 0, 4], [0x2c, 2, 0, 4],
		[0x30, 2, 2, 3], [0x34, 3, 3, 3], [0x38, 2, 2, 4], [0x3c, 3, 3, 4],
	];
	for (const [opcode, positionStride, colorStride, vertexCount] of cases) {
		const count = 1 + positionStride * vertexCount - (colorStride === 0 ? 0 : 1);
		const words = Uint32Array.from({ length: count }, (_, index) => (0xa0000000 | index) >>> 0);
		const start = buffer.appendWords(words, count);
		const command = buffer.commandCount;
		buffer.pushCommand(GX_GPU_COMMAND_DRAW_POLYGON, opcode, start, count, 0, 0, 0, 0, 0, 0, 0, GX_GPU_SKIPPED_LINE_NONE);
		const record = buffer.commandDrawIndex[command];
		assert.equal(buffer.drawVertexCount[record], vertexCount);
		assert.equal(buffer.drawPositionStride[record], positionStride);
		assert.equal(buffer.drawColorStride[record], colorStride);
		for (let vertex = 0; vertex < vertexCount; ++vertex) {
			assert.equal(buffer.words[start + 1 + vertex * buffer.drawPositionStride[record]], words[1 + vertex * positionStride]);
			assert.equal(buffer.words[start + vertex * buffer.drawColorStride[record]], words[vertex * colorStride]);
			if ((opcode & 4) !== 0) assert.equal(buffer.words[start + 2 + vertex * buffer.drawPositionStride[record]], words[2 + vertex * positionStride]);
		}
	}
});

function pushFillCommand(commandBuffer: GxGpuCommandBuffer): void {
	const words = new Uint32Array([
		(GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff,
		0,
		(1 << 16) | 1,
	]);
	const wordStart = commandBuffer.appendWords(words, words.length);
	commandBuffer.pushCommand(
		GX_GPU_COMMAND_FILL_RECTANGLE,
		GX_GPU_GP0_FILL_RECTANGLE,
		wordStart,
		words.length,
		0,
		0,
		0,
		0,
		GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
		0,
		0,
		GX_GPU_SKIPPED_LINE_NONE,
	);
	commandBuffer.completeCommandExecution(commandBuffer.commandCount);
	commandBuffer.sealCommandsForPresentation();
}

test('GX-GPU command-buffer restore republishes the retained command stream', () => {
	const commandBuffer = new GxGpuCommandBuffer(commandBufferDma);
	commandBuffer.reset();
	pushFillCommand(commandBuffer);
	const state = commandBuffer.captureState();
	const commandSerial = commandBuffer.serial;

	commandBuffer.retireCommandsPreservingVram(commandBuffer.presentCommandCount);
	commandBuffer.restoreState(state);

	assert.notEqual(commandBuffer.serial, commandSerial);
	assert.equal(commandBuffer.commandCount, 1);
	assert.equal(commandBuffer.presentCommandCount, 1);
});

test('GX-GPU command-buffer retire compacts presented command stream', () => {
	const commandBuffer = new GxGpuCommandBuffer(commandBufferDma);
	commandBuffer.reset();
	pushFillCommand(commandBuffer);
	commandBuffer.retireCommandsPreservingVram(commandBuffer.presentCommandCount);

	gxGpuSoftwareVram.fill(0);
	assert.equal(commandBuffer.commandCount, 0);
	assert.equal(commandBuffer.presentCommandCount, 0);
	assert.equal(executeGxGpuSoftwareCommands(gxGpuSoftware, commandBuffer, 0, commandBuffer.presentCommandCount), 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(gxGpuSoftware, 0, 0)], 0);
});

test('GX-GPU command-buffer retire preserves partial payload words after sealed commands', () => {
	const commandBuffer = new GxGpuCommandBuffer(commandBufferDma);
	commandBuffer.reset();
	pushFillCommand(commandBuffer);
	commandBuffer.appendWord(0xa0b0c0d0);

	assert.equal(commandBuffer.retireCommandsPreservingVram(commandBuffer.presentCommandCount), 3);
	assert.equal(commandBuffer.commandCount, 0);
	assert.equal(commandBuffer.presentCommandCount, 0);
	assert.equal(commandBuffer.wordCount, 1);
	assert.equal(commandBuffer.words[0], 0xa0b0c0d0);
});
