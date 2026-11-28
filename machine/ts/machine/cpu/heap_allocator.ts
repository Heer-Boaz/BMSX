import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';

// RAM management ranges owned by the runtime, independent of allocator bins.
export const HEAP_STRING_METADATA_OFFSET = 0x300;
export const HEAP_COLLECTION_TARGET_OFFSET = 0x340;
export const HEAP_LOGICAL_OCCUPIED_OFFSET = 0x3f0;
export const HEAP_STRING_MARK_WORK_OFFSET = 0x3f4;
const ALLOCATOR_STATE_OFFSET = 0x400;
const ARENA_TREE_ROOTS_END = 24 + 33 * 8 + 32 * 4;
const ARENA_LIMIT_OFFSET = ARENA_TREE_ROOTS_END + 4;
const ARENA_SEGMENT_OFFSET = ARENA_TREE_ROOTS_END + 8;
const ARENA_OCCUPIED_OFFSET = ARENA_TREE_ROOTS_END + 12;
const CHUNK_HEAD_BEFORE_PAYLOAD = 4;
const ISSUED_OBJECT_FLAGS = 2 | 4;

const PAGE_MASK = HEAP_PAGE_SIZE - 1;

export class HeapAllocator {
	private readonly management: number;

	public constructor(private readonly memory: Memory) {
		this.management = (memory.ramByteCount() & ~PAGE_MASK) - RUNTIME_MANAGEMENT_SIZE;
	}

	public managementOffset(): number { return this.management; }
	public allocatorStateOffset(): number { return this.management + ALLOCATOR_STATE_OFFSET; }
	public floorOffset(address: number): number {
		const offset = Math.min(Math.max(address, DYNAMIC_RAM_BASE) - RAM_BASE, this.management);
		return (offset + PAGE_MASK) & ~PAGE_MASK;
	}

	public floorAddress(): number { return this.memory.ramBusEnd(); }
	public capacityBytes(): number { return RAM_BASE + this.management - this.floorAddress(); }
	public occupiedBytes(): number { return this.memory.readRamRecordWord(this.allocatorStateOffset() + ARENA_OCCUPIED_OFFSET); }
	public unoccupiedBytes(): number { return this.capacityBytes() - this.occupiedBytes(); }
	public issuedObjectStart(offset: number): boolean {
		const state = this.allocatorStateOffset();
		offset >>>= 0;
		return offset >= ((this.memory.readRamRecordWord(state + ARENA_SEGMENT_OFFSET) + 8) >>> 0)
			&& offset < this.memory.readRamRecordWord(state + ARENA_LIMIT_OFFSET)
			&& (this.memory.readRamRecordWord(offset - CHUNK_HEAD_BEFORE_PAYLOAD) & ISSUED_OBJECT_FLAGS) === ISSUED_OBJECT_FLAGS;
	}
}
