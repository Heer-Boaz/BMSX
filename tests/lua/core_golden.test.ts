import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IO_DMA_STATUS } from '../../src/bmsx/machine/bus/io';
import { transformFixed16 } from '../../src/bmsx/machine/common/numeric';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { RAM_BASE, SYSTEM_ROM_BASE } from '../../src/bmsx/machine/memory/map';
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
	memory.writeValue(IO_DMA_STATUS, 0xfeedcafe);
	assert.equal(memory.readIoU32(IO_DMA_STATUS), 0xfeedcafe);
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
