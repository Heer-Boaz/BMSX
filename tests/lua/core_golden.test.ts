import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IO_DMA_CTRL, IO_DMA_STATUS } from '../../src/bmsx/machine/bus/io';
import { transformFixed16 } from '../../src/bmsx/machine/common/numeric';
import { Memory, type VramWriteSink } from '../../src/bmsx/machine/memory/memory';
import { GEO_SCRATCH_BASE, RAM_BASE, RAM_END, SYSTEM_ROM_BASE, VRAM_STAGING_BASE } from '../../src/bmsx/machine/memory/map';
import { cyclesUntilBudgetUnits } from '../../src/bmsx/machine/scheduler/budget';
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
	assert.throws(() => memory.readMappedU16LE(IO_DMA_STATUS), /I\/O read fault/);
});

test('core golden: mapped memory hot paths keep boundary faults and contained VRAM transfers explicit', () => {
	class RecordingVram implements VramWriteSink {
		public readonly reads: Array<{ addr: number; length: number }> = [];
		public readonly writes: Array<{ addr: number; bytes: number[] }> = [];

		public writeVram(addr: number, bytes: Uint8Array): void {
			this.writes.push({ addr, bytes: [...bytes] });
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

	assert.throws(() => memory.readMappedU32LE(0xffff_fffc), /Bus fault/);
	assert.throws(() => memory.writeMappedU32LE(0xffff_fffc, 0), /Bus fault/);
	assert.throws(() => memory.readMappedU32LE(RAM_END - 3), /Bus fault/);
	assert.throws(() => memory.writeMappedU16LE(RAM_END - 1, 0), /Bus fault/);

	assert.throws(() => memory.readMappedU32LE(VRAM_STAGING_BASE - 1), /Bus fault/);
	assert.throws(() => memory.writeMappedU32LE(VRAM_STAGING_BASE - 1, 0xabcdef01), /Bus fault/);
	assert.deepEqual(vram.reads, []);
	assert.deepEqual(vram.writes, []);

	assert.equal(memory.readMappedU32LE(VRAM_STAGING_BASE), 0x04030201);
	memory.writeMappedU32LE(VRAM_STAGING_BASE, 0x78563412);
	assert.deepEqual(vram.reads, [{ addr: VRAM_STAGING_BASE, length: 4 }]);
	assert.deepEqual(vram.writes, [{ addr: VRAM_STAGING_BASE, bytes: [0x12, 0x34, 0x56, 0x78] }]);
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
