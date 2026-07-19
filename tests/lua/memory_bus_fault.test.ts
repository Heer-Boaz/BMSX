import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	BUS_FAULT_ACCESS_F32,
	BUS_FAULT_ACCESS_F64,
	BUS_FAULT_ACCESS_READ,
	BUS_FAULT_ACCESS_WRITE,
	BUS_FAULT_UNMAPPED,
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_BUS_FAULT_ACK,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IO_SLOT_COUNT,
} from '../../machine/ts/machine/bus/io';
import { IO_BASE, IO_WORD_SIZE } from '../../machine/ts/machine/memory/map';
import { Memory, NO_BLOCKED_MAPPED_WRITE } from '../../machine/ts/machine/memory/memory';

const UNMAPPED_ADDRESS = 0x06000000;

function assertBusFault(memory: Memory, access: number): void {
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), UNMAPPED_ADDRESS);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS), access);
}

test('floating mapped transactions retain their bus width and stop after a faulting first F64 cycle', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });

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
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const firstRamWordAfterIo = IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE;
	const lastIoWord = firstRamWordAfterIo - IO_WORD_SIZE;

	assert.equal(memory.firstBlockedMappedWordWrite(lastIoWord, 2), NO_BLOCKED_MAPPED_WRITE);
});
