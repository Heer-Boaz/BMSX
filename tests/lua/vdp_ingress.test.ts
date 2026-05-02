import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IO_VDP_CMD,
	IO_VDP_DITHER,
	IO_VDP_PMU_BANK,
	IO_VDP_PMU_CTRL,
	IO_VDP_PMU_SCALE_X,
	IO_VDP_PMU_SCALE_Y,
	IO_VDP_PMU_Y,
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
	VDP_SLOT_ATLAS_NONE,
	VDP_SLOT_PRIMARY,
} from '../../src/bmsx/machine/bus/io';
import { CPU } from '../../src/bmsx/machine/cpu/cpu';
import { VDP } from '../../src/bmsx/machine/devices/vdp/vdp';
import { VDP_RD_SURFACE_PRIMARY } from '../../src/bmsx/machine/devices/vdp/contracts';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { IO_WORD_SIZE, VDP_STREAM_BUFFER_BASE } from '../../src/bmsx/machine/memory/map';
import { DeviceScheduler } from '../../src/bmsx/machine/scheduler/device';

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

function activeQueue(vdp: VDP): any[] {
	return (vdp as any).activeFrame.queue;
}

function skyboxSources(w = 1, h = 1) {
	const source = { slot: VDP_SLOT_PRIMARY, u: 0, v: 0, w, h };
	return {
		posx: source,
		negx: source,
		posy: source,
		negy: source,
		posz: source,
		negz: source,
	};
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

test('VDP2D direct lifecycle opens, seals, and rejects invalid edges', () => {
	const { memory, vdp } = createVdp();

	assert.throws(() => memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME));
	assert.throws(() => memory.writeValue(IO_VDP_CMD, VDP_CMD_FILL_RECT));

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	assert.equal(buildFrameOpen(vdp), true);
	assert.throws(() => memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME));
	assert.equal(buildFrameOpen(vdp), false);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_NOP);
	assert.equal(buildFrameOpen(vdp), false);
});

test('VDP2D direct register faults preserve latches and do not cancel an open frame', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	assert.throws(() => memory.writeValue(IO_VDP_REG_DRAW_CTRL, 0x4));
	assert.equal(memory.readValue(IO_VDP_REG_DRAW_CTRL), 0);
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
	assert.deepEqual(activeQueue(vdp)[0].color, { r: 0x11, g: 0x22, b: 0x33, a: 0xff });
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

	const command = activeQueue(vdp)[0];
	assert.equal(command.opcode, 'blit');
	assert.equal(command.flipH, true);
	assert.equal(command.flipV, true);
	assert.equal(command.parallaxWeight, -1);
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
	const queue = vdp.takeReadyExecutionQueue();
	assert.ok(queue);
	const command = queue[0];
	assert.equal(command.opcode, 'blit');
	assert.equal(command.parallaxWeight, 0.5);
	assert.equal(command.dstX, 32);
	assert.equal(command.dstY, 48);
	assert.equal(command.scaleX, 1);
	assert.equal(command.scaleY, 1);
	vdp.completeReadyExecution(queue);
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
	const queue = vdp.takeReadyExecutionQueue();
	assert.ok(queue);
	const command = queue[0];
	assert.equal(command.opcode, 'blit');
	assert.equal(command.parallaxWeight, 0.5);
	assert.equal(command.dstY, 46);
	assert.equal(command.scaleX, 1.25);
	assert.equal(command.scaleY, 1);
	vdp.completeReadyExecution(queue);
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

	const command = activeQueue(vdp)[0];
	assert.equal(command.opcode, 'blit');
	assert.equal(command.parallaxWeight, -0.5);
	assert.equal(command.dstY, 34);
	assert.equal(command.scaleX, 1.25);
	assert.equal(command.scaleY, 1);
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
	assert.deepEqual(activeQueue(vdp)[0].color, { r: 1, g: 2, b: 3, a: 0xff });
});

test('VDP2D FIFO packet faults cancel the frame while preserving prior register side effects', () => {
	const { memory, vdp } = createVdp();

	assert.throws(() => sealStream(memory, vdp, [
		VDP_PKT_REG1 | VDP_REG_BG_COLOR,
		0xff102030,
		0x04000000,
		VDP_PKT_END,
	]));

	assert.equal(memory.readValue(IO_VDP_REG_BG_COLOR), 0xff102030);
	assert.equal(activeQueue(vdp).length, 0);
});

test('VDP2D FIFO rejects reserved bits and register ranges', () => {
	const { memory, vdp } = createVdp();

	assert.throws(() => sealStream(memory, vdp, [VDP_PKT_CMD | (1 << 16) | VDP_CMD_CLEAR, VDP_PKT_END]));
	assert.throws(() => sealStream(memory, vdp, [VDP_PKT_REG1 | 18, 0, VDP_PKT_END]));
	assert.throws(() => sealStream(memory, vdp, [VDP_PKT_REGN | (2 << 16) | 17, 0, 0, VDP_PKT_END]));
});

test('VDP2D SLOT_INDEX and SLOT_DIM validate and apply in-order through REGN', () => {
	const { memory, vdp } = createVdp();

	assert.throws(() => memory.writeValue(IO_VDP_REG_SLOT_INDEX, 3));
	assert.equal(memory.readValue(IO_VDP_REG_SLOT_INDEX), VDP_SLOT_PRIMARY);

	sealStream(memory, vdp, [
		VDP_PKT_REGN | (2 << 16) | VDP_REG_SLOT_INDEX,
		VDP_SLOT_PRIMARY,
		16 | (16 << 16),
		VDP_PKT_END,
	]);
	assert.deepEqual(vdp.resolveBlitterSurfaceSize(VDP_RD_SURFACE_PRIMARY), { width: 16, height: 16 });

	assert.throws(() => memory.writeValue(IO_VDP_REG_SLOT_DIM, 0xffff | (0xffff << 16)));
	assert.deepEqual(vdp.resolveBlitterSurfaceSize(VDP_RD_SURFACE_PRIMARY), { width: 16, height: 16 });
});

test('VDP2D validation failures cancel direct draw frames', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, 0x00010000);
	assert.throws(() => memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT));

	assert.equal(buildFrameOpen(vdp), false);
	assert.equal(activeQueue(vdp).length, 0);
});

test('VDP2D faults invalid BLIT and LINE geometry at command latch', () => {
	{
		const { memory, vdp } = createVdp();
		memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
		memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
		memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
		memory.writeValue(IO_VDP_REG_SRC_UV, 0);
		memory.writeValue(IO_VDP_REG_SRC_WH, 4 | (4 << 16));
		memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, 0xffff0000);
		memory.writeValue(IO_VDP_REG_DRAW_SCALE_Y, 0x00010000);

		assert.throws(() => memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT));
		assert.equal(memory.readValue(IO_VDP_REG_DRAW_SCALE_X), 0xffff0000);
		assert.equal(buildFrameOpen(vdp), false);
	}
	{
		const { memory, vdp } = createVdp();
		memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
		memory.writeValue(IO_VDP_REG_LINE_WIDTH, 0);

		assert.throws(() => memory.writeValue(IO_VDP_CMD, VDP_CMD_DRAW_LINE));
		assert.equal(memory.readValue(IO_VDP_REG_LINE_WIDTH), 0);
		assert.equal(buildFrameOpen(vdp), false);
	}
});

test('VDP2D faults invalid PMU-resolved BLIT scale at command latch', () => {
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

	assert.throws(() => memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT));
	assert.equal(buildFrameOpen(vdp), false);
});

test('VDP2D FIFO allows an empty PKT_END-only frame', () => {
	const { memory, vdp } = createVdp();

	sealStream(memory, vdp, [VDP_PKT_END]);

	assert.equal(activeQueue(vdp).length, 0);
	assert.equal((vdp as any).activeFrame.occupied, true);
	assert.equal((vdp as any).activeFrame.hasCommands, false);
});

test('VDP2D BLIT validates source rect bounds', () => {
	const { memory, vdp } = createVdp();

	memory.writeValue(IO_VDP_REG_SLOT_DIM, 16 | (16 << 16));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_DRAW_LAYER_PRIO, 1 << 8);
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, 0x00010000);
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_Y, 0x00010000);
	memory.writeValue(IO_VDP_REG_SRC_SLOT, VDP_SLOT_PRIMARY);
	memory.writeValue(IO_VDP_REG_SRC_UV, 15 | (0 << 16));
	memory.writeValue(IO_VDP_REG_SRC_WH, 2 | (16 << 16));

	assert.throws(() => memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT));
	assert.equal(buildFrameOpen(vdp), false);
});

test('VDP SBX live state commits only through frame present', () => {
	const { memory, vdp } = createVdp();

	assert.equal(vdp.committedSkyboxEnabled, false);
	vdp.setSkyboxSources(skyboxSources());
	assert.equal(vdp.committedSkyboxEnabled, false);

	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	assert.equal(vdp.committedSkyboxEnabled, false);
	vdp.presentReadyFrameOnVblankEdge();
	assert.equal(vdp.committedSkyboxEnabled, true);

	vdp.clearSkybox();
	assert.equal(vdp.committedSkyboxEnabled, true);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	vdp.presentReadyFrameOnVblankEdge();
	assert.equal(vdp.committedSkyboxEnabled, false);
});

test('VDP SBX validates face words during frame seal', () => {
	const { memory, vdp } = createVdp();

	vdp.setSkyboxSources(skyboxSources(2, 1));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);

	assert.throws(() => memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME));
	assert.equal(buildFrameOpen(vdp), false);
	assert.equal(vdp.committedSkyboxEnabled, false);
});
