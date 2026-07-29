import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IO_GX_GTE_COMMAND,
	IO_GX_GTE_CONTROL0,
	IO_GX_GTE_CYCLES,
	IO_GX_GTE_DATA0,
	IO_GX_GTE_PLUS_BASE,
} from '../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { MAPPED_BUS_MASTER_DMA } from '../../machine/ts/machine/memory/bus_signals';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import {
	DEVICE_SERVICE_GTE,
	DeviceScheduler,
} from '../../machine/ts/machine/scheduler/device';

import {
	GX_GTE_CYCLES_AVSZ3,
	GX_GTE_CYCLES_AVSZ4,
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
	GX_GTE_CYCLES_RTPT,
	GX_GTE_CYCLES_SQR,
	GX_GTE_FLAG_COLOR_B_SAT,
	GX_GTE_FLAG_COLOR_G_SAT,
	GX_GTE_FLAG_COLOR_R_SAT,
	GX_GTE_FLAG_DIV_OVERFLOW,
	GX_GTE_FLAG_ERROR,
	GX_GTE_FLAG_IR1_SAT,
	GX_GTE_FLAG_IR2_SAT,
	GX_GTE_FLAG_MAC1_POS,
	GX_GTE_FLAG_MAC2_NEG,
	GX_GTE_FLAG_SZ_OTZ_SAT,
	GX_GTE_FN_AVSZ3,
	GX_GTE_FN_AVSZ4,
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
	GX_GTE_FN_RTPT,
	GX_GTE_FN_SQR,
	GX_GTE_PLUS_ADD_XY,
	GX_GTE_PLUS_ADD_Z,
	GX_GTE_PLUS_COMMAND,
	GX_GTE_PLUS_CYCLES,
	GX_GTE_PLUS_CYCLES_BUSY,
	GX_GTE_PLUS_CYCLES_INVALID,
	GX_GTE_PLUS_CYCLES_VMAD3,
	GX_GTE_PLUS_FLAG,
	GX_GTE_PLUS_FLAG_ERROR,
	GX_GTE_PLUS_FLAG_INVALID_COMMAND,
	GX_GTE_PLUS_FLAG_X_NEG,
	GX_GTE_PLUS_FLAG_X_POS,
	GX_GTE_PLUS_FLAG_Y_POS,
	GX_GTE_PLUS_FLAG_Y_NEG,
	GX_GTE_PLUS_FLAG_Z_NEG,
	GX_GTE_PLUS_FLAG_Z_POS,
	GX_GTE_PLUS_FN_VMAD3,
	GX_GTE_PLUS_MUL_XY,
	GX_GTE_PLUS_MUL_Z,
	GX_GTE_PLUS_RESULT_XY,
	GX_GTE_PLUS_RESULT_Z,
	GX_GTE_PLUS_SCALAR,
	GxGte,
} from '../../machine/ts/machine/devices/gx/gte';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';

const GTE_SF = 1 << 19;

function createGte(): {
	memory: Memory;
	cpu: CPU;
	gte: GxGte;
	scheduler: DeviceScheduler;
} {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const irq = new IrqController(memory);
	const executionAddressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, irq, executionAddressSpace);
	const scheduler = new DeviceScheduler(cpu);
	return { memory, cpu, gte: new GxGte(memory, cpu, scheduler), scheduler };
}

function completeGtePlus(memory: Memory, scheduler: DeviceScheduler, cycles: number): void {
	scheduler.advanceTo(scheduler.nowCycles + cycles);
	assert.equal(scheduler.hasDueTimer(), false);
	memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE);
}

function serviceScheduledGtePlus(gte: GxGte, scheduler: DeviceScheduler, cycles: number): void {
	scheduler.advanceTo(scheduler.nowCycles + cycles);
	assert.equal(scheduler.hasDueTimer(), true);
	assert.equal(scheduler.popDueTimer(), DEVICE_SERVICE_GTE);
	gte.onService();
}

function installGtePlusBurstProgram(
	cpu: CPU,
	words: readonly number[],
): void {
	const instructionCount = words.length + 3;
	const code = new Uint8Array(instructionCount * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.LOADK, 0, 0, 0, 0);
	for (let index = 0; index < words.length; index += 1) {
		writeInstruction(code, index + 1, OpCode.LOADK, index + 1, 0, index + 1, 0);
	}
	writeInstruction(code, words.length + 1, OpCode.STORE_MEM_WORDS_D, 1, 0, words.length, 0);
	writeInstruction(code, words.length + 2, OpCode.RET, 0, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: instructionCount, maxStack: words.length + 1 }],
		constants: [IO_GX_GTE_PLUS_BASE, ...words],
		functionIds: ['gte_plus_burst'],
	});
	cpu.memory.installSystemRom(image.romBytes);
	cpu.reset();
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

test('GX-GTE+ VMAD3 executes three signed Q4.12 lanes through raw MMIO words', () => {
	const { memory, gte, scheduler } = createGte();
	const commandAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE;
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(10, -20));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_Z * IO_WORD_SIZE, 0xa5a5001e);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_XY * IO_WORD_SIZE, pack16(8, 12));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_Z * IO_WORD_SIZE, 0x5a5afffc);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_SCALAR * IO_WORD_SIZE, 0xbeef0800);
	assert.equal(memory.mappedWriteReady(commandAddress), true);
	memory.writeMappedU32LE(commandAddress, 0xdeadbe01);

	assert.equal(scheduler.hasDueTimer(), false);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), 0);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_Z * IO_WORD_SIZE), 0);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_FLAG * IO_WORD_SIZE), 0);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE), 0xdeadbe01);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), (GX_GTE_PLUS_CYCLES_BUSY | GX_GTE_PLUS_CYCLES_VMAD3) >>> 0);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(100, 100));
	scheduler.advanceTo(4);
	assert.equal(scheduler.hasDueTimer(), false);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), 0);
	completeGtePlus(memory, scheduler, 1);

	assert.equal(memory.mappedWriteReady(commandAddress), true);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), pack16(14, -14));
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_Z * IO_WORD_SIZE), 28);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_FLAG * IO_WORD_SIZE), 0);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), GX_GTE_PLUS_CYCLES_VMAD3);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_Z * IO_WORD_SIZE), 0xa5a5001e);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_SCALAR * IO_WORD_SIZE), 0xbeef0800);
});

test('GX-GTE+ VMAD3 uses signed scalars, arithmetic shift and all lane saturation flags', () => {
	const { memory, gte, scheduler } = createGte();
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(10, -20));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_Z * IO_WORD_SIZE, 30);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_XY * IO_WORD_SIZE, pack16(8, 12));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_Z * IO_WORD_SIZE, -4);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_SCALAR * IO_WORD_SIZE, -0x0800);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE, GX_GTE_PLUS_FN_VMAD3);
	completeGtePlus(memory, scheduler, GX_GTE_PLUS_CYCLES_VMAD3);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), pack16(6, -26));
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_Z * IO_WORD_SIZE), 32);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_FLAG * IO_WORD_SIZE), 0);

	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(0x7fff, -0x8000));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_Z * IO_WORD_SIZE, 0x7fff);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_XY * IO_WORD_SIZE, pack16(0x7fff, -0x8000));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_Z * IO_WORD_SIZE, 0x7fff);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_SCALAR * IO_WORD_SIZE, 0x1000);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE, GX_GTE_PLUS_FN_VMAD3);
	completeGtePlus(memory, scheduler, GX_GTE_PLUS_CYCLES_VMAD3);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), pack16(0x7fff, -0x8000));
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_Z * IO_WORD_SIZE), 0x7fff);
	assert.equal(
		memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_FLAG * IO_WORD_SIZE),
		(GX_GTE_PLUS_FLAG_ERROR | GX_GTE_PLUS_FLAG_X_POS | GX_GTE_PLUS_FLAG_Y_NEG | GX_GTE_PLUS_FLAG_Z_POS) >>> 0,
	);

	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, 0);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_Z * IO_WORD_SIZE, -0x8000);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_XY * IO_WORD_SIZE, 0);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_Z * IO_WORD_SIZE, -0x8000);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE, GX_GTE_PLUS_FN_VMAD3);
	completeGtePlus(memory, scheduler, GX_GTE_PLUS_CYCLES_VMAD3);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_Z * IO_WORD_SIZE), 0x8000);
	assert.equal(
		memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_FLAG * IO_WORD_SIZE),
		(GX_GTE_PLUS_FLAG_ERROR | GX_GTE_PLUS_FLAG_Z_NEG) >>> 0,
	);

	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(-0x8000, 0x7fff));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_Z * IO_WORD_SIZE, 0);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_XY * IO_WORD_SIZE, pack16(-0x8000, 0x7fff));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_Z * IO_WORD_SIZE, 0);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE, GX_GTE_PLUS_FN_VMAD3);
	completeGtePlus(memory, scheduler, GX_GTE_PLUS_CYCLES_VMAD3);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), pack16(-0x8000, 0x7fff));
	assert.equal(
		memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_FLAG * IO_WORD_SIZE),
		(GX_GTE_PLUS_FLAG_ERROR | GX_GTE_PLUS_FLAG_X_NEG | GX_GTE_PLUS_FLAG_Y_POS) >>> 0,
	);
});

test('GX-GTE+ unknown command retains results and publishes an invalid-command latch', () => {
	const { memory, gte, scheduler } = createGte();
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(1, 2));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE, GX_GTE_PLUS_FN_VMAD3);
	completeGtePlus(memory, scheduler, GX_GTE_PLUS_CYCLES_VMAD3);
	const result = memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE);

	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE, 0xcafe0002);

	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), result);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_FLAG * IO_WORD_SIZE), 0);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), (GX_GTE_PLUS_CYCLES_BUSY | GX_GTE_PLUS_CYCLES_INVALID) >>> 0);
	completeGtePlus(memory, scheduler, GX_GTE_PLUS_CYCLES_INVALID);

	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), result);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_FLAG * IO_WORD_SIZE), (GX_GTE_PLUS_FLAG_ERROR | GX_GTE_PLUS_FLAG_INVALID_COMMAND) >>> 0);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), GX_GTE_PLUS_CYCLES_INVALID);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE), 0xcafe0002);
});

test('GX-GTE+ read-only latches ignore writes and reset cancels an in-flight command', () => {
	const { memory, gte, scheduler } = createGte();
	const resultXyAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE;
	const resultZAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_Z * IO_WORD_SIZE;
	const flagAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_FLAG * IO_WORD_SIZE;
	const cyclesAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE;
	const commandAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE;
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(1, 2));
	memory.writeMappedU32LE(commandAddress, GX_GTE_PLUS_FN_VMAD3);
	completeGtePlus(memory, scheduler, GX_GTE_PLUS_CYCLES_VMAD3);
	memory.writeMappedU32LE(resultXyAddress, 0xffffffff);
	memory.writeMappedU32LE(resultZAddress, 0xffffffff);
	memory.writeMappedU32LE(flagAddress, 0xffffffff);
	memory.writeMappedU32LE(cyclesAddress, 0xffffffff);
	assert.equal(memory.readMappedU32LE(resultXyAddress), pack16(1, 2));
	assert.equal(memory.readMappedU32LE(resultZAddress), 0);
	assert.equal(memory.readMappedU32LE(flagAddress), 0);
	assert.equal(memory.readMappedU32LE(cyclesAddress), GX_GTE_PLUS_CYCLES_VMAD3);

	memory.writeMappedU32LE(commandAddress, GX_GTE_PLUS_FN_VMAD3);
	gte.reset();
	for (let index = 0; index < 10; index += 1) {
		assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + index * IO_WORD_SIZE), 0);
	}
	assert.equal(memory.mappedWriteReady(commandAddress), true);
	assert.equal(scheduler.hasDueTimer(), false);
});

test('GX-GTE+ retains old result and FLAG latches until the retained completion tick', () => {
	const { memory, scheduler } = createGte();
	const commandAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE;
	const resultAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE;
	const flagAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_FLAG * IO_WORD_SIZE;
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(0x7fff, 3));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_XY * IO_WORD_SIZE, pack16(0x7fff, 4));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_SCALAR * IO_WORD_SIZE, 0x1000);
	memory.writeMappedU32LE(commandAddress, GX_GTE_PLUS_FN_VMAD3);
	completeGtePlus(memory, scheduler, GX_GTE_PLUS_CYCLES_VMAD3);
	assert.equal(memory.readMappedU32LE(resultAddress), pack16(0x7fff, 7));
	assert.equal(memory.readMappedU32LE(flagAddress), (GX_GTE_PLUS_FLAG_ERROR | GX_GTE_PLUS_FLAG_X_POS) >>> 0);

	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(5, 6));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_XY * IO_WORD_SIZE, pack16(0, 0));
	memory.writeMappedU32LE(commandAddress, GX_GTE_PLUS_FN_VMAD3);
	assert.equal(memory.readMappedU32LE(resultAddress), pack16(0x7fff, 7));
	assert.equal(memory.readMappedU32LE(flagAddress), (GX_GTE_PLUS_FLAG_ERROR | GX_GTE_PLUS_FLAG_X_POS) >>> 0);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), (GX_GTE_PLUS_CYCLES_BUSY | GX_GTE_PLUS_CYCLES_VMAD3) >>> 0);
	completeGtePlus(memory, scheduler, GX_GTE_PLUS_CYCLES_VMAD3);
	assert.equal(memory.readMappedU32LE(resultAddress), pack16(5, 6));
	assert.equal(memory.readMappedU32LE(flagAddress), 0);
});

test('GX-GTE+ command admission is CPU-only and cannot overwrite an active command', () => {
	const { memory, scheduler } = createGte();
	const commandAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE;
	memory.writeMappedDmaU32LE(commandAddress, 0xcafe0002, MAPPED_BUS_MASTER_DMA);
	assert.equal(memory.readMappedU32LE(commandAddress), 0);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), 0);

	memory.writeMappedU32LE(commandAddress, 0xdeadbe01);
	memory.writeMappedU32LE(commandAddress, 0xcafe0002);
	memory.writeMappedDmaU32LE(commandAddress, 0xabcd0002, MAPPED_BUS_MASTER_DMA);
	assert.equal(memory.readMappedU32LE(commandAddress), 0xdeadbe01);
	assert.equal(scheduler.hasDueTimer(), false);
	completeGtePlus(memory, scheduler, GX_GTE_PLUS_CYCLES_VMAD3);
	assert.equal(memory.readMappedU32LE(commandAddress), 0xdeadbe01);
});

test('GX-GTE+ publishes exactly on cycle five inside an active CPU slice', () => {
	const { memory, cpu, scheduler } = createGte();
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(9, -7));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE, GX_GTE_PLUS_FN_VMAD3);
	cpu.instructionBudgetRemaining = 10;
	scheduler.beginCpuSlice(10);
	cpu.instructionBudgetRemaining = 6;
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), 0);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), (GX_GTE_PLUS_CYCLES_BUSY | GX_GTE_PLUS_CYCLES_VMAD3) >>> 0);
	cpu.instructionBudgetRemaining = 5;
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), GX_GTE_PLUS_CYCLES_VMAD3);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), pack16(9, -7));
	scheduler.endCpuSlice();
	assert.equal(scheduler.hasDueTimer(), false);
});

test('GX-GTE+ CPU burst interlock is atomic across save, restore and command resume', () => {
	const first = createGte();
	const commandAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE;
	const firstAddXy = pack16(1, 2);
	first.memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, firstAddXy);
	const burstWords = [
		pack16(10, -20),
		30,
		pack16(8, 12),
		-4,
		0x0800,
		0,
		0,
		0,
		GX_GTE_PLUS_FN_VMAD3,
	];
	installGtePlusBurstProgram(first.cpu, burstWords);
	assert.equal(first.cpu.runUntilDepth(0, burstWords.length + 1), RunResult.Yielded);
	first.memory.writeMappedU32LE(commandAddress, GX_GTE_PLUS_FN_VMAD3);
	first.scheduler.beginCpuSlice(10);
	assert.equal(first.cpu.runUntilDepth(0, 10), RunResult.Halted);
	first.scheduler.endCpuSlice();
	assert.equal(first.cpu.isMemoryWriteBlocked(), true);
	const blockedCpuState = first.cpu.captureRuntimeState();
	assert.equal(blockedCpuState.memoryWriteBlockedAddress, commandAddress);
	assert.equal(blockedCpuState.yieldRequested, false);
	assert.equal(first.memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE), firstAddXy);
	assert.equal(first.scheduler.nextDeadline(), GX_GTE_PLUS_CYCLES_VMAD3);

	first.scheduler.advanceTo(2);
	const gteState = first.gte.captureState();
	const cpuState = first.cpu.captureRuntimeState();
	assert.equal(gteState.plusPendingCycles, 3);
	assert.equal(gteState.plusInterlockArmed, true);

	const restored = createGte();
	installGtePlusBurstProgram(restored.cpu, burstWords);
	restored.scheduler.setNowCycles(100);
	restored.gte.restoreState(gteState);
	restored.cpu.restoreRuntimeState(cpuState);
	assert.equal(restored.scheduler.nextDeadline(), 103);
	restored.scheduler.advanceTo(102);
	assert.equal(restored.cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(restored.cpu.isMemoryWriteBlocked(), true);
	assert.equal(restored.memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE), firstAddXy);
	serviceScheduledGtePlus(restored.gte, restored.scheduler, 1);
	assert.equal(restored.cpu.isMemoryWriteBlocked(), false);
	restored.scheduler.beginCpuSlice(100);
	assert.equal(restored.cpu.runUntilDepth(0, 100), RunResult.Halted);
	const retryCycles = 100 - restored.cpu.instructionBudgetRemaining;
	restored.scheduler.endCpuSlice();
	restored.scheduler.advanceTo(restored.scheduler.nowCycles + retryCycles);
	assert.equal(restored.cpu.isMemoryWriteBlocked(), false);
	assert.equal(restored.memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE), burstWords[0]!);
	assert.equal(restored.memory.readMappedU32LE(commandAddress), GX_GTE_PLUS_FN_VMAD3);
	assert.equal(restored.scheduler.hasDueTimer(), false);
	const resumedState = restored.gte.captureState();
	assert.equal(resumedState.plusPendingCycles, 3);
	assert.equal(resumedState.plusInterlockArmed, false);
	completeGtePlus(restored.memory, restored.scheduler, 3);
	assert.equal(restored.memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), pack16(14, -14));
	assert.equal(restored.memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_Z * IO_WORD_SIZE), 28);
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

test('GX-GTE MVMVA preserves the PSX reserved-matrix datapath quirk', () => {
	const { gte } = createGte();
	gte.writeDataRegister(0, pack16(2, 4));
	gte.writeDataRegister(1, 6);
	gte.writeDataRegister(6, packRgb(3, 0, 0, 0));
	gte.writeDataRegister(8, 5);
	gte.writeControlRegister(1, 7);
	gte.writeControlRegister(2, 11);

	assert.equal(gte.execute((3 << 17) | (3 << 13) | GX_GTE_FN_MVMVA), GX_GTE_CYCLES_MVMVA);

	assert.equal(gte.readDataRegister(9), 126);
	assert.equal(gte.readDataRegister(10), 84);
	assert.equal(gte.readDataRegister(11), 132);
	assert.equal(gte.readDataRegister(25), 126);
	assert.equal(gte.readDataRegister(26), 84);
	assert.equal(gte.readDataRegister(27), 132);
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE MVMVA preserves the PSX far-color translation bug', () => {
	const { gte } = createGte();
	gte.writeControlRegister(0, pack16(100, 2));
	gte.writeControlRegister(1, pack16(3, 200));
	gte.writeControlRegister(2, pack16(5, 7));
	gte.writeControlRegister(3, pack16(300, 11));
	gte.writeControlRegister(4, 13);
	gte.writeControlRegister(21, 1);
	gte.writeControlRegister(22, 2);
	gte.writeControlRegister(23, 3);
	gte.writeDataRegister(0, pack16(17, 19));
	gte.writeDataRegister(1, 23);

	assert.equal(gte.execute((2 << 13) | GX_GTE_FN_MVMVA), GX_GTE_CYCLES_MVMVA);

	assert.equal(gte.readDataRegister(9), 107);
	assert.equal(gte.readDataRegister(10), 256);
	assert.equal(gte.readDataRegister(11), 508);
	assert.equal(gte.readDataRegister(25), 107);
	assert.equal(gte.readDataRegister(26), 256);
	assert.equal(gte.readDataRegister(27), 508);
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

	gte.writeDataRegister(9, 0xff9c);
	gte.writeDataRegister(10, 0xff38);
	gte.writeDataRegister(11, 0xfed4);
	assert.equal(gte.execute(GTE_SF | GX_GTE_FN_INTPL), GX_GTE_CYCLES_INTPL);
	assert.equal(gte.readDataRegister(25), 0xffffff9c);
	assert.equal(gte.readDataRegister(26), 0xffffff38);
	assert.equal(gte.readDataRegister(27), 0xfffffed4);
	assert.equal(gte.readDataRegister(9), 0xffffff9c);
	assert.equal(gte.readDataRegister(10), 0xffffff38);
	assert.equal(gte.readDataRegister(11), 0xfffffed4);
	assert.equal(gte.readDataRegister(22), packRgb(0, 0, 0, 0x55));
	assert.equal(gte.readControlRegister(31), GX_GTE_FLAG_COLOR_R_SAT | GX_GTE_FLAG_COLOR_G_SAT | GX_GTE_FLAG_COLOR_B_SAT);
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

test('GX-GTE GPF consumes the raw IR0 register as a signed halfword', () => {
	const { gte } = createGte();
	gte.writeDataRegister(8, 0xffff);
	gte.writeDataRegister(9, 1);
	gte.writeDataRegister(10, 2);
	gte.writeDataRegister(11, 3);

	assert.equal(gte.execute(GX_GTE_FN_GPF), GX_GTE_CYCLES_GPF);

	assert.equal(gte.readDataRegister(25), 0xffffffff);
	assert.equal(gte.readDataRegister(26), 0xfffffffe);
	assert.equal(gte.readDataRegister(27), 0xfffffffd);
	assert.equal(gte.readDataRegister(9), 0xffffffff);
	assert.equal(gte.readDataRegister(10), 0xfffffffe);
	assert.equal(gte.readDataRegister(11), 0xfffffffd);
	assert.equal(gte.readDataRegister(22), 0);
	assert.equal(gte.readControlRegister(31), GX_GTE_FLAG_COLOR_R_SAT | GX_GTE_FLAG_COLOR_G_SAT | GX_GTE_FLAG_COLOR_B_SAT);
});

test('GX-GTE depth cue opcodes consume the raw IR0 register as a signed halfword', () => {
	const { gte } = createGte();
	gte.writeDataRegister(6, packRgb(0, 0, 0, 0x5a));
	gte.writeDataRegister(8, 0xffff);
	gte.writeControlRegister(21, 1);
	gte.writeControlRegister(22, 1);
	gte.writeControlRegister(23, 1);

	assert.equal(gte.execute(GX_GTE_FN_DPCS), GX_GTE_CYCLES_DPCS);

	assert.equal(gte.readDataRegister(25), 0xfffff000);
	assert.equal(gte.readDataRegister(26), 0xfffff000);
	assert.equal(gte.readDataRegister(27), 0xfffff000);
	assert.equal(gte.readDataRegister(9), 0xfffff000);
	assert.equal(gte.readDataRegister(10), 0xfffff000);
	assert.equal(gte.readDataRegister(11), 0xfffff000);
	assert.equal(gte.readDataRegister(22), packRgb(0, 0, 0, 0x5a));
	assert.equal(gte.readControlRegister(31), GX_GTE_FLAG_COLOR_R_SAT | GX_GTE_FLAG_COLOR_G_SAT | GX_GTE_FLAG_COLOR_B_SAT);
});

test('GX-GTE GPL wraps the 44-bit MAC datapath before sf shift and reports both overflow directions', () => {
	const { gte } = createGte();
	gte.writeDataRegister(6, packRgb(0, 0, 0, 0x5a));
	gte.writeDataRegister(8, 0x1000);
	gte.writeDataRegister(9, 0x7fff);
	gte.writeDataRegister(10, 0x8000);
	gte.writeDataRegister(11, 1);
	gte.writeDataRegister(25, 0x7fffffff);
	gte.writeDataRegister(26, 0x80000000);
	gte.writeDataRegister(27, 0);

	assert.equal(gte.execute(GTE_SF | GX_GTE_FN_GPL), GX_GTE_CYCLES_GPL);

	assert.equal(gte.readDataRegister(25), 0x80007ffe);
	assert.equal(gte.readDataRegister(26), 0x7fff8000);
	assert.equal(gte.readDataRegister(27), 1);
	assert.equal(gte.readDataRegister(9), 0xffff8000);
	assert.equal(gte.readDataRegister(10), 0x7fff);
	assert.equal(gte.readDataRegister(11), 1);
	assert.equal(gte.readDataRegister(22), packRgb(0, 0xff, 0, 0x5a));
	assert.equal(gte.readControlRegister(31), (
		GX_GTE_FLAG_ERROR
		| GX_GTE_FLAG_MAC1_POS
		| GX_GTE_FLAG_MAC2_NEG
		| GX_GTE_FLAG_IR1_SAT
		| GX_GTE_FLAG_IR2_SAT
		| GX_GTE_FLAG_COLOR_R_SAT
		| GX_GTE_FLAG_COLOR_G_SAT
	) >>> 0);
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

test('GX-GTE AVSZ4 uses ZSF4 and all four SZ FIFO words to produce OTZ', () => {
	const { gte } = createGte();
	gte.writeDataRegister(16, 50);
	gte.writeDataRegister(17, 100);
	gte.writeDataRegister(18, 200);
	gte.writeDataRegister(19, 300);
	gte.writeControlRegister(30, 0x1000);

	assert.equal(gte.execute(GX_GTE_FN_AVSZ4), GX_GTE_CYCLES_AVSZ4);

	assert.equal(gte.readDataRegister(7), 650);
	assert.equal(gte.readDataRegister(24), 0x28a000);
	assert.equal(gte.readControlRegister(31), 0);

	gte.writeDataRegister(16, 0xffff);
	gte.writeDataRegister(17, 0xffff);
	gte.writeDataRegister(18, 0xffff);
	gte.writeDataRegister(19, 0xffff);
	gte.writeControlRegister(30, 0x1000);

	assert.equal(gte.execute(GX_GTE_FN_AVSZ4), GX_GTE_CYCLES_AVSZ4);

	assert.equal(gte.readDataRegister(7), 0xffff);
	assert.equal(gte.readDataRegister(24), 0x3fffc000);
	assert.equal(gte.readControlRegister(31), (GX_GTE_FLAG_ERROR | GX_GTE_FLAG_SZ_OTZ_SAT) >>> 0);
});

test('GX-GTE RTPS narrows MAC result to the PSX 32-bit register datapath before IR saturation', () => {
	const { gte } = createGte();
	gte.writeControlRegister(5, 0x7fffffff);
	gte.writeControlRegister(26, 256);

	gte.execute(GX_GTE_FN_RTPS);

	assert.equal(gte.readDataRegister(9), 0xfffff000);
});

test('GX-GTE RTPS clamps IR3 from the PSX 32-bit MAC3 register value', () => {
	const { gte } = createGte();
	gte.writeControlRegister(7, 0x00080000);

	gte.execute(GX_GTE_FN_RTPS);

	assert.equal(gte.readDataRegister(27), 0x80000000);
	assert.equal(gte.readDataRegister(11), 0xffff8000);
});

test('GX-GTE raw COP2 register edges match PSX FIFO and RGB packing behavior', () => {
	const { gte } = createGte();

	gte.writeDataRegister(12, pack16(1, 2));
	gte.writeDataRegister(13, pack16(3, 4));
	gte.writeDataRegister(14, pack16(5, 6));
	gte.writeDataRegister(15, pack16(7, 8));
	assert.equal(gte.readDataRegister(12), pack16(3, 4));
	assert.equal(gte.readDataRegister(13), pack16(5, 6));
	assert.equal(gte.readDataRegister(14), pack16(7, 8));
	assert.equal(gte.readDataRegister(15), pack16(7, 8));

	gte.writeDataRegister(28, 31 | (1 << 5) | (16 << 10));
	assert.equal(gte.readDataRegister(9), 0x0f80);
	assert.equal(gte.readDataRegister(10), 0x0080);
	assert.equal(gte.readDataRegister(11), 0x0800);
	assert.equal(gte.readDataRegister(28), 31 | (1 << 5) | (16 << 10));
	assert.equal(gte.readDataRegister(29), 31 | (1 << 5) | (16 << 10));

	gte.writeDataRegister(9, 0xf000);
	gte.writeDataRegister(10, 0x2000);
	gte.writeDataRegister(11, 0x0f80);
	assert.equal(gte.readDataRegister(28), (31 << 5) | (31 << 10));
	assert.equal(gte.readDataRegister(29), (31 << 5) | (31 << 10));

	gte.writeDataRegister(30, 0x00000000);
	assert.equal(gte.readDataRegister(31), 32);
	gte.writeDataRegister(30, 0xffffffff);
	assert.equal(gte.readDataRegister(31), 32);
	gte.writeDataRegister(30, 0x00f00000);
	assert.equal(gte.readDataRegister(31), 8);
	gte.writeDataRegister(30, 0xff0fffff);
	assert.equal(gte.readDataRegister(31), 8);
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE RTPS uses H as unsigned 16-bit while exposing its PSX sign-extended readback', () => {
	const { gte } = createGte();
	setupIdentityProjection(gte);
	gte.writeControlRegister(4, 0x2000);
	gte.writeControlRegister(26, 0xffff);
	gte.writeDataRegister(0, pack16(1, 0));
	gte.writeDataRegister(1, 0x4000);

	assert.equal(gte.readControlRegister(26), 0xffffffff);
	assert.equal(gte.execute(GTE_SF | GX_GTE_FN_RTPS), GX_GTE_CYCLES_RTPS);

	assert.equal(gte.readDataRegister(14), pack16(161, 120));
	assert.equal(gte.readDataRegister(19), 0x8000);
	assert.equal((gte.readControlRegister(31) & GX_GTE_FLAG_DIV_OVERFLOW) >>> 0, 0);
});

test('GX-GTE RTPT applies DQA/DQB depth cueing only on the last transformed vertex', () => {
	const { gte } = createGte();
	setupIdentityProjection(gte);
	gte.writeControlRegister(27, 0x0080);
	gte.writeControlRegister(28, 0);
	gte.writeDataRegister(0, pack16(0, 0));
	gte.writeDataRegister(1, 256);
	gte.writeDataRegister(2, pack16(0, 0));
	gte.writeDataRegister(3, 512);
	gte.writeDataRegister(4, pack16(0, 0));
	gte.writeDataRegister(5, 1024);

	assert.equal(gte.execute(GTE_SF | GX_GTE_FN_RTPT), GX_GTE_CYCLES_RTPT);

	assert.equal(gte.readDataRegister(8), 0x0200);
	assert.equal(gte.readDataRegister(17), 256);
	assert.equal(gte.readDataRegister(18), 512);
	assert.equal(gte.readDataRegister(19), 1024);
	assert.equal(gte.readControlRegister(31), 0);
});

test('GX-GTE opcode 0 is not an RTPS alias', () => {
	const { gte } = createGte();
	setupIdentityProjection(gte);
	gte.writeDataRegister(0, pack16(1, 2));
	gte.writeDataRegister(1, 256);
	gte.writeControlRegister(31, GX_GTE_FLAG_DIV_OVERFLOW);

	assert.equal(gte.execute(0), 0);

	assert.equal(gte.readDataRegister(9), 0);
	assert.equal(gte.readDataRegister(10), 0);
	assert.equal(gte.readDataRegister(11), 0);
	assert.equal(gte.readDataRegister(14), 0);
	assert.equal(gte.readControlRegister(31), (GX_GTE_FLAG_ERROR | GX_GTE_FLAG_DIV_OVERFLOW) >>> 0);
});

test('GX-GTE unknown PSX function code is deterministic no-op hardware, not a host exception', () => {
	const { gte } = createGte();
	gte.writeControlRegister(31, GX_GTE_FLAG_DIV_OVERFLOW);

	assert.equal(gte.execute(0x02), 0);
	assert.equal(gte.readControlRegister(31), (GX_GTE_FLAG_ERROR | GX_GTE_FLAG_DIV_OVERFLOW) >>> 0);
});

test('GX-GTE save state preserves raw PSX COP2 register words', () => {
	const { memory, gte, scheduler } = createGte();
	gte.execute(GX_GTE_FN_RTPS);
	gte.writeDataRegister(30, 0x80000000);
	gte.writeControlRegister(24, 160 << 16);
	memory.writeMappedU32LE(IO_GX_GTE_COMMAND, GX_GTE_FN_DPCS);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(11, -13));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_XY * IO_WORD_SIZE, pack16(4, 6));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_SCALAR * IO_WORD_SIZE, 0x0800);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE, GX_GTE_PLUS_FN_VMAD3);
	completeGtePlus(memory, scheduler, GX_GTE_PLUS_CYCLES_VMAD3);
	gte.writeControlRegister(31, GX_GTE_FLAG_DIV_OVERFLOW);
	const state = gte.captureState();

	gte.reset();
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), 0);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), 0);
	gte.restoreState(state);

	assert.equal(gte.readDataRegister(30), 0x80000000);
	assert.equal(gte.readDataRegister(31), 1);
	assert.equal(gte.readControlRegister(24), 160 << 16);
	assert.equal(gte.readControlRegister(31), (GX_GTE_FLAG_ERROR | GX_GTE_FLAG_DIV_OVERFLOW) >>> 0);
	assert.equal(gte.captureState().mac3, state.mac3);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_CYCLES), GX_GTE_CYCLES_DPCS);
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), pack16(13, -10));
	assert.equal(memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), GX_GTE_PLUS_CYCLES_VMAD3);
});

test('GX-GTE+ save state restores an in-flight command at the remaining-cycle edge', () => {
	const { memory, gte, scheduler } = createGte();
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, pack16(10, -20));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_Z * IO_WORD_SIZE, 30);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_XY * IO_WORD_SIZE, pack16(8, 12));
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_MUL_Z * IO_WORD_SIZE, -4);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_SCALAR * IO_WORD_SIZE, -0x0800);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE, GX_GTE_PLUS_FN_VMAD3);
	memory.writeMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_ADD_XY * IO_WORD_SIZE, 0);
	scheduler.advanceTo(2);
	const state = gte.captureState();
	assert.equal(state.plusPendingCycles, 3);
	assert.equal(state.plusInterlockArmed, false);

	const restored = createGte();
	restored.scheduler.setNowCycles(100);
	restored.gte.restoreState(state);
	const commandAddress = IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_COMMAND * IO_WORD_SIZE;
	assert.equal(restored.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	assert.equal(restored.memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), 0);
	assert.equal(restored.memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), (GX_GTE_PLUS_CYCLES_BUSY | GX_GTE_PLUS_CYCLES_VMAD3) >>> 0);
	restored.scheduler.advanceTo(102);
	assert.equal(restored.scheduler.hasDueTimer(), false);
	assert.equal(restored.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
	restored.scheduler.advanceTo(103);
	assert.equal(restored.scheduler.hasDueTimer(), false);
	assert.equal(restored.memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_CYCLES * IO_WORD_SIZE), GX_GTE_PLUS_CYCLES_VMAD3);
	assert.equal(restored.memory.mappedWriteReady(commandAddress), true);
	assert.equal(restored.memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_XY * IO_WORD_SIZE), pack16(6, -26));
	assert.equal(restored.memory.readMappedU32LE(IO_GX_GTE_PLUS_BASE + GX_GTE_PLUS_RESULT_Z * IO_WORD_SIZE), 32);
	const completedState = restored.gte.captureState();
	assert.equal(completedState.plusPendingCycles, 0);
	assert.equal(completedState.plusInterlockArmed, false);
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

test('GX-GTE RTPS saturates a 0x20000 UNR divide result without divide overflow FLAG', () => {
	const { gte } = createGte();
	setupIdentityProjection(gte);
	gte.writeControlRegister(26, 0xfe3f);
	gte.writeDataRegister(0, 0);
	gte.writeDataRegister(1, 0x7f20);

	gte.execute(GTE_SF | GX_GTE_FN_RTPS);

	assert.equal(gte.readDataRegister(19), 0x7f20);
	assert.equal(gte.readDataRegister(14), pack16(160, 120));
	assert.equal(gte.readControlRegister(31), 0);
});
