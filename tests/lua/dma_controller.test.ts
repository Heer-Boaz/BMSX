import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	BUS_FAULT_UNMAPPED,
	DMA_REQUEST_IMGDEC_READ,
	DMA_REQUEST_IMGDEC_WRITE,
	DMA_STATUS_BUSY,
	DMA_STATUS_DONE,
	DMA_TRIGGER_START,
	IO_DMA0_CONTROL,
	IO_DMA0_READ_ADDR,
	IO_DMA0_STATUS,
	IO_DMA0_TRANSFER_COUNT,
	IO_DMA0_TRIGGER,
	IO_DMA0_WRITE_ADDR,
	IO_DMA1_CONTROL,
	IO_DMA1_READ_ADDR,
	IO_DMA1_STATUS,
	IO_DMA1_TRANSFER_COUNT,
	IO_DMA1_TRIGGER,
	IO_DMA1_WRITE_ADDR,
	IO_DMA_CHANNEL_COUNT,
	IO_GX_GPU_GP0,
	IO_IRQ_FLAGS,
	IO_SLOT_COUNT,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IRQ_DMA0_DONE,
	IRQ_DMA1_DONE,
} from '../../machine/ts/machine/bus/io';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionLoader } from '../../machine/ts/machine/cpu/execution_loader';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import {
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_GP1_DMA_DIRECTION,
	GX_GPU_STATUS_READY_TO_RECEIVE_DMA,
	GxGpu,
} from '../../machine/ts/machine/devices/gx/gpu';
import {
	GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
	GX_GPU_DMA_DIRECTION_FIFO,
	GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU,
	GX_GPU_DMA_DIRECTION_OFF,
	GX_GPU_COMMAND_FIFO_WORD_CAPACITY,
	GX_GPU_DMA_INGRESS_WORD_CAPACITY,
	GX_GPU_GP0_CPU_TO_VRAM_FIRST,
	GX_GPU_GP0_FILL_RECTANGLE,
	GX_GPU_GP0_VRAM_TO_CPU_FIRST,
} from '../../machine/ts/machine/devices/gx/gp0';
import {
	GX_GPU_PCRTC_SMODE1_LOW,
	GX_GPU_PCRTC_SMODE1_SINT,
	gxGpuPcrtcRegisterAddress,
} from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import {
	CART_RAM_END,
	CART_ROM_BASE,
	CART_ROM_END,
	IO_BASE,
	IO_WORD_SIZE,
	DYNAMIC_RAM_BASE,
	RAM_END,
	SYSTEM_ROM_BASE,
} from '../../machine/ts/machine/memory/map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/machine/model_registry';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { cartridgeSlots } from '../helpers/cartridge';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';

type DmaGpuFixture = {
	memory: Memory;
	cpu: CPU;
	executionLoader: ExecutionLoader;
	dma: DmaController;
	gpu: GxGpu;
	scheduler: DeviceScheduler;
};

const RAM_COPY_CONTROL = 0x00003c03;
const IMGDEC_GATED_RAM_COPY_CONTROL = 0x00003d43;
const GP0_WRITE_CONTROL = 0x00003c41;
const FORCED_GP0_WRITE_CONTROL = 0x00003c01;
const GP0_READ_CONTROL = 0x0000000a;
const GX_CROSS_REQUEST_CONTROL = 0x00000048;
const DMA_DISABLED_CONTROL = 0x000003fc;
const PORT_ADVANCE_CONTROL = 0x00000003;
const SELF_DMA_TRIGGER_CONTROL = 0x00000001;

function createDmaGpuFixture(): DmaGpuFixture {
	const memory = new Memory({
		systemRom: new Uint8Array([0x04, 0x03, 0x02, 0x01, 0x08, 0x07, 0x06, 0x05]),
		cartridgeSlots: cartridgeSlots(new Uint8Array([0x44, 0x33, 0x22, 0x11, 0x88, 0x77, 0x66, 0x55])),
	});
	const irq = new IrqController(memory);
	const executionLoader = new ExecutionLoader(memory);
	const cpu = new CPU(memory, irq, executionLoader);
	const scheduler = new DeviceScheduler(cpu);
	const dma = new DmaController(memory, cpu, irq, scheduler);
	const gpu = new GxGpu(memory, cpu, irq, scheduler, dma);
	dma.reset();
	gpu.reset();
	irq.reset();
	dma.setTiming(0, 1, 0, 0, 0, 0);
	const smode1Address = gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_SMODE1_LOW);
	memory.writeMappedU32LE(smode1Address, memory.readMappedU32LE(smode1Address) | GX_GPU_PCRTC_SMODE1_SINT);
	gpu.onService(0);
	return { memory, cpu, executionLoader, dma, gpu, scheduler };
}

test('region-aware DMA charges one RAM burst setup and combines both block sides once', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, scheduler } = fixture;
	const ramSource = DYNAMIC_RAM_BASE + 0x80;
	const ramDestination = DYNAMIC_RAM_BASE + 0xa0;
	const romDestination = DYNAMIC_RAM_BASE + 0xc0;
	memory.writeMappedU32LE(ramSource, 0x99aabbcc);
	memory.writeMappedU32LE(ramSource + 4, 0xddeeff00);
	dma.setTiming(
		PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
		PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
		PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
		scheduler.nowCycles,
	);

	programTransfer(memory, ramSource, ramDestination, 2, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 6, 'single-ported RAM copy sums two 3-cycle block sides');
	runNextDmaService(fixture);
	assert.equal(memory.readMappedU32LE(ramDestination), 0x99aabbcc);
	assert.equal(memory.readMappedU32LE(ramDestination + 4), 0xddeeff00);

	programTransfer(memory, CART_ROM_BASE, romDestination, 2, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 26, 'the 20-cycle cartridge side gates the RAM burst');
	runNextDmaService(fixture);
	assert.equal(memory.readMappedU32LE(romDestination), 0x11223344);
	assert.equal(memory.readMappedU32LE(romDestination + 4), 0x55667788);
});

test('system firmware ROM uses its internal bus timing instead of cartridge timing', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, scheduler } = fixture;
	const firmwareDestination = DYNAMIC_RAM_BASE + 0x1000;
	dma.setTiming(
		PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
		PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
		PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
		scheduler.nowCycles,
	);

	programTransfer(memory, SYSTEM_ROM_BASE, firmwareDestination, 2, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 3, 'the RAM destination gates a two-cycle local firmware read');
	runNextDmaService(fixture);
	assert.equal(memory.readMappedU32LE(firmwareDestination), 0x01020304);
	assert.equal(memory.readMappedU32LE(firmwareDestination + 4), 0x05060708);
});

test('incrementing DMA timing follows memory regions across physical map boundaries', () => {
	const cartRomToRam = createDmaGpuFixture();
	cartRomToRam.dma.setTiming(5, 7, 2, 11, 13, 0);
	programTransfer(
		cartRomToRam.memory,
		CART_ROM_END - IO_WORD_SIZE,
		IO_GX_GPU_GP0,
		2,
		FORCED_GP0_WRITE_CONTROL,
	);
	assert.equal(
		cartRomToRam.scheduler.nextDeadline(),
		48,
		'cartridge ROM and RAM each pay their physical bus setup and word timing',
	);

	const cartRamToMmio = createDmaGpuFixture();
	cartRamToMmio.dma.setTiming(5, 7, 2, 11, 13, 0);
	programTransfer(
		cartRamToMmio.memory,
		CART_RAM_END - IO_WORD_SIZE,
		IO_GX_GPU_GP0,
		2,
		FORCED_GP0_WRITE_CONTROL,
	);
	assert.equal(
		cartRamToMmio.scheduler.nextDeadline(),
		48,
		'cartridge RAM and MMIO each begin a physical bus transaction',
	);

	const ioToRam = createDmaGpuFixture();
	ioToRam.dma.setTiming(5, 7, 2, 11, 13, 0);
	programTransfer(
		ioToRam.memory,
		IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE - IO_WORD_SIZE,
		IO_GX_GPU_GP0,
		2,
		FORCED_GP0_WRITE_CONTROL,
	);
	assert.equal(
		ioToRam.scheduler.nextDeadline(),
		12,
		'the first RAM word after the IO aperture pays RAM setup and word timing',
	);
});

test('cartridge ROM pays one setup per admitted block', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, scheduler } = fixture;
	const destination = DYNAMIC_RAM_BASE + 0x1800;
	dma.setTiming(
		PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
		PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
		PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
		scheduler.nowCycles,
	);

	programTransfer(memory, CART_ROM_BASE, destination, 17, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 132, 'sixteen words cost four setup cycles plus eight cycles per word');
	runNextDmaService(fixture);
	assert.equal(scheduler.nextDeadline(), 144, 'the final one-word block pays a new four-cycle setup');
});

test('RAM burst setup is block-local rather than persistent address state', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, scheduler } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x2000;
	const destination = DYNAMIC_RAM_BASE + 0x2100;
	dma.setTiming(
		PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
		PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
		PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
		scheduler.nowCycles,
	);

	programTransfer(memory, source, destination, 1, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 4);
	runNextDmaService(fixture);

	programTransfer(memory, source, destination, 1, RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), 8, 'a later block pays its own setup even at identical addresses');
});

test('a fixed MMIO port adds no memory wait beside its RAM block side', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, gpu, scheduler } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x3000;
	memory.writeMappedU32LE(source, 0x01020304);
	memory.writeMappedU32LE(source + 4, 0x05060708);
	dma.setTiming(
		PSX_MACHINE_SPEC.dmaRamCyclesPerWord,
		PSX_MACHINE_SPEC.dmaRamBurstSetupCycles,
		PSX_MACHINE_SPEC.dmaSystemRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomCyclesPerWord,
		PSX_MACHINE_SPEC.dmaCartRomBurstSetupCycles,
		scheduler.nowCycles,
	);

	programTransfer(memory, source, IO_GX_GPU_GP0, 2, GP0_WRITE_CONTROL);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_FIFO);
	assert.equal(scheduler.nextDeadline(), 3);
});

function programTransfer(memory: Memory, readAddress: number, writeAddress: number, wordCount: number, control: number): void {
	memory.writeMappedU32LE(IO_DMA0_READ_ADDR, readAddress);
	memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, writeAddress);
	memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, wordCount);
	memory.writeMappedU32LE(IO_DMA0_CONTROL, control);
	memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
}

function runNextDmaService(fixture: DmaGpuFixture): void {
	const deadline = fixture.scheduler.nextDeadline();
	assert.notEqual(deadline, Number.MAX_SAFE_INTEGER);
	fixture.scheduler.advanceTo(deadline);
	fixture.dma.onService(deadline);
}

test('DMA executes the register state latched when its block was admitted', () => {
	const fixture = createDmaGpuFixture();
	const { memory } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x100;
	const destination = DYNAMIC_RAM_BASE + 0x200;
	const replacementDestination = DYNAMIC_RAM_BASE + 0x240;
	memory.writeMappedU32LE(source, 0x11223344);
	memory.writeMappedU32LE(source + 4, 0x55667788);
	memory.writeMappedU32LE(source + 8, 0x99aabbcc);

	programTransfer(memory, source, destination, 3, RAM_COPY_CONTROL);
	assert.equal(memory.readIoU32(IO_DMA0_TRIGGER), 0);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_BUSY);
	memory.writeMappedU32LE(IO_DMA0_READ_ADDR, CART_ROM_BASE);
	memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, replacementDestination);
	memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, 0);
	memory.writeMappedU32LE(IO_DMA0_CONTROL, DMA_DISABLED_CONTROL);
	runNextDmaService(fixture);

	assert.equal(memory.readMappedU32LE(destination), 0x11223344);
	assert.equal(memory.readMappedU32LE(destination + 4), 0x55667788);
	assert.equal(memory.readMappedU32LE(destination + 8), 0x99aabbcc);
	assert.equal(memory.readMappedU32LE(replacementDestination), 0);
	assert.equal(memory.readIoU32(IO_DMA0_READ_ADDR), source + 12);
	assert.equal(memory.readIoU32(IO_DMA0_WRITE_ADDR), destination + 12);
	assert.equal(memory.readIoU32(IO_DMA0_TRANSFER_COUNT), 0);
	assert.equal(memory.readIoU32(IO_DMA0_CONTROL), DMA_DISABLED_CONTROL);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA0_DONE, IRQ_DMA0_DONE);
});

test('an armed GX DMA channel reserves GP0 and waits for the GPU DREQ', () => {
	const fixture = createDmaGpuFixture();
	const { memory, gpu, scheduler } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x300;
	const command0 = (GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x3f;
	memory.writeMappedU32LE(source, command0);
	memory.writeMappedU32LE(source + 4, 0x00020010);
	memory.writeMappedU32LE(source + 8, 0x00030020);

	programTransfer(memory, source, IO_GX_GPU_GP0, 3, GP0_WRITE_CONTROL);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), false);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_BUSY);

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_FIFO);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), false);
	runNextDmaService(fixture);

	const commands = gpu.readDeviceOutput().commandBuffer;
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_FILL_RECTANGLE);
	assert.equal(commands.words[commands.commandWordStart[0]], command0 >>> 0);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), true);
});

test('supervisor entry banks a GX DMA channel that has not admitted a block', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, gpu } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x340;
	const command0 = (GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x3f;
	memory.writeMappedU32LE(source, command0);
	memory.writeMappedU32LE(source + 4, 0x00020010);
	memory.writeMappedU32LE(source + 8, 0x00030020);

	programTransfer(memory, source, IO_GX_GPU_GP0, 3, GP0_WRITE_CONTROL);
	assert.equal(dma.hasAdmittedWriteBlock(IO_GX_GPU_GP0), false);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), false);

	gpu.beginSupervisorQuiesce();
	dma.beginSupervisorQuiesce();
	assert.equal(gpu.supervisorQuiescent(), true);
	assert.equal(dma.supervisorQuiescent(), true);
	dma.enterSupervisorContext();
	gpu.enterSupervisorContext();

	gpu.leaveSupervisorContext();
	dma.leaveSupervisorContext();
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_BUSY);
	assert.equal(dma.hasAdmittedWriteBlock(IO_GX_GPU_GP0), false);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), false);

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_FIFO);
	runNextDmaService(fixture);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
});

test('supervisor closes DMA triggers before closing block admission', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, scheduler } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x360;
	const destination = DYNAMIC_RAM_BASE + 0x460;
	for (let index = 0; index < 17; index += 1) {
		memory.writeMappedU32LE(source + index * 4, index + 1);
	}

	programTransfer(memory, source, destination, 17, IMGDEC_GATED_RAM_COPY_CONTROL);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	dma.beginSupervisorControlQuiesce();
	assert.equal(dma.supervisorQuiescent(), false);

	dma.setRequestLines(1 << DMA_REQUEST_IMGDEC_WRITE, 1 << DMA_REQUEST_IMGDEC_WRITE);
	assert.notEqual(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	dma.beginSupervisorQuiesce();
	runNextDmaService(fixture);

	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_BUSY);
	assert.equal(memory.readIoU32(IO_DMA0_TRANSFER_COUNT), 1);
	assert.equal(dma.captureState().activeChannel, IO_DMA_CHANNEL_COUNT);
	assert.equal(dma.supervisorQuiescent(), true);
});

test('an admitted self-DMA write cannot reopen a trigger after the supervisor control gate closes', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x370;
	memory.writeMappedU32LE(source, DMA_TRIGGER_START);
	memory.writeMappedU32LE(IO_DMA1_READ_ADDR, source);
	memory.writeMappedU32LE(IO_DMA1_WRITE_ADDR, DYNAMIC_RAM_BASE + 0x470);
	memory.writeMappedU32LE(IO_DMA1_TRANSFER_COUNT, 1);
	memory.writeMappedU32LE(IO_DMA1_CONTROL, RAM_COPY_CONTROL);

	programTransfer(memory, source, IO_DMA1_TRIGGER, 1, SELF_DMA_TRIGGER_CONTROL);
	dma.beginSupervisorControlQuiesce();
	dma.beginSupervisorQuiesce();
	runNextDmaService(fixture);

	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_DMA1_STATUS), 0);
	assert.equal(memory.readIoU32(IO_DMA1_TRIGGER), 0);
	assert.equal(dma.supervisorQuiescent(), true);
});

test('CPU-to-GP0 DMA streams an A0 payload across programmed blocks', () => {
	const fixture = createDmaGpuFixture();
	const { memory, gpu } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x380;
	memory.writeMappedU32LE(source, GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
	memory.writeMappedU32LE(source + 4, 0);
	memory.writeMappedU32LE(source + 8, (1 << 16) | 34);
	for (let index = 0; index < 17; index += 1) {
		memory.writeMappedU32LE(source + 12 + index * 4, (0x55000000 | index) >>> 0);
	}

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	programTransfer(memory, source, IO_GX_GPU_GP0, 20, GP0_WRITE_CONTROL);
	runNextDmaService(fixture);
	assert.equal(memory.readIoU32(IO_DMA0_TRANSFER_COUNT), 4);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_BUSY);
	assert.equal(gpu.readStatus() & GX_GPU_STATUS_READY_TO_RECEIVE_DMA, GX_GPU_STATUS_READY_TO_RECEIVE_DMA);
	runNextDmaService(fixture);

	const commands = gpu.readDeviceOutput().commandBuffer;
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	assert.equal(commands.commandCount, 1);
	assert.equal(commands.commandKind[0], GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM);
});

test('forced GP0 DMA saturates the physical command and ingress FIFOs', () => {
	const fixture = createDmaGpuFixture();
	const { memory, gpu } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x1000;
	gpu.writeGp0((GX_GPU_GP0_FILL_RECTANGLE << 24) | 0x0000ff);
	gpu.writeGp0(0);
	gpu.writeGp0((511 << 16) | 0x03f1);
	for (let index = 0; index < 48; index += 1) {
		memory.writeMappedU32LE(source + index * 4, 0x03000000 | index);
	}

	programTransfer(memory, source, IO_GX_GPU_GP0, 48, FORCED_GP0_WRITE_CONTROL);
	runNextDmaService(fixture);
	let state = gpu.captureState();
	assert.equal(state.gp0FifoWords.length, GX_GPU_COMMAND_FIFO_WORD_CAPACITY);
	assert.equal(state.gp0DmaIngressWords.length, 0);
	runNextDmaService(fixture);
	state = gpu.captureState();
	assert.equal(state.gp0FifoWords.length, GX_GPU_COMMAND_FIFO_WORD_CAPACITY);
	assert.equal(state.gp0DmaIngressWords.length, GX_GPU_DMA_INGRESS_WORD_CAPACITY);
	runNextDmaService(fixture);

	state = gpu.captureState();
	assert.equal(state.gp0Word, 0x0300002f);
	assert.equal(state.gp0FifoWords[GX_GPU_COMMAND_FIFO_WORD_CAPACITY - 1], 0x0300000f);
	assert.equal(state.gp0DmaIngressWords[GX_GPU_DMA_INGRESS_WORD_CAPACITY - 1], 0x0300001f);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
});

test('an admitted DMA block survives DREQ drop, timing changes, and restore', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, gpu, scheduler } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x400;
	memory.writeMappedU32LE(source, 0xe1000000);
	memory.writeMappedU32LE(source + 4, 0xe1000001);
	dma.setTiming(4, 0, 4, 0, 0, 0);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	programTransfer(memory, source, IO_GX_GPU_GP0, 2, GP0_WRITE_CONTROL);
	assert.equal(scheduler.nextDeadline(), 8);

	scheduler.advanceTo(3);
	dma.setTiming(8, 0, 8, 0, 0, 3);
	assert.equal(scheduler.nextDeadline(), 8);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_OFF);
	assert.equal(scheduler.nextDeadline(), 8);
	const state = dma.captureState();
	assert.equal(state.scheduledReadAddressWord, source);
	assert.equal(state.scheduledWriteAddressWord, IO_GX_GPU_GP0);
	assert.equal(state.scheduledTransferCountWord, 2);
	assert.equal(state.scheduledControlWord, GP0_WRITE_CONTROL);
	dma.restoreState(state, scheduler.nowCycles);
	dma.postLoad();
	assert.equal(scheduler.nextDeadline(), 8);

	runNextDmaService(fixture);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
});

test('DMA resamples finite GX read DREQ between words and resumes on a later readback', () => {
	const fixture = createDmaGpuFixture();
	const { memory, gpu, scheduler } = fixture;
	const destination = DYNAMIC_RAM_BASE + 0x500;
	const sentinel = 0xa5a5a5a5;
	memory.writeMappedU32LE(destination, sentinel);
	memory.writeMappedU32LE(destination + 4, sentinel);
	memory.writeMappedU32LE(destination + 8, sentinel);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 3);
	programTransfer(memory, IO_GX_GPU_GP0, destination, 3, GP0_READ_CONTROL);

	scheduler.advanceTo(1);
	gpu.onService(1);
	gpu.presentReadyFrameOnVblankEdge();
	let output = gpu.readDeviceOutput();
	let readback = output.readbackPort;
	readback.pixelBytes[0] = 0x11;
	readback.pixelBytes[1] = 0x11;
	readback.pixelBytes[2] = 0x22;
	readback.pixelBytes[3] = 0x22;
	readback.pixelBytes[4] = 0x33;
	readback.pixelBytes[5] = 0x33;
	assert.equal(readback.claimReadback(output.commandBuffer.presentCommandCount), true);
	readback.completeReadback(readback.token);
	assert.equal(memory.readMappedU32LE(IO_GX_GPU_GP0), 0, 'CPU GPUREAD retains its latch while DMA owns the read port');
	runNextDmaService(fixture);
	runNextDmaService(fixture);

	assert.equal(memory.readMappedU32LE(destination), 0x22221111);
	assert.equal(memory.readMappedU32LE(destination + 4), 0x00003333);
	assert.equal(memory.readMappedU32LE(destination + 8), sentinel);
	assert.equal(memory.readIoU32(IO_DMA0_TRANSFER_COUNT), 1);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_BUSY);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);

	gpu.retirePresentedCommands();
	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 2);
	const readbackDeadline = scheduler.nextDeadline();
	scheduler.advanceTo(readbackDeadline);
	gpu.onService(readbackDeadline);
	gpu.presentReadyFrameOnVblankEdge();
	output = gpu.readDeviceOutput();
	readback = output.readbackPort;
	readback.pixelBytes[0] = 0x55;
	readback.pixelBytes[1] = 0x55;
	readback.pixelBytes[2] = 0x66;
	readback.pixelBytes[3] = 0x66;
	assert.equal(readback.claimReadback(output.commandBuffer.presentCommandCount), true);
	readback.completeReadback(readback.token);
	runNextDmaService(fixture);

	assert.equal(memory.readMappedU32LE(destination + 8), 0x66665555);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
});

test('GX direction switches break before make without admitting a crossed DREQ pair', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, gpu, scheduler } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x580;
	const crossDestination = DYNAMIC_RAM_BASE + 0x5c0;
	const readDestination = DYNAMIC_RAM_BASE + 0x600;
	memory.writeMappedU32LE(source, 0x12345678);

	gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
	gpu.writeGp0(0);
	gpu.writeGp0((1 << 16) | 2);
	const readbackDeadline = scheduler.nextDeadline();
	scheduler.advanceTo(readbackDeadline);
	gpu.onService(readbackDeadline);
	gpu.presentReadyFrameOnVblankEdge();
	const output = gpu.readDeviceOutput();
	const readback = output.readbackPort;
	readback.pixelBytes[0] = 0x11;
	readback.pixelBytes[1] = 0x11;
	readback.pixelBytes[2] = 0x22;
	readback.pixelBytes[3] = 0x22;
	assert.equal(readback.claimReadback(output.commandBuffer.presentCommandCount), true);
	readback.completeReadback(readback.token);
	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_FIFO);

	programTransfer(memory, source, crossDestination, 1, GX_CROSS_REQUEST_CONTROL);
	memory.writeMappedU32LE(IO_DMA1_READ_ADDR, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA1_WRITE_ADDR, readDestination);
	memory.writeMappedU32LE(IO_DMA1_TRANSFER_COUNT, 1);
	memory.writeMappedU32LE(IO_DMA1_CONTROL, GP0_READ_CONTROL);
	memory.writeMappedU32LE(IO_DMA1_TRIGGER, DMA_TRIGGER_START);
	assert.equal(dma.captureState().activeChannel, IO_DMA_CHANNEL_COUNT);

	gpu.writeGp1((GX_GPU_GP1_DMA_DIRECTION << 24) | GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	const dmaState = dma.captureState();
	assert.equal(dmaState.activeChannel, 1);
	assert.equal(dmaState.scheduledReadAddressWord, IO_GX_GPU_GP0);
	assert.equal(memory.readMappedU32LE(crossDestination), 0);
});

test('DMA bus faults remain Memory-owned and do not abort channel progress', () => {
	const fixture = createDmaGpuFixture();
	const { memory } = fixture;
	const destination = DYNAMIC_RAM_BASE + 0x600;
	memory.writeMappedU32LE(destination, 0xdeadbeef);

	programTransfer(memory, RAM_END - 2, destination, 1, RAM_COPY_CONTROL);
	runNextDmaService(fixture);

	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), RAM_END - 2);
	assert.equal(memory.readMappedU32LE(destination), 0);
	assert.equal(memory.readIoU32(IO_DMA0_READ_ADDR), RAM_END + 2);
	assert.equal(memory.readIoU32(IO_DMA0_WRITE_ADDR), destination + 4);
	assert.equal(memory.readIoU32(IO_DMA0_TRANSFER_COUNT), 0);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
});

test('self-DMA control writes affect the next admission, not the admitted block', () => {
	const fixture = createDmaGpuFixture();
	const { memory, scheduler } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x700;
	const runningControl = 0x00003c01;
	memory.writeMappedU32LE(source, DMA_DISABLED_CONTROL);
	memory.writeMappedU32LE(source + 4, runningControl);

	programTransfer(memory, source, IO_DMA0_CONTROL, 2, runningControl);
	runNextDmaService(fixture);
	assert.equal(memory.readIoU32(IO_DMA0_CONTROL), runningControl);
	assert.equal(memory.readIoU32(IO_DMA0_READ_ADDR), source + 8);
	assert.equal(memory.readIoU32(IO_DMA0_TRANSFER_COUNT), 0);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
});

test('a zero-count trigger completes synchronously', () => {
	const { memory } = createDmaGpuFixture();
	programTransfer(memory, 0, 0, 0, DMA_DISABLED_CONTROL);
	assert.equal(memory.readIoU32(IO_DMA0_TRIGGER), 0);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA0_DONE, IRQ_DMA0_DONE);
});

test('clearing the transfer count completes a channel waiting for DREQ', () => {
	const { memory, scheduler } = createDmaGpuFixture();
	programTransfer(memory, 0, IO_GX_GPU_GP0, 1, DMA_DISABLED_CONTROL);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_BUSY);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), false);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);

	memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, 0);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), true);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA0_DONE, IRQ_DMA0_DONE);
});

test('advancing a DMA port address releases blocked CPU writes after the block', () => {
	const fixture = createDmaGpuFixture();
	const { memory } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x780;
	memory.writeMappedU32LE(source, 0);
	memory.writeMappedU32LE(source + 4, 0);
	programTransfer(memory, source, IO_GX_GPU_GP0, 2, PORT_ADVANCE_CONTROL);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), false);

	runNextDmaService(fixture);
	assert.equal(memory.readIoU32(IO_DMA0_TRANSFER_COUNT), 1);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_BUSY);
	assert.equal(memory.mappedWriteReady(IO_GX_GPU_GP0), true);
	runNextDmaService(fixture);
});

test('a DMA address write wakes only the CPU store whose endpoint reservation was released', () => {
	const fixture = createDmaGpuFixture();
	const { memory, cpu, executionLoader } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x7c0;
	const replacementReadAddress = DYNAMIC_RAM_BASE + 0x8c0;
	const replacementWriteAddress = DYNAMIC_RAM_BASE + 0x9c0;
	const compiled = compileLuaSource(`
local gp0<const>: *word = ${IO_GX_GPU_GP0}
*gp0 = 0
	`);
	const finalized = linkTestSystemBlua32(compiled);
	memory.installSystemRom(finalized.romBytes);
	executionLoader.mountExecutableMedia(cpu);
	cpu.start(finalized.vectors.startupFunctionAddress);

	programTransfer(memory, source, IO_GX_GPU_GP0, 1, DMA_DISABLED_CONTROL);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.isMemoryWriteBlocked(), true);
	assert.equal(cpu.stalledMemoryWriteAddress(), IO_GX_GPU_GP0);

	memory.writeMappedU32LE(source, 0);
	memory.writeMappedU32LE(IO_DMA1_READ_ADDR, source);
	memory.writeMappedU32LE(IO_DMA1_WRITE_ADDR, IO_GX_GPU_GP0);
	memory.writeMappedU32LE(IO_DMA1_TRANSFER_COUNT, 1);
	memory.writeMappedU32LE(IO_DMA1_CONTROL, FORCED_GP0_WRITE_CONTROL);
	memory.writeMappedU32LE(IO_DMA1_TRIGGER, DMA_TRIGGER_START);
	runNextDmaService(fixture);
	assert.equal(cpu.isMemoryWriteBlocked(), true, 'another channel completing at GP0 leaves the reserved store blocked');

	memory.writeMappedU32LE(source, replacementReadAddress);
	memory.writeMappedU32LE(IO_DMA1_READ_ADDR, source);
	memory.writeMappedU32LE(IO_DMA1_WRITE_ADDR, IO_DMA0_READ_ADDR);
	memory.writeMappedU32LE(IO_DMA1_TRANSFER_COUNT, 1);
	memory.writeMappedU32LE(IO_DMA1_CONTROL, SELF_DMA_TRIGGER_CONTROL);
	memory.writeMappedU32LE(IO_DMA1_TRIGGER, DMA_TRIGGER_START);
	runNextDmaService(fixture);
	assert.equal(cpu.isMemoryWriteBlocked(), true, 'changing the read endpoint leaves the reserved GP0 write blocked');

	memory.writeMappedU32LE(source, replacementWriteAddress);
	memory.writeMappedU32LE(IO_DMA1_READ_ADDR, source);
	memory.writeMappedU32LE(IO_DMA1_WRITE_ADDR, IO_DMA0_WRITE_ADDR);
	memory.writeMappedU32LE(IO_DMA1_TRANSFER_COUNT, 1);
	memory.writeMappedU32LE(IO_DMA1_CONTROL, SELF_DMA_TRIGGER_CONTROL);
	memory.writeMappedU32LE(IO_DMA1_TRIGGER, DMA_TRIGGER_START);
	runNextDmaService(fixture);
	assert.equal(cpu.isMemoryWriteBlocked(), false, 'changing the write endpoint releases the exact stalled GP0 store');
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
});

test('both directional request lines must assert before a channel can acquire the bus', () => {
	const fixture = createDmaGpuFixture();
	const { memory, dma, scheduler } = fixture;
	const source = DYNAMIC_RAM_BASE + 0x800;
	const destination = DYNAMIC_RAM_BASE + 0x900;
	memory.writeMappedU32LE(source, 0x12345678);
	memory.writeMappedU32LE(IO_DMA0_READ_ADDR, source);
	memory.writeMappedU32LE(IO_DMA0_WRITE_ADDR, destination);
	memory.writeMappedU32LE(IO_DMA0_TRANSFER_COUNT, 1);
	memory.writeMappedU32LE(IO_DMA0_CONTROL, 0x0000015b);
	memory.writeMappedU32LE(IO_DMA0_TRIGGER, DMA_TRIGGER_START);

	dma.setRequestLines(1 << DMA_REQUEST_IMGDEC_WRITE, 1 << DMA_REQUEST_IMGDEC_WRITE);
	assert.equal(scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	dma.setRequestLines(1 << DMA_REQUEST_IMGDEC_READ, 1 << DMA_REQUEST_IMGDEC_READ);
	runNextDmaService(fixture);

	assert.equal(memory.readMappedU32LE(destination), 0x12345678);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
});

test('the two channels share one bus and arbitrate blocks round-robin', () => {
	const fixture = createDmaGpuFixture();
	const { memory } = fixture;
	const source0 = DYNAMIC_RAM_BASE + 0xa00;
	const destination0 = DYNAMIC_RAM_BASE + 0xb00;
	const source1 = DYNAMIC_RAM_BASE + 0xc00;
	const destination1 = DYNAMIC_RAM_BASE + 0xd00;
	for (let index = 0; index < 17; index += 1) {
		memory.writeMappedU32LE(source0 + index * 4, index + 1);
	}
	memory.writeMappedU32LE(source1, 0x89abcdef);
	programTransfer(memory, source0, destination0, 17, RAM_COPY_CONTROL);
	memory.writeMappedU32LE(IO_DMA1_READ_ADDR, source1);
	memory.writeMappedU32LE(IO_DMA1_WRITE_ADDR, destination1);
	memory.writeMappedU32LE(IO_DMA1_TRANSFER_COUNT, 1);
	memory.writeMappedU32LE(IO_DMA1_CONTROL, RAM_COPY_CONTROL);
	memory.writeMappedU32LE(IO_DMA1_TRIGGER, DMA_TRIGGER_START);

	runNextDmaService(fixture);
	assert.equal(memory.readIoU32(IO_DMA0_TRANSFER_COUNT), 1);
	assert.equal(memory.readMappedU32LE(destination1), 0);
	runNextDmaService(fixture);
	assert.equal(memory.readMappedU32LE(destination1), 0x89abcdef);
	assert.equal(memory.readIoU32(IO_DMA1_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_BUSY);
	runNextDmaService(fixture);
	assert.equal(memory.readIoU32(IO_DMA0_STATUS), DMA_STATUS_DONE);
	assert.equal(memory.readMappedU32LE(destination0 + 16 * 4), 17);
	assert.equal(memory.readIoU32(IO_IRQ_FLAGS) & (IRQ_DMA0_DONE | IRQ_DMA1_DONE), IRQ_DMA0_DONE | IRQ_DMA1_DONE);
});
