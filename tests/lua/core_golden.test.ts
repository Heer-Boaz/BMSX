import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	BUS_FAULT_ACCESS_READ,
	BUS_FAULT_ACCESS_F64,
	BUS_FAULT_ACCESS_U8,
	BUS_FAULT_ACCESS_U16,
	BUS_FAULT_ACCESS_U32,
	BUS_FAULT_ACCESS_WRITE,
	BUS_FAULT_NONE,
	BUS_FAULT_READ_ONLY,
	BUS_FAULT_UNALIGNED_IO,
	BUS_FAULT_UNMAPPED,
		BUS_FAULT_VRAM_RANGE,
	DMA_CTRL_START,
	DMA_STATUS_DONE,
	DMA_STATUS_ERROR,
		IMG_CTRL_START,
		IMG_STATUS_DONE,
		IMG_STATUS_ERROR,
		IO_DMA_CTRL,
	IO_DMA_DST,
	IO_DMA_LEN,
	IO_DMA_SRC,
		IO_DMA_STATUS,
	IO_DMA_WRITTEN,
	IO_IMG_CAP,
	IO_IMG_CTRL,
	IO_IMG_DST,
	IO_IMG_LEN,
	IO_IMG_SRC,
	IO_IMG_STATUS,
	IO_IRQ_FLAGS,
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_BUS_FAULT_ACK,
	IO_SYS_BUS_FAULT_ADDR,
		IO_SYS_BUS_FAULT_CODE,
	IRQ_DMA_ERROR,
		IRQ_IMG_ERROR,
	} from '../../src/bmsx/machine/bus/io';
import { transformFixed16 } from '../../src/bmsx/machine/common/numeric';
	import { CPU } from '../../src/bmsx/machine/cpu/cpu';
import { DmaController } from '../../src/bmsx/machine/devices/dma/controller';
	import { ImgDecController } from '../../src/bmsx/machine/devices/imgdec/controller';
import { IrqController } from '../../src/bmsx/machine/devices/irq/controller';
import { Memory, type VramWriteSink } from '../../src/bmsx/machine/memory/memory';
import { GEO_SCRATCH_BASE, RAM_BASE, RAM_END, SYSTEM_ROM_BASE, VRAM_PRIMARY_SLOT_BASE, VRAM_STAGING_BASE } from '../../src/bmsx/machine/memory/map';
	import type { VDP } from '../../src/bmsx/machine/devices/vdp/vdp';
import { cyclesUntilBudgetUnits } from '../../src/bmsx/machine/scheduler/budget';
import { DeviceScheduler } from '../../src/bmsx/machine/scheduler/device';
import { HeadlessGPUBackend } from '../../src/bmsx/render/headless/backend';
import { TextureManager } from '../../src/bmsx/render/texture_manager';

const TRANSFORM_CASES: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
	[0, 0, 0, 0, 0, 0],
	[65536, 0, 0, 131072, 0, 131072],
	[0x7fffffff, 0, 0, 0x7fffffff, 0, 0x7fffffff],
	[-0x80000000, 0, 0, 0x7fffffff, 0, -0x80000000],
	[0x7fffffff, -0x7fffffff, 0, 0x7fffffff, 0x7fffffff, 0],
	[0, 0, -65536, 0, 0, -65536],
	[0x40000000, 0x40000000, 0x7fffffff, 0x40000000, 0x40000000, 0x7fffffff],
];

function assertBusFault(memory: Memory, code: number, addr: number, access: number): void {
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), code);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), addr >>> 0);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS), access >>> 0);
}

function clearBusFault(memory: Memory): void {
	memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_NONE);
}

function createImageDecoderFixture(): { memory: Memory; controller: ImgDecController } {
	const memory = new Memory({ systemRom: new Uint8Array() });
	const scheduler = new DeviceScheduler(new CPU(memory));
	const irq = new IrqController(memory);
	const controller = new ImgDecController(memory, {} as DmaController, {} as VDP, irq, scheduler);
	controller.reset();
	irq.reset();
	return { memory, controller };
}

function createDmaFixture(): { memory: Memory; controller: DmaController } {
	const memory = new Memory({ systemRom: new Uint8Array() });
	const scheduler = new DeviceScheduler(new CPU(memory));
	const irq = new IrqController(memory);
	const vdp = {
		canAcceptVdpSubmit: () => true,
		acceptSubmitAttempt: () => { },
		rejectSubmitAttempt: () => { },
		beginDmaSubmit: () => { },
		endDmaSubmit: () => { },
		sealDmaTransfer: () => true,
	} as unknown as VDP;
	const controller = new DmaController(memory, irq, vdp, scheduler);
	controller.reset();
	irq.reset();
	controller.setTiming(1, 64, 64, 0);
	return { memory, controller };
}

test('core golden: memory RAM, ROM, and numeric I/O words stay observable', () => {
	const memory = new Memory({ systemRom: new Uint8Array([0x11, 0x22, 0x33, 0x44]) });
	assert.equal(memory.readU8(SYSTEM_ROM_BASE), 0x11);
	memory.writeU32(RAM_BASE, 0x12345678);
	assert.equal(memory.readU32(RAM_BASE), 0x12345678);
	memory.writeMappedU32LE(GEO_SCRATCH_BASE, 0x89abcdef);
	assert.equal(memory.readMappedU32LE(GEO_SCRATCH_BASE), 0x89abcdef);
	memory.writeMappedU16LE(GEO_SCRATCH_BASE + 4, 0xf00d);
	assert.equal(memory.readMappedU16LE(GEO_SCRATCH_BASE + 4), 0xf00d);
	memory.writeValue(IO_DMA_STATUS, 0xfeedcafe);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), 0xfeedcafe);
	assert.equal(memory.readMappedU32LE(IO_DMA_STATUS), 0xfeedcafe);
	memory.writeMappedU32LE(IO_DMA_CTRL, 0x13572468);
	assert.equal(memory.readIoU32(IO_DMA_CTRL), 0x13572468);
	assert.equal(memory.readMappedU16LE(IO_DMA_STATUS), 0);
	assertBusFault(memory, BUS_FAULT_UNALIGNED_IO, IO_DMA_STATUS, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U16);
	clearBusFault(memory);
	memory.writeMappedU32LE(IO_DMA_STATUS, 0);
	assertBusFault(memory, BUS_FAULT_READ_ONLY, IO_DMA_STATUS, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
	clearBusFault(memory);
});

test('core golden: mapped memory hot paths keep boundary faults and contained VRAM transfers explicit', () => {
	class RecordingVram implements VramWriteSink {
		public readonly reads: Array<{ addr: number; length: number }> = [];
		public readonly writes: Array<{ addr: number; bytes: number[] }> = [];

		public writeVram(addr: number, bytes: Uint8Array, srcOffset = 0, length = bytes.byteLength - srcOffset): void {
			const out: number[] = [];
			for (let index = 0; index < length; index += 1) {
				out.push(bytes[srcOffset + index]!);
			}
			this.writes.push({ addr, bytes: out });
		}

		public readVram(addr: number, out: Uint8Array): void {
			this.reads.push({ addr, length: out.byteLength });
			for (let index = 0; index < out.byteLength; index += 1) {
				out[index] = index + 1;
			}
		}
	}

	const memory = new Memory({ systemRom: new Uint8Array([0x11, 0x22, 0x33, 0x44]) });
	const vram = new RecordingVram();
	memory.setVramWriter(vram);

	assert.equal(memory.readMappedU32LE(0xffff_fffc), 0);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, 0xffff_fffc, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32);
	clearBusFault(memory);
	memory.writeMappedU32LE(0xffff_fffc, 0);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, 0xffff_fffc, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
	clearBusFault(memory);
	assert.equal(memory.readMappedU32LE(RAM_END - 3), 0);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, RAM_END - 3, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32);
	clearBusFault(memory);
	memory.writeMappedU16LE(RAM_END - 1, 0);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, RAM_END - 1, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U16);
	clearBusFault(memory);

	assert.equal(memory.readMappedU32LE(VRAM_STAGING_BASE - 1), 0);
	assertBusFault(memory, BUS_FAULT_VRAM_RANGE, VRAM_STAGING_BASE - 1, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32);
	clearBusFault(memory);
	memory.writeMappedU32LE(VRAM_STAGING_BASE - 1, 0xabcdef01);
	assertBusFault(memory, BUS_FAULT_VRAM_RANGE, VRAM_STAGING_BASE - 1, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
	clearBusFault(memory);
	assert.equal(memory.readMappedF64LE(VRAM_STAGING_BASE - 4), 0);
	assertBusFault(memory, BUS_FAULT_VRAM_RANGE, VRAM_STAGING_BASE - 4, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F64);
	clearBusFault(memory);
	memory.writeMappedF64LE(VRAM_STAGING_BASE - 4, 1);
	assertBusFault(memory, BUS_FAULT_VRAM_RANGE, VRAM_STAGING_BASE - 4, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F64);
	clearBusFault(memory);
	assert.deepEqual(vram.reads, []);
	assert.deepEqual(vram.writes, []);

	assert.equal(memory.readMappedU32LE(VRAM_STAGING_BASE), 0x04030201);
	memory.writeMappedU32LE(VRAM_STAGING_BASE, 0x78563412);
	assert.deepEqual(vram.reads, [{ addr: VRAM_STAGING_BASE, length: 4 }]);
	assert.deepEqual(vram.writes, [{ addr: VRAM_STAGING_BASE, bytes: [0x12, 0x34, 0x56, 0x78] }]);
});

test('core golden: raw memory byte paths latch bus faults instead of throwing', () => {
	const memory = new Memory({ systemRom: new Uint8Array([0x11, 0x22, 0x33, 0x44]) });
	assert.equal(memory.readU8(0xffff_ffff), 0);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, 0xffff_ffff, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
	clearBusFault(memory);
	const bytes = new Uint8Array(4);
	assert.equal(memory.readBytesInto(RAM_END - 1, bytes, bytes.byteLength), false);
	assert.deepEqual([...bytes], [0, 0, 0, 0]);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, RAM_END - 1, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
	clearBusFault(memory);
	assert.equal(memory.writeBytes(RAM_END - 1, new Uint8Array([1, 2, 3, 4])), false);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, RAM_END - 1, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
	clearBusFault(memory);
	memory.writeU32(RAM_END - 3, 0x12345678);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, RAM_END - 3, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
});

test('core golden: DMA source bus faults complete as device errors', () => {
	const { memory, controller } = createDmaFixture();
	memory.writeValue(IO_DMA_SRC, RAM_END - 1);
	memory.writeValue(IO_DMA_DST, RAM_BASE);
	memory.writeValue(IO_DMA_LEN, 4);
	memory.writeIoValue(IO_DMA_CTRL, DMA_CTRL_START);
	controller.tryStartIo();
	controller.accrueCycles(1, 1);
	controller.onService(1);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), DMA_STATUS_DONE | DMA_STATUS_ERROR);
	assert.equal(memory.readIoU32(IO_DMA_WRITTEN), 0);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_DMA_ERROR) !== 0, true);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, RAM_END - 1, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
});

test('core golden: image decoder register faults complete as device status', () => {
	for (const [dst, cap] of [[0xffff_0000, 4], [VRAM_PRIMARY_SLOT_BASE, 0]]) {
		const { memory, controller } = createImageDecoderFixture();
		memory.writeValue(IO_IMG_SRC, RAM_BASE);
		memory.writeValue(IO_IMG_LEN, 0);
		memory.writeValue(IO_IMG_DST, dst);
		memory.writeValue(IO_IMG_CAP, cap);
		memory.writeIoValue(IO_IMG_CTRL, IMG_CTRL_START);
		assert.doesNotThrow(() => controller.onCtrlWrite(0));
		assert.equal(memory.readIoU32(IO_IMG_STATUS), IMG_STATUS_DONE | IMG_STATUS_ERROR);
		assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_IMG_ERROR) !== 0, true);
	}

	const { memory, controller } = createImageDecoderFixture();
	memory.writeValue(IO_IMG_SRC, RAM_END - 1);
	memory.writeValue(IO_IMG_LEN, 4);
	memory.writeValue(IO_IMG_DST, VRAM_PRIMARY_SLOT_BASE);
	memory.writeValue(IO_IMG_CAP, 4);
	memory.writeIoValue(IO_IMG_CTRL, IMG_CTRL_START);
	controller.onCtrlWrite(0);
	assert.equal(memory.readIoU32(IO_IMG_STATUS), IMG_STATUS_DONE | IMG_STATUS_ERROR);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_IMG_ERROR) !== 0, true);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, RAM_END - 1, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
});

test('core golden: queued image decoder faults reject and drain', async () => {
	const { controller } = createImageDecoderFixture();
	let invalidDstRejected = false;
	let invalidCapRejected = false;
	const invalidDst = controller.decodeToVram({ bytes: new Uint8Array(), dst: 0xffff_0000, cap: 4 }).then(
		() => assert.fail('queued invalid destination should reject'),
		() => {
			invalidDstRejected = true;
		},
	);
	const invalidCap = controller.decodeToVram({ bytes: new Uint8Array(), dst: VRAM_PRIMARY_SLOT_BASE, cap: 0 }).then(
		() => assert.fail('queued invalid capacity should reject'),
		() => {
			invalidCapRejected = true;
		},
	);
	controller.onService(0);
	await invalidDst;
	await Promise.resolve();
	assert.equal(invalidDstRejected, true);
	assert.equal(invalidCapRejected, false);
	controller.onService(0);
	await invalidCap;
	assert.equal(invalidCapRejected, true);
});

test('core golden: budget and fixed16 datapaths match native integer semantics', () => {
	assert.equal(cyclesUntilBudgetUnits(60, 7, 0, 1), 9);
	assert.equal(cyclesUntilBudgetUnits(60, 7, 59, 1), 1);
	for (const [m0, m1, tx, x, y, expected] of TRANSFORM_CASES) {
		assert.equal(transformFixed16(m0, m1, tx, x, y), expected);
	}
});

test('core golden: texture keys use the canonical direct string format', () => {
	const manager = new TextureManager(new HeadlessGPUBackend());
	const key = (manager as any).makeKey('atlas/main', {
		size: { x: 16, y: 8 },
		srgb: false,
		wrapS: 1,
		wrapT: 2,
		minFilter: 3,
		magFilter: 4,
	});
	assert.equal(key, 'atlas/main|size=16.000x8.000|srgb=0|wrapS=1|wrapT=2|minFilter=3|magFilter=4');
});
