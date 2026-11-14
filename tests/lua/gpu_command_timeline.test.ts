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
const gouraudTexturedQuad = [
	0x3c0000ff, 0, 0, 0x0000ff00, 8, 0x01000008,
	0x00ff0000, 0x00080000, 0x00080000, 0x00ffffff, 0x00080008, 0x00080008,
];
function submitDmaCommands(h: Fixture, words: readonly number[]): void {
	h.gpu.writeGp0((gp0.GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT << 24) | (255 << 10) | 255);
	h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	const source = map.DYNAMIC_RAM_BASE + 0x1000;
	for (let i = 0; i < words.length; ++i) h.memory.writeU32(source + 4 * i, words[i]);
	h.memory.writeMappedU32LE(io.IO_DMA0_READ_ADDR, source);
	h.memory.writeMappedU32LE(io.IO_DMA0_TRANSFER_COUNT, words.length);
	h.memory.writeMappedU32LE(io.IO_DMA0_CONTROL, io.DMA_ROUTE_TO_GPU);
	h.memory.writeMappedU32LE(io.IO_DMA0_TRIGGER, io.DMA_TRIGGER_START);
	for (let i = 0; i < 8 && h.memory.readIoU32(io.IO_DMA0_STATUS) !== io.DMA_STATUS_DONE; ++i) step(h);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE, 'the entire command burst is accepted before GPU-only services');
}
function runToIrq(h: Fixture): number {
	let services = 0;
	for (let i = 0; i < 128 && (h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU) === 0; ++i) services += step(h);
	assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, io.IRQ_GPU, 'the bounded command stream reaches its IRQ');
	return services;
}
function enqueue(h: Fixture, fills: number, irq = true): void {
	for (let i = 0; i < fills; ++i) for (const word of [0x020000ff, 0, 0x00010001]) h.gpu.writeGp0(word);
	if (irq) h.gpu.writeGp0(0x1f000000);
}
function step(h: Fixture): number {
	const cycle = h.scheduler.nextDeadline();
	assert.notEqual(cycle, Number.MAX_SAFE_INTEGER, 'a required device event is scheduled');
	h.scheduler.advanceTo(cycle);
	let gpuServices = 0;
	while (h.scheduler.hasDueTimer()) {
		const kind = h.scheduler.popDueTimer();
		if (kind === DEVICE_SERVICE_GPU) { h.gpu.onService(cycle); ++gpuServices; }
		else if (kind === DEVICE_SERVICE_DMA) h.dma.onService(cycle);
		else assert.fail(`unexpected device service ${kind}`);
	}
	return gpuServices;
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

test('sixteen prepared packet records cover long packets across FIFO and accepted DMA ingress', () => {
	const h = fixture(), words = Array.from({ length: 20 }, () => gouraudTexturedQuad).flat();
	words.push(0x1f000000);
	submitDmaCommands(h, words);
	const queued = h.gpu.captureState();
	assert.equal(queued.gp0FifoWords.length, 16, 'preparation retains all physical FIFO credits');
	assert.equal(queued.gp0DmaIngressWords.length, 213, 'accepted words remain in the DMA ingress until real FIFO progress');
	const services = runToIrq(h);
	assert.equal(h.scheduler.nowCycles, 7122);
	assert.ok(services <= 2, `twenty twelve-word packets need at most two GPU services, observed ${services}`);
	assert.deepEqual(h.gpu.captureState().commandBuffer.words, words.slice(0, -1));
});

test('lookahead skips header NOPs without stripping NOP-like packet parameters', () => {
	const h = fixture(), words: number[] = [];
	const nops = [0, 0x04001234, 0xe700ffff];
	for (let i = 0; i < 18; ++i) words.push(nops[i % nops.length], ...gouraudTexturedQuad);
	words.push(0x1f000000);
	submitDmaCommands(h, words);
	const dmaDoneCycle = h.scheduler.nowCycles;
	runToIrq(h);
	assert.equal(h.scheduler.nowCycles, dmaDoneCycle + 18 * 330);
	assert.deepEqual(h.gpu.captureState().commandBuffer.words, Array.from({ length: 18 }, () => gouraudTexturedQuad).flat());
});

test('FIFO reset discards a prepared prefix extending into DMA ingress', () => {
	const h = fixture(), words = Array.from({ length: 20 }, () => gouraudTexturedQuad).flat();
	words.push(0x1f000000);
	submitDmaCommands(h, words);
	h.scheduler.advanceTo(h.scheduler.nowCycles + 10);
	h.gpu.writeGp1(gp1.GX_GPU_GP1_CLEAR_FIFO << 24);
	const cleared = h.gpu.captureState();
	assert.deepEqual(cleared.gp0FifoWords, []);
	assert.deepEqual(cleared.gp0DmaIngressWords, []);
	assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, 0);
	assert.equal(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	const resetCycle = h.scheduler.nowCycles;
	enqueue(h, 1);
	runToIrq(h);
	assert.equal(h.scheduler.nowCycles, resetCycle + cleared.pendingCommandCycles + 29, 'new work cannot consume stale prepared packet records');
});

test('mid-command restore rebuilds packet lookahead from unchanged FIFO and DMA ingress words', () => {
	const h = fixture(), words = Array.from({ length: 20 }, () => gouraudTexturedQuad).flat();
	words.push(0x1f000000);
	submitDmaCommands(h, words);
	h.scheduler.advanceTo(h.scheduler.nowCycles + 10);
	const cycle = h.scheduler.nowCycles, gpuState = h.gpu.captureState(), dmaState = h.dma.captureState();
	assert.equal(gpuState.gp0FifoWords.length, 16);
	assert.equal(gpuState.gp0DmaIngressWords.length, 213);
	const restored = fixture(); restored.scheduler.advanceTo(cycle);
	restored.dma.restoreState(dmaState, cycle); restored.gpu.restoreState(gpuState);
	restored.dma.postLoad(); restored.gpu.dependencyStateChanged();
	const restoredState = restored.gpu.captureState();
	assert.deepEqual(restoredState.gp0FifoWords, gpuState.gp0FifoWords);
	assert.deepEqual(restoredState.gp0DmaIngressWords, gpuState.gp0DmaIngressWords);
	const restoredServices = runToIrq(restored);
	runToIrq(h);
	assert.equal(restored.scheduler.nowCycles, 7122);
	assert.equal(h.scheduler.nowCycles, 7122);
	assert.ok(restoredServices <= 2, `restored ingress lookahead needs at most two GPU services, observed ${restoredServices}`);
	assert.deepEqual(restored.gpu.captureState().commandBuffer, h.gpu.captureState().commandBuffer);
});

test('zero-tick clipped packets refill the physical FIFO before consuming cached ingress packets', () => {
	const h = fixture(), reference = fixture(), words = [0x020000ff, 0, 0x00010001];
	for (let i = 0; i < 48; ++i) words.push(0x400000ff, 0x012c012c, 0x012d012d);
	words.push(...gouraudTexturedQuad, 0x1f000000);
	reference.gpu.setOperationObserver({ emitted() {} });
	submitDmaCommands(h, words); submitDmaCommands(reference, words);
	const dmaDoneCycle = h.scheduler.nowCycles;
	assert.equal(reference.scheduler.nowCycles, dmaDoneCycle);
	runToIrq(h); runToIrq(reference);
	assert.equal(h.scheduler.nowCycles, dmaDoneCycle + 29 + 330, 'all clipped finite lines take zero command ticks');
	assert.equal(reference.scheduler.nowCycles, h.scheduler.nowCycles);
	assert.deepEqual(h.gpu.captureState().commandBuffer, reference.gpu.captureState().commandBuffer);
	assert.deepEqual(h.gpu.captureState().commandBuffer.words, words.slice(0, -1));
});
