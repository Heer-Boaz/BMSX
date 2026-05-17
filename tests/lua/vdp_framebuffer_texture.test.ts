import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IO_VDP_CMD,
	IO_VDP_DITHER,
	IO_VDP_REG_BG_COLOR,
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
} from '../../src/bmsx/machine/bus/io';
import {
	VDP_SLOT_ATLAS_NONE,
} from '../../src/bmsx/machine/devices/vdp/contracts';
import {
	VDP_CMD_BEGIN_FRAME,
	VDP_CMD_CLEAR,
	VDP_CMD_END_FRAME,
} from '../../src/bmsx/machine/devices/vdp/registers';

import { CPU } from '../../src/bmsx/machine/cpu/cpu';
import type { VdpFrameBufferPresentation, VdpFrameBufferPresentationSink } from '../../src/bmsx/machine/devices/vdp/device_output';
import { VDP } from '../../src/bmsx/machine/devices/vdp/vdp';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { DeviceScheduler } from '../../src/bmsx/machine/scheduler/device';
import { DEFAULT_TEXTURE_PARAMS } from '../../src/bmsx/render/backend/texture_params';
import { HeadlessGPUBackend } from '../../src/bmsx/render/headless/backend';
import { TextureManager } from '../../src/bmsx/render/texture_manager';
import { VdpFrameBufferTextures } from '../../src/bmsx/render/vdp/framebuffer';
import { drainReadyVdpFrameBufferExecutionForSoftware } from '../../src/bmsx/render/backend/software/vdp_framebuffer_execution';

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

function submitClearFrame(memory: Memory, vdp: VDP, backend: HeadlessGPUBackend): void {
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BEGIN_FRAME);
	memory.writeValue(IO_VDP_REG_BG_COLOR, 0xff112233);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_CLEAR);
	memory.writeValue(IO_VDP_CMD, VDP_CMD_END_FRAME);
	const workUnits = vdp.getPendingRenderWorkUnits();
	assert.ok(workUnits > 0);
	vdp.advanceWork(workUnits);
	drainReadyVdpFrameBufferExecutionForSoftware(backend, vdp);
	assert.equal(vdp.presentReadyFrameOnVblankEdge(), true);
}

function drainPresentationProbe(vdp: VDP): { consumed: boolean; count: number } {
	const result = {
		consumed: false,
		count: 0,
	};
	const sink: VdpFrameBufferPresentationSink = {
		consumeVdpFrameBufferPresentation(presentation: VdpFrameBufferPresentation): void {
			result.consumed = true;
			result.count = presentation.presentationCount;
		},
	};
	vdp.drainFrameBufferPresentation(sink);
	return result;
}

test('VDP framebuffer texture syncs from presented device page', () => {
	const { memory, vdp } = createVdp();
	const backend = new HeadlessGPUBackend();
	const textureManager = new TextureManager(backend);
	const frameBufferTextures = new VdpFrameBufferTextures(textureManager, { backend, textures: {} } as any);
	frameBufferTextures.initialize(vdp);

	submitClearFrame(memory, vdp, backend);
	vdp.drainFrameBufferPresentation(frameBufferTextures);
	assert.equal(drainPresentationProbe(vdp).consumed, false);

	const pixel = new Uint8Array(4);
	backend.readTextureRegion(frameBufferTextures.displayTexture(), pixel, 1, 1, 0, 0, DEFAULT_TEXTURE_PARAMS);
	assert.deepEqual(Array.from(pixel), [0x11, 0x22, 0x33, 0xff]);
});

test('VDP framebuffer context sync consumes pending presentation through the device transaction', () => {
	const { memory, vdp } = createVdp();
	const backend = new HeadlessGPUBackend();
	submitClearFrame(memory, vdp, backend);
	const textureManager = new TextureManager(backend);
	const frameBufferTextures = new VdpFrameBufferTextures(textureManager, { backend, textures: {} } as any);
	frameBufferTextures.initialize(vdp);
	assert.equal(drainPresentationProbe(vdp).consumed, false);

	const pixel = new Uint8Array(4);
	backend.readTextureRegion(frameBufferTextures.displayTexture(), pixel, 1, 1, 0, 0, DEFAULT_TEXTURE_PARAMS);
	assert.deepEqual(Array.from(pixel), [0x11, 0x22, 0x33, 0xff]);
});

test('VDP save-state restore drops runtime-only framebuffer presentation work', () => {
	const { memory, vdp } = createVdp();
	const backend = new HeadlessGPUBackend();
	const saved = vdp.captureSaveState();

	submitClearFrame(memory, vdp, backend);

	vdp.restoreSaveState(saved);
	assert.equal(drainPresentationProbe(vdp).consumed, false);
});
