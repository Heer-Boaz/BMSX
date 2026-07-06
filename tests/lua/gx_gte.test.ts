import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IO_GX_GTE_COMMAND,
	IO_GX_GTE_CONTROL0,
	IO_GX_GTE_CYCLES,
	IO_GX_GTE_DATA0,
} from '../../machine/ts/machine/bus/io';
import { IO_WORD_SIZE } from '../../machine/ts/machine/memory/map';
import { Memory } from '../../machine/ts/machine/memory/memory';

import {
	GX_GTE_CYCLES_AVSZ3,
	GX_GTE_CYCLES_MVMVA,
	GX_GTE_CYCLES_NCLIP,
	GX_GTE_CYCLES_OP,
	GX_GTE_CYCLES_RTPS,
	GX_GTE_CYCLES_SQR,
	GX_GTE_FLAG_DIV_OVERFLOW,
	GX_GTE_FLAG_ERROR,
	GX_GTE_FN_AVSZ3,
	GX_GTE_FN_MVMVA,
	GX_GTE_FN_NCLIP,
	GX_GTE_FN_OP,
	GX_GTE_FN_RTPS,
	GX_GTE_FN_SQR,
	GxGte,
} from '../../machine/ts/machine/devices/gx/gte';

const GTE_SF = 1 << 19;

function createGte(): { memory: Memory; gte: GxGte } {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	return { memory, gte: new GxGte(memory) };
}

function pack16(low: number, high: number): number {
	return ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0;
}

function setupIdentityProjection(gte: GxGte): void {
	gte.writeControlRegister(0, pack16(0x1000, 0));
	gte.writeControlRegister(1, pack16(0, 0));
	gte.writeControlRegister(2, pack16(0x1000, 0));
	gte.writeControlRegister(3, pack16(0, 0));
	gte.writeControlRegister(4, 0x1000);
	gte.writeControlRegister(24, 160 << 16);
	gte.writeControlRegister(25, 120 << 16);
	gte.writeControlRegister(26, 256);
}

test('GX-GTE RTPS follows PSX register pipeline for an identity projection', () => {
	const { gte } = createGte();
	setupIdentityProjection(gte);
	gte.writeDataRegister(0, pack16(1, 2));
	gte.writeDataRegister(1, 256);

	assert.equal(gte.execute(GTE_SF | GX_GTE_FN_RTPS), GX_GTE_CYCLES_RTPS);

	assert.equal(gte.readDataRegister(9), 1);
	assert.equal(gte.readDataRegister(10), 2);
	assert.equal(gte.readDataRegister(11), 256);
	assert.equal(gte.readDataRegister(19), 256);
	assert.equal(gte.readDataRegister(14), pack16(161, 122));
	assert.equal(gte.readControlRegister(31), 0);
});


test('GX-GTE MMIO exposes PSX COP2 data/control registers and command execution', () => {
	const { memory } = createGte();
	memory.writeMappedU32LE(IO_GX_GTE_CONTROL0 + 0 * IO_WORD_SIZE, pack16(0x1000, 0));
	memory.writeMappedU32LE(IO_GX_GTE_CONTROL0 + 1 * IO_WORD_SIZE, pack16(0, 0));
	memory.writeMappedU32LE(IO_GX_GTE_CONTROL0 + 2 * IO_WORD_SIZE, pack16(0x1000, 0));
	memory.writeMappedU32LE(IO_GX_GTE_CONTROL0 + 3 * IO_WORD_SIZE, pack16(0, 0));
	memory.writeMappedU32LE(IO_GX_GTE_CONTROL0 + 4 * IO_WORD_SIZE, 0x1000);
	memory.writeMappedU32LE(IO_GX_GTE_CONTROL0 + 24 * IO_WORD_SIZE, 160 << 16);
	memory.writeMappedU32LE(IO_GX_GTE_CONTROL0 + 25 * IO_WORD_SIZE, 120 << 16);
	memory.writeMappedU32LE(IO_GX_GTE_CONTROL0 + 26 * IO_WORD_SIZE, 256);
	memory.writeMappedU32LE(IO_GX_GTE_DATA0 + 0 * IO_WORD_SIZE, pack16(1, 2));
	memory.writeMappedU32LE(IO_GX_GTE_DATA0 + 1 * IO_WORD_SIZE, 256);

	memory.writeMappedU32LE(IO_GX_GTE_COMMAND, GTE_SF | GX_GTE_FN_RTPS);

	assert.equal(memory.readMappedU32LE(IO_GX_GTE_CYCLES), GX_GTE_CYCLES_RTPS);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_DATA0 + 9 * IO_WORD_SIZE), 1);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_DATA0 + 10 * IO_WORD_SIZE), 2);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_DATA0 + 11 * IO_WORD_SIZE), 256);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_DATA0 + 14 * IO_WORD_SIZE), pack16(161, 122));
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_CONTROL0 + 31 * IO_WORD_SIZE), 0);
});

test('GX-GTE NCLIP writes the PSX screen-space signed area into MAC0', () => {
	const { gte } = createGte();
	gte.writeDataRegister(12, pack16(0, 0));
	gte.writeDataRegister(13, pack16(10, 0));
	gte.writeDataRegister(14, pack16(0, 10));

	assert.equal(gte.execute(GX_GTE_FN_NCLIP), GX_GTE_CYCLES_NCLIP);

	assert.equal(gte.readDataRegister(24), 100);
	assert.equal(gte.readControlRegister(31), 0);
});


test('GX-GTE OP follows the PSX outer-product datapath', () => {
	const { gte } = createGte();
	gte.writeControlRegister(0, pack16(2, 0));
	gte.writeControlRegister(2, pack16(3, 0));
	gte.writeControlRegister(4, 4);
	gte.writeDataRegister(9, 5);
	gte.writeDataRegister(10, 7);
	gte.writeDataRegister(11, 11);

	assert.equal(gte.execute(GX_GTE_FN_OP), GX_GTE_CYCLES_OP);

	assert.equal(gte.readDataRegister(9), 5);
	assert.equal(gte.readDataRegister(10), 0xfffffffe);
	assert.equal(gte.readDataRegister(11), 0xffffffff);
	assert.equal(gte.readDataRegister(25), 5);
	assert.equal(gte.readDataRegister(26), 0xfffffffe);
	assert.equal(gte.readDataRegister(27), 0xffffffff);
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE MVMVA decodes PSX matrix/vector/control-vector opcode fields', () => {
	const { gte } = createGte();
	gte.writeControlRegister(0, pack16(0x1000, 0));
	gte.writeControlRegister(1, pack16(0, 0));
	gte.writeControlRegister(2, pack16(0x1000, 0));
	gte.writeControlRegister(3, pack16(0, 0));
	gte.writeControlRegister(4, 0x1000);
	gte.writeControlRegister(5, 10);
	gte.writeControlRegister(6, 20);
	gte.writeControlRegister(7, 30);
	gte.writeDataRegister(0, pack16(1, 2));
	gte.writeDataRegister(1, 3);

	assert.equal(gte.execute(GTE_SF | (3 << 13) | GX_GTE_FN_MVMVA), GX_GTE_CYCLES_MVMVA);
	assert.equal(gte.readDataRegister(9), 1);
	assert.equal(gte.readDataRegister(10), 2);
	assert.equal(gte.readDataRegister(11), 3);

	assert.equal(gte.execute(GTE_SF | GX_GTE_FN_MVMVA), GX_GTE_CYCLES_MVMVA);
	assert.equal(gte.readDataRegister(9), 11);
	assert.equal(gte.readDataRegister(10), 22);
	assert.equal(gte.readDataRegister(11), 33);
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE SQR squares PSX IR registers with SF/LM behavior', () => {
	const { gte } = createGte();
	gte.writeDataRegister(9, 3);
	gte.writeDataRegister(10, 0xfffc);
	gte.writeDataRegister(11, 5);

	assert.equal(gte.execute(GX_GTE_FN_SQR), GX_GTE_CYCLES_SQR);

	assert.equal(gte.readDataRegister(9), 9);
	assert.equal(gte.readDataRegister(10), 16);
	assert.equal(gte.readDataRegister(11), 25);
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE AVSZ3 uses ZSF3 and SZ FIFO words to produce OTZ', () => {
	const { gte } = createGte();
	gte.writeDataRegister(17, 100);
	gte.writeDataRegister(18, 200);
	gte.writeDataRegister(19, 300);
	gte.writeControlRegister(29, 0x1000);

	assert.equal(gte.execute(GX_GTE_FN_AVSZ3), GX_GTE_CYCLES_AVSZ3);

	assert.equal(gte.readDataRegister(7), 600);
	assert.equal(gte.readDataRegister(24), 0x258000);
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE RTPS narrows MAC result to the PSX 32-bit register datapath before IR saturation', () => {
	const { gte } = createGte();
	gte.writeControlRegister(5, 0x7fffffff);
	gte.writeControlRegister(26, 256);

	gte.execute(GX_GTE_FN_RTPS);

	assert.equal(gte.readDataRegister(9), 0xfffff000);
});

test('GX-GTE unknown PSX function code is deterministic no-op hardware, not a host exception', () => {
	const { gte } = createGte();

	assert.equal(gte.execute(0x02), 0);
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE save state preserves raw PSX COP2 register words', () => {
	const { gte } = createGte();
	gte.execute(GX_GTE_FN_RTPS);
	gte.writeDataRegister(30, 0x80000000);
	gte.writeControlRegister(24, 160 << 16);
	gte.writeControlRegister(31, GX_GTE_FLAG_DIV_OVERFLOW);
	const state = gte.captureState();

	gte.reset();
	gte.restoreState(state);

	assert.equal(gte.readDataRegister(30), 0x80000000);
	assert.equal(gte.readDataRegister(31), 1);
	assert.equal(gte.readControlRegister(24), 160 << 16);
	assert.equal(gte.readControlRegister(31), (GX_GTE_FLAG_ERROR | GX_GTE_FLAG_DIV_OVERFLOW) >>> 0);
	assert.equal(gte.captureState().mac3, state.mac3);
});

test('GX-GTE RTPS exposes PSX divide overflow as FLAG bits instead of falling back', () => {
	const { gte } = createGte();
	setupIdentityProjection(gte);
	gte.writeDataRegister(0, pack16(1, 1));
	gte.writeDataRegister(1, 1);

	gte.execute(GTE_SF | GX_GTE_FN_RTPS);

	assert.equal(gte.readDataRegister(19), 1);
	assert.equal((gte.readControlRegister(31) & (GX_GTE_FLAG_ERROR | GX_GTE_FLAG_DIV_OVERFLOW)) >>> 0, (GX_GTE_FLAG_ERROR | GX_GTE_FLAG_DIV_OVERFLOW) >>> 0);
});
