import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import type { Memory } from '../../../machine/ts/machine/memory/memory';
import { bindReferenceDlmalloc, type DlmallocArena } from './dlmalloc_wasm';

const ALLOCATOR_STATE_OFFSET = 0x400;
const ARENA_TREE_ROOTS_END = 24 + 33 * 8 + 32 * 4;
const ARENA_LIMIT_OFFSET = ARENA_TREE_ROOTS_END + 4;
const ARENA_SEGMENT_OFFSET = ARENA_TREE_ROOTS_END + 8;
const ARENA_OCCUPIED_OFFSET = ARENA_TREE_ROOTS_END + 12;
const CHUNK_HEAD_BEFORE_PAYLOAD = 4;
const ISSUED_OBJECT_FLAGS = 2 | 4;

const PAGE_MASK = HEAP_PAGE_SIZE - 1;

export class HeapAllocator {
	private referenceArena: DlmallocArena | undefined;
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

	private get arena(): DlmallocArena {
		return this.referenceArena ??= bindReferenceDlmalloc(this.memory, this.allocatorStateOffset());
	}

	public allocationBytes(address: number): number { return this.arena.allocationBytes(address - RAM_BASE); }
	public setFloor(floorAddress: number): boolean {
		const floor = this.floorOffset(floorAddress);
		if (this.arena.setFloor(floor) === 0) return false;
		this.memory.setRamBusEnd(RAM_BASE + floor);
		return true;
	}

	public allocate(byteCount: number, owned: boolean): number {
		const offset = this.arena.allocate(byteCount, +!owned);
		return offset !== 0 ? RAM_BASE + offset : 0;
	}

	public free(address: number): void { this.arena.free(address - RAM_BASE); }
	public reserveBacking(address: number, bytes: number): number {
		const offset = this.arena.reserveBacking(address - RAM_BASE, bytes);
		return offset !== 0 ? RAM_BASE + offset : 0;
	}
	public resizeBacking(address: number, bytes: number): number {
		const offset = this.arena.resizeBacking(address - RAM_BASE, bytes);
		return offset !== 0 ? RAM_BASE + offset : 0;
	}
	public shrinkBacking(address: number, retainedBytes: number): void {
		this.arena.shrink(address - RAM_BASE, retainedBytes);
	}
}
