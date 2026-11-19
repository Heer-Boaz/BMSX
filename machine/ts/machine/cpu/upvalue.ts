import { writeLE32 } from '../../common/endian';
import { MAIN_RAM_SIZE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';
import type { GcHeap } from './gc_heap';
import { ThreadField } from './thread_record';
import { type Value, type ValueTag, valueFromTag, valuePayload, valueTag } from './value';

export const UPVALUE_HEAP_BYTES = 16;
export const UPVALUE_ADDRESS_MASK = MAIN_RAM_SIZE - UPVALUE_HEAP_BYTES;
export const UPVALUE_RECORD_KIND = 11;
export const UPVALUE_FLAGS = 2;
export const UPVALUE_OPEN = 1;
export const UPVALUE_VALUE_TAG = 3;
export const UPVALUE_VALUE_WORD = 4;
export const UPVALUE_OWNER = 8;
export const UPVALUE_NEXT = 12;
export const UPVALUE_CHAIN_LIMIT = MAIN_RAM_SIZE / UPVALUE_HEAP_BYTES;

export function initialize(memory: Memory, address: number, white: number): void {
	memory.writeRamRecordPair(address, UPVALUE_RECORD_KIND | (white << 8), 0);
	memory.writeRamRecordPair(address + UPVALUE_OWNER, 0, 0);
}

export function isOpen(memory: Memory, address: number): boolean {
	return (memory.readRamRecordByte((address & UPVALUE_ADDRESS_MASK) + UPVALUE_FLAGS) & UPVALUE_OPEN) !== 0;
}

export function bindOpen(memory: Memory, address: number, owner: number, slot: number, next: number): void {
	const offset = address & UPVALUE_ADDRESS_MASK;
	const ram = memory.ramData();
	ram[offset + UPVALUE_FLAGS] = UPVALUE_OPEN;
	writeLE32(ram, offset + UPVALUE_VALUE_WORD, slot);
	writeLE32(ram, offset + UPVALUE_OWNER, owner);
	writeLE32(ram, offset + UPVALUE_NEXT, next);
	memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
}

export function close(heap: GcHeap, address: number): void {
	const memory = heap.memory;
	const captured = load(memory, address);
	const offset = address & UPVALUE_ADDRESS_MASK;
	const ram = memory.ramData();
	ram[offset + UPVALUE_FLAGS] &= ~UPVALUE_OPEN;
	ram[offset + UPVALUE_VALUE_TAG] = valueTag(captured);
	writeLE32(ram, offset + UPVALUE_VALUE_WORD, valuePayload(captured));
	writeLE32(ram, offset + UPVALUE_OWNER, 0);
	writeLE32(ram, offset + UPVALUE_NEXT, 0);
	memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
	heap.writeBarrier(offset, UPVALUE_NEXT);
}

export function load(memory: Memory, address: number): Value {
	const cell = address & UPVALUE_ADDRESS_MASK;
	const word = memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
	if (!isOpen(memory, cell)) return valueFromTag(memory.readRamRecordByte(cell + UPVALUE_VALUE_TAG), word);
	const owner = memory.readRamRecordWord(cell + UPVALUE_OWNER);
	const block = memory.readRamRecordWord(owner + ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
	const capacity = memory.readRamRecordWord(owner + ThreadField.StackCapacity);
	return valueFromTag(memory.readRamRecordByte(block + capacity * 4 + word), memory.readRamRecordWord(block + word * 4));
}

export function store(heap: GcHeap, address: number, tag: ValueTag, word: number): void {
	const memory = heap.memory;
	const cell = address & UPVALUE_ADDRESS_MASK;
	if (!isOpen(memory, cell)) {
		heap.writeBarrier(cell, UPVALUE_NEXT);
		memory.writeRamRecordWord(cell + UPVALUE_VALUE_WORD, word);
		memory.writeRamRecordByte(cell + UPVALUE_VALUE_TAG, tag);
		return;
	}
	const owner = memory.readRamRecordWord(cell + UPVALUE_OWNER);
	const slot = memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
	const block = memory.readRamRecordWord(owner + ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
	const capacity = memory.readRamRecordWord(owner + ThreadField.StackCapacity);
	memory.writeRamRecordWord(block + slot * 4, word);
	memory.writeRamRecordByte(block + capacity * 4 + slot, tag);
}
