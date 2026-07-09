import assert from 'node:assert/strict';
import test from 'node:test';

import {
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GxGpuCommandBuffer,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { GX_GPU_GP0_FILL_RECTANGLE } from '../../machine/ts/machine/devices/gx/gpu';
import { executeGxGpuSoftwareCommands } from '../../machine/ts/render/backend/software/gx_gpu_commands';
import { gxGpuSoftwareVram, gxGpuSoftwareVramIndex } from '../../machine/ts/render/backend/software/gx_gpu_vram';

const GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD = 1023 | (511 << 10);

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
		GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
		0,
		0,
		0,
	);
	commandBuffer.sealCommandsForPresentation();
}

test('GX-GPU command-buffer restore republishes command stream without clearing VRAM revision', () => {
	const commandBuffer = new GxGpuCommandBuffer();
	commandBuffer.reset();
	const vramClearSerial = commandBuffer.vramClearSerial;
	pushFillCommand(commandBuffer);
	const state = commandBuffer.captureState();
	const commandSerial = commandBuffer.serial;

	commandBuffer.retireCommandsPreservingVram();
	commandBuffer.restoreState(state);

	assert.equal(commandBuffer.vramClearSerial, vramClearSerial);
	assert.notEqual(commandBuffer.serial, commandSerial);
	assert.equal(commandBuffer.commandCount, 1);
	assert.equal(commandBuffer.presentCommandCount, 1);
});

test('GX-GPU command-buffer retire compacts presented command stream', () => {
	const commandBuffer = new GxGpuCommandBuffer();
	commandBuffer.reset();
	pushFillCommand(commandBuffer);
	commandBuffer.retireCommandsPreservingVram();

	gxGpuSoftwareVram.fill(0);
	assert.equal(commandBuffer.commandCount, 0);
	assert.equal(commandBuffer.presentCommandCount, 0);
	assert.equal(executeGxGpuSoftwareCommands(commandBuffer, 0), 0);
	assert.equal(gxGpuSoftwareVram[gxGpuSoftwareVramIndex(0, 0)], 0);
});

test('GX-GPU command-buffer retire preserves partial payload words after sealed commands', () => {
	const commandBuffer = new GxGpuCommandBuffer();
	commandBuffer.reset();
	pushFillCommand(commandBuffer);
	commandBuffer.appendWord(0xa0b0c0d0);

	assert.equal(commandBuffer.retireCommandsPreservingVram(), 3);
	assert.equal(commandBuffer.commandCount, 0);
	assert.equal(commandBuffer.presentCommandCount, 0);
	assert.equal(commandBuffer.wordCount, 1);
	assert.equal(commandBuffer.words[0], 0xa0b0c0d0);
});
