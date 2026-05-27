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
	IO_VDP_RD_DATA,
	IO_VDP_RD_MODE,
	IO_VDP_RD_STATUS,
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
	IO_VDP_SLOT_PRIMARY,
	IO_VDP_SLOT_SECONDARY,
	IO_VDP_STATUS,
} from '../../src/bmsx/machine/bus/io';
import { CPU } from '../../src/bmsx/machine/cpu/cpu';
import type { VdpFrameBufferPresentation, VdpFrameBufferPresentationSink, VdpSurfaceUpload } from '../../src/bmsx/machine/devices/vdp/device_output';
import { VDP, VDP_FRAMEBUFFER_PAGE_DISPLAY } from '../../src/bmsx/machine/devices/vdp/vdp';
import {
	VDP_FIFO_CTRL_SEAL,
	VDP_FAULT_CMD_BAD_DOORBELL,
	VDP_FAULT_RD_OOB,
	VDP_FAULT_RD_UNSUPPORTED_MODE,
	VDP_FAULT_SUBMIT_STATE,
	VDP_FAULT_STREAM_BAD_PACKET,
	VDP_FAULT_VRAM_SLOT_DIM,
	VDP_FAULT_VRAM_WRITE_OOB,
	VDP_FAULT_VRAM_WRITE_UNALIGNED,
	VDP_FAULT_VRAM_WRITE_UNMAPPED,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
	VDP_RD_SURFACE_PRIMARY,
	VDP_SLOT_NONE,
	VDP_SLOT_PRIMARY,
	VDP_STATUS_FAULT,
	VDP_STATUS_VBLANK,
} from '../../src/bmsx/machine/devices/vdp/contracts';
import {
	VDP_DEX_FRAME_IDLE,
	VDP_SUBMITTED_FRAME_EMPTY,
	VDP_SUBMITTED_FRAME_READY,
} from '../../src/bmsx/machine/devices/vdp/frame';
import {
	VDP_CMD_BEGIN_FRAME,
	VDP_CMD_CLEAR,
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

const VDP_XF_MATRIX_HEADER = VDP_XF_PACKET_KIND | (VDP_XF_MATRIX_PACKET_PAYLOAD_WORDS << 16);
const VDP_XF_SELECT_HEADER = VDP_XF_PACKET_KIND | (VDP_XF_SELECT_PACKET_PAYLOAD_WORDS << 16);


function createVdp(): { memory: Memory; scheduler: DeviceScheduler; vdp: VDP } {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const scheduler = new DeviceScheduler(cpu);
	const vdp = new VDP(memory, scheduler, { width: 256, height: 212 });
	memory.writeIoValue(IO_VDP_DITHER, 0);
	memory.writeIoValue(IO_VDP_SLOT_PRIMARY, VDP_SLOT_NONE);
	memory.writeIoValue(IO_VDP_SLOT_SECONDARY, VDP_SLOT_NONE);
	vdp.initializeVramSurfaces();
	vdp.initializeRegisters();
	vdp.resetStatus();
	return { memory, scheduler, vdp };
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

test('VDP direct lifecycle opens, seals, and rejects invalid edges', () => {
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

test('VDP direct registers latch raw representable words without closing an open frame', () => {
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


test('VDP stream retains RPU pass and draw commands as device output', () => {
	const { memory, vdp } = createVdp();
	const rpuHeader = 0x18000000;
	const resourceNone = 0xffffffff;
	const opBeginPass = 32;
	const opEndPass = 33;
	const opBeginDraw = 40;
	const opEndDraw = 44;
	const shaderV2C4 = 0;
	const primitiveTriangles = 0;
	const indexNone = 0;
	const pipeColorWriteRgba = 0x000f0000;

	sealFifo(memory, [
		rpuHeader | (8 << 16), opBeginPass, resourceNone, resourceNone, 0, 256 | (212 << 16), 1, 0xff102030, 0xffffffff,
		rpuHeader | (9 << 16), opBeginDraw, shaderV2C4, primitiveTriangles | (indexNone << 8), pipeColorWriteRgba, 3, 1, resourceNone, 0, 0,
		rpuHeader | (1 << 16), opEndDraw,
		rpuHeader | (1 << 16), opEndPass,
		VDP_PKT_END,
	]);

	assert.equal(memory.readIoU32(IO_VDP_FAULT_CODE), 0);
	vdp.advanceWork(vdp.getPendingRenderWorkUnits());
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), false);
	const output = vdp.readDeviceOutput();
	assert.equal(output.rpu.commands.passCount, 1);
	assert.equal(output.rpu.commands.drawCount, 1);
	assert.equal(output.rpu.commands.passClearColor[0], 0xff102030);
	assert.equal(output.rpu.commands.drawVertexCount[0], 3);
	assert.equal(output.rpu.commands.drawInstanceCount[0], 1);
});

test('VDP packet FIFO faults cancel the frame while preserving prior register side effects', () => {
	const { memory, vdp } = createVdp();

	sealStream(memory, vdp, [
		VDP_PKT_REG1 | VDP_REG_BG_COLOR,
		0xff102030,
		0x04000000,
		VDP_PKT_END,
	]);

	assertVdpFault(memory, VDP_FAULT_STREAM_BAD_PACKET);
	assert.equal(memory.readValue(IO_VDP_REG_BG_COLOR), 0xff102030);
	assert.equal(vdp.getPendingRenderWorkUnits(), 0);
});

test('VDP packet FIFO rejects reserved bits and register ranges', () => {
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

test('VDP packet FIFO allows an empty PKT_END-only frame', () => {
	const { memory, vdp } = createVdp();

	sealStream(memory, vdp, [VDP_PKT_END]);

	assert.equal(vdp.getPendingRenderWorkUnits(), 0);
	assert.equal((vdp as any).activeFrame.state, VDP_SUBMITTED_FRAME_READY);
	assert.equal((vdp as any).activeFrame.hasCommands, false);
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


test('VDP save-state restores readback budget and overflow status', () => {
	const { memory, vdp } = createVdp();

	vdp.beginFrame();
	const state = vdp.captureState();
	state.readback.readBudgetBytes = 0;
	state.readback.readOverflow = true;
	vdp.beginFrame();
	assert.notEqual((memory.readValue(IO_VDP_RD_STATUS) as number) & VDP_RD_STATUS_READY, 0);

	vdp.restoreState(state);
	const status = memory.readValue(IO_VDP_RD_STATUS) as number;
	assert.equal(status & VDP_RD_STATUS_READY, 0);
	assert.notEqual(status & VDP_RD_STATUS_OVERFLOW, 0);
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

test('VDP XF words resolve to render-owned view rotation inverse transform', () => {
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
	assert.equal(transform.viewRotationInverse[0], 0.5);
	assert.equal(transform.viewRotationInverse[5], 0.25);
	assert.equal(transform.viewRotationInverse[10], 0.125);
	assert.equal(transform.viewRotationInverse[12], 0);
	assert.equal(transform.viewRotationInverse[13], 0);
	assert.equal(transform.viewRotationInverse[14], 0);
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
