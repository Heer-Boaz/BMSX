import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	BUS_FAULT_ACCESS_U8,
	BUS_FAULT_ACCESS_U16,
	BUS_FAULT_ACCESS_F32,
	BUS_FAULT_ACCESS_F64,
	BUS_FAULT_ACCESS_U32,
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
import { CART_MMIO_BASE, CART_RAM_BASE, CART_ROM_BASE, DYNAMIC_RAM_BASE, IO_BASE, IO_WORD_SIZE, RAM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { Memory, NO_BLOCKED_MAPPED_WRITE, type MemoryByteView } from '../../machine/ts/machine/memory/memory';
import { MAPPED_PAGE_BYTE_SIZE, type MappedPageBinding } from '../../machine/ts/machine/memory/mapped_page';
import { MAPPED_BUS_INSTRUCTION_FETCH, MAPPED_BUS_MASTER_CPU, MAPPED_BUS_MASTER_DMA, MAPPED_BUS_DMA_BLOCK_END, MAPPED_BUS_DMA_MEMORY, mappedBusSignalsForCartridgeSlot, type MappedBusSignals } from '../../machine/ts/machine/memory/bus_signals';
import { readLE32 } from '../../machine/ts/common/endian';

const UNMAPPED_ADDRESS = 0x06000000;

test('raw word accounting follows the selected decoder region, including underlying IO RAM', () => {
	const slots = cartridgeSlots(new Uint8Array(16).fill(0x51));
	slots[0]!.ramByteCount = 16;
	slots[0]!.mailboxPresent = true;
	const memory = new Memory({ systemRom: new Uint8Array(16).fill(0x42), cartridgeSlots: slots }, PSX_MACHINE_SPEC.ramBytes);
	const counters = { ramWords: 0, systemRomWords: 0, cartridgeWords: 0, otherWords: 0 };
	let ioReads = 0, ioWrites = 0;
	memory.mapIoRead(IO_GX_GPU_GP0, memory, () => { ioReads++; return 0; });
	memory.mapIoWrite(IO_GX_GPU_GP0, memory, () => { ioWrites++; });
	assert.equal(memory.readU32(SYSTEM_ROM_BASE + 1, counters), 0x42424242);
	memory.countRawWriteU32(SYSTEM_ROM_BASE, counters);
	memory.writeU32(SYSTEM_ROM_BASE, 0xffffffff);
	memory.countRawWriteU32(DYNAMIC_RAM_BASE + 1, counters);
	memory.writeU32(DYNAMIC_RAM_BASE + 1, 0x87654321);
	assert.equal(memory.readU32(DYNAMIC_RAM_BASE + 1, counters), 0x87654321);
	memory.countRawWriteU32(IO_GX_GPU_GP0, counters);
	memory.writeU32(IO_GX_GPU_GP0, 0x12345678);
	assert.equal(memory.readU32(IO_GX_GPU_GP0, counters), 0x12345678);
	assert.equal(ioReads + ioWrites, 0, 'raw accesses bypass the mapped IO overlay');
	assert.equal(memory.readU32(CART_ROM_BASE + 1, counters), 0x51515151);
	memory.countRawWriteU32(CART_RAM_BASE + 1, counters);
	memory.writeU32(CART_RAM_BASE + 1, 0x89abcdef);
	assert.equal(memory.readU32(CART_RAM_BASE + 1, counters), 0x89abcdef);
	memory.countRawWriteU32(CART_MMIO_BASE, counters);
	memory.writeU32(CART_MMIO_BASE, 7);
	memory.readU32(CART_MMIO_BASE, counters);
	memory.readU32(UNMAPPED_ADDRESS, counters);
	memory.countRawWriteU32(UNMAPPED_ADDRESS, counters);
	memory.writeU32(UNMAPPED_ADDRESS, 0);
	assert.deepEqual(counters, { ramWords: 4, systemRomWords: 2, cartridgeWords: 5, otherWords: 2 });
	counters.ramWords = 0xffffffff;
	memory.readU32(DYNAMIC_RAM_BASE, counters);
	assert.equal(counters.ramWords, 0, 'counter words wrap identically to the native register representation');
});

test('mapped read views admit physical backing without reading IO or unbacked tails', () => {
	const system = new Uint8Array(67), rom0 = new Uint8Array(67).fill(0x31), rom1 = new Uint8Array(67).fill(0x72);
	const slots = cartridgeSlots(rom0, rom1);
	slots[0]!.ramByteCount = 67; slots[1]!.ramByteCount = 67;
	const memory = new Memory({ systemRom: system, cartridgeSlots: slots }, PSX_MACHINE_SPEC.ramBytes);
	const view: MemoryByteView = { bytes: system, byteOffset: 0, byteLength: 0 };
	assert.equal(memory.bindMappedReadView(SYSTEM_ROM_BASE + 35, 32, MAPPED_BUS_MASTER_CPU, view), true);
	assert.equal(view.bytes, system); assert.equal(view.byteOffset, 35); assert.equal(view.byteLength, 32);
	memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 3, 0x12345678);
	assert.equal(memory.bindMappedReadView(DYNAMIC_RAM_BASE + 3, 32, MAPPED_BUS_MASTER_CPU, view), true);
	assert.equal(readLE32(view.bytes, view.byteOffset), 0x12345678);
	memory.writeMappedU32LE(DYNAMIC_RAM_BASE + 3, 0x87654321);
	assert.equal(readLE32(view.bytes, view.byteOffset), 0x87654321, 'RAM views consume live backing, not a captured copy');
	for (const slot of [0, 1]) {
		const signals = MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_BLOCK_END | mappedBusSignalsForCartridgeSlot(slot);
		assert.equal(memory.bindMappedReadView(CART_ROM_BASE + 35, 32, signals, view), true);
		assert.equal(view.bytes[view.byteOffset], slot === 0 ? 0x31 : 0x72);
		memory.cartridgeController.writeU32(CART_RAM_BASE + 3, slot + 11, signals);
		assert.equal(memory.bindMappedReadView(CART_RAM_BASE + 3, 32, signals, view), true);
		assert.equal(readLE32(view.bytes, view.byteOffset), slot + 11);
	}
	assert.equal(memory.bindMappedReadView(CART_ROM_BASE, 32, MAPPED_BUS_MASTER_CPU, view), true);
	assert.equal(view.bytes[view.byteOffset], 0x31);
	let ioReads = 0;
	memory.mapIoRead(IO_GX_GPU_GP0, memory, () => { ioReads++; return 0; });
	const ioEnd = IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE;
	for (const [address, length] of [[IO_BASE - 4, 8], [IO_GX_GPU_GP0, 4], [ioEnd - 4, 8],
		[RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 4, 8], [SYSTEM_ROM_BASE + 36, 32],
		[CART_ROM_BASE + 36, 32], [CART_RAM_BASE + 36, 32], [CART_MMIO_BASE, 4], [UNMAPPED_ADDRESS, 4], [0xfffffff0, 32]]) {
		assert.equal(memory.bindMappedReadView(address, length, MAPPED_BUS_MASTER_CPU, view), false);
	}
	assert.equal(ioReads, 0); assert.equal(memory.readBusFaultSequence(), 0);
	for (const address of [SYSTEM_ROM_BASE, DYNAMIC_RAM_BASE, CART_ROM_BASE, CART_RAM_BASE])
		assert.equal(memory.bindMappedReadView(address, 0, MAPPED_BUS_MASTER_CPU, view), false);
	const empty = new Memory({ systemRom: system, cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	assert.equal(empty.bindMappedReadView(CART_ROM_BASE, 32, MAPPED_BUS_MASTER_CPU, view), false);
});

test('IO word permissions apply to CPU and DMA without changing raw register values', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	for (const dma of [false, true]) {
		for (const address of [IO_SYS_STATUS, IO_IRQ_FLAGS, IO_DMA0_STATUS, IO_DMA1_STATUS,
			IO_IMGDEC_STATUS, IO_IMGDEC_INPUT_WORDS_RECEIVED, IO_IMGDEC_DECODED_WORD_COUNT,
			IO_GEO_STATUS, IO_INP_STATUS, IO_APU_EVENT_SEQ, IO_CART_STATUS,
			IO_SYS_SUPERVISOR_FAULT_DOMAIN, IO_INP_KEYS, IO_INP_OUTPUT_PORT - IO_WORD_SIZE]) {
			memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1);
			memory.writeIoU32(address, 0x81234567);
			if (dma) memory.writeMappedBusU32LE(address, 0xffffffff, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_BLOCK_END);
			else memory.writeMappedU32LE(address, 0xffffffff);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_READ_ONLY);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), address);
			assert.equal(memory.readIoU32(address), 0x81234567);
		}
		for (const address of [IO_DMA0_CONTROL, IO_IMGDEC_DATA, IO_INP_OUTPUT_PORT]) {
			memory.writeMappedU32LE(IO_SYS_BUS_FAULT_ACK, 1);
			if (dma) memory.writeMappedBusU32LE(address, 0x81234567, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_BLOCK_END);
			else memory.writeMappedU32LE(address, 0x81234567);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_NONE);
			assert.equal(memory.readIoU32(address), 0x81234567);
		}
	}
});

function assertBusFault(memory: Memory, access: number, address = UNMAPPED_ADDRESS): void {
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), address);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS), access);
}

test('the live public RAM aperture excludes private records from CPU, fetch and direct views', () => {
	const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const end = DYNAMIC_RAM_BASE + 2 * MAPPED_PAGE_BYTE_SIZE;
	memory.setRamBusEnd(end);
	memory.writeRamRecordWord(end - 4, 0x12345678);
	assert.equal(memory.readMappedU8(end - 1), 0x12);
	assert.equal(memory.readMappedU16LE(end - 2), 0x1234);
	assert.equal(memory.readMappedU32LE(end - 4), 0x12345678);
	assert.equal(memory.readMappedBusU32LE(end - 4, MAPPED_BUS_INSTRUCTION_FETCH), 0x12345678,
		'public DATA/BSS bytes remain executable');
	memory.writeMappedU8(end - 1, 0x91); memory.writeMappedU16LE(end - 2, 0x8765);
	assert.equal(memory.readRamRecordWord(end - 4), 0x87655678);
	const view: MemoryByteView = { bytes: memory.ramData(), byteOffset: 0, byteLength: 0 };
	const binding: MappedPageBinding = { key: 0, cacheable: false, readBytes: null, readByteOffset: 0, writeWatches: null, writeWatchIndex: 0 };
	for (const signals of [MAPPED_BUS_MASTER_CPU, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY, MAPPED_BUS_INSTRUCTION_FETCH]) {
		assert.equal(memory.bindMappedReadView(end - 4, 4, signals, view), true);
		assert.equal(memory.bindMappedReadView(end - 4, 5, signals, view), false);
		memory.bindMappedPage(end - MAPPED_PAGE_BYTE_SIZE, signals, binding);
		assert.notEqual(binding.readBytes, null);
		memory.bindMappedPage(end, signals, binding);
		assert.equal(binding.readBytes, null);
		assert.equal(memory.bindMappedReadView(end, 4, signals, view), false);
	}
	for (const address of [end, RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 0x4000, RAM_BASE + PSX_MACHINE_SPEC.ramBytes - 4]) {
		memory.writeRamRecordWord(address, 0x89abcdef);
		for (const [width, read, write] of [
			[BUS_FAULT_ACCESS_U8, () => memory.readMappedU8(address), () => memory.writeMappedU8(address, 0)],
			[BUS_FAULT_ACCESS_U16, () => memory.readMappedU16LE(address), () => memory.writeMappedU16LE(address, 0)],
			[BUS_FAULT_ACCESS_U32, () => memory.readMappedU32LE(address), () => memory.writeMappedU32LE(address, 0)],
			[BUS_FAULT_ACCESS_WORD, () => memory.readMappedWord(address), () => memory.writeMappedWord(address, 0)],
			[BUS_FAULT_ACCESS_F32, () => memory.readMappedF32LE(address), () => memory.writeMappedF32LE(address, 0)],
			[BUS_FAULT_ACCESS_F64, () => memory.readMappedF64LE(address), () => memory.writeMappedF64LE(address, 0)],
		] as const) {
			memory.clearBusFault(); const sequence = memory.readBusFaultSequence();
			assert.equal(read(), 0); assertBusFault(memory, BUS_FAULT_ACCESS_READ | width, address);
			assert.equal(memory.readBusFaultSequence(), sequence + 1);
			memory.clearBusFault(); write(); assertBusFault(memory, BUS_FAULT_ACCESS_WRITE | width, address);
			assert.equal(memory.readRamRecordWord(address), 0x89abcdef, 'the bus cannot modify CPU-private bytes');
		}
		memory.clearBusFault();
		assert.equal(memory.readMappedBusU32LE(address, MAPPED_BUS_INSTRUCTION_FETCH), 0);
		assertBusFault(memory, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32, address);
	}
	memory.clearBusFault();
	memory.writeMappedU32LE(end - 3, 0); assertBusFault(memory, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32, end - 3);
	assert.equal(memory.readRamRecordWord(end - 4), 0x87655678, 'a crossing U32 commits no partial bytes');
	memory.clearBusFault();
	memory.writeMappedF64LE(end - 4, 1); assertBusFault(memory, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F64, end);
	assert.equal(memory.readRamRecordWord(end - 4), 0, 'the admitted first F64 cycle remains committed');
	assert.equal(memory.readRamRecordWord(end), 0x89abcdef, 'the second F64 cycle cannot enter the private range');
	memory.setRamBusEnd(end + MAPPED_PAGE_BYTE_SIZE); memory.clearBusFault();
	assert.equal(memory.readMappedU32LE(end), 0x89abcdef, 'moving the live end exposes newly assigned static RAM');
	memory.setRamBusEnd(end); memory.clearBusFault();
	assert.equal(memory.readMappedU32LE(end), 0); assertBusFault(memory, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32, end);
	memory.writeRamRecordWord(end, 0x76543210);
	assert.equal(memory.readRamRecordWord(end), 0x76543210, 'the physical record port is independent of the public bus end');
});

test('DMA spans obey the public RAM aperture on both source and destination', () => {
	const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const end = DYNAMIC_RAM_BASE + 2 * MAPPED_PAGE_BYTE_SIZE, publicWords = DYNAMIC_RAM_BASE + 0x80;
	const signals = MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY;
	memory.setRamBusEnd(end);
	memory.writeRamRecordWord(end - 4, 0x12345678); memory.writeRamRecordWord(end, 0x89abcdef);
	memory.transferDmaBlock(end - 4, publicWords, 2, 4, 4, signals, signals);
	assert.equal(memory.readRamRecordWord(publicWords), 0x12345678);
	assert.equal(memory.readRamRecordWord(publicWords + 4), 0, 'a private source supplies the fault bus value, not its payload');
	assertBusFault(memory, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32, end);
	memory.clearBusFault(); memory.writeRamRecordWord(publicWords + 4, 0x76543210);
	memory.transferDmaBlock(publicWords, end - 4, 2, 4, 4, signals, signals);
	assert.equal(memory.readRamRecordWord(end - 4), 0x12345678);
	assert.equal(memory.readRamRecordWord(end), 0x89abcdef, 'a private DMA destination does not receive the second word');
	assertBusFault(memory, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32, end);
	memory.clearBusFault();
	memory.setRamBusEnd(end + MAPPED_PAGE_BYTE_SIZE);
	memory.transferDmaBlock(publicWords, end - 4, 2, 4, 4, signals, signals);
	assert.equal(memory.readRamRecordWord(end), 0x76543210);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_NONE);
});

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

test('DMA memory words inside the IO aperture fault before handlers, including unaligned addresses', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const trace = new DmaBusTrace(memory);
	memory.mapIoRead(IO_IMGDEC_DATA, trace, DmaBusTrace.read);
	memory.mapIoWrite(IO_GX_GPU_GP0, trace, DmaBusTrace.write);
	memory.mapIoWriteReady(IO_GX_GPU_GP0, DmaBusTrace.ready);
	const end = IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE;
	for (const address of [IO_BASE,
		IO_IMGDEC_DATA, IO_GX_GPU_GP0, IO_SYS_STATUS, IO_GX_GPU_GP0 + 1, end - 4]) {
		for (const write of [false, true]) {
			memory.clearBusFault();
			const signals = MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY | MAPPED_BUS_DMA_BLOCK_END;
			if (write) memory.writeMappedBusU32LE(address, 0x81234567, signals);
			else assert.equal(memory.readMappedBusU32LE(address, signals), 0);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ADDR), address);
			assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_ACCESS),
				(write ? BUS_FAULT_ACCESS_WRITE : BUS_FAULT_ACCESS_READ) | BUS_FAULT_ACCESS_U32);
		}
	}
	assert.deepEqual(trace.calls, [], 'memory-selected IO must not call a device handler or readiness gate');
	// A word only partly in the aperture follows the existing ordinary memory
	// decode, rather than becoming a new whole-word IO fault.
	const cpu = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	for (const address of [IO_BASE - 3, IO_BASE - 2, IO_BASE - 1, end - 3, end - 2, end - 1]) {
		for (const write of [false, true]) {
			memory.clearBusFault(); cpu.clearBusFault();
			if (write) {
				memory.writeMappedBusU32LE(address, 0x81234567, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY);
				cpu.writeMappedU32LE(address, 0x81234567);
			} else assert.equal(memory.readMappedBusU32LE(address, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY), cpu.readMappedU32LE(address));
			for (const fault of [IO_SYS_BUS_FAULT_CODE, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_ACCESS])
				assert.equal(memory.readIoU32(fault), cpu.readIoU32(fault));
		}
	}
});

test('DMA blocks retain scalar bus order, per-word readiness, faults and live handlers', () => {
	const source = DYNAMIC_RAM_BASE + 0x100, destination = DYNAMIC_RAM_BASE + 0x200;
	for (const [readStart, writeStart, readStep, writeStep] of [
		[IO_IMGDEC_DATA, IO_GX_GPU_GP0, 0, 0], [source, IO_GX_GPU_GP0, 4, 0],
		[IO_IMGDEC_DATA, destination, 0, 4], [source, destination, 4, 4],
		[source, source, 4, 4], [source, source + 1, 4, 4], [source, source + 2, 4, 4],
		[source, source + 3, 4, 4], [source, source + 4, 4, 4], [source, source + 5, 4, 4],
		[source + 1, source, 4, 4], [source + 4, source, 4, 4], [IO_IMGDEC_DATA, IO_SYS_STATUS, 0, 0],
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
			const word = scalar.readMappedBusU32LE(read, readSignals | end);
			scalar.writeMappedBusU32LE(write, word, writeSignals | end);
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

test('DMA memory spans retain ordered words across ROM, sockets, overlaps and physical tails', () => {
	const system = Uint8Array.from({ length: 67 }, (_, i) => (i * 13 + 5) & 0xff);
	const rom0 = Uint8Array.from({ length: 67 }, (_, i) => (i * 7 + 3) & 0xff);
	const rom1 = Uint8Array.from({ length: 67 }, (_, i) => (i * 11 + 9) & 0xff);
	const base = DYNAMIC_RAM_BASE;
	for (const [source, destination, slot] of [
		[base + 32, base + 64, 0], [base + 32, base + 33, 0],
		[base + 32, base + 34, 0], [base + 32, base + 35, 0],
		[base + 32, base + 36, 0], [base + 32, base + 37, 0],
		[base + 33, base + 32, 0], [base + 36, base + 32, 0],
		[SYSTEM_ROM_BASE + 3, base + 64, 0], [SYSTEM_ROM_BASE + 59, base + 64, 0],
		[CART_ROM_BASE + 3, base + 64, 0], [CART_ROM_BASE + 3, base + 64, 1],
		[CART_RAM_BASE + 3, base + 64, 0], [CART_RAM_BASE + 3, base + 64, 1],
		[CART_RAM_BASE + 59, base + 64, 1], [UNMAPPED_ADDRESS, base + 125, 0],
		[base + 32, base + 125, 0],
	] as const) for (const count of [0, 1, 5, 16]) {
		const scalarSlots = cartridgeSlots(rom0, rom1), blockSlots = cartridgeSlots(rom0, rom1);
		for (const slots of [scalarSlots, blockSlots]) { slots[0]!.ramByteCount = 67; slots[1]!.ramByteCount = 67; }
		const scalar = new Memory({ systemRom: system, cartridgeSlots: scalarSlots }, base - RAM_BASE + 128);
		const block = new Memory({ systemRom: system, cartridgeSlots: blockSlots }, base - RAM_BASE + 128);
		for (const memory of [scalar, block]) for (const cardSlot of [0, 1]) {
			const signals = MAPPED_BUS_MASTER_DMA | mappedBusSignalsForCartridgeSlot(cardSlot);
			for (let i = 0; i < 16; ++i) memory.cartridgeController.writeU32(CART_RAM_BASE + i * 4, 0x91820000 + cardSlot * 0x100 + i, signals);
		}
		for (let i = 0; i < 128; ++i) {
			const value = (i * 17 + 1) & 0xff;
			scalar.ramData()[base - RAM_BASE + i] = value;
			block.ramData()[base - RAM_BASE + i] = value;
		}
		const readSignals = MAPPED_BUS_MASTER_DMA | mappedBusSignalsForCartridgeSlot(slot);
		const writeSignals = MAPPED_BUS_MASTER_DMA;
		for (let i = 0; i < count; ++i) {
			const end = i + 1 === count ? MAPPED_BUS_DMA_BLOCK_END : 0;
			const word = scalar.readMappedBusU32LE(source + i * 4, readSignals | end);
			scalar.writeMappedBusU32LE(destination + i * 4, word, writeSignals | end);
		}
		block.transferDmaBlock(source, destination, count, 4, 4, readSignals, writeSignals);
		assert.deepEqual(block.ramData().subarray(base - RAM_BASE), scalar.ramData().subarray(base - RAM_BASE));
		assert.equal(block.readBusFaultSequence(), scalar.readBusFaultSequence());
		for (const address of [IO_SYS_BUS_FAULT_CODE, IO_SYS_BUS_FAULT_ADDR, IO_SYS_BUS_FAULT_ACCESS]) {
			assert.equal(block.readIoU32(address), scalar.readIoU32(address));
		}
	}
});

test('CPU record words mirror and align each access without using the bus', () => {
	const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const alias = PSX_MACHINE_SPEC.ramBytes;
	const page = RAM_BASE + alias - MAPPED_PAGE_BYTE_SIZE;
	const end = RAM_BASE + alias;
	const invalidations: Array<readonly [number, number, number]> = [];
	memory.attachMappedPageInvalidator({
		invalidateMappedWords(key, first, end) { invalidations.push([key, first, end]); },
		invalidateMappedRange() {},
	});
	const binding: MappedPageBinding = { key: 0, cacheable: false, readBytes: null, readByteOffset: 0, writeWatches: null, writeWatchIndex: 0 };
	memory.bindMappedPage(page, MAPPED_BUS_MASTER_CPU, binding);
	const last = (MAPPED_PAGE_BYTE_SIZE >>> 2) - 1;
	binding.writeWatches!.armWord(binding.writeWatchIndex, last);
	let ioWrites = 0;
	memory.mapIoWrite(IO_GX_GPU_GP0, memory, () => { ++ioWrites; });
	const sequence = memory.readBusFaultSequence();
	memory.writeRamRecordWord(0xffffffff, 0x89abcdef);
	memory.writeRamRecordWord(end, 0x40302010);
	memory.writeRamRecordWord(IO_GX_GPU_GP0 + alias + 3, 0x12345678);
	assert.equal(memory.readRamRecordWord(end - 1), 0x89abcdef);
	assert.equal(memory.readRamRecordWord(RAM_BASE), 0x40302010);
	assert.equal(memory.readRamRecordWord(IO_GX_GPU_GP0), 0x12345678);
	assert.equal(memory.readMappedU32LE(end - 4), 0x89abcdef);
	assert.equal(ioWrites, 0);
	assert.equal(memory.readBusFaultSequence(), sequence);
	assert.deepEqual(invalidations, [[page, last, last + 1]]);
	memory.readMappedU32LE(end);
	assert.equal(memory.readIoU32(IO_SYS_BUS_FAULT_CODE), BUS_FAULT_UNMAPPED);
});

test('DMA memory span invalidates watched code across page boundaries', () => {
	const memory = new Memory({ systemRom: new Uint8Array(16).fill(0x5a), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const page = DYNAMIC_RAM_BASE, destination = page + MAPPED_PAGE_BYTE_SIZE - 4;
	const invalidations: Array<readonly [number, number, number]> = [];
	memory.attachMappedPageInvalidator({
		invalidateMappedWords(key, first, end) { invalidations.push([key, first, end]); },
		invalidateMappedRange() {},
	});
	const binding: MappedPageBinding = { key: 0, cacheable: false, readBytes: null, readByteOffset: 0, writeWatches: null, writeWatchIndex: 0 };
	memory.bindMappedPage(page, MAPPED_BUS_MASTER_CPU, binding);
	binding.writeWatches!.armWord(binding.writeWatchIndex, 255);
	memory.bindMappedPage(page + MAPPED_PAGE_BYTE_SIZE, MAPPED_BUS_MASTER_CPU, binding);
	binding.writeWatches!.armWord(binding.writeWatchIndex, 0);
	binding.writeWatches!.armWord(binding.writeWatchIndex, 1);
	memory.transferDmaBlock(SYSTEM_ROM_BASE, destination, 3, 4, 4, MAPPED_BUS_MASTER_DMA, MAPPED_BUS_MASTER_DMA);
	assert.deepEqual(invalidations, [[page, 255, 256], [page + MAPPED_PAGE_BYTE_SIZE, 0, 2]]);
	for (let i = 0; i < 3; ++i) assert.equal(memory.readMappedU32LE(destination + i * 4), 0x5a5a5a5a);
});


test('DMA prefix capabilities are revoked by scalar rebinding and obey read-only words', () => {
	for (let rebind = 0; rebind < 4; ++rebind) {
		const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
		const trace = { reads: 0, ready: 0, writes: 0, readSignals: [] as number[], writeSignals: [] as number[] };
		const target = rebind === 3 ? IO_SYS_STATUS : IO_GX_GPU_GP0;
		const read = (t: typeof trace, _address: number, signals: number) => { t.readSignals.push(signals); return ++t.reads; };
		const ready = (t: typeof trace) => ++t.ready % 3 !== 0;
		const write = (t: typeof trace, _address: number, _word: number, signals: number) => { ++t.writes; t.writeSignals.push(signals); };
		const prefix = () => { throw new Error('revoked/readonly prefix cannot run'); };
		memory.mapIoRead(IO_IMGDEC_DATA, trace, read); memory.mapIoWrite(target, trace, write); memory.mapIoWriteReady(target, ready);
		memory.mapIoDmaReadPrefix(IO_IMGDEC_DATA, prefix); memory.mapIoDmaWritePrefix(target, prefix);
		if (rebind === 0) memory.mapIoRead(IO_IMGDEC_DATA, trace, read);
		if (rebind === 1) memory.mapIoWrite(target, trace, write);
		if (rebind === 2) memory.mapIoWriteReady(target, ready);
		memory.writeIoU32(target, 0x24681357);
		memory.transferDmaBlock(IO_IMGDEC_DATA, target, 4, 0, 0, 5, 13);
		assert.equal(trace.reads, 4); assert.deepEqual(trace.readSignals, [5, 5, 5, 7]);
		if (rebind === 3) {
			assert.equal(trace.writes, 0); assert.equal(trace.ready, 0); assert.equal(memory.readBusFaultSequence(), 4);
			assert.equal(memory.readIoU32(target), 0x24681357);
		} else { assert.equal(trace.ready, 4); assert.equal(trace.writes, 3); assert.deepEqual(trace.writeSignals, [13, 13, 15]); }
	}
});
