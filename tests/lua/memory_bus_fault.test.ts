import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	BUS_FAULT_ACCESS_F32,
	BUS_FAULT_ACCESS_F64,
	BUS_FAULT_ACCESS_READ,
	BUS_FAULT_ACCESS_WRITE,
	BUS_FAULT_UNMAPPED,
	BUS_FAULT_READ_ONLY,
	BUS_FAULT_NONE,
	IO_SYS_STATUS, IO_IRQ_FLAGS, IO_DMA0_STATUS, IO_DMA1_STATUS,
	IO_IMGDEC_STATUS, IO_IMGDEC_INPUT_WORDS_RECEIVED, IO_IMGDEC_DECODED_WORD_COUNT,
	IO_GEO_STATUS, IO_INP_STATUS, IO_APU_EVENT_SEQ, IO_CART_STATUS,
	IO_SYS_SUPERVISOR_FAULT_DOMAIN, IO_INP_KEYS, IO_INP_OUTPUT_PORT,
	IO_DMA0_CONTROL, IO_IMGDEC_DATA,
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_BUS_FAULT_ACK,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IO_SLOT_COUNT,
} from '../../machine/ts/spec/bmsx/io';
import { IO_BASE, IO_WORD_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { Memory, NO_BLOCKED_MAPPED_WRITE } from '../../machine/ts/machine/memory/memory';
import { MAPPED_BUS_MASTER_DMA, MAPPED_BUS_DMA_BLOCK_END } from '../../machine/ts/machine/memory/bus_signals';

const UNMAPPED_ADDRESS = 0x06000000;

test('IO word permissions apply to CPU and DMA without changing raw register values', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	for (const dma of [false, true]) {
		for (const address of [IO_SYS_STATUS, IO_IRQ_FLAGS, IO_DMA0_STATUS, IO_DMA1_STATUS,
			IO_IMGDEC_STATUS, IO_IMGDEC_INPUT_WORDS_RECEIVED, IO_IMGDEC_DECODED_WORD_COUNT,
			IO_GEO_STATUS, IO_INP_STATUS, IO_APU_EVENT_SEQ, IO_CART_STATUS,
			IO_SYS_SUPERVISOR_FAULT_DOMAIN, IO_INP_KEYS, IO_INP_OUTPUT_PORT - IO_WORD_SIZE]) {
			memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1);
			memory.writeIoU32(address, 0x81234567);
			if (dma) memory.writeMappedDmaU32LE(address, 0xffffffff, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_BLOCK_END);
			else memory.writeMappedU32LE(address, 0xffffffff);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_READ_ONLY);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), address);
			assert.equal(memory.readIoU32(address), 0x81234567);
		}
		for (const address of [IO_DMA0_CONTROL, IO_IMGDEC_DATA, IO_INP_OUTPUT_PORT]) {
			memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1);
			if (dma) memory.writeMappedDmaU32LE(address, 0x81234567, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_BLOCK_END);
			else memory.writeMappedU32LE(address, 0x81234567);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_NONE);
			assert.equal(memory.readIoU32(address), 0x81234567);
		}
	}
});

function assertBusFault(memory: Memory, access: number): void {
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), UNMAPPED_ADDRESS);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS), access);
}

test('floating mapped transactions retain their bus width and stop after a faulting first F64 cycle', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);

	memory.readMappedF32LE(UNMAPPED_ADDRESS);
	assertBusFault(memory, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F32);
	memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1);

	memory.writeMappedF32LE(UNMAPPED_ADDRESS, 1);
	assertBusFault(memory, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F32);
	memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1);

	let faultSequence = memory.readBusFaultSequence();
	memory.readMappedF64LE(UNMAPPED_ADDRESS);
	assert.equal(memory.readBusFaultSequence(), faultSequence + 1);
	assertBusFault(memory, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F64);
	memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1);

	faultSequence = memory.readBusFaultSequence();
	memory.writeMappedF64LE(UNMAPPED_ADDRESS, 1);
	assert.equal(memory.readBusFaultSequence(), faultSequence + 1);
	assertBusFault(memory, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F64);
});

test('mapped word-burst preflight stops when a burst crosses the physical IO registerfile boundary', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const firstRamWordAfterIo = IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE;
	const lastIoWord = firstRamWordAfterIo - IO_WORD_SIZE;

	assert.equal(memory.firstBlockedMappedWordWrite(lastIoWord, 2), NO_BLOCKED_MAPPED_WRITE);
});
