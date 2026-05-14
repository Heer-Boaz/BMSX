import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
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
	IO_VDP_REG_DRAW_PRIORITY,
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
} from '../../src/bmsx/machine/bus/io';
import { CPU } from '../../src/bmsx/machine/cpu/cpu';
import type { VdpFrameBufferPresentation, VdpFrameBufferPresentationSink, VdpSurfaceUpload } from '../../src/bmsx/machine/devices/vdp/device_output';
import { VDP, VDP_FRAMEBUFFER_PAGE_DISPLAY } from '../../src/bmsx/machine/devices/vdp/vdp';
import {
	VDP_BBU_BILLBOARD_LIMIT,
	VDP_FIFO_CTRL_SEAL,
	VDP_FAULT_RD_OOB,
	VDP_FAULT_RD_UNSUPPORTED_MODE,
	VDP_FAULT_SUBMIT_STATE,
	VDP_FAULT_STREAM_BAD_PACKET,
	VDP_FAULT_DEX_SOURCE_OOB,
	VDP_FAULT_DEX_SOURCE_SLOT,
	VDP_FAULT_DEX_INVALID_LINE_WIDTH,
	VDP_FAULT_DEX_INVALID_SCALE,
	VDP_FAULT_DEX_OVERFLOW,
	VDP_FAULT_DEX_UNSUPPORTED_DRAW_CTRL,
	VDP_FAULT_SBX_SOURCE_OOB,
	VDP_FAULT_BBU_OVERFLOW,
	VDP_FAULT_BBU_SOURCE_OOB,
	VDP_FAULT_BBU_ZERO_SIZE,
	VDP_FAULT_VRAM_SLOT_DIM,
	VDP_FAULT_VRAM_WRITE_OOB,
	VDP_FAULT_VRAM_WRITE_UNALIGNED,
	VDP_FAULT_VRAM_WRITE_UNMAPPED,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_SURFACE_PRIMARY,
	VDP_SBX_CONTROL_ENABLE,
	VDP_SLOT_ATLAS_NONE,
	VDP_SLOT_PRIMARY,
	VDP_SBX_COMMIT_WRITE,
	VDP_STATUS_FAULT,
	VDP_STATUS_VBLANK,
} from '../../src/bmsx/machine/devices/vdp/contracts';
import { VDP_BBU_PACKET_KIND, VDP_BBU_PACKET_PAYLOAD_WORDS } from '../../src/bmsx/machine/devices/vdp/bbu';
import { VDP_BLITTER_FIFO_CAPACITY, VDP_BLITTER_OPCODE_BLIT } from '../../src/bmsx/machine/devices/vdp/blitter';
import {
	VDP_DEX_FRAME_IDLE,
	VDP_SUBMITTED_FRAME_EMPTY,
	VDP_SUBMITTED_FRAME_READY,
} from '../../src/bmsx/machine/devices/vdp/frame';
import {
	VDP_CMD_BEGIN_FRAME,
	VDP_CMD_BLIT,
	VDP_CMD_CLEAR,
	VDP_CMD_DRAW_LINE,
	VDP_CMD_END_FRAME,
	VDP_CMD_FILL_RECT,
	VDP_CMD_NOP,
	VDP_PKT_CMD,
	VDP_PKT_END,
	VDP_PKT_REG1,
	VDP_PKT_REGN,
	VDP_REG_BG_COLOR,
	VDP_REG_DRAW_PRIORITY,
	VDP_REG_SLOT_INDEX,
	VDP_REG_SRC_SLOT,
} from '../../src/bmsx/machine/devices/vdp/registers';
import { VDP_VOUT_SCANOUT_PHASE_ACTIVE, VDP_VOUT_SCANOUT_PHASE_VBLANK } from '../../src/bmsx/machine/devices/vdp/vout';
import { VDP_SBX_PACKET_KIND, VDP_SBX_PACKET_PAYLOAD_WORDS } from '../../src/bmsx/machine/devices/vdp/sbx';
import {
	VDP_XF_MATRIX_COUNT,
	VDP_XF_MATRIX_PACKET_PAYLOAD_WORDS,
	VDP_XF_MATRIX_REGISTER_WORDS,
	VDP_XF_MATRIX_WORDS,
	VDP_XF_PACKET_KIND,
	VDP_XF_SELECT_PACKET_PAYLOAD_WORDS,
	VDP_XF_VIEW_MATRIX_INDEX_REGISTER,
} from '../../src/bmsx/machine/devices/vdp/xf';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { IO_WORD_SIZE, VDP_STREAM_BUFFER_BASE, VRAM_FRAMEBUFFER_BASE, VRAM_PRIMARY_SLOT_BASE } from '../../src/bmsx/machine/memory/map';
import { DeviceScheduler } from '../../src/bmsx/machine/scheduler/device';
import { createVdpTransformSnapshot, resolveVdpTransformSnapshot } from '../../src/bmsx/render/vdp/transform';

const VDP_BILLBOARD_HEADER = VDP_BBU_PACKET_KIND | (VDP_BBU_PACKET_PAYLOAD_WORDS << 16);
const VDP_SKYBOX_HEADER = VDP_SBX_PACKET_KIND | (VDP_SBX_PACKET_PAYLOAD_WORDS << 16);
const VDP_XF_MATRIX_HEADER = VDP_XF_PACKET_KIND | (VDP_XF_MATRIX_PACKET_PAYLOAD_WORDS << 16);
const VDP_XF_SELECT_HEADER = VDP_XF_PACKET_KIND | (VDP_XF_SELECT_PACKET_PAYLOAD_WORDS << 16);

function createVdp(): { memory: Memory; scheduler: DeviceScheduler; vdp: VDP } {
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
	return { memory, scheduler, vdp };
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

function buildFrameOpen(vdp: VDP): boolean {
	return (vdp as any).buildFrame.state !== VDP_DEX_FRAME_IDLE;
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

function xfMatrixRegisterPacket(matrixIndex: number, words: readonly number[]): number[] {
	assert.equal(words.length, VDP_XF_MATRIX_WORDS);
	return [
		VDP_XF_MATRIX_HEADER,
		matrixIndex * VDP_XF_MATRIX_WORDS,
		...words,
	];
}

function xfSelectRegisterPacket(viewMatrixIndex: number, projectionMatrixIndex: number): number[] {
	return [
		VDP_XF_SELECT_HEADER,
		VDP_XF_VIEW_MATRIX_INDEX_REGISTER,
		viewMatrixIndex,
		projectionMatrixIndex,
	];
}

function assertVdpFault(memory: Memory, code: number): void {
	assert.equal(memory.readIoU32(IO_VDP_FAULT_CODE), code);
	assert.equal((memory.readIoU32(IO_VDP_STATUS) & VDP_STATUS_FAULT) !== 0, true);
}

function drainFrameBufferPresentation(vdp: VDP): { count: number; dirtyRowStart: number; dirtyRowEnd: number; firstDirtyXEnd: number } {
	const result = {
		count: 0,
		dirtyRowStart: 0,
		dirtyRowEnd: 0,
		firstDirtyXEnd: 0,
	};
	const sink: VdpFrameBufferPresentationSink = {
		consumeVdpFrameBufferPresentation(presentation: VdpFrameBufferPresentation): void {
			result.count = presentation.presentationCount;
			result.dirtyRowStart = presentation.dirtyRowStart;
			result.dirtyRowEnd = presentation.dirtyRowEnd;
			result.firstDirtyXEnd = presentation.dirtySpansByRow[presentation.dirtyRowStart]!.xEnd;
		},
	};
	vdp.drainFrameBufferPresentation(sink);
	return result;
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
	memory.writeValue(IO_VDP_REG_DRAW_PRIORITY, 7);
	memory.writeValue(IO_VDP_REG_DRAW_COLOR, 0xff112233);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_FILL_RECT);
	memory.writeValue(IO_VDP_REG_DRAW_COLOR, 0xff445566);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);

	assert.equal(activeQueue(vdp).length, 1);
	assert.equal(activeQueue(vdp).color[0], 0xff112233);
});

test('VDP framebuffer present edge swaps CPU-visible display page', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_BG_COLOR, 0xff112233);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_CLEAR);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	const workUnits = vdp.getPendingRenderWorkUnits();
	assert.ok(workUnits > 0);
	vdp.advanceWork(workUnits);

	const readback = new Uint8Array(4);
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), true);
	assert.equal(vdp.readFrameBufferPixels(VDP_FRAMEBUFFER_PAGE_DISPLAY, 0, 0, 1, 1, readback), true);
	assert.deepEqual(Array.from(readback), [0x11, 0x22, 0x33, 0xff]);
	const presentation = drainFrameBufferPresentation(vdp);
	assert.equal(presentation.count, 1);
	assert.equal(presentation.dirtyRowStart, 0);
	assert.equal(presentation.dirtyRowEnd, vdp.frameBufferHeight);
	assert.equal(presentation.firstDirtyXEnd, vdp.frameBufferWidth);
});

test('VDP2D BLIT snapshots DRAW_CTRL flip and parallax immutably', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 0);
	memory.writeValue(IO_VDP_REG_SRC_WH, 4 | (4 << 16));
	memory.writeValue(IO_VDP_REG_DRAW_PRIORITY, 9);
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
	memory.writeValue(IO_VDP_REG_DRAW_PRIORITY, 9);
	memory.writeValue(IO_VDP_REG_DRAW_CTRL, 0x00800000);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	memory.writeValue(IO_VDP_PMU_Y, 100 << 16);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);

	memory.writeValue(IO_VDP_PMU_Y, 8 << 16);
	vdp.accrueCycles(500, 750);

	const workUnits = vdp.getPendingRenderWorkUnits();
	assert.ok(workUnits > 0);
	const command = activeQueue(vdp);
	assert.equal(command.opcode[0], VDP_BLITTER_OPCODE_BLIT);
	assert.equal(command.parallaxWeight[0], 0.5);
	assert.equal(command.dstX[0], 32);
	assert.equal(command.dstY[0], 48);
	assert.equal(command.scaleX[0], 1);
	assert.equal(command.scaleY[0], 1);
	vdp.advanceWork(workUnits);
	assert.equal(vdp.getPendingRenderWorkUnits(), 0);
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
	memory.writeValue(IO_VDP_REG_DRAW_PRIORITY, 9);
	memory.writeValue(IO_VDP_REG_DRAW_CTRL, 0x00800000 | (3 << 8));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);

	const workUnits = vdp.getPendingRenderWorkUnits();
	assert.ok(workUnits > 0);
	const command = activeQueue(vdp);
	assert.equal(command.opcode[0], VDP_BLITTER_OPCODE_BLIT);
	assert.equal(command.parallaxWeight[0], 0.5);
	assert.equal(command.dstY[0], 46);
	assert.equal(command.scaleX[0], 1.25);
	assert.equal(command.scaleY[0], 1);
	vdp.advanceWork(workUnits);
	assert.equal(vdp.getPendingRenderWorkUnits(), 0);
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
	memory.writeValue(IO_VDP_REG_DRAW_PRIORITY, 9);
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
	assert.equal(activeQueue(vdp).color[0], 0xff010203);
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
	sealStream(memory, vdp, [VDP_PKT_REG1 | 19, 0, VDP_PKT_END]);
	assertVdpFault(memory, VDP_FAULT_STREAM_BAD_PACKET);
	clearVdpFault(memory);
	sealStream(memory, vdp, [VDP_PKT_REGN | (2 << 16) | 18, 0, 0, VDP_PKT_END]);
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
	assert.equal((vdp as any).activeFrame.state, VDP_SUBMITTED_FRAME_EMPTY);
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
	assert.equal((vdp as any).activeFrame.state, VDP_SUBMITTED_FRAME_EMPTY);
	assert.equal(activeQueue(vdp).length, 0);
});

test('VDP2D SLOT_INDEX latches raw words and SLOT_DIM applies in-order through REGN', () => {
	const { memory, vdp } = createVdp();
	let primaryWidth = 0;
	let primaryHeight = 0;
	const primarySurfaceProbe = {
		consumeVdpSurfaceUpload(upload: VdpSurfaceUpload): void {
			if (upload.surfaceId === VDP_RD_SURFACE_PRIMARY) {
				primaryWidth = upload.surfaceWidth;
				primaryHeight = upload.surfaceHeight;
			}
		},
	};

	memory.writeValue(IO_VDP_REG_SLOT_INDEX, 3);
	assert.equal(memory.readValue(IO_VDP_REG_SLOT_INDEX), 3);
	memory.writeValue(IO_VDP_REG_SLOT_INDEX, VDP_SLOT_PRIMARY);

	sealStream(memory, vdp, [
		VDP_PKT_REGN | (2 << 16) | VDP_REG_SLOT_INDEX,
		VDP_SLOT_PRIMARY,
		16 | (16 << 16),
		VDP_PKT_END,
	]);
	vdp.drainSurfaceUploads(primarySurfaceProbe);
	assert.deepEqual({ width: primaryWidth, height: primaryHeight }, { width: 16, height: 16 });

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 0xffff | (0xffff << 16));
	assertVdpFault(memory, VDP_FAULT_VRAM_SLOT_DIM);
	primaryWidth = 0;
	primaryHeight = 0;
	vdp.drainSurfaceUploads(primarySurfaceProbe);
	assert.deepEqual({ width: primaryWidth, height: primaryHeight }, { width: 0, height: 0 });

	clearVdpFault(memory);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_SRC_UV, 15);
	memory.writeValue(IO_VDP_REG_SRC_WH, 1 | (1 << 16));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	assert.equal(memory.readIoU32(IO_VDP_FAULT_CODE), 0);
	memory.writeValue(IO_VDP_REG_SRC_UV, 16);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	assertVdpFault(memory, VDP_FAULT_DEX_SOURCE_OOB);
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
	assert.equal((vdp as any).activeFrame.state, VDP_SUBMITTED_FRAME_READY);
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

test('VDP2D BLIT faults unsupported DRAW_CTRL blend bits at snapshot', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 0);
	memory.writeValue(IO_VDP_REG_SRC_WH, 4 | (4 << 16));
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, 0x00010000);
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_Y, 0x00010000);
	memory.writeValue(IO_VDP_REG_DRAW_CTRL, 0x00000004);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
	assertVdpFault(memory, VDP_FAULT_DEX_UNSUPPORTED_DRAW_CTRL);
	assert.equal(memory.readValue(IO_VDP_REG_DRAW_CTRL), 0x00000004);
	assert.equal(buildFrameOpen(vdp), true);
});

test('VDP2D blitter FIFO overflow latches a DEX fault instead of throwing', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_GEOM_X0, 0);
	memory.writeValue(IO_VDP_REG_GEOM_X0 + IO_WORD_SIZE, 0);
	memory.writeValue(IO_VDP_REG_GEOM_X0 + 2 * IO_WORD_SIZE, 1 << 16);
	memory.writeValue(IO_VDP_REG_GEOM_X0 + 3 * IO_WORD_SIZE, 1 << 16);
	for (let index = 0; index <= VDP_BLITTER_FIFO_CAPACITY; index += 1) {
		memory.writeValue(IO_VDP_CMD, VDP_CMD_FILL_RECT);
	}

	assertVdpFault(memory, VDP_FAULT_DEX_OVERFLOW);
	assert.equal(buildFrameOpen(vdp), true);
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
	assert.equal((vdp as any).activeFrame.state, VDP_SUBMITTED_FRAME_READY);
	assert.equal((vdp as any).activeFrame.hasCommands, false);
});

test('VDP2D BLIT source rect OOB latches a DEX source fault', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_DRAW_PRIORITY, 1);
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

test('VDP VRAM read faults latch status instead of throwing', () => {
	const { memory, vdp } = createVdp();
	const out = new Uint8Array(4);

	assert.doesNotThrow(() => vdp.readVram(0, out));
	assertVdpFault(memory, VDP_FAULT_VRAM_WRITE_UNMAPPED);
	assert.deepEqual(Array.from(out), [0, 0, 0, 0]);
	clearVdpFault(memory);

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 1 | (1 << 16));
	assert.doesNotThrow(() => vdp.readVram(VRAM_PRIMARY_SLOT_BASE + 4, out));
	assertVdpFault(memory, VDP_FAULT_VRAM_WRITE_OOB);
	assert.deepEqual(Array.from(out), [0, 0, 0, 0]);
});

test('VDP VOUT scanout timing owns the VBLANK output pin', () => {
	const { memory, scheduler, vdp } = createVdp();

	assert.equal(vdp.readDeviceOutput().scanoutPhase, VDP_VOUT_SCANOUT_PHASE_ACTIVE);
	assert.equal(vdp.readDeviceOutput().scanoutX, 0);
	assert.equal(vdp.readDeviceOutput().scanoutY, 0);
	assert.equal((memory.readIoU32(IO_VDP_STATUS) & VDP_STATUS_VBLANK) !== 0, false);
	vdp.setScanoutTiming(false, 0, 100, 80);
	scheduler.setNowCycles(41);
	assert.equal(vdp.readDeviceOutput().scanoutPhase, VDP_VOUT_SCANOUT_PHASE_ACTIVE);
	assert.equal(vdp.readDeviceOutput().scanoutX, 166);
	assert.equal(vdp.readDeviceOutput().scanoutY, 108);
	assert.equal((memory.readIoU32(IO_VDP_STATUS) & VDP_STATUS_VBLANK) !== 0, false);
	scheduler.setNowCycles(80);
	vdp.setScanoutTiming(true, 80, 100, 80);
	scheduler.setNowCycles(90);
	assert.equal(vdp.readDeviceOutput().scanoutPhase, VDP_VOUT_SCANOUT_PHASE_VBLANK);
	assert.equal(vdp.readDeviceOutput().scanoutX, 128);
	assert.equal(vdp.readDeviceOutput().scanoutY, 238);
	assert.equal((memory.readIoU32(IO_VDP_STATUS) & VDP_STATUS_VBLANK) !== 0, true);
	scheduler.setNowCycles(100);
	vdp.setScanoutTiming(false, 0, 100, 80);
	scheduler.setNowCycles(120);
	assert.equal(vdp.readDeviceOutput().scanoutPhase, VDP_VOUT_SCANOUT_PHASE_ACTIVE);
	assert.equal(vdp.readDeviceOutput().scanoutX, 0);
	assert.equal(vdp.readDeviceOutput().scanoutY, 53);
	assert.equal((memory.readIoU32(IO_VDP_STATUS) & VDP_STATUS_VBLANK) !== 0, false);
});

test('VDP dither register writes update the live latch directly', () => {
	const { memory, vdp } = createVdp();

	assert.equal(vdp.readDeviceOutput().ditherType, 0);
	assert.equal(vdp.readDeviceOutput().frameBufferWidth, 256);
	assert.equal(vdp.readDeviceOutput().frameBufferHeight, 212);
	memory.writeValue(IO_VDP_DITHER, 3);
	vdp.setDecodedVramSurfaceDimensions(VRAM_FRAMEBUFFER_BASE, 128, 64);

	assert.equal(vdp.captureState().ditherType, 3);
	assert.equal(vdp.readDeviceOutput().ditherType, 0);
	assert.equal(vdp.frameBufferWidth, 128);
	assert.equal(vdp.frameBufferHeight, 64);
	assert.equal(vdp.readDeviceOutput().frameBufferWidth, 256);
	assert.equal(vdp.readDeviceOutput().frameBufferHeight, 212);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	vdp.setDecodedVramSurfaceDimensions(VRAM_FRAMEBUFFER_BASE, 96, 48);
	assert.equal(vdp.frameBufferWidth, 96);
	assert.equal(vdp.frameBufferHeight, 48);
	assert.equal(vdp.readDeviceOutput().frameBufferWidth, 256);
	assert.equal(vdp.readDeviceOutput().frameBufferHeight, 212);
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), false);
	assert.equal(vdp.readDeviceOutput().ditherType, 3);
	assert.equal(vdp.readDeviceOutput().frameBufferWidth, 128);
	assert.equal(vdp.readDeviceOutput().frameBufferHeight, 64);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), false);
	assert.equal(vdp.readDeviceOutput().frameBufferWidth, 96);
	assert.equal(vdp.readDeviceOutput().frameBufferHeight, 48);
});

test('VDP save-state restores raw registerfile and surface geometry', () => {
	const { memory, vdp } = createVdp();
	const pixels = new Uint8Array(16 * 16 * 4);
	pixels[0] = 0xaa;
	pixels[1] = 0xbb;
	pixels[2] = 0xcc;
	pixels[3] = 0xff;

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_REG_BG_COLOR, 0xff112233);
	vdp.writeVram(VRAM_PRIMARY_SLOT_BASE, pixels);
	const saved = vdp.captureSaveState();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 1 | (1 << 16));
	memory.writeValue(IO_VDP_REG_BG_COLOR, 0xff445566);
	vdp.writeVram(VRAM_PRIMARY_SLOT_BASE, new Uint8Array([0x10, 0x20, 0x30, 0x40]));

	vdp.restoreSaveState(saved);
	assert.equal(memory.readIoU32(IO_VDP_REG_BG_COLOR), 0xff112233);

	let primaryWidth = 0;
	let primaryHeight = 0;
	vdp.drainSurfaceUploads({
		consumeVdpSurfaceUpload(upload: VdpSurfaceUpload): void {
			if (upload.surfaceId === VDP_RD_SURFACE_PRIMARY) {
				primaryWidth = upload.surfaceWidth;
				primaryHeight = upload.surfaceHeight;
			}
		},
	});
	assert.deepEqual({ width: primaryWidth, height: primaryHeight }, { width: 16, height: 16 });

	const restoredPixel = new Uint8Array(4);
	vdp.readVram(VRAM_PRIMARY_SLOT_BASE, restoredPixel);
	assert.deepEqual(Array.from(restoredPixel), [0xaa, 0xbb, 0xcc, 0xff]);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_CLEAR);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	const workUnits = vdp.getPendingRenderWorkUnits();
	assert.ok(workUnits > 0);
	vdp.advanceWork(workUnits);
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), true);
	const displayPixel = new Uint8Array(4);
	assert.equal(vdp.readFrameBufferPixels(VDP_FRAMEBUFFER_PAGE_DISPLAY, 0, 0, 1, 1, displayPixel), true);
	assert.deepEqual(Array.from(displayPixel), [0x11, 0x22, 0x33, 0xff]);
});

test('VDP save-state restores active and queued submitted frames', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_BG_COLOR, 0xff101112);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_CLEAR);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	const firstFrameWork = vdp.getPendingRenderWorkUnits();
	assert.ok(firstFrameWork > 0);

	memory.writeValue(IO_VDP_REG_BG_COLOR, 0xff202122);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_CLEAR);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	const saved = vdp.captureSaveState();

	memory.writeValue(IO_VDP_REG_BG_COLOR, 0xff303132);
	vdp.advanceWork(vdp.getPendingRenderWorkUnits());
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), true);

	vdp.restoreSaveState(saved);
	assert.equal(vdp.getPendingRenderWorkUnits(), firstFrameWork);
	vdp.advanceWork(vdp.getPendingRenderWorkUnits());
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), true);
	const firstDisplayPixel = new Uint8Array(4);
	assert.equal(vdp.readFrameBufferPixels(VDP_FRAMEBUFFER_PAGE_DISPLAY, 0, 0, 1, 1, firstDisplayPixel), true);
	assert.deepEqual(Array.from(firstDisplayPixel), [0x10, 0x11, 0x12, 0xff]);

	assert.ok(vdp.getPendingRenderWorkUnits() > 0);
	vdp.advanceWork(vdp.getPendingRenderWorkUnits());
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), true);
	const secondDisplayPixel = new Uint8Array(4);
	assert.equal(vdp.readFrameBufferPixels(VDP_FRAMEBUFFER_PAGE_DISPLAY, 0, 0, 1, 1, secondDisplayPixel), true);
	assert.deepEqual(Array.from(secondDisplayPixel), [0x20, 0x21, 0x22, 0xff]);
});

test('VDP SBX live state commits only through frame present', () => {
	const { memory, vdp } = createVdp();

	assert.equal(vdp.readDeviceOutput().skyboxEnabled, false);
	writeSkyboxMmio(memory);
	assert.equal(vdp.readDeviceOutput().skyboxEnabled, false);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	assert.equal(vdp.readDeviceOutput().skyboxEnabled, false);
	vdp.presentReadyFrameOnVblankEdge();
	assert.equal(vdp.readDeviceOutput().skyboxEnabled, true);

	writeSkyboxMmio(memory, 0);
	assert.equal(vdp.readDeviceOutput().skyboxEnabled, true);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	vdp.presentReadyFrameOnVblankEdge();
	assert.equal(vdp.readDeviceOutput().skyboxEnabled, false);
});

test('VDP SBX validates face words during frame seal', () => {
	const { memory, vdp } = createVdp();

	writeSkyboxMmio(memory, VDP_SBX_CONTROL_ENABLE, 2, 1);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	assertVdpFault(memory, VDP_FAULT_SBX_SOURCE_OOB);
	assert.equal(buildFrameOpen(vdp), false);
	assert.equal(vdp.readDeviceOutput().skyboxEnabled, false);
});

test('VDP SBX accepts SKYBOX packets into frame-latched state', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	sealStream(memory, vdp, [...skyboxPacket(VDP_SBX_CONTROL_ENABLE, 4, 5), VDP_PKT_END]);
	vdp.presentReadyFrameOnVblankEdge();
	assert.equal(vdp.readDeviceOutput().skyboxEnabled, true);
	const sample = vdp.readDeviceOutput().skyboxSamples[0]!;
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
	assert.equal(vdp.readDeviceOutput().skyboxEnabled, false);
	sealStream(memory, vdp, [...skyboxPacket(VDP_SBX_CONTROL_ENABLE, 17, 1), VDP_PKT_END]);
	assertVdpFault(memory, VDP_FAULT_SBX_SOURCE_OOB);
	assert.equal(vdp.readDeviceOutput().skyboxEnabled, false);
	clearVdpFault(memory);
	sealStream(memory, vdp, [...skyboxPacket(VDP_SBX_CONTROL_ENABLE, 4, 5), VDP_PKT_END]);
	vdp.presentReadyFrameOnVblankEdge();
	assert.equal(vdp.readDeviceOutput().skyboxEnabled, true);
});

test('VDP XF packet updates raw transform register state', () => {
	const { memory, vdp } = createVdp();
	const viewMatrixIndex = 2;
	const projectionMatrixIndex = 3;
	const viewWords = [
		0x00010000, 0, 0, 0,
		0, 0x00010000, 0, 0,
		0, 0, 0x00010000, 0,
		0x00030000, 0x00040000, 0xfffb0000, 0x00010000,
	];
	const projWords = [
		0x00020000, 0, 0, 0,
		0, 0x00020000, 0, 0,
		0, 0, 0xffff0000, 0xffff0000,
		0, 0, 0xfffe0000, 0,
	];

	sealStream(memory, vdp, [
		...xfMatrixRegisterPacket(viewMatrixIndex, viewWords),
		...xfMatrixRegisterPacket(projectionMatrixIndex, projWords),
		...xfSelectRegisterPacket(viewMatrixIndex, projectionMatrixIndex),
		VDP_PKT_END,
	]);

	const state = vdp.captureState();
	const viewBase = viewMatrixIndex * VDP_XF_MATRIX_WORDS;
	const projectionBase = projectionMatrixIndex * VDP_XF_MATRIX_WORDS;
	assert.equal(state.xf.viewMatrixIndex, viewMatrixIndex);
	assert.equal(state.xf.projectionMatrixIndex, projectionMatrixIndex);
	for (let index = 0; index < VDP_XF_MATRIX_WORDS; index += 1) {
		assert.equal(state.xf.matrixWords[viewBase + index] >>> 0, viewWords[index] >>> 0);
		assert.equal(state.xf.matrixWords[projectionBase + index] >>> 0, projWords[index] >>> 0);
	}
});

test('VDP XF words resolve to render-owned skybox transform', () => {
	const transform = createVdpTransformSnapshot();
	const viewMatrixIndex = 2;
	const projectionMatrixIndex = 3;
	const matrixWords = new Array<number>(VDP_XF_MATRIX_REGISTER_WORDS).fill(0);
	const viewWords = [
		0x00020000, 0, 0, 0,
		0, 0x00040000, 0, 0,
		0, 0, 0x00080000, 0,
		0x00060000, 0x00080000, 0x00100000, 0x00010000,
	];
	const projWords = [
		0x00010000, 0, 0, 0,
		0, 0x00010000, 0, 0,
		0, 0, 0x00010000, 0,
		0, 0, 0, 0x00010000,
	];
	for (let index = 0; index < VDP_XF_MATRIX_WORDS; index += 1) {
		matrixWords[viewMatrixIndex * VDP_XF_MATRIX_WORDS + index] = viewWords[index];
		matrixWords[projectionMatrixIndex * VDP_XF_MATRIX_WORDS + index] = projWords[index];
	}

	resolveVdpTransformSnapshot(transform, matrixWords, viewMatrixIndex, projectionMatrixIndex);

	assert.equal(transform.view[0], 2);
	assert.equal(transform.skyboxView[0], 0.5);
	assert.equal(transform.skyboxView[5], 0.25);
	assert.equal(transform.skyboxView[10], 0.125);
	assert.equal(transform.skyboxView[12], 0);
	assert.equal(transform.skyboxView[13], 0);
	assert.equal(transform.skyboxView[14], 0);
	assert.equal(transform.eye[0], -3);
	assert.equal(transform.eye[1], -2);
	assert.equal(transform.eye[2], -2);
});

test('VDP XF packet faults through VDP state instead of exceptions', () => {
	const { memory, vdp } = createVdp();

	assert.doesNotThrow(() => sealStream(memory, vdp, [
		VDP_XF_PACKET_KIND | (VDP_XF_SELECT_PACKET_PAYLOAD_WORDS << 16),
		VDP_XF_VIEW_MATRIX_INDEX_REGISTER,
		VDP_XF_MATRIX_COUNT,
		0,
		VDP_PKT_END,
	]));
	assertVdpFault(memory, VDP_FAULT_STREAM_BAD_PACKET);
	assert.equal(vdp.getPendingRenderWorkUnits(), 0);
});

test('VDP XF state is committed with the submitted frame instead of latest live state', () => {
	const { memory, vdp } = createVdp();
	const projWords = [
		0x00010000, 0, 0, 0,
		0, 0x00010000, 0, 0,
		0, 0, 0x00010000, 0,
		0, 0, 0, 0x00010000,
	];
	const frameAView = [
		0x00020000, 0, 0, 0,
		0, 0x00010000, 0, 0,
		0, 0, 0x00010000, 0,
		0, 0, 0, 0x00010000,
	];
	const frameBView = [
		0x00030000, 0, 0, 0,
		0, 0x00010000, 0, 0,
		0, 0, 0x00010000, 0,
		0, 0, 0, 0x00010000,
	];

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	sealStream(memory, vdp, [
		...xfMatrixRegisterPacket(2, frameAView),
		...xfMatrixRegisterPacket(3, projWords),
		...xfSelectRegisterPacket(2, 3),
		VDP_PKT_REGN | (5 << 16) | VDP_REG_SRC_SLOT,
		VDP_SLOT_PRIMARY,
		0,
		4 | (4 << 16),
		0,
		0,
		VDP_PKT_REG1 | VDP_REG_DRAW_PRIORITY,
		9,
		VDP_PKT_CMD | VDP_CMD_BLIT,
		VDP_PKT_END,
	]);
	sealStream(memory, vdp, [
		...xfMatrixRegisterPacket(4, frameBView),
		...xfMatrixRegisterPacket(5, projWords),
		...xfSelectRegisterPacket(4, 5),
		VDP_PKT_END,
	]);

	const workUnits = vdp.getPendingRenderWorkUnits();
	assert.ok(workUnits > 0);
	vdp.advanceWork(workUnits);
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), true);
	const output = vdp.readDeviceOutput();
	assert.equal(output.xfViewMatrixIndex, 2);
	assert.equal(output.xfProjectionMatrixIndex, 3);
	assert.equal(output.xfMatrixWords[2 * VDP_XF_MATRIX_WORDS] >>> 0, frameAView[0]);
	assert.notEqual(output.xfMatrixWords[2 * VDP_XF_MATRIX_WORDS] >>> 0, frameBView[0]);
});

function billboardPacket(sizeWord: number, u = 2, v = 3, w = 4, h = 5, control = 0): number[] {
	return [
		VDP_BILLBOARD_HEADER,
		0,
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
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), false);
	const output = vdp.readDeviceOutput();
	const billboards = output.billboards;
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
	assert.equal(billboards.color[0], 0xff112233);
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
	sealStream(memory, vdp, [...billboardPacket(1 << 16, 0, 0, 1, 1), VDP_PKT_END]);
	assert.equal(vdp.getPendingRenderWorkUnits(), 1);
	vdp.advanceWork(1);
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), false);
	assert.equal(vdp.readDeviceOutput().billboards.length, 1);

	const stream: number[] = [];
	for (let index = 0; index <= VDP_BBU_BILLBOARD_LIMIT; index += 1) {
		stream.push(...billboardPacket(1 << 16, 0, 0, 1, 1));
	}
	stream.push(VDP_PKT_END);
	sealStream(memory, vdp, stream);
	assertVdpFault(memory, VDP_FAULT_BBU_OVERFLOW);
	assert.equal(vdp.getPendingRenderWorkUnits(), 0);
});
