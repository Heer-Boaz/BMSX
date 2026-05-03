import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IO_VDP_CAMERA_COMMIT,
	IO_VDP_CAMERA_EYE,
	IO_VDP_CAMERA_PROJ,
	IO_VDP_CAMERA_VIEW,
	IO_VDP_CMD,
	IO_VDP_DITHER,
	IO_VDP_FAULT_ACK,
	IO_VDP_FAULT_CODE,
	IO_VDP_FAULT_DETAIL,
	IO_VDP_FIFO,
	IO_VDP_FIFO_CTRL,
	IO_VDP_PMU_BANK,
	IO_VDP_PMU_CTRL,
	IO_VDP_PMU_SCALE_X,
	IO_VDP_PMU_SCALE_Y,
	IO_VDP_PMU_Y,
	IO_VDP_RD_DATA,
	IO_VDP_RD_MODE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_REG_BG_COLOR,
	IO_VDP_REG_DRAW_COLOR,
	IO_VDP_REG_DRAW_CTRL,
	IO_VDP_REG_DRAW_LAYER_PRIO,
	IO_VDP_REG_DRAW_SCALE_X,
	IO_VDP_REG_DRAW_SCALE_Y,
	IO_VDP_REG_DST_X,
	IO_VDP_REG_DST_Y,
	IO_VDP_REG_GEOM_X0,
	IO_VDP_REG_LINE_WIDTH,
	IO_VDP_REG_SLOT_DIM,
	IO_VDP_REG_SLOT_INDEX,
	IO_VDP_REG_SRC_SLOT,
	IO_VDP_REG_SRC_UV,
	IO_VDP_REG_SRC_WH,
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
	IO_VDP_SBX_COMMIT,
	IO_VDP_SBX_CONTROL,
	IO_VDP_SBX_FACE0,
	IO_VDP_STATUS,
	VDP_CAMERA_COMMIT_WRITE,
	VDP_FIFO_CTRL_SEAL,
	VDP_FAULT_RD_OOB,
	VDP_FAULT_RD_UNSUPPORTED_MODE,
	VDP_FAULT_SUBMIT_STATE,
	VDP_FAULT_STREAM_BAD_PACKET,
	VDP_FAULT_DEX_SOURCE_OOB,
	VDP_FAULT_DEX_SOURCE_SLOT,
	VDP_FAULT_DEX_INVALID_LINE_WIDTH,
	VDP_FAULT_DEX_INVALID_SCALE,
	VDP_FAULT_SBX_SOURCE_OOB,
	VDP_FAULT_BBU_OVERFLOW,
	VDP_FAULT_BBU_SOURCE_OOB,
	VDP_FAULT_BBU_ZERO_SIZE,
	VDP_FAULT_VRAM_SLOT_DIM,
	VDP_FAULT_VRAM_WRITE_UNALIGNED,
	VDP_RD_MODE_RGBA8888,
	VDP_SLOT_ATLAS_NONE,
	VDP_SLOT_PRIMARY,
	VDP_SBX_COMMIT_WRITE,
	VDP_STATUS_FAULT,
} from '../../src/bmsx/machine/bus/io';
import { CPU } from '../../src/bmsx/machine/cpu/cpu';
import { VDP } from '../../src/bmsx/machine/devices/vdp/vdp';
import { VDP_BBU_BILLBOARD_LIMIT, VDP_RD_SURFACE_PRIMARY, VDP_SBX_CONTROL_ENABLE } from '../../src/bmsx/machine/devices/vdp/contracts';
import { VDP_BBU_PACKET_KIND, VDP_BBU_PACKET_PAYLOAD_WORDS } from '../../src/bmsx/machine/devices/vdp/bbu';
import { VDP_BLITTER_OPCODE_BLIT } from '../../src/bmsx/machine/devices/vdp/blitter';
import { VDP_SBX_PACKET_KIND, VDP_SBX_PACKET_PAYLOAD_WORDS } from '../../src/bmsx/machine/devices/vdp/sbx';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { IO_WORD_SIZE, VDP_STREAM_BUFFER_BASE, VRAM_FRAMEBUFFER_BASE, VRAM_PRIMARY_SLOT_BASE } from '../../src/bmsx/machine/memory/map';
import { DeviceScheduler } from '../../src/bmsx/machine/scheduler/device';
import { numberToF32Bits } from '../../src/bmsx/machine/common/numeric';
import { HeadlessGPUBackend } from '../../src/bmsx/render/headless/backend';
import { TextureManager } from '../../src/bmsx/render/texture_manager';
import { initializeVdpTextureTransfer } from '../../src/bmsx/render/vdp/texture_transfer';
import {
	applyVdpFrameBufferTextureWrites,
	initializeVdpFrameBufferTextures,
	presentVdpFrameBufferPages,
	readVdpDisplayFrameBufferPixels,
	readVdpRenderFrameBufferPixels,
} from '../../src/bmsx/render/vdp/framebuffer';

const VDP_CMD_NOP = 0;
const VDP_CMD_CLEAR = 1;
const VDP_CMD_FILL_RECT = 2;
const VDP_CMD_DRAW_LINE = 3;
const VDP_CMD_BLIT = 4;
const VDP_CMD_BEGIN_FRAME = 14;
const VDP_CMD_END_FRAME = 15;

const VDP_PKT_END = 0x00000000;
const VDP_PKT_CMD = 0x01000000;
const VDP_PKT_REG1 = 0x02000000;
const VDP_PKT_REGN = 0x03000000;
const VDP_BILLBOARD_HEADER = VDP_BBU_PACKET_KIND | (VDP_BBU_PACKET_PAYLOAD_WORDS << 16);
const VDP_SKYBOX_HEADER = VDP_SBX_PACKET_KIND | (VDP_SBX_PACKET_PAYLOAD_WORDS << 16);

const VDP_REG_BG_COLOR = 15;
const VDP_REG_SLOT_INDEX = 16;

function createVdp(): { memory: Memory; vdp: VDP } {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const scheduler = new DeviceScheduler(cpu);
	const vdp = new VDP(memory, scheduler, { width: 256, height: 212 });
	memory.writeIoValue(IO_VDP_DITHER, 0);
	memory.writeIoValue(IO_VDP_SLOT_PRIMARY_ATLAS, VDP_SLOT_ATLAS_NONE);
	memory.writeIoValue(IO_VDP_SLOT_SECONDARY_ATLAS, VDP_SLOT_ATLAS_NONE);
	vdp.initializeVramSurfaces();
	vdp.initializeRegisters();
	vdp.resetStatus();
	return { memory, vdp };
}

function activeQueue(vdp: VDP): any {
	return (vdp as any).activeFrame.queue;
}

function skyboxPacket(control = VDP_SBX_CONTROL_ENABLE, w = 4, h = 5): number[] {
	const words = [VDP_SKYBOX_HEADER, control];
	for (let face = 0; face < 6; face += 1) {
		words.push(VDP_SLOT_PRIMARY, 0, 0, w, h);
	}
	return words;
}

function writeSkyboxMmio(memory: Memory, control = VDP_SBX_CONTROL_ENABLE, w = 1, h = 1): void {
	let addr = IO_VDP_SBX_FACE0;
	for (let face = 0; face < 6; face += 1) {
		memory.writeValue(addr + 0 * IO_WORD_SIZE, VDP_SLOT_PRIMARY);
		memory.writeValue(addr + 1 * IO_WORD_SIZE, 0);
		memory.writeValue(addr + 2 * IO_WORD_SIZE, 0);
		memory.writeValue(addr + 3 * IO_WORD_SIZE, w);
		memory.writeValue(addr + 4 * IO_WORD_SIZE, h);
		addr += 5 * IO_WORD_SIZE;
	}
	memory.writeValue(IO_VDP_SBX_CONTROL, control);
	memory.writeValue(IO_VDP_SBX_COMMIT, VDP_SBX_COMMIT_WRITE);
}

function writeCameraMmio(memory: Memory, view: Float32Array, proj: Float32Array, eye: Float32Array): void {
	for (let index = 0; index < 16; index += 1) {
		memory.writeValue(IO_VDP_CAMERA_VIEW + index * IO_WORD_SIZE, numberToF32Bits(view[index]));
		memory.writeValue(IO_VDP_CAMERA_PROJ + index * IO_WORD_SIZE, numberToF32Bits(proj[index]));
	}
	for (let index = 0; index < 3; index += 1) {
		memory.writeValue(IO_VDP_CAMERA_EYE + index * IO_WORD_SIZE, numberToF32Bits(eye[index]));
	}
	memory.writeValue(IO_VDP_CAMERA_COMMIT, VDP_CAMERA_COMMIT_WRITE);
}

function buildFrameOpen(vdp: VDP): boolean {
	return (vdp as any).buildFrame.open;
}

function writeStream(memory: Memory, words: number[]): void {
	for (let index = 0; index < words.length; index += 1) {
		memory.writeU32(VDP_STREAM_BUFFER_BASE + index * IO_WORD_SIZE, words[index] >>> 0);
	}
}

function sealStream(memory: Memory, vdp: VDP, words: number[]): void {
	writeStream(memory, words);
	vdp.sealDmaTransfer(VDP_STREAM_BUFFER_BASE, words.length * IO_WORD_SIZE);
}

function sealFifo(memory: Memory, words: number[]): void {
	for (let index = 0; index < words.length; index += 1) {
		memory.writeValue(IO_VDP_FIFO, words[index] >>> 0);
	}
	memory.writeValue(IO_VDP_FIFO_CTRL, VDP_FIFO_CTRL_SEAL);
}

function initializeHeadlessVdpTextures(vdp: VDP): void {
	const backend = new HeadlessGPUBackend();
	const textureManager = new TextureManager(backend);
	initializeVdpTextureTransfer(textureManager, { backend, textures: {} } as any);
	initializeVdpFrameBufferTextures(vdp);
}

function assertVdpFault(memory: Memory, code: number): void {
	assert.equal(memory.readIoU32(IO_VDP_FAULT_CODE), code);
	assert.equal((memory.readIoU32(IO_VDP_STATUS) & VDP_STATUS_FAULT) !== 0, true);
}

function clearVdpFault(memory: Memory): void {
	memory.writeValue(IO_VDP_FAULT_ACK, 1);
	assert.equal(memory.readIoU32(IO_VDP_FAULT_CODE), 0);
	assert.equal((memory.readIoU32(IO_VDP_STATUS) & VDP_STATUS_FAULT), 0);
	assert.equal(memory.readIoU32(IO_VDP_FAULT_ACK), 0);
}

test('VDP2D direct lifecycle opens, seals, and rejects invalid edges', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	assertVdpFault(memory, VDP_FAULT_SUBMIT_STATE);
	clearVdpFault(memory);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_FILL_RECT);
	assertVdpFault(memory, VDP_FAULT_SUBMIT_STATE);
	clearVdpFault(memory);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	assert.equal(buildFrameOpen(vdp), true);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	assertVdpFault(memory, VDP_FAULT_SUBMIT_STATE);
	assert.equal(buildFrameOpen(vdp), false);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_NOP);
	assert.equal(buildFrameOpen(vdp), false);
});

test('VDP2D direct registers latch raw representable words without closing an open frame', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_DRAW_CTRL, 0x4);
	assert.equal(memory.readValue(IO_VDP_REG_DRAW_CTRL), 0x4);
	assert.equal(buildFrameOpen(vdp), true);
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, 0xffff0000);
	assert.equal(memory.readValue(IO_VDP_REG_DRAW_SCALE_X), 0xffff0000);
	assert.equal(buildFrameOpen(vdp), true);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	assert.equal(buildFrameOpen(vdp), false);
});

test('VDP2D direct draw doorbell snapshots latch state immutably', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_GEOM_X0, 0 << 16);
	memory.writeValue(IO_VDP_REG_GEOM_X0 + IO_WORD_SIZE, 0 << 16);
	memory.writeValue(IO_VDP_REG_GEOM_X0 + 2 * IO_WORD_SIZE, 8 << 16);
	memory.writeValue(IO_VDP_REG_GEOM_X0 + 3 * IO_WORD_SIZE, 8 << 16);
	memory.writeValue(IO_VDP_REG_DRAW_LAYER_PRIO, 7 << 8);
	memory.writeValue(IO_VDP_REG_DRAW_COLOR, 0xff112233);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_FILL_RECT);
	memory.writeValue(IO_VDP_REG_DRAW_COLOR, 0xff445566);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);

	assert.equal(activeQueue(vdp).length, 1);
	assert.equal(activeQueue(vdp).colorWord[0], 0xff112233);
});

test('VDP framebuffer VRAM dirty rows upload to the render texture before page present', () => {
	const { vdp } = createVdp();
	initializeHeadlessVdpTextures(vdp);
	const pixel = new Uint8Array([0x11, 0x22, 0x33, 0xff]);

	vdp.writeVram(VRAM_FRAMEBUFFER_BASE, pixel);
	applyVdpFrameBufferTextureWrites(vdp);

	assert.deepEqual(Array.from(readVdpRenderFrameBufferPixels(0, 0, 1, 1)), Array.from(pixel));
	presentVdpFrameBufferPages();
	vdp.swapFrameBufferReadbackPages();
	assert.deepEqual(Array.from(readVdpDisplayFrameBufferPixels(0, 0, 1, 1)), Array.from(pixel));
});

test('VDP2D BLIT snapshots DRAW_CTRL flip and parallax immutably', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 0);
	memory.writeValue(IO_VDP_REG_SRC_WH, 4 | (4 << 16));
	memory.writeValue(IO_VDP_REG_DRAW_LAYER_PRIO, 9 << 8);
	memory.writeValue(IO_VDP_REG_DRAW_CTRL, 0xff000003);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	memory.writeValue(IO_VDP_REG_DRAW_CTRL, 0);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);

	const command = activeQueue(vdp);
	assert.equal(command.opcode[0], VDP_BLITTER_OPCODE_BLIT);
	assert.equal(command.flipH[0], 1);
	assert.equal(command.flipV[0], 1);
	assert.equal(command.parallaxWeight[0], -1);
});

test('VDP PMU resolves parallax into BLIT geometry before backend execution', () => {
	const { memory, vdp } = createVdp();

	vdp.setTiming(1000, 1000, 0);
	memory.writeValue(IO_VDP_PMU_BANK, 0);
	memory.writeValue(IO_VDP_PMU_Y, 16 << 16);
	vdp.accrueCycles(250, 250);

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 0);
	memory.writeValue(IO_VDP_REG_SRC_WH, 4 | (4 << 16));
	memory.writeValue(IO_VDP_REG_DST_X, 32 << 16);
	memory.writeValue(IO_VDP_REG_DST_Y, 40 << 16);
	memory.writeValue(IO_VDP_REG_DRAW_LAYER_PRIO, 9 << 8);
	memory.writeValue(IO_VDP_REG_DRAW_CTRL, 0x00800000);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	memory.writeValue(IO_VDP_PMU_Y, 100 << 16);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);

	memory.writeValue(IO_VDP_PMU_Y, 8 << 16);
	vdp.accrueCycles(500, 750);

	const workUnits = vdp.getPendingRenderWorkUnits();
	assert.ok(workUnits > 0);
	vdp.advanceWork(workUnits);
	const output = vdp.readHostOutput();
	assert.notEqual(output, vdp.readHostOutput());
	assert.notEqual(output.executionToken, 0);
	const queue = output.executionQueue;
	assert.ok(queue);
	const command = queue;
	assert.equal(command.opcode[0], VDP_BLITTER_OPCODE_BLIT);
	assert.equal(command.parallaxWeight[0], 0.5);
	assert.equal(command.dstX[0], 32);
	assert.equal(command.dstY[0], 48);
	assert.equal(command.scaleX[0], 1);
	assert.equal(command.scaleY[0], 1);
	vdp.completeHostExecution(output);
	assert.equal(vdp.readHostOutput().executionToken, 0);
});

test('VDP PMU bank registers resolve DRAW_CTRL bank and signed weight', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_PMU_BANK, 3);
	memory.writeValue(IO_VDP_PMU_Y, 12 << 16);
	memory.writeValue(IO_VDP_PMU_SCALE_X, 0x00018000);
	memory.writeValue(IO_VDP_PMU_CTRL, 1);
	assert.equal(memory.readValue(IO_VDP_PMU_CTRL), 1);
	memory.writeValue(IO_VDP_PMU_BANK, 4);
	memory.writeValue(IO_VDP_PMU_SCALE_Y, 0);
	assert.equal(memory.readValue(IO_VDP_PMU_SCALE_Y), 0);
	memory.writeValue(IO_VDP_PMU_BANK, 3);

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 0);
	memory.writeValue(IO_VDP_REG_SRC_WH, 4 | (4 << 16));
	memory.writeValue(IO_VDP_REG_DST_X, 32 << 16);
	memory.writeValue(IO_VDP_REG_DST_Y, 40 << 16);
	memory.writeValue(IO_VDP_REG_DRAW_LAYER_PRIO, 9 << 8);
	memory.writeValue(IO_VDP_REG_DRAW_CTRL, 0x00800000 | (3 << 8));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);

	const workUnits = vdp.getPendingRenderWorkUnits();
	assert.ok(workUnits > 0);
	vdp.advanceWork(workUnits);
	const output = vdp.readHostOutput();
	const queue = output.executionQueue;
	assert.ok(queue);
	const command = queue;
	assert.equal(command.opcode[0], VDP_BLITTER_OPCODE_BLIT);
	assert.equal(command.parallaxWeight[0], 0.5);
	assert.equal(command.dstY[0], 46);
	assert.equal(command.scaleX[0], 1.25);
	assert.equal(command.scaleY[0], 1);
	vdp.completeHostExecution(output);
});

test('VDP PMU scale influence uses absolute signed DRAW_CTRL weight', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_PMU_BANK, 3);
	memory.writeValue(IO_VDP_PMU_Y, 12 << 16);
	memory.writeValue(IO_VDP_PMU_SCALE_X, 0x00018000);

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 0);
	memory.writeValue(IO_VDP_REG_SRC_WH, 4 | (4 << 16));
	memory.writeValue(IO_VDP_REG_DST_X, 32 << 16);
	memory.writeValue(IO_VDP_REG_DST_Y, 40 << 16);
	memory.writeValue(IO_VDP_REG_DRAW_LAYER_PRIO, 9 << 8);
	memory.writeValue(IO_VDP_REG_DRAW_CTRL, (0xff800000 | (3 << 8)) >>> 0);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);

	const command = activeQueue(vdp);
	assert.equal(command.opcode[0], VDP_BLITTER_OPCODE_BLIT);
	assert.equal(command.parallaxWeight[0], -0.5);
	assert.equal(command.dstY[0], 34);
	assert.equal(command.scaleX[0], 1.25);
	assert.equal(command.scaleY[0], 1);
});

test('VDP2D FIFO replays registers, commands, and PKT_END frame sealing', () => {
	const { memory, vdp } = createVdp();

	sealStream(memory, vdp, [
		VDP_PKT_REG1 | VDP_REG_BG_COLOR,
		0xff010203,
		VDP_PKT_CMD | VDP_CMD_CLEAR,
		VDP_PKT_END,
	]);

	assert.equal(activeQueue(vdp).length, 1);
	assert.equal(activeQueue(vdp).colorWord[0], 0xff010203);
});

test('VDP2D FIFO packet faults cancel the frame while preserving prior register side effects', () => {
	const { memory, vdp } = createVdp();

	sealStream(memory, vdp, [
		VDP_PKT_REG1 | VDP_REG_BG_COLOR,
		0xff102030,
		0x04000000,
		VDP_PKT_END,
	]);

	assertVdpFault(memory, VDP_FAULT_STREAM_BAD_PACKET);
	assert.equal(memory.readValue(IO_VDP_REG_BG_COLOR), 0xff102030);
	assert.equal(activeQueue(vdp).length, 0);
});

test('VDP2D FIFO rejects reserved bits and register ranges', () => {
	const { memory, vdp } = createVdp();

	sealStream(memory, vdp, [VDP_PKT_CMD | (1 << 16) | VDP_CMD_CLEAR, VDP_PKT_END]);
	assertVdpFault(memory, VDP_FAULT_STREAM_BAD_PACKET);
	clearVdpFault(memory);
	sealStream(memory, vdp, [VDP_PKT_REG1 | 18, 0, VDP_PKT_END]);
	assertVdpFault(memory, VDP_FAULT_STREAM_BAD_PACKET);
	clearVdpFault(memory);
	sealStream(memory, vdp, [VDP_PKT_REGN | (2 << 16) | 17, 0, 0, VDP_PKT_END]);
	assertVdpFault(memory, VDP_FAULT_STREAM_BAD_PACKET);
});

test('VDP2D FIFO DEX command faults abort the sealed stream frame', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 0);
	memory.writeValue(IO_VDP_REG_SRC_WH, 4 | (4 << 16));
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, 0);
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_Y, 0x00010000);

	sealFifo(memory, [VDP_PKT_CMD | VDP_CMD_BLIT, VDP_PKT_END]);

	assertVdpFault(memory, VDP_FAULT_DEX_INVALID_SCALE);
	assert.equal(buildFrameOpen(vdp), false);
	assert.equal((vdp as any).activeFrame.occupied, false);
	assert.equal(activeQueue(vdp).length, 0);
});

test('VDP2D DMA DEX command faults abort the sealed stream frame', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 15 | (0 << 16));
	memory.writeValue(IO_VDP_REG_SRC_WH, 2 | (16 << 16));
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, 0x00010000);
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_Y, 0x00010000);

	sealStream(memory, vdp, [VDP_PKT_CMD | VDP_CMD_BLIT, VDP_PKT_END]);

	assertVdpFault(memory, VDP_FAULT_DEX_SOURCE_OOB);
	assert.equal(buildFrameOpen(vdp), false);
	assert.equal((vdp as any).activeFrame.occupied, false);
	assert.equal(activeQueue(vdp).length, 0);
});

test('VDP2D SLOT_INDEX latches raw words and SLOT_DIM applies in-order through REGN', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_INDEX, 3);
	assert.equal(memory.readValue(IO_VDP_REG_SLOT_INDEX), 3);
	memory.writeValue(IO_VDP_REG_SLOT_INDEX, VDP_SLOT_PRIMARY);

	sealStream(memory, vdp, [
		VDP_PKT_REGN | (2 << 16) | VDP_REG_SLOT_INDEX,
		VDP_SLOT_PRIMARY,
		16 | (16 << 16),
		VDP_PKT_END,
	]);
	assert.deepEqual(vdp.resolveBlitterSurfaceSize(VDP_RD_SURFACE_PRIMARY), { width: 16, height: 16 });

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 0xffff | (0xffff << 16));
	assertVdpFault(memory, VDP_FAULT_VRAM_SLOT_DIM);
	assert.deepEqual(vdp.resolveBlitterSurfaceSize(VDP_RD_SURFACE_PRIMARY), { width: 16, height: 16 });
});

test('VDP2D BLIT source faults latch without closing a direct frame', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_SRC_SLOT, 99);
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, 0x00010000);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	assertVdpFault(memory, VDP_FAULT_DEX_SOURCE_SLOT);
	assert.equal(buildFrameOpen(vdp), true);
	clearVdpFault(memory);
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 0);
	memory.writeValue(IO_VDP_REG_SRC_WH, 0);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	assertVdpFault(memory, VDP_FAULT_DEX_SOURCE_OOB);
	assert.equal(buildFrameOpen(vdp), true);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	assert.equal((vdp as any).activeFrame.occupied, true);
});

test('VDP2D BLIT and LINE latch cart-visible DEX faults without register rollback', () => {
	{
		const { memory, vdp } = createVdp();
		memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
		memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
		memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
		memory.writeValue(IO_VDP_REG_SRC_UV, 0);
		memory.writeValue(IO_VDP_REG_SRC_WH, 4 | (4 << 16));
		memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, 0xffff0000);
		memory.writeValue(IO_VDP_REG_DRAW_SCALE_Y, 0x00010000);

		memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
		assert.equal(memory.readValue(IO_VDP_REG_DRAW_SCALE_X), 0xffff0000);
		assertVdpFault(memory, VDP_FAULT_DEX_INVALID_SCALE);
		assert.equal(buildFrameOpen(vdp), true);
	}
	{
		const { memory, vdp } = createVdp();
		memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
		memory.writeValue(IO_VDP_REG_LINE_WIDTH, 0);

		memory.writeValue(IO_VDP_CMD, VDP_CMD_DRAW_LINE);
		assert.equal(memory.readValue(IO_VDP_REG_LINE_WIDTH), 0);
		assertVdpFault(memory, VDP_FAULT_DEX_INVALID_LINE_WIDTH);
		assert.equal(buildFrameOpen(vdp), true);
	}
});

test('VDP2D PMU-resolved representable scale flows through BLIT datapath', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_PMU_BANK, 0);
	memory.writeValue(IO_VDP_PMU_SCALE_X, 0);
	assert.equal(memory.readValue(IO_VDP_PMU_SCALE_X), 0);

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 0);
	memory.writeValue(IO_VDP_REG_SRC_WH, 4 | (4 << 16));
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, 0x00010000);
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_Y, 0x00010000);
	memory.writeValue(IO_VDP_REG_DRAW_CTRL, 0x01000000);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	assert.equal(buildFrameOpen(vdp), true);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
});

test('VDP2D FIFO allows an empty PKT_END-only frame', () => {
	const { memory, vdp } = createVdp();

	sealStream(memory, vdp, [VDP_PKT_END]);

	assert.equal(activeQueue(vdp).length, 0);
	assert.equal((vdp as any).activeFrame.occupied, true);
	assert.equal((vdp as any).activeFrame.hasCommands, false);
});

test('VDP2D BLIT source rect OOB latches a DEX source fault', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_DRAW_LAYER_PRIO, 1 << 8);
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, 0x00010000);
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_Y, 0x00010000);
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 15 | (0 << 16));
	memory.writeValue(IO_VDP_REG_SRC_WH, 2 | (16 << 16));

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	assertVdpFault(memory, VDP_FAULT_DEX_SOURCE_OOB);
	assert.equal(buildFrameOpen(vdp), true);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
});

test('VDP readback faults latch status instead of throwing', () => {
	const { memory } = createVdp();

	memory.writeValue(IO_VDP_RD_MODE, 99);

	assert.equal(memory.readValue(IO_VDP_RD_DATA), 0);
	assert.equal(memory.readIoU32(IO_VDP_FAULT_CODE), VDP_FAULT_RD_UNSUPPORTED_MODE);
	assert.equal(memory.readIoU32(IO_VDP_FAULT_DETAIL), 99);
	assert.equal((memory.readIoU32(IO_VDP_STATUS) & VDP_STATUS_FAULT) !== 0, true);
	clearVdpFault(memory);
});

test('VDP fault latch is sticky-first until FAULT_ACK', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_RD_MODE, 99);
	assert.equal(memory.readValue(IO_VDP_RD_DATA), 0);
	assertVdpFault(memory, VDP_FAULT_RD_UNSUPPORTED_MODE);
	vdp.writeVram(VRAM_PRIMARY_SLOT_BASE + 1, new Uint8Array([1, 2, 3, 4]));
	assert.equal(memory.readIoU32(IO_VDP_FAULT_CODE), VDP_FAULT_RD_UNSUPPORTED_MODE);
	clearVdpFault(memory);
	vdp.writeVram(VRAM_PRIMARY_SLOT_BASE + 1, new Uint8Array([1, 2, 3, 4]));
	assertVdpFault(memory, VDP_FAULT_VRAM_WRITE_UNALIGNED);
});

test('VDP readback OOB faults latch status instead of throwing', () => {
	const { memory } = createVdp();

	memory.writeValue(IO_VDP_RD_MODE, VDP_RD_MODE_RGBA8888);
	memory.writeValue(IO_VDP_RD_X, 999);
	memory.writeValue(IO_VDP_RD_Y, 0);

	assert.equal(memory.readValue(IO_VDP_RD_DATA), 0);
	assert.equal(memory.readIoU32(IO_VDP_FAULT_CODE), VDP_FAULT_RD_OOB);
});

test('VDP VRAM write faults latch status instead of throwing', () => {
	const { memory, vdp } = createVdp();

	assert.doesNotThrow(() => vdp.writeVram(VRAM_PRIMARY_SLOT_BASE + 1, new Uint8Array([1, 2, 3, 4])));
	assert.equal(memory.readIoU32(IO_VDP_FAULT_CODE), VDP_FAULT_VRAM_WRITE_UNALIGNED);
	assert.equal((memory.readIoU32(IO_VDP_STATUS) & VDP_STATUS_FAULT) !== 0, true);
});

test('VDP dither register writes update the live latch directly', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_DITHER, 3);

	assert.equal(vdp.captureState().ditherType, 3);
});

test('VDP SBX live state commits only through frame present', () => {
	const { memory, vdp } = createVdp();

	assert.equal(vdp.readHostOutput().skyboxEnabled, false);
	writeSkyboxMmio(memory);
	assert.equal(vdp.readHostOutput().skyboxEnabled, false);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	assert.equal(vdp.readHostOutput().skyboxEnabled, false);
	vdp.presentReadyFrameOnVblankEdge();
	assert.equal(vdp.readHostOutput().skyboxEnabled, true);

	writeSkyboxMmio(memory, 0);
	assert.equal(vdp.readHostOutput().skyboxEnabled, true);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	vdp.presentReadyFrameOnVblankEdge();
	assert.equal(vdp.readHostOutput().skyboxEnabled, false);
});

test('VDP SBX validates face words during frame seal', () => {
	const { memory, vdp } = createVdp();

	writeSkyboxMmio(memory, VDP_SBX_CONTROL_ENABLE, 2, 1);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	assertVdpFault(memory, VDP_FAULT_SBX_SOURCE_OOB);
	assert.equal(buildFrameOpen(vdp), false);
	assert.equal(vdp.readHostOutput().skyboxEnabled, false);
});

test('VDP SBX accepts SKYBOX packets into frame-latched state', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	sealStream(memory, vdp, [...skyboxPacket(VDP_SBX_CONTROL_ENABLE, 4, 5), VDP_PKT_END]);
	vdp.presentReadyFrameOnVblankEdge();
	assert.equal(vdp.readHostOutput().skyboxEnabled, true);
	const sample = vdp.readHostOutput().skyboxSamples[0]!;
	assert.equal(sample.source.surfaceId, VDP_RD_SURFACE_PRIMARY);
	assert.equal(sample.surfaceWidth, 16);
	assert.equal(sample.surfaceHeight, 16);
	assert.equal(sample.source.width, 4);
	assert.equal(sample.source.height, 5);
});

test('VDP SBX stores raw control bits and faults bad face words at frame seal', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	assert.doesNotThrow(() => sealStream(memory, vdp, [...skyboxPacket(2, 4, 5), VDP_PKT_END]));
	vdp.presentReadyFrameOnVblankEdge();
	assert.equal(vdp.readHostOutput().skyboxEnabled, false);
	sealStream(memory, vdp, [...skyboxPacket(VDP_SBX_CONTROL_ENABLE, 17, 1), VDP_PKT_END]);
	assertVdpFault(memory, VDP_FAULT_SBX_SOURCE_OOB);
	assert.equal(vdp.readHostOutput().skyboxEnabled, false);
});

test('VDP camera MMIO commits live bank sampled at frame present', () => {
	const { memory, vdp } = createVdp();
	const view = new Float32Array(16);
	const proj = new Float32Array(16);
	view[0] = 1; view[5] = 1; view[10] = 1; view[15] = 1;
	proj[0] = 1; proj[5] = 1; proj[10] = 1; proj[15] = 1;
	const eye = new Float32Array([3, 4, 5]);

	writeCameraMmio(memory, view, proj, eye);

	assert.equal(vdp.readHostOutput().camera.eye[0], 0);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	vdp.presentReadyFrameOnVblankEdge();
	assert.equal(vdp.readHostOutput().camera.eye[0], 3);
	assert.equal(vdp.readHostOutput().camera.eye[1], 4);
	assert.equal(vdp.readHostOutput().camera.eye[2], 5);
});

function billboardPacket(sizeWord: number, u = 2, v = 3, w = 4, h = 5, control = 0): number[] {
	return [
		VDP_BILLBOARD_HEADER,
		0,
		VDP_SLOT_PRIMARY,
		u | (v << 16),
		w | (h << 16),
		10 << 16,
		20 << 16,
		30 << 16,
		sizeWord,
		0xff112233,
		control,
	];
}

test('VDP BBU accepts BILLBOARD packets into frame-latched instance RAM', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	sealStream(memory, vdp, [...billboardPacket(2 << 16), VDP_PKT_END]);
	assert.equal(vdp.getPendingRenderWorkUnits(), 1);
	assert.equal((vdp as any).activeFrame.hasCommands, true);
	assert.equal((vdp as any).activeFrame.hasFrameBufferCommands, false);
	vdp.advanceWork(1);
	const output = vdp.readHostOutput();
	const queue = output.executionQueue;
	assert.notEqual(queue, null);
	const billboards = output.executionBillboards;
	assert.equal(billboards.length, 1);
	assert.equal(billboards.slot[0], VDP_SLOT_PRIMARY);
	assert.equal(billboards.surfaceWidth[0], 16);
	assert.equal(billboards.surfaceHeight[0], 16);
	assert.equal(billboards.sourceSrcX[0], 2);
	assert.equal(billboards.sourceSrcY[0], 3);
	assert.equal(billboards.sourceWidth[0], 4);
	assert.equal(billboards.sourceHeight[0], 5);
	assert.equal(billboards.positionX[0], 10);
	assert.equal(billboards.positionY[0], 20);
	assert.equal(billboards.positionZ[0], 30);
	assert.equal(billboards.size[0], 2);
	assert.equal(billboards.colorWord[0], 0xff112233);
	vdp.completeHostExecution(output);
});

test('VDP BBU faults only at BILLBOARD packet latch', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	sealStream(memory, vdp, [...billboardPacket(0), VDP_PKT_END]);
	assertVdpFault(memory, VDP_FAULT_BBU_ZERO_SIZE);
	assert.equal(vdp.getPendingRenderWorkUnits(), 0);
	clearVdpFault(memory);
	sealStream(memory, vdp, [...billboardPacket(1 << 16, 0, 0, 1, 1, 1), VDP_PKT_END]);
	assertVdpFault(memory, VDP_FAULT_STREAM_BAD_PACKET);
	assert.equal(vdp.getPendingRenderWorkUnits(), 0);
	clearVdpFault(memory);
	sealStream(memory, vdp, [...billboardPacket(1 << 16, 15, 0, 2, 1), VDP_PKT_END]);
	assertVdpFault(memory, VDP_FAULT_BBU_SOURCE_OOB);
	assert.equal(vdp.getPendingRenderWorkUnits(), 0);
	clearVdpFault(memory);

	const stream: number[] = [];
	for (let index = 0; index <= VDP_BBU_BILLBOARD_LIMIT; index += 1) {
		stream.push(...billboardPacket(1 << 16, 0, 0, 1, 1));
	}
	stream.push(VDP_PKT_END);
	sealStream(memory, vdp, stream);
	assertVdpFault(memory, VDP_FAULT_BBU_OVERFLOW);
	assert.equal(vdp.getPendingRenderWorkUnits(), 0);
});
