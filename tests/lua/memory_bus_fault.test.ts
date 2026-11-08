import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	BUS_FAULT_ACCESS_F32,
	BUS_FAULT_ACCESS_F64,
	BUS_FAULT_ACCESS_READ,
	BUS_FAULT_ACCESS_WRITE,
	BUS_FAULT_ACCESS_WORD,
	BUS_FAULT_UNMAPPED,
	BUS_FAULT_READ_ONLY,
	BUS_FAULT_NONE,
	IO_SYS_STATUS, IO_IRQ_FLAGS, IO_DMA0_STATUS, IO_DMA1_STATUS,
	IO_IMGDEC_STATUS, IO_IMGDEC_INPUT_WORDS_RECEIVED, IO_IMGDEC_DECODED_WORD_COUNT,
	IO_GEO_STATUS, IO_INP_STATUS, IO_APU_EVENT_SEQ, IO_CART_STATUS,
	IO_SYS_SUPERVISOR_FAULT_DOMAIN, IO_INP_KEYS, IO_INP_OUTPUT_PORT,
	IO_DMA0_CONTROL, IO_IMGDEC_DATA, IO_GX_GPU_GP0,
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_BUS_FAULT_ACK,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IO_SLOT_COUNT,
} from '../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE, IO_BASE, IO_WORD_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { Memory, NO_BLOCKED_MAPPED_WRITE } from '../../machine/ts/machine/memory/memory';
import { MAPPED_BUS_MASTER_DMA, MAPPED_BUS_DMA_BLOCK_END, mappedBusSignalsForCartridgeSlot, type MappedBusSignals } from '../../machine/ts/machine/memory/bus_signals';

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

class DmaBusTrace {
	readonly calls: Array<readonly [number, number, number, number]> = [];
	reads = 0;
	readiness = 0;
	constructor(readonly memory: Memory) {}
	static read(trace: DmaBusTrace, address: number, signals: MappedBusSignals): number {
		const word = 0x81234560 + trace.reads++;
		trace.calls.push([0, address, word, signals]);
		if (trace.reads === 2) trace.memory.mapIoWrite(IO_GX_GPU_GP0, trace, DmaBusTrace.writeRebound);
		return word;
	}
	static ready(trace: DmaBusTrace, address: number, signals: MappedBusSignals): boolean {
		const ready = ++trace.readiness % 3 !== 0;
		trace.calls.push([1, address, ready ? 1 : 0, signals]);
		return ready;
	}
	static write(trace: DmaBusTrace, address: number, word: number, signals: MappedBusSignals): void {
		trace.calls.push([2, address, word, signals]);
	}
	static writeRebound(trace: DmaBusTrace, address: number, word: number, signals: MappedBusSignals): void {
		trace.calls.push([3, address, word, signals]);
	}
}

test('DMA blocks retain scalar bus order, per-word readiness, faults and live handlers', () => {
	const source = DYNAMIC_RAM_BASE + 0x100, destination = DYNAMIC_RAM_BASE + 0x200;
	for (const [readStart, writeStart, readStep, writeStep] of [
		[IO_IMGDEC_DATA, IO_GX_GPU_GP0, 0, 0], [source, IO_GX_GPU_GP0, 4, 0],
		[IO_IMGDEC_DATA, destination, 0, 4], [source, destination, 4, 4],
		[source, source + 4, 4, 4], [IO_IMGDEC_DATA, IO_SYS_STATUS, 0, 0],
		[IO_IMGDEC_DATA + 1, IO_GX_GPU_GP0, 0, 0], [UNMAPPED_ADDRESS, IO_GX_GPU_GP0, 0, 0],
		[0xfffffffc, destination, 4, 4], [IO_IMGDEC_DATA, IO_GX_GPU_GP0, 4, 4],
		[IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE - IO_WORD_SIZE, destination, 4, 4],
	]) for (const count of [0, 1, 5, 16]) {
		const scalar = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
		const block = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
		const scalarTrace = new DmaBusTrace(scalar), blockTrace = new DmaBusTrace(block);
		for (const trace of [scalarTrace, blockTrace]) {
			for (let i = 0; i < 32; ++i) trace.memory.writeMappedU32LE(source + 4 * i, 0xf1234500 + i);
			trace.memory.mapIoRead(IO_IMGDEC_DATA, trace, DmaBusTrace.read);
			trace.memory.mapIoWrite(IO_GX_GPU_GP0, trace, DmaBusTrace.write);
			trace.memory.mapIoWriteReady(IO_GX_GPU_GP0, DmaBusTrace.ready);
			trace.memory.writeIoU32(IO_SYS_STATUS, 0x89abcdef);
		}
		const readSignals = MAPPED_BUS_MASTER_DMA | mappedBusSignalsForCartridgeSlot(0);
		const writeSignals = MAPPED_BUS_MASTER_DMA | mappedBusSignalsForCartridgeSlot(1);
		let read = readStart, write = writeStart;
		for (let i = 0; i < count; ++i) {
			const end = i + 1 === count ? MAPPED_BUS_DMA_BLOCK_END : 0;
			const word = scalar.readMappedDmaU32LE(read, readSignals | end);
			scalar.writeMappedDmaU32LE(write, word, writeSignals | end);
			read = (read + readStep) >>> 0; write = (write + writeStep) >>> 0;
		}
		block.transferDmaBlock(readStart, writeStart, count, readStep, writeStep, readSignals, writeSignals);
		assert.deepEqual(blockTrace.calls, scalarTrace.calls);
		assert.equal(blockTrace.reads, scalarTrace.reads);
		assert.equal(blockTrace.readiness, scalarTrace.readiness);
		assert.equal(block.readBusFaultSequence(), scalar.readBusFaultSequence());
		for (const address of [IO_SYS_BUS_FAULT_CODE, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_ACCESS, IO_SYS_STATUS]) {
			assert.equal(block.readIoU32(address), scalar.readIoU32(address));
		}
		for (let i = 0; i < 32; ++i) {
			assert.equal(block.readMappedU32LE(source + 4 * i), scalar.readMappedU32LE(source + 4 * i));
			assert.equal(block.readMappedU32LE(destination + 4 * i), scalar.readMappedU32LE(destination + 4 * i));
		}
	}
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	memory.writeMappedWord(IO_SYS_STATUS, 0xffffffff);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS), BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_WORD);
});
