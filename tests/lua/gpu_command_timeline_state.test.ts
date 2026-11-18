import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLE16 } from '../../machine/ts/common/endian';

import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { GX_GPU_SERVICE_RUNTIME_EDGE_MASK, GxGpu } from '../../machine/ts/machine/devices/gx/gpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { DEVICE_SERVICE_GPU, DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { IO_GX_GPU_GP0, IO_IRQ_FLAGS, IRQ_GPU } from '../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN } from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import * as gp1 from '../../machine/ts/spec/gx/gp1';
import * as pcrtc from '../../machine/ts/spec/gx/pcrtc';
import { cartridgeSlots } from '../helpers/cartridge';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';

// An operation observer requires each actual start to be serviced. It gives
// the same GPU an instruction-by-instruction timeline without a second model
// of command costs or register latching in the test.
function fixture(observed: boolean) {
	const spec = PSX_MACHINE_SPEC;
	const memory = new Memory({ systemRom: new Uint8Array(8), cartridgeSlots: cartridgeSlots() }, spec.ramBytes);
	const irq = new IrqController(memory);
	const cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory));
	const scheduler = new DeviceScheduler(cpu);
	const dma = new DmaController(memory, cpu, irq, scheduler);
	const gpu = new GxGpu(memory, cpu, irq, scheduler, dma, spec.gxGpuVramBytes);
	memory.cartridgeController.connect(memory, irq, dma);
	dma.reset(); memory.cartridgeController.reset(); gpu.reset(); irq.reset();
	const mode = pcrtc.gxGpuPcrtcRegisterAddress(pcrtc.GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(mode, memory.readMappedU32LE(mode) | pcrtc.GX_GPU_PCRTC_SMODE1_SINT);
	gpu.onService(0);
	const state = gpu.captureState();
	state.drawingAreaBottomRightWord = (1023 << 10) | 1023;
	gpu.restoreState(state);
	if (observed) gpu.setOperationObserver({ emitted() {} });
	return { memory, gpu, scheduler };
}

type Fixture = ReturnType<typeof fixture>;

function advance(target: Fixture, cycle: number): void {
	while (target.scheduler.nextDeadline() <= cycle) {
		const deadline = target.scheduler.nextDeadline();
		target.scheduler.advanceTo(deadline);
		while (target.scheduler.hasDueTimer()) {
			assert.equal(target.scheduler.popDueTimer(), DEVICE_SERVICE_GPU);
			const edge = target.gpu.onService(deadline) & GX_GPU_SERVICE_RUNTIME_EDGE_MASK;
			if (edge === GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN) target.gpu.presentReadyFrameOnVblankEdge();
		}
	}
	target.scheduler.advanceTo(cycle);
}

function sameState(lazy: Fixture, observed: Fixture): void {
	assert.deepEqual(lazy.gpu.captureState(), observed.gpu.captureState());
	assert.equal(lazy.memory.readIoU32(IO_IRQ_FLAGS), observed.memory.readIoU32(IO_IRQ_FLAGS));
}

test('future GPU packet timing follows a GP1 Y-gate change without reinterpreting the running fill', () => {
	const lazy = fixture(false), observed = fixture(true);
	for (const target of [lazy, observed]) {
		// The row-512 rectangle is clipped in the nine-bit Y mode and visible
		// in the ten-bit mode. Its cost changes from 8 to 12 CPU cycles.
		for (const word of [
			0x020000ff, 0, 0x00010001,
			0x600000ff, 512 << 16, 0x00020004,
			0x0200ff00, 0, 0x00010001,
			0x1f000000,
		]) target.memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
		advance(target, 10);
		target.gpu.writeGp1((gp1.GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24) | 1);
		assert.equal(target.gpu.captureState().commandBuffer.commandVramYAddressExtensionWord[0], 0,
			'the already running fill keeps its latched address gate');
	}
	sameState(lazy, observed);
	for (const cycle of [28, 29, 30, 40, 41, 66, 69, 70, 71]) {
		advance(lazy, cycle); advance(observed, cycle);
		sameState(lazy, observed);
		assert.equal(lazy.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU, cycle >= 70 ? IRQ_GPU : 0);
	}
	assert.deepEqual(lazy.gpu.captureState().commandBuffer.commandVramYAddressExtensionWord, [0, 1, 1]);
});

test('prepared GP0 draw controls remain unpublished until their own starts', () => {
	const lazy = fixture(false), observed = fixture(true);
	for (const target of [lazy, observed]) {
		for (const word of [
			0x020000ff, 0, 0x00010001,
			0xe1000100,
			0xe5000001,
			0x640000ff, 0, 0, 0x00020004,
			0xe6000003,
			0x1f000000,
		]) target.memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
	}
	for (const cycle of [0, 10, 28, 29, 30, 31, 32, 40, 100]) {
		advance(lazy, cycle); advance(observed, cycle);
		sameState(lazy, observed);
		const state = lazy.gpu.captureState();
		assert.equal(state.drawModeWord, cycle >= 29 ? 0x100 : 0);
		assert.equal(state.drawingOffsetWord, cycle >= 30 ? 1 : 0);
	}
});

test('future packet state follows GP1 display-start and display-mode changes', () => {
	const lazy = fixture(false), observed = fixture(true);
	for (const target of [lazy, observed]) {
		target.gpu.writeGp1((gp1.GX_GPU_GP1_DISPLAY_MODE << 24) | 0x24);
		for (const word of [0x020000ff, 0, 0x00010001, 0x600000ff, 0, 0x00050004, 0x1f000000]) {
			target.memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
		}
		advance(target, 10);
		target.gpu.writeGp1((gp1.GX_GPU_GP1_DISPLAY_START << 24) | (1 << 10));
		advance(target, 20);
		target.gpu.writeGp1(gp1.GX_GPU_GP1_DISPLAY_MODE << 24);
	}
	for (const cycle of [20, 28, 29, 40, 41, 46, 47, 48]) {
		advance(lazy, cycle); advance(observed, cycle);
		sameState(lazy, observed);
		assert.equal(lazy.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU, cycle >= 47 ? IRQ_GPU : 0);
	}
	assert.deepEqual(lazy.gpu.captureState().commandBuffer.commandSkippedLineParity, [0, 2]);
});

test('a real PCRTC field edge updates future packet latches but not the running command', () => {
	const lazy = fixture(false), observed = fixture(true);
	for (const target of [lazy, observed]) {
		target.gpu.setTiming(1_000_000, 0);
		const mode = pcrtc.gxGpuPcrtcRegisterAddress(pcrtc.GX_GPU_PCRTC_SMODE1_LOW);
		target.memory.writeMappedU32LE(mode, target.memory.readMappedU32LE(mode) & ~pcrtc.GX_GPU_PCRTC_SMODE1_SINT);
		target.memory.writeMappedU32LE(pcrtc.gxGpuPcrtcRegisterAddress(pcrtc.GX_GPU_PCRTC_SMODE2_LOW), pcrtc.GX_GPU_PCRTC_SMODE2_INT);
		const syncv = pcrtc.gxGpuPcrtcRegisterAddress(pcrtc.GX_GPU_PCRTC_SYNCV_LOW);
		target.memory.writeMappedU32LE(syncv, (target.memory.readMappedU32LE(syncv) & ~0x3ff) | 5);
		target.gpu.onService(0);
		target.gpu.writeGp1((gp1.GX_GPU_GP1_DISPLAY_MODE << 24) | 0x24);
		for (const word of [0x020000ff, 0, 0x01ff03ff, 0x600000ff, 0, 0x00050004, 0x1f000000]) {
			target.memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
		}
	}
	for (const cycle of [10_000, 20_000, 35_026, 35_027, 35_038, 35_039, 40_000]) {
		advance(lazy, cycle); advance(observed, cycle);
		sameState(lazy, observed);
	}
	const parities = observed.gpu.captureState().commandBuffer.commandSkippedLineParity;
	assert.notEqual(parities[0], parities[1], 'the queued rectangle starts in the next display field');
	assert.equal(lazy.memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GPU, IRQ_GPU);
});

for (const action of [pcrtc.GX_GPU_PCRTC_CSR_FLUSH, pcrtc.GX_GPU_PCRTC_CSR_RESET]) {
	test(`PCRTC CSR action ${action} catches up elapsed drawing before discarding future input`, () => {
		for (const cycle of [28, 29, 30, 40, 59, 70]) {
			const lazy = fixture(false), observed = fixture(true);
			const initialPixel = readLE16(lazy.gpu.readVramSnapshotBytes(), 0);
			for (const target of [lazy, observed]) {
				for (const word of [0x020000ff, 0, 0x00010001, 0xe1000123, 0x0200ff00, 0, 0x00010001]) {
					target.memory.writeMappedU32LE(IO_GX_GPU_GP0, word);
				}
			}
			assert.equal(lazy.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'the lazy queue has no required service to skip');
			for (const target of [lazy, observed]) {
				advance(target, cycle);
				target.memory.writeMappedU32LE(pcrtc.gxGpuPcrtcRegisterAddress(pcrtc.GX_GPU_PCRTC_CSR_LOW), action);
			}
			sameState(lazy, observed);
			const state = lazy.gpu.captureState();
			assert.equal(state.commandBuffer.commandCount, cycle >= 30 ? 2 : 1, 'an already started successor survives the clear');
			assert.equal(state.commandBuffer.executedCommandCount, cycle >= 59 ? 2 : cycle >= 29 ? 1 : 0);
			assert.equal(state.pendingCommandCycles, cycle < 29 ? 29 - cycle : cycle < 30 ? 30 - cycle : cycle < 59 ? 59 - cycle : 0);
			assert.equal(state.drawModeWord, action === pcrtc.GX_GPU_PCRTC_CSR_FLUSH && cycle >= 29 ? 0x123 : 0);
			assert.deepEqual(state.gp0FifoWords, []);
			const backend = new HeadlessGPUBackend(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes);
			backend.executeGxGpuCommandDrain(lazy.gpu);
			assert.equal(backend.gxGpuSoftware.vram[0], cycle >= 59 ? 0x03e0 : cycle >= 29 ? 0x001f : initialPixel, 'a drain renders only the completed prefix');
			advance(lazy, 70);
			backend.executeGxGpuCommandDrain(lazy.gpu);
			assert.equal(backend.gxGpuSoftware.vram[0], cycle >= 30 ? 0x03e0 : 0x001f, 'retained finite drawing still reaches VRAM');
		}
	});
}
