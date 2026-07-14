import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	BUS_FAULT_ACCESS_READ,
	BUS_FAULT_ACCESS_U8,
	BUS_FAULT_ACCESS_U16,
	BUS_FAULT_ACCESS_U32,
	BUS_FAULT_ACCESS_WRITE,
	BUS_FAULT_NONE,
	BUS_FAULT_READ_ONLY,
	BUS_FAULT_UNALIGNED_IO,
	BUS_FAULT_UNMAPPED,
	IO_DMA_CONTROL,
	IO_DMA_STATUS,
	IO_INP_KEYS,
	IO_INP_OUTPUT_STATUS,
	IO_INP_PADS,
	IO_INP_POINTER_BUTTONS,
	IO_INP_POINTER_WHEEL,
	IO_INP_POINTER_X,
	IO_INP_POINTER_Y,
	IO_INP_STATUS,
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_BUS_FAULT_ACK,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IRQ_VBLANK,
} from '../../machine/ts/machine/bus/io';
import { transformFixed16 } from '../../machine/ts/machine/common/numeric';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { GEO_SCRATCH_BASE, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE, RAM_BASE, RAM_END, SYSTEM_ROM_BASE } from '../../machine/ts/machine/memory/map';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { VblankState } from '../../machine/ts/machine/runtime/vblank';
import { cyclesUntilBudgetUnits } from '../../machine/ts/machine/scheduler/budget';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import { TextureManager } from '../../machine/ts/render/texture_manager';

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

test('core golden: memory RAM, ROM, and numeric I/O words stay observable', () => {
	const memory = new Memory({ systemRom: new Uint8Array([0x11, 0x22, 0x33, 0x44]), cartRom: new Uint8Array(0) });
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
	memory.writeMappedU32LE(IO_DMA_CONTROL, 0x13572468);
	assert.equal(memory.readIoU32(IO_DMA_CONTROL), 0x13572468);
	assert.equal(memory.readMappedU16LE(IO_DMA_STATUS), 0);
	assertBusFault(memory, BUS_FAULT_UNALIGNED_IO, IO_DMA_STATUS, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U16);
	clearBusFault(memory);
	memory.writeMappedU32LE(IO_DMA_STATUS, 0);
	assertBusFault(memory, BUS_FAULT_READ_ONLY, IO_DMA_STATUS, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
	clearBusFault(memory);
	for (const readOnlyIcuRegister of [IO_INP_STATUS, IO_INP_KEYS, IO_INP_POINTER_BUTTONS, IO_INP_POINTER_X, IO_INP_POINTER_Y, IO_INP_POINTER_WHEEL, IO_INP_PADS, IO_INP_OUTPUT_STATUS]) {
		memory.writeMappedU32LE(readOnlyIcuRegister, 0);
		assertBusFault(memory, BUS_FAULT_READ_ONLY, readOnlyIcuRegister, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
		clearBusFault(memory);
	}
});

test('core golden: program ROM window zero-fills consistently across memory paths', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	memory.setProgramRom(new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]), 4);
	const tailBytes = new Uint8Array(4);

	assert.equal(memory.readValue(PROGRAM_ROM_BASE), 0x11223344);
	assert.equal(memory.readMappedU32LE(PROGRAM_ROM_BASE), 0x44332211);
	assert.equal(memory.readMappedU32LE(PROGRAM_ROM_BASE + 4), 0x00006655);
	assert.equal(memory.readU8(PROGRAM_ROM_BASE + PROGRAM_ROM_SIZE - 1), 0);
	memory.readBytesInto(PROGRAM_ROM_BASE + 4, tailBytes, tailBytes.byteLength);
	assert.deepEqual([...tailBytes], [0x55, 0x66, 0, 0]);
	assert.equal(memory.readMappedU32LE(PROGRAM_ROM_BASE + PROGRAM_ROM_SIZE - 4), 0);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_NONE);
});

test('core golden: raw memory byte paths latch bus faults instead of throwing', () => {
	const memory = new Memory({ systemRom: new Uint8Array([0x11, 0x22, 0x33, 0x44]), cartRom: new Uint8Array(0) });
	assert.equal(memory.readU8(0xffff_ffff), 0);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, 0xffff_ffff, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
	clearBusFault(memory);
	const bytes = new Uint8Array(4);
	memory.readBytesInto(RAM_END - 1, bytes, bytes.byteLength);
	assert.deepEqual([...bytes], [0, 0, 0, 0]);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, RAM_END - 1, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
	clearBusFault(memory);
	memory.writeBytes(RAM_END - 1, new Uint8Array([1, 2, 3, 4]));
	assertBusFault(memory, BUS_FAULT_UNMAPPED, RAM_END - 1, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
	clearBusFault(memory);
	memory.writeU32(RAM_END - 3, 0x12345678);
	assertBusFault(memory, BUS_FAULT_UNMAPPED, RAM_END - 3, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
});

test('core golden: budget and fixed16 datapaths match native integer semantics', () => {
	assert.equal(cyclesUntilBudgetUnits(60, 7, 0, 1), 9);
	assert.equal(cyclesUntilBudgetUnits(60, 7, 59, 1), 1);
	for (const [m0, m1, tx, x, y, expected] of TRANSFORM_CASES) {
		assert.equal(transformFixed16(m0, m1, tx, x, y), expected);
	}
});

test('core golden: runtime VBlank end publishes scanout at the new frame origin', () => {
	const memory = new Memory({ systemRom: new Uint8Array(), cartRom: new Uint8Array(0) });
	const scheduler = new DeviceScheduler(new CPU(memory));
	const gxScanoutCalls: Array<{ active: boolean; cyclesIntoFrame: number; cyclesPerFrame: number; totalScanlines: number }> = [];
	const inputSampleEdges: Array<{ currentTimeMs: number; nowCycles: number }> = [];
	let raisedIrq = 0;
	let gxPresentCount = 0;
	let appliedDisplayModeWord = 0;
	let appliedVerticalDisplayRangeWord = 0;
	const gpuOutput = {
		displayModeWord: 0x09,
		verticalDisplayRangeWord: 0x00044c23,
	};
	const runtime = {
		timing: {
			cpuHz: 5000,
			cycleBudgetPerFrame: 100,
			totalScanlines: 10,
			dmaWordsPerSec: 0,
			geoWorkUnitsPerSec: 0,
		},
		machine: {
			scheduler,
			inputController: {
				cancelSampleArm() { },
				onVblankEdge(currentTimeMs: number, nowCycles: number) {
					inputSampleEdges.push({ currentTimeMs, nowCycles });
				},
			},
			irqController: {
				postLoad() { },
				raise(irq: number) {
					raisedIrq = irq;
				},
			},
			gxGpu: {
				readDeviceOutput() {
					return gpuOutput;
				},
				presentReadyFrameOnVblankEdge() {
					gxPresentCount += 1;
				},
				setScanoutTiming(active: boolean, cyclesIntoFrame: number, cyclesPerFrame: number, totalScanlines: number) {
					gxScanoutCalls.push({ active, cyclesIntoFrame, cyclesPerFrame, totalScanlines });
				},
			},
			refreshDeviceTimings() { },
		},
		frameLoop: {
			currentFrameState: null,
		},
		machineElapsedMs() {
			return scheduler.currentNowCycles() * 1000 / 5000;
		},
		applyPublishedPsxGpuDisplayTiming(displayModeWord: number, verticalDisplayRangeWord: number) {
			appliedDisplayModeWord = displayModeWord;
			appliedVerticalDisplayRangeWord = verticalDisplayRangeWord;
		},
	} as unknown as Runtime;
	const vblank = new VblankState(runtime);
	vblank.setVblankCycles(20);

	scheduler.setNowCycles(80);
	vblank.handleBeginTimer();
	assert.equal(raisedIrq, IRQ_VBLANK);
	assert.equal(gxPresentCount, 1);
	assert.deepEqual(inputSampleEdges[0], { currentTimeMs: 16, nowCycles: 80 });
	assert.deepEqual(gxScanoutCalls[0], { active: true, cyclesIntoFrame: 80, cyclesPerFrame: 100, totalScanlines: 10 });

	scheduler.setNowCycles(100);
	vblank.handleEndTimer();
	assert.equal(appliedDisplayModeWord, gpuOutput.displayModeWord);
	assert.equal(appliedVerticalDisplayRangeWord, gpuOutput.verticalDisplayRangeWord);
	assert.deepEqual(gxScanoutCalls[1], { active: false, cyclesIntoFrame: 0, cyclesPerFrame: 100, totalScanlines: 10 });

	gxScanoutCalls.length = 0;
	scheduler.setNowCycles(0);
	vblank.setVblankCycles(100);
	assert.deepEqual(gxScanoutCalls[0], { active: true, cyclesIntoFrame: 0, cyclesPerFrame: 100, totalScanlines: 10 });
	scheduler.setNowCycles(100);
	vblank.handleEndTimer();
	assert.deepEqual(gxScanoutCalls[1], { active: true, cyclesIntoFrame: 0, cyclesPerFrame: 100, totalScanlines: 10 });
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
