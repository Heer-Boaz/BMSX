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
	GX_GTE_CYCLES_CC,
	GX_GTE_CYCLES_CDP,
	GX_GTE_CYCLES_DCPL,
	GX_GTE_CYCLES_DPCS,
	GX_GTE_CYCLES_DPCT,
	GX_GTE_CYCLES_GPF,
	GX_GTE_CYCLES_GPL,
	GX_GTE_CYCLES_INTPL,
	GX_GTE_CYCLES_MVMVA,
	GX_GTE_CYCLES_NCCS,
	GX_GTE_CYCLES_NCCT,
	GX_GTE_CYCLES_NCDS,
	GX_GTE_CYCLES_NCDT,
	GX_GTE_CYCLES_NCLIP,
	GX_GTE_CYCLES_NCS,
	GX_GTE_CYCLES_NCT,
	GX_GTE_CYCLES_OP,
	GX_GTE_CYCLES_RTPS,
	GX_GTE_CYCLES_SQR,
	GX_GTE_FLAG_COLOR_R_SAT,
	GX_GTE_FLAG_DIV_OVERFLOW,
	GX_GTE_FLAG_ERROR,
	GX_GTE_FN_AVSZ3,
	GX_GTE_FN_CC,
	GX_GTE_FN_CDP,
	GX_GTE_FN_DCPL,
	GX_GTE_FN_DPCS,
	GX_GTE_FN_DPCT,
	GX_GTE_FN_GPF,
	GX_GTE_FN_GPL,
	GX_GTE_FN_INTPL,
	GX_GTE_FN_MVMVA,
	GX_GTE_FN_NCCS,
	GX_GTE_FN_NCCT,
	GX_GTE_FN_NCDS,
	GX_GTE_FN_NCDT,
	GX_GTE_FN_NCLIP,
	GX_GTE_FN_NCS,
	GX_GTE_FN_NCT,
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

function packRgb(r: number, g: number, b: number, code: number): number {
	return (r | (g << 8) | (b << 16) | (code << 24)) >>> 0;
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

function setupIdentityLighting(gte: GxGte): void {
	gte.writeControlRegister(8, pack16(0x1000, 0));
	gte.writeControlRegister(9, pack16(0, 0));
	gte.writeControlRegister(10, pack16(0x1000, 0));
	gte.writeControlRegister(11, pack16(0, 0));
	gte.writeControlRegister(12, 0x1000);
	gte.writeControlRegister(13, 0);
	gte.writeControlRegister(14, 0);
	gte.writeControlRegister(15, 0);
	gte.writeControlRegister(16, pack16(0x1000, 0));
	gte.writeControlRegister(17, pack16(0, 0));
	gte.writeControlRegister(18, pack16(0x1000, 0));
	gte.writeControlRegister(19, pack16(0, 0));
	gte.writeControlRegister(20, 0x1000);
}

function setupUnitLighting(gte: GxGte): void {
	gte.writeControlRegister(8, pack16(1, 0));
	gte.writeControlRegister(9, pack16(0, 0));
	gte.writeControlRegister(10, pack16(1, 0));
	gte.writeControlRegister(11, pack16(0, 0));
	gte.writeControlRegister(12, 1);
	gte.writeControlRegister(13, 0);
	gte.writeControlRegister(14, 0);
	gte.writeControlRegister(15, 0);
	gte.writeControlRegister(16, pack16(1, 0));
	gte.writeControlRegister(17, pack16(0, 0));
	gte.writeControlRegister(18, pack16(1, 0));
	gte.writeControlRegister(19, pack16(0, 0));
	gte.writeControlRegister(20, 1);
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

test('GX-GTE MVMVA uses vector registers as sources before writing IR1..IR3', () => {
	const { gte } = createGte();
	gte.writeControlRegister(0, pack16(1, 2));
	gte.writeControlRegister(1, pack16(3, 4));
	gte.writeControlRegister(2, pack16(5, 6));
	gte.writeControlRegister(3, pack16(7, 8));
	gte.writeControlRegister(4, pack16(9, 0));
	gte.writeDataRegister(9, 1);
	gte.writeDataRegister(10, 2);
	gte.writeDataRegister(11, 3);

	assert.equal(gte.execute((3 << 15) | GX_GTE_FN_MVMVA), GX_GTE_CYCLES_MVMVA);
	assert.equal(gte.readDataRegister(9), 14);
	assert.equal(gte.readDataRegister(10), 32);
	assert.equal(gte.readDataRegister(11), 50);
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

test('GX-GTE DPCS depth-cues RGBC through the PSX color FIFO', () => {
	const { gte } = createGte();
	gte.writeDataRegister(6, packRgb(10, 20, 30, 0x44));

	assert.equal(gte.execute(GTE_SF | GX_GTE_FN_DPCS), GX_GTE_CYCLES_DPCS);

	assert.equal(gte.readDataRegister(9), 160);
	assert.equal(gte.readDataRegister(10), 320);
	assert.equal(gte.readDataRegister(11), 480);
	assert.equal(gte.readDataRegister(25), 160);
	assert.equal(gte.readDataRegister(26), 320);
	assert.equal(gte.readDataRegister(27), 480);
	assert.equal(gte.readDataRegister(22), packRgb(10, 20, 30, 0x44));
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE INTPL depth-cues the IR vector and pushes RGB from MAC', () => {
	const { gte } = createGte();
	gte.writeDataRegister(6, packRgb(0, 0, 0, 0x55));
	gte.writeDataRegister(9, 100);
	gte.writeDataRegister(10, 200);
	gte.writeDataRegister(11, 300);

	assert.equal(gte.execute(GTE_SF | GX_GTE_FN_INTPL), GX_GTE_CYCLES_INTPL);

	assert.equal(gte.readDataRegister(9), 100);
	assert.equal(gte.readDataRegister(10), 200);
	assert.equal(gte.readDataRegister(11), 300);
	assert.equal(gte.readDataRegister(22), packRgb(6, 12, 18, 0x55));
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE DCPL multiplies RGBC by IR before depth cueing', () => {
	const { gte } = createGte();
	gte.writeDataRegister(6, packRgb(2, 3, 4, 0x66));
	gte.writeDataRegister(9, 10);
	gte.writeDataRegister(10, 20);
	gte.writeDataRegister(11, 30);

	assert.equal(gte.execute(GX_GTE_FN_DCPL), GX_GTE_CYCLES_DCPL);

	assert.equal(gte.readDataRegister(9), 320);
	assert.equal(gte.readDataRegister(10), 960);
	assert.equal(gte.readDataRegister(11), 1920);
	assert.equal(gte.readDataRegister(22), packRgb(20, 60, 120, 0x66));
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE DPCT consumes RGB0/RGB1/RGB2 through the PSX color FIFO', () => {
	const { gte } = createGte();
	gte.writeDataRegister(6, packRgb(0, 0, 0, 0xaa));
	gte.writeDataRegister(20, packRgb(1, 2, 3, 0x10));
	gte.writeDataRegister(21, packRgb(4, 5, 6, 0x20));
	gte.writeDataRegister(22, packRgb(7, 8, 9, 0x30));

	assert.equal(gte.execute(GTE_SF | GX_GTE_FN_DPCT), GX_GTE_CYCLES_DPCT);

	assert.equal(gte.readDataRegister(20), packRgb(1, 2, 3, 0xaa));
	assert.equal(gte.readDataRegister(21), packRgb(4, 5, 6, 0xaa));
	assert.equal(gte.readDataRegister(22), packRgb(7, 8, 9, 0xaa));
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE NCS and NCT use the PSX light and color matrix pipeline', () => {
	const { gte } = createGte();
	setupIdentityLighting(gte);
	gte.writeDataRegister(6, packRgb(0, 0, 0, 0x31));
	gte.writeDataRegister(0, pack16(256, 512));
	gte.writeDataRegister(1, 768);

	assert.equal(gte.execute(GTE_SF | GX_GTE_FN_NCS), GX_GTE_CYCLES_NCS);

	assert.equal(gte.readDataRegister(9), 256);
	assert.equal(gte.readDataRegister(10), 512);
	assert.equal(gte.readDataRegister(11), 768);
	assert.equal(gte.readDataRegister(22), packRgb(16, 32, 48, 0x31));
	assert.equal(gte.readControlRegister(31), 0);

	const next = createGte().gte;
	setupIdentityLighting(next);
	next.writeDataRegister(6, packRgb(0, 0, 0, 0x32));
	next.writeDataRegister(0, pack16(160, 320));
	next.writeDataRegister(1, 480);
	next.writeDataRegister(2, pack16(320, 480));
	next.writeDataRegister(3, 640);
	next.writeDataRegister(4, pack16(480, 640));
	next.writeDataRegister(5, 800);

	assert.equal(next.execute(GTE_SF | GX_GTE_FN_NCT), GX_GTE_CYCLES_NCT);

	assert.equal(next.readDataRegister(20), packRgb(10, 20, 30, 0x32));
	assert.equal(next.readDataRegister(21), packRgb(20, 30, 40, 0x32));
	assert.equal(next.readDataRegister(22), packRgb(30, 40, 50, 0x32));
	assert.equal(next.readControlRegister(31), 0);
});

test('GX-GTE NCCS and CC apply RGBC after the PSX color matrix', () => {
	const { gte } = createGte();
	setupUnitLighting(gte);
	gte.writeDataRegister(6, packRgb(2, 3, 4, 0x71));
	gte.writeDataRegister(0, pack16(10, 20));
	gte.writeDataRegister(1, 30);

	assert.equal(gte.execute(GX_GTE_FN_NCCS), GX_GTE_CYCLES_NCCS);

	assert.equal(gte.readDataRegister(9), 320);
	assert.equal(gte.readDataRegister(10), 960);
	assert.equal(gte.readDataRegister(11), 1920);
	assert.equal(gte.readDataRegister(22), packRgb(20, 60, 120, 0x71));
	assert.equal(gte.readControlRegister(31), 0);

	const next = createGte().gte;
	setupUnitLighting(next);
	next.writeDataRegister(6, packRgb(2, 3, 4, 0x72));
	next.writeDataRegister(9, 10);
	next.writeDataRegister(10, 20);
	next.writeDataRegister(11, 30);

	assert.equal(next.execute(GX_GTE_FN_CC), GX_GTE_CYCLES_CC);

	assert.equal(next.readDataRegister(9), 320);
	assert.equal(next.readDataRegister(10), 960);
	assert.equal(next.readDataRegister(11), 1920);
	assert.equal(next.readDataRegister(22), packRgb(20, 60, 120, 0x72));
	assert.equal(next.readControlRegister(31), 0);

	const shuffled = createGte().gte;
	setupUnitLighting(shuffled);
	shuffled.writeControlRegister(16, pack16(0, 1));
	shuffled.writeControlRegister(17, pack16(0, 0));
	shuffled.writeControlRegister(18, pack16(0, 1));
	shuffled.writeControlRegister(19, pack16(1, 0));
	shuffled.writeControlRegister(20, 0);
	shuffled.writeDataRegister(6, packRgb(1, 1, 1, 0x79));
	shuffled.writeDataRegister(9, 10);
	shuffled.writeDataRegister(10, 20);
	shuffled.writeDataRegister(11, 30);

	assert.equal(shuffled.execute(GX_GTE_FN_CC), GX_GTE_CYCLES_CC);

	assert.equal(shuffled.readDataRegister(9), 320);
	assert.equal(shuffled.readDataRegister(10), 480);
	assert.equal(shuffled.readDataRegister(11), 160);
	assert.equal(shuffled.readDataRegister(22), packRgb(20, 30, 10, 0x79));
	assert.equal(shuffled.readControlRegister(31), 0);
});

test('GX-GTE NCDS and CDP depth-cue RGBC after the PSX color matrix', () => {
	const { gte } = createGte();
	setupUnitLighting(gte);
	gte.writeDataRegister(6, packRgb(2, 3, 4, 0x73));
	gte.writeDataRegister(0, pack16(10, 20));
	gte.writeDataRegister(1, 30);

	assert.equal(gte.execute(GX_GTE_FN_NCDS), GX_GTE_CYCLES_NCDS);

	assert.equal(gte.readDataRegister(9), 320);
	assert.equal(gte.readDataRegister(10), 960);
	assert.equal(gte.readDataRegister(11), 1920);
	assert.equal(gte.readDataRegister(22), packRgb(20, 60, 120, 0x73));
	assert.equal(gte.readControlRegister(31), 0);

	const next = createGte().gte;
	setupUnitLighting(next);
	next.writeDataRegister(6, packRgb(2, 3, 4, 0x74));
	next.writeDataRegister(9, 10);
	next.writeDataRegister(10, 20);
	next.writeDataRegister(11, 30);

	assert.equal(next.execute(GX_GTE_FN_CDP), GX_GTE_CYCLES_CDP);

	assert.equal(next.readDataRegister(9), 320);
	assert.equal(next.readDataRegister(10), 960);
	assert.equal(next.readDataRegister(11), 1920);
	assert.equal(next.readDataRegister(22), packRgb(20, 60, 120, 0x74));
	assert.equal(next.readControlRegister(31), 0);
});

test('GX-GTE NCDT and NCCT process all three PSX normal/vector slots through RGB FIFO', () => {
	const { gte } = createGte();
	setupUnitLighting(gte);
	gte.writeDataRegister(6, packRgb(1, 1, 1, 0x75));
	gte.writeDataRegister(0, pack16(1, 2));
	gte.writeDataRegister(1, 3);
	gte.writeDataRegister(2, pack16(4, 5));
	gte.writeDataRegister(3, 6);
	gte.writeDataRegister(4, pack16(7, 8));
	gte.writeDataRegister(5, 9);

	assert.equal(gte.execute(GX_GTE_FN_NCDT), GX_GTE_CYCLES_NCDT);

	assert.equal(gte.readDataRegister(20), packRgb(1, 2, 3, 0x75));
	assert.equal(gte.readDataRegister(21), packRgb(4, 5, 6, 0x75));
	assert.equal(gte.readDataRegister(22), packRgb(7, 8, 9, 0x75));
	assert.equal(gte.readControlRegister(31), 0);

	const next = createGte().gte;
	setupUnitLighting(next);
	next.writeDataRegister(6, packRgb(1, 1, 1, 0x76));
	next.writeDataRegister(0, pack16(1, 2));
	next.writeDataRegister(1, 3);
	next.writeDataRegister(2, pack16(4, 5));
	next.writeDataRegister(3, 6);
	next.writeDataRegister(4, pack16(7, 8));
	next.writeDataRegister(5, 9);

	assert.equal(next.execute(GX_GTE_FN_NCCT), GX_GTE_CYCLES_NCCT);

	assert.equal(next.readDataRegister(20), packRgb(1, 2, 3, 0x76));
	assert.equal(next.readDataRegister(21), packRgb(4, 5, 6, 0x76));
	assert.equal(next.readDataRegister(22), packRgb(7, 8, 9, 0x76));
	assert.equal(next.readControlRegister(31), 0);
});

test('GX-GTE GPF and GPL use PSX MAC/IR color datapaths', () => {
	const { gte } = createGte();
	gte.writeDataRegister(6, packRgb(0, 0, 0, 0x77));
	gte.writeDataRegister(8, 16);
	gte.writeDataRegister(9, 32);
	gte.writeDataRegister(10, 64);
	gte.writeDataRegister(11, 96);

	assert.equal(gte.execute(GX_GTE_FN_GPF), GX_GTE_CYCLES_GPF);
	assert.equal(gte.readDataRegister(9), 512);
	assert.equal(gte.readDataRegister(10), 1024);
	assert.equal(gte.readDataRegister(11), 1536);
	assert.equal(gte.readDataRegister(22), packRgb(32, 64, 96, 0x77));

	gte.writeDataRegister(25, 100);
	gte.writeDataRegister(26, 200);
	gte.writeDataRegister(27, 300);
	gte.writeDataRegister(9, 2);
	gte.writeDataRegister(10, 3);
	gte.writeDataRegister(11, 4);

	assert.equal(gte.execute(GX_GTE_FN_GPL), GX_GTE_CYCLES_GPL);
	assert.equal(gte.readDataRegister(9), 132);
	assert.equal(gte.readDataRegister(10), 248);
	assert.equal(gte.readDataRegister(11), 364);
	assert.equal(gte.readDataRegister(22), packRgb(8, 15, 22, 0x77));
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE RGB FIFO color saturation flags do not set the PSX error summary bit', () => {
	const { gte } = createGte();
	gte.writeDataRegister(6, packRgb(0, 0, 0, 0x12));
	gte.writeDataRegister(8, 0x1000);
	gte.writeDataRegister(9, 2);
	gte.writeDataRegister(10, 0);
	gte.writeDataRegister(11, 0);

	assert.equal(gte.execute(GX_GTE_FN_GPF), GX_GTE_CYCLES_GPF);

	assert.equal(gte.readDataRegister(22), packRgb(255, 0, 0, 0x12));
	assert.equal(gte.readControlRegister(31), GX_GTE_FLAG_COLOR_R_SAT);
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
