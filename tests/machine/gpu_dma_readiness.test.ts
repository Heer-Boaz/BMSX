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
import { DmaEndpoint } from '../../machine/ts/machine/devices/dma/endpoints';
import { GxGpu } from '../../machine/ts/machine/devices/gx/gpu';
import { GX_GPU_READBACK_PENDING } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { DEVICE_SERVICE_DMA, DEVICE_SERVICE_GPU, DEVICE_SERVICE_SYSTEM, DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { cartridgeSlots } from '../helpers/cartridge';

function fixture() {
	const memory = new Memory({ systemRom: new Uint8Array(8), cartridgeSlots: cartridgeSlots(new Uint8Array(8)) }, spec.ramBytes);
	const irq = new IrqController(memory), execution = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, irq, execution), scheduler = new DeviceScheduler(cpu);
	// The upload source (+0x1000) and competing copy destination (+0x4000) are static RAM.
	assert.equal(cpu.heapAllocator.setFloor(map.DYNAMIC_RAM_BASE + 0x5000), true);
	const dma = new DmaController(memory, cpu, irq, scheduler), gpu = new GxGpu(memory, cpu, irq, scheduler, dma, spec.gxGpuVramBytes);
	memory.cartridgeController.connect(memory, irq, dma);
	dma.reset(); memory.cartridgeController.reset(); gpu.reset(); irq.reset();
	dma.setTiming(1, 40, 1, 1, 0, 0);
	const mode = pcrtc.gxGpuPcrtcRegisterAddress(pcrtc.GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(mode, memory.readMappedU32LE(mode) | pcrtc.GX_GPU_PCRTC_SMODE1_SINT);
	gpu.onService(0);
	gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	return { memory, irq, cpu, scheduler, dma, gpu };
}
type Fixture = ReturnType<typeof fixture>;
const source = map.DYNAMIC_RAM_BASE + 0x1000;
function start(h: Fixture, route: number, count: number) {
	h.memory.writeMappedU32LE(io.IO_DMA0_READ_ADDR, source);
	h.memory.writeMappedU32LE(io.IO_DMA0_TRANSFER_COUNT, count);
	h.memory.writeMappedU32LE(io.IO_DMA0_CONTROL, route);
	h.memory.writeMappedU32LE(io.IO_DMA0_TRIGGER, io.DMA_TRIGGER_START);
}
function step(h: Fixture) {
	const time = h.scheduler.nextDeadline();
	assert.notEqual(time, Number.MAX_SAFE_INTEGER, 'a blocked DMA has a wakeup');
	h.scheduler.advanceTo(time);
	while (h.scheduler.hasDueTimer()) {
		const kind = h.scheduler.popDueTimer();
		if (kind === DEVICE_SERVICE_DMA) h.dma.onService(time);
		else if (kind === DEVICE_SERVICE_GPU) h.gpu.onService(time);
		else assert.fail(`unexpected service ${kind}`);
	}
}
function fill(h: Fixture, size: number) {
	for (const word of [0x020000ff, 0, size]) h.gpu.writeGp0(word);
}

test('an admitted GP0 burst needs no earlier unobservable draw-completion event', () => {
	const h = fixture(); fill(h, 0x00010001);
	assert.equal(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'unobserved draw is lazy before DMA');
	for (let i = 0; i < 4; ++i) h.memory.writeU32(source + 4 * i, 0xe1000000);
	h.scheduler.advanceTo(10); start(h, io.DMA_ROUTE_TO_GPU, 4);
	const d = h.scheduler.nowCycles + h.dma.captureState().scheduledBlockCycles;
	assert.ok(h.dma.cpuBusHeld());
	assert.ok(d > 29, 'the admitted burst completes after the draw');
	assert.equal(h.scheduler.nextDeadline(), d, 'GPU need not run at cycle 29 while DMA owns the admitted burst');
	step(h);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
	assert.equal(h.gpu.captureState().commandBuffer.executedCommandCount, 1, 'GP0 transfer catches the earlier draw up');
});

test('a queued GPU IRQ keeps its own deadline during an admitted GP0 DMA block', () => {
	const h = fixture(); fill(h, 0x00010001);
	h.gpu.writeGp0(0x1f000000);
	for (let i = 0; i < 4; ++i) h.memory.writeU32(source + 4 * i, 0xe1000000);
	h.scheduler.advanceTo(10); start(h, io.DMA_ROUTE_TO_GPU, 4);
	const d = h.scheduler.nowCycles + h.dma.captureState().scheduledBlockCycles;
	assert.ok(d > 29);
	assert.equal(h.scheduler.nextDeadline(), 29, 'queued IRQ is independently observable');
	step(h);
	assert.equal(h.memory.readIoU32(io.IO_IRQ_FLAGS) & io.IRQ_GPU, io.IRQ_GPU);
	assert.equal(h.dma.cpuBusHeld(), true, 'IRQ is published before the DMA block completes');
	step(h);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
});

test('DMA waiting for saturated GP0 ingress wakes when draw completion frees capacity', () => {
	const h = fixture(); fill(h, 0x00640001);
	const count = gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1;
	for (let i = 0; i < count; ++i) h.memory.writeU32(source + 4 * i, 0xe1000000);
	start(h, io.DMA_ROUTE_TO_GPU, count);
	step(h);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_BUSY);
	assert.equal(h.dma.cpuBusHeld(), false, 'the next block waits for ingress capacity');
	for (let i = 0; i < 300 && h.memory.readIoU32(io.IO_DMA0_STATUS) === io.DMA_STATUS_BUSY; ++i) step(h);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT), 0);
});

test('IMGDEC source becoming ready after GPU capacity was freed does not strand its DMA tail', () => {
	const h = fixture(); fill(h, 0x00640001);
	let reads = 0;
	h.memory.mapIoRead(io.IO_IMGDEC_DATA, h, () => {
		++reads;
		if (reads === 1) h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, 0);
		return 0xe1000000;
	});
	h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY);
	start(h, io.DMA_ROUTE_IMGDEC_TO_GPU, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1);
	step(h);
	assert.equal(reads, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY);
	assert.equal(h.dma.cpuBusHeld(), false);
	assert.ok(h.gpu.captureState().gp0DmaIngressWords.length > 0, 'GPU has queued ingress while IMGDEC source is not ready');
	const observation = h.scheduler.nowCycles + 1000;
	assert.ok(h.scheduler.nextDeadline() > observation, 'GPU work is lazy while the IMGDEC source is not ready');
	h.scheduler.advanceTo(observation);
	// No GPU register poll: the source's DREQ edge must see current destination capacity.
	h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, 1);
	assert.equal(h.dma.cpuBusHeld(), true, 'source-ready edge must admit the remaining word');
	step(h);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
	assert.equal(reads, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1);
});

// One channel waits for IMGDEC while a separate RAM-copy block owns DMA.
// The source edge occurs during that block, so its completion must re-check
// the GPU endpoint without requiring a CPU GP0 read or write.
test('source DREQ during a different admitted DMA block is observed when the engine is released', () => {
	const h = fixture(); fill(h, 0x00640001);
	let reads = 0;
	h.memory.mapIoRead(io.IO_IMGDEC_DATA, h, () => {
		++reads;
		if (reads === 1) h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, 0);
		return 0xe1000000;
	});
	h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY);
	start(h, io.DMA_ROUTE_IMGDEC_TO_GPU, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1);
	step(h);
	assert.equal(reads, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY);
	assert.equal(h.dma.cpuBusHeld(), false);
	assert.ok(h.gpu.captureState().gp0DmaIngressWords.length > 0);
	const copyTarget = map.DYNAMIC_RAM_BASE + 0x4000;
	h.memory.writeMappedU32LE(io.IO_DMA1_READ_ADDR, source);
	h.memory.writeMappedU32LE(io.IO_DMA1_WRITE_ADDR, copyTarget);
	h.memory.writeMappedU32LE(io.IO_DMA1_TRANSFER_COUNT, 256);
	h.memory.writeMappedU32LE(io.IO_DMA1_CONTROL, io.DMA_ROUTE_COPY);
	h.memory.writeMappedU32LE(io.IO_DMA1_TRIGGER, io.DMA_TRIGGER_START);
	assert.equal(h.dma.cpuBusHeld(), true, 'channel 1 owns the engine');
	const completion = h.scheduler.nowCycles + h.dma.captureState().scheduledBlockCycles;
	const edge = h.scheduler.nowCycles + 500;
	assert.ok(edge < completion);
	assert.equal(h.scheduler.nextDeadline(), completion, 'no GPU event while the unrelated DMA block owns the engine');
	h.scheduler.advanceTo(edge);
	h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, 1);
	assert.equal(h.scheduler.nextDeadline(), completion, 'source edge must not demand GPU service before DMA release');
	assert.equal(h.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT), 1, 'channel 0 cannot execute before channel 1 releases the engine');
	assert.equal(h.memory.readIoU32(io.IO_DMA1_STATUS), io.DMA_STATUS_BUSY);
	for (let i = 0; i < 300 && h.memory.readIoU32(io.IO_DMA0_STATUS) === io.DMA_STATUS_BUSY; ++i) step(h);
	assert.equal(h.memory.readIoU32(io.IO_DMA1_STATUS), io.DMA_STATUS_DONE);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE, 'channel 0 resumes after the other block');
	assert.equal(reads, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1);
});

test('new write demand catches GPU up even when a read channel was already waiting', () => {
	for (const pairedRequest of [false, true]) {
		const h = fixture(); fill(h, 0x00640001);
		let reads = 0;
		h.memory.mapIoRead(io.IO_IMGDEC_DATA, h, () => {
			if (++reads === 1) h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, 0);
			return 0xe1000000;
		});
		h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY);
		start(h, io.DMA_ROUTE_IMGDEC_TO_GPU, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1); step(h);
		h.memory.writeMappedU32LE(io.IO_DMA1_WRITE_ADDR, source);
		h.memory.writeMappedU32LE(io.IO_DMA1_TRANSFER_COUNT, 1);
		h.memory.writeMappedU32LE(io.IO_DMA1_CONTROL, io.DMA_ROUTE_FROM_GPU);
		h.memory.writeMappedU32LE(io.IO_DMA1_TRIGGER, io.DMA_TRIGGER_START);
		assert.equal(h.dma.cpuBusHeld(), false);
		assert.ok(h.gpu.captureState().gp0DmaIngressWords.length > 0, 'the read-channel START has not already freed write capacity');
		assert.equal(h.dma.gpuCommandServiceDemand(), 1 << DmaEndpoint.GpuRead);
		assert.equal(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
		h.scheduler.advanceTo(10000);
		if (pairedRequest) h.dma.setEndpointRequests(DmaEndpoint.ImgDecRead, 1, DmaEndpoint.ImgDecWrite, 0);
		else h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, 1);
		assert.equal(h.dma.cpuBusHeld(), true, 'the newly added write bit must catch up before arbitration');
		assert.equal(h.dma.captureState().activeChannel, 0);
		step(h);
		assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
		assert.equal(h.memory.readIoU32(io.IO_DMA1_STATUS), io.DMA_STATUS_BUSY, 'read demand still awaits an actual readback');
		assert.equal(reads, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1);
	}
});

test('a disabled GP0 DMA job owns its port but does not observe draw completion', () => {
	const h = fixture(); fill(h, 0x00010001);
	h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_OFF);
	h.memory.writeU32(source, 0xe1000000);
	start(h, io.DMA_ROUTE_TO_GPU, 1);
	assert.equal(h.dma.cpuBusHeld(), false);
	assert.equal(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'draw completion cannot enable an OFF request');
	assert.equal(h.memory.mappedWriteReady(io.IO_GX_GPU_GP0), false, 'DMA still owns the CPU write port');
	assert.equal(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'a port-ownership wait cannot be released by draw completion');
	h.memory.writeMappedU32LE(io.IO_DMA0_TRIGGER, io.DMA_TRIGGER_STOP);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), 0);
	assert.equal(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'stopped DMA no longer observes the GPU completion');
});

test('a GP0 job in GPUREAD mode does not request unrelated draw completion', () => {
	const h = fixture(); fill(h, 0x00010001);
	h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	start(h, io.DMA_ROUTE_TO_GPU, 1);
	assert.equal(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	assert.equal(h.dma.ownsWritePort(io.IO_GX_GPU_GP0), true);
});

test('a GPUREAD job cannot produce pixels by completing ordinary draws', () => {
	for (const direction of [gp0.GX_GPU_DMA_DIRECTION_OFF, gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0, gp0.GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU]) {
		const h = fixture(); fill(h, 0x00010001);
		h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | direction);
		h.memory.writeMappedU32LE(io.IO_DMA0_WRITE_ADDR, source);
		start(h, io.DMA_ROUTE_FROM_GPU, 1);
		assert.equal(h.dma.ownsReadPort(io.IO_GX_GPU_GP0), true);
		assert.equal(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'there is no queued readback to make ready');
	}
});

test('a GP1 mode edge rearms ingress demand even when its current capacity remains zero', () => {
	const h = fixture(); fill(h, 0x00640001);
	const count = gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1;
	for (let i = 0; i < count; ++i) h.memory.writeU32(source + i * 4, 0xe1000000);
	start(h, io.DMA_ROUTE_TO_GPU, count); step(h);
	assert.equal(h.dma.cpuBusHeld(), false);
	const completion = h.scheduler.nextDeadline();
	assert.notEqual(completion, Number.MAX_SAFE_INTEGER);
	for (const direction of [gp0.GX_GPU_DMA_DIRECTION_OFF, gp0.GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU]) {
		h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | direction);
		assert.equal(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'the wrong mode disables completion demand');
		h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
		assert.equal(h.scheduler.nextDeadline(), completion, 'the mode edge observes existing ingress debt, without a capacity edge');
	}
	for (let i = 0; i < 300 && h.memory.readIoU32(io.IO_DMA0_STATUS) === io.DMA_STATUS_BUSY; ++i) step(h);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
});

test('readback and supervisor dependencies remain observable with disabled DMA demand', () => {
	const h = fixture(); fill(h, 0x00010001);
	h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_OFF);
	for (const word of [0xc0000000, 0, 0x00010001]) h.gpu.writeGp0(word);
	start(h, io.DMA_ROUTE_TO_GPU, 1);
	assert.equal(h.scheduler.nextDeadline(), 30, 'readback completion owns its dependency independently of DMA direction');
	step(h);
	assert.equal(h.gpu.captureState().commandBuffer.readbackPhase, GX_GPU_READBACK_PENDING, 'readback becomes pending at its own completion');
	const q = fixture(); fill(q, 0x00010001);
	q.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_OFF);
	start(q, io.DMA_ROUTE_TO_GPU, 1);
	q.dma.beginSupervisorQuiesce(); q.gpu.beginSupervisorQuiesce();
	while (q.scheduler.hasDueTimer()) assert.equal(q.scheduler.popDueTimer(), DEVICE_SERVICE_SYSTEM);
	assert.equal(q.scheduler.nextDeadline(), 29, 'the supervisor still needs to drain admitted GPU work');
});

test('restored mode-disabled DMA does not force a draw deadline and can later resume', () => {
	const h = fixture(); fill(h, 0x00640001);
	h.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_OFF);
	h.memory.writeU32(source, 0xe1000000); start(h, io.DMA_ROUTE_TO_GPU, 1);
	const gpuState = h.gpu.captureState(), dmaState = h.dma.captureState();
	const restored = fixture();
	restored.memory.writeU32(source, 0xe1000000);
	restored.dma.restoreState(dmaState, 0); restored.gpu.restoreState(gpuState);
	restored.dma.postLoad(); restored.gpu.dependencyStateChanged();
	assert.equal(restored.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'restore reconciles OFF after all request producers');
	assert.equal(restored.memory.mappedWriteReady(io.IO_GX_GPU_GP0), false);
	assert.equal(restored.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'restored ownership alone cannot observe completion');
	restored.gpu.writeGp1((gp1.GX_GPU_GP1_DMA_DIRECTION << 24) | gp0.GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	assert.equal(restored.dma.cpuBusHeld(), true);
	step(restored);
	assert.equal(restored.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
});

test('STOP cancels GPU wakeup when a DMA tail waits for full ingress', () => {
	const h = fixture();
	fill(h, 0x00640001);
	const count = gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1;
	for (let i = 0; i < count; ++i) h.memory.writeU32(source + 4 * i, 0xe1000000);
	start(h, io.DMA_ROUTE_TO_GPU, count);
	step(h);
	assert.equal(h.dma.cpuBusHeld(), false);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_BUSY);
	assert.notEqual(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'ingress completion can wake DMA');
	h.memory.writeMappedU32LE(io.IO_DMA0_TRIGGER, io.DMA_TRIGGER_STOP);
	assert.equal(h.memory.readIoU32(io.IO_DMA0_STATUS), 0);
	assert.equal(h.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER, 'no DMA is waiting for ingress');
});

test('restored GP0 source-wait survives another active DMA block and wakes on later source edge', () => {
	const h = fixture(); fill(h, 0x00640001);
	let reads = 0;
	const read = () => { ++reads; if (reads === 1) h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, 0); return 0xe1000000; };
	h.memory.mapIoRead(io.IO_IMGDEC_DATA, h, read);
	h.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY);
	start(h, io.DMA_ROUTE_IMGDEC_TO_GPU, gp0.GX_GPU_DMA_INGRESS_WORD_CAPACITY + 1);
	step(h);
	const target = map.DYNAMIC_RAM_BASE + 0x4000;
	h.memory.writeMappedU32LE(io.IO_DMA1_READ_ADDR, source);
	h.memory.writeMappedU32LE(io.IO_DMA1_WRITE_ADDR, target);
	h.memory.writeMappedU32LE(io.IO_DMA1_TRANSFER_COUNT, 256);
	h.memory.writeMappedU32LE(io.IO_DMA1_CONTROL, io.DMA_ROUTE_COPY);
	h.memory.writeMappedU32LE(io.IO_DMA1_TRIGGER, io.DMA_TRIGGER_START);
	const snapshotTime = h.scheduler.nowCycles, gpuState = h.gpu.captureState(), dmaState = h.dma.captureState();
	const restored = fixture(); restored.scheduler.advanceTo(snapshotTime);
	let restoredReads = 0;
	restored.memory.mapIoRead(io.IO_IMGDEC_DATA, restored, () => { ++restoredReads; return 0xe1000000; });
	restored.dma.restoreState(dmaState, snapshotTime);
	restored.gpu.restoreState(gpuState);
	restored.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, 0);
	restored.dma.postLoad();
	restored.gpu.dependencyStateChanged();
	const completion = snapshotTime + dmaState.scheduledBlockCycles;
	assert.equal(restored.scheduler.nextDeadline(), completion, 'restored active block owns its original deadline');
	const edge = snapshotTime + 500; assert.ok(edge < completion);
	restored.scheduler.advanceTo(edge);
	restored.dma.setEndpointCapacity(DmaEndpoint.ImgDecRead, 1);
	assert.equal(restored.scheduler.nextDeadline(), completion, 'source edge cannot add a GPU deadline during admitted block');
	assert.equal(restored.memory.readIoU32(io.IO_DMA0_TRANSFER_COUNT), 1);
	for (let i = 0; i < 300 && restored.memory.readIoU32(io.IO_DMA0_STATUS) === io.DMA_STATUS_BUSY; ++i) step(restored);
	assert.equal(restored.memory.readIoU32(io.IO_DMA1_STATUS), io.DMA_STATUS_DONE);
	assert.equal(restored.memory.readIoU32(io.IO_DMA0_STATUS), io.DMA_STATUS_DONE);
	assert.equal(restoredReads, 1, 'the restored DMA transfers the remaining decoder word exactly once');
});
