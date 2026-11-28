import { HEAP_COLLECTION_TARGET_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from './heap_allocator';
import type { Memory } from '../memory/memory';
import type { HeapAllocator } from './heap_allocator';

export class LuaHeap {
	protected readonly targetAddress: number;
	public readonly occupiedOffset: number;

	public constructor(private readonly memory: Memory, private readonly arena: HeapAllocator) {
		const management = arena.managementOffset();
		this.targetAddress = management + HEAP_COLLECTION_TARGET_OFFSET;
		this.occupiedOffset = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
	}

	public collectionTarget(): number {
		return this.memory.readRamRecordWord(this.targetAddress);
	}

	public usedBytes(): number {
		return this.memory.readRamRecordWord(this.occupiedOffset);
	}
	public capacity(): number { return this.arena.capacityBytes(); }

}
