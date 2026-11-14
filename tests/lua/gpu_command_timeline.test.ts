import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as io from '../../machine/ts/spec/bmsx/io';
import * as map from '../../machine/ts/spec/bmsx/memory_map';
import * as gp0 from '../../machine/ts/spec/gx/gp0';
import * as gp1 from '../../machine/ts/spec/gx/gp1';
import * as pcrtc from '../../machine/ts/spec/gx/pcrtc';
import { PSX_MACHINE_SPEC as spec } from '../../machine/ts/spec/bmsx/model';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { GxGpu } from '../../machine/ts/machine/devices/gx/gpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { DEVICE_SERVICE_DMA, DEVICE_SERVICE_GPU, DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { cartridgeSlots } from '../helpers/cartridge';

function fixture() {
	const memory = new Memory({ systemRom: new Uint8Array(8), cartridgeSlots: cartridgeSlots(new Uint8Array(8)) }, spec.ramBytes);
	const irq = new IrqController(memory), cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory));
	const scheduler = new DeviceScheduler(cpu), dma = new DmaController(memory, cpu, irq, scheduler);
	const gpu = new GxGpu(memory, cpu, irq, scheduler, dma, spec.gxGpuVramBytes);
	memory.cartridgeController.connect(memory, irq, dma);
	dma.reset(); memory.cartridgeController.reset(); gpu.reset(); irq.reset();
	dma.setTiming(1, 40, 1, 1, 0, 0);
	const mode = pcrtc.gxGpuPcrtcRegisterAddress(pcrtc.GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(mode, memory.readMappedU32LE(mode) | pcrtc.GX_GPU_PCRTC_SMODE1_SINT);
	gpu.onService(0);
	return { memory, irq, cpu, scheduler, dma, gpu };
}
type Fixture = ReturnType<typeof fixture>;
function enqueue(h: Fixture, fills: number, irq = true): void {
	for (let i = 0; i < fills; ++i) for (const word of [0x020000ff, 0, 0x00010001]) h.gpu.writeGp0(word);
	if (irq) h.gpu.writeGp0(0x1f000000);
}
function step(h: Fixture): void {
	const cycle = h.scheduler.nextDeadline();
	assert.notEqual(cycle, Number.MAX_SAFE_INTEGER, 'a required device event is scheduled');
	h.scheduler.advanceTo(cycle);
	while (h.scheduler.hasDueTimer()) {
		const kind = h.scheduler.popDueTimer();
		if (kind === DEVICE_SERVICE_GPU) h.gpu.onService(cycle);
		else if (kind === DEVICE_SERVICE_DMA) h.dma.onService(cycle);
		else assert.fail(`unexpected device service ${kind}`);
	}
}

test('queued fills require one GPU service at the exact IRQ start, not an event per fill', () => {
	const h = fixture(); enqueue(h, 4);
	assert.equal(h.gpu.captureState().gp0FifoWords.length, 10, 'first fill is active, remaining ten words own FIFO credits');
	assert.equal(h.scheduler.nextDeadline(), 116);
	h.scheduler.advanceTo(115);
	assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, 0);
	step(h);
	assert.equal(h.scheduler.nowCycles, 116);
	assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, io.IRQ_GPU);
});

test('the FIFO keeps its credits and a blocked CPU request wakes at the first real release', () => {
	const h = fixture(); enqueue(h, 6);
	assert.equal(h.gpu.captureState().gp0FifoWords.length, 16);
	assert.equal(h.memory.mappedWriteReady(io.IO_GX_GPU_GP0), false, 'prepared packets do not free hardware FIFO slots');
	assert.equal(h.scheduler.nextDeadline(), 29, 'a real writer needs the earlier FIFO release');
	h.scheduler.advanceTo(28);
	assert.equal(h.memory.mappedWriteReady(io.IO_GX_GPU_GP0), false);
	step(h);
	assert.equal(h.scheduler.nowCycles, 29);
	assert.equal(h.memory.mappedWriteReady(io.IO_GX_GPU_GP0), true);
	assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, 0);
});

test('a GP1 query/ack before the marker does not execute the IRQ ahead of time', () => {
	const h = fixture(); enqueue(h, 4);
	h.scheduler.advanceTo(10);
	h.gpu.readStatus();
	h.gpu.writeGp1((gp1.GX_GPU_GP1_GET_GPU_INFO << 24) | 7);
	h.gpu.writeGp1(gp1.GX_GPU_GP1_ACK_INTERRUPT << 24);
	assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, 0);
	assert.equal(h.scheduler.nextDeadline(), 116);
	step(h);
	assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, io.IRQ_GPU);
});

test('GP1 FIFO reset discards a prepared future IRQ without publishing it', () => {
	const h = fixture(); enqueue(h, 4);
	h.scheduler.advanceTo(10);
	h.gpu.writeGp1(gp1.GX_GPU_GP1_CLEAR_FIFO << 24);
	assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, 0);
	assert.equal(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
});

test('save/restore at mid-command preserves the raw queue and the future IRQ edge', () => {
	const h = fixture(); enqueue(h, 4);
	h.scheduler.advanceTo(10);
	const gpuState = h.gpu.captureState(), dmaState = h.dma.captureState();
	const restored = fixture(); restored.scheduler.advanceTo(10);
	restored.dma.restoreState(dmaState, 10); restored.gpu.restoreState(gpuState);
	restored.dma.postLoad(); restored.gpu.dependencyStateChanged();
	assert.deepEqual(restored.gpu.captureState().gp0FifoWords, gpuState.gp0FifoWords);
	assert.equal(restored.scheduler.nextDeadline(), 116);
	step(restored);
	assert.equal(restored.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, io.IRQ_GPU);
});

test('a DMA tail blocked on full GP0 ingress gets its earliest real progress edge', () => {
	const h = fixture();
	h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	for (const word of [0x020000ff, 0, 0x00640001]) h.gpu.writeGp0(word);
	const source = map.DYNAMIC_RAM_BASE + 0x1000, count = gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1;
	for (let i = 0; i < count; ++i) h.memory.writeU32(source + 4 * i, 0xe1000000);
	h.memory.writeMappedU32LE(io.IO_DMA0_READ_ADDR, source);
	h.memory.writeMappedU32LE(io.IO_DMA0_TRANSFER_COUNT, count);
	h.memory.writeMappedU32LE(io.IO_DMA0_CONTROL, io.DMA_ROUTE_TO_GPU);
	h.memory.writeMappedU32LE(io.IO_DMA0_TRIGGER, io.DMA_TRIGGER_START);
	step(h);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_BUSY);
	assert.equal(h.dma.cpuBusHeld(), false, 'the next block waits for GP0 ingress capacity');
	assert.equal(h.scheduler.nextDeadline(), 573, 'the occupied GPU must begin draining before the next DMA burst');
	for (let i = 0; i < 300 && h.memory.readIoU32(io.IO_DMA0_STATUS) === io.DMA_STATUS_BUSY; ++i) step(h);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT), 0);
});

test('queued C0 readback becomes pending at its own edge without earlier fill services', () => {
	const h = fixture(); enqueue(h, 4, false);
	for (const word of [0xc0000000, 0, 0x00010001]) h.gpu.writeGp0(word);
	assert.equal(h.gpu.captureState().commandBuffer.readbackPhase, 0);
	assert.equal(h.scheduler.nextDeadline(), 117);
	h.scheduler.advanceTo(116);
	assert.equal(h.gpu.captureState().commandBuffer.readbackPhase, 0);
	step(h);
	assert.equal(h.scheduler.nowCycles, 117);
	assert.equal(h.gpu.captureState().commandBuffer.readbackPhase, 1);
});

test('an IRQ deep in a completed DMA ingress block does not require a service per fill', () => {
	const h = fixture();
	h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	const source = map.DYNAMIC_RAM_BASE + 0x1000, fills = 84, count = fills * 3 + 1;
	for (let i = 0; i < fills; ++i) {
		for (const [j, word] of [0x020000ff, 0, 0x00010001].entries()) h.memory.writeU32(source + 4 * (3 * i + j), word);
	}
	h.memory.writeU32(source + 4 * (count - 1), 0x1f000000);
	h.memory.writeMappedU32LE(io.IO_DMA0_READ_ADDR, source);
	h.memory.writeMappedU32LE(io.IO_DMA0_TRANSFER_COUNT, count);
	h.memory.writeMappedU32LE(io.IO_DMA0_CONTROL, io.DMA_ROUTE_TO_GPU);
	h.memory.writeMappedU32LE(io.IO_DMA0_TRIGGER, io.DMA_TRIGGER_START);
	step(h);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
	const irqCycle = h.scheduler.nowCycles + fills * 29;
	let gpuEvents = 0;
	while ((h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU) === 0 && gpuEvents < fills) {
		step(h); ++gpuEvents;
	}
	assert.equal(h.scheduler.nowCycles, irqCycle);
	assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, io.IRQ_GPU);
	assert.ok(gpuEvents < fills, 'bounded prepared horizon batches at least some fills');
});
