import type { Memory } from '../../machine/ts/machine/memory/memory';
import { stockHeapManagementOffset } from '../../toolchain/ts/firmware/stock_heap_layout';

const LOGICAL_OCCUPIED = 0x3f0;
const ARENA_STATE = 0x400;
const ARENA_TREE_ROOTS_END = 24 + 33 * 8 + 32 * 4;
const ARENA_LIMIT = ARENA_TREE_ROOTS_END + 4;
const ARENA_SEGMENT = ARENA_TREE_ROOTS_END + 8;
const CHUNK_HEAD_BEFORE_PAYLOAD = 4;
const ISSUED_OBJECT_FLAGS = 2 | 4;

/** The stock firmware's logical counter, not the physical RAM map. */
export function stockHeapLogicalBytes(memory: Memory): number {
	return memory.readRamRecordWord(stockHeapManagementOffset(memory) + LOGICAL_OCCUPIED);
}

/** Decode a stock allocator chunk when a stopped inspection follows a weak edge. */
export function isStockHeapIssuedObject(memory: Memory, offset: number): boolean {
	const state = stockHeapManagementOffset(memory) + ARENA_STATE;
	offset >>>= 0;
	return offset >= ((memory.readRamRecordWord(state + ARENA_SEGMENT) + 8) >>> 0)
		&& offset < memory.readRamRecordWord(state + ARENA_LIMIT)
		&& (memory.readRamRecordWord(offset - CHUNK_HEAD_BEFORE_PAYLOAD) & ISSUED_OBJECT_FLAGS) === ISSUED_OBJECT_FLAGS;
}
