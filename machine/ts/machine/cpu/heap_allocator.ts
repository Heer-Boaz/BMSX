import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../spec/bmsx/memory_map';
import type { DlmallocArena } from '../memory/dlmalloc_wasm';
import type { Memory } from '../memory/memory';

// RAM management ranges owned by the runtime, independent of allocator bins.
export const HEAP_STRING_METADATA_OFFSET = 0x300;
export const HEAP_COLLECTION_TARGET_OFFSET = 0x340;
export const HEAP_GC_CONTROL_OFFSET = 0x344;
export const HEAP_LOGICAL_OCCUPIED_OFFSET = 0x3f0;
const ALLOCATOR_STATE_OFFSET = 0x400;

const PAGE_MASK = HEAP_PAGE_SIZE - 1;

export class HeapAllocator {
	private readonly management: number;
	private readonly arena: DlmallocArena;

	public constructor(private readonly memory: Memory) {
		this.management = (memory.ramByteCount() & ~PAGE_MASK) - RUNTIME_MANAGEMENT_SIZE;
		this.arena = memory.bindDlmalloc(this.allocatorStateOffset());
		this.reset(DYNAMIC_RAM_BASE);
	}

	public managementOffset(): number { return this.management; }
	public allocatorStateOffset(): number { return this.management + ALLOCATOR_STATE_OFFSET; }
	public floorOffset(address: number): number {
		const offset = Math.min(Math.max(address, DYNAMIC_RAM_BASE) - RAM_BASE, this.management);
		return (offset + PAGE_MASK) & ~PAGE_MASK;
	}

	public reset(floorAddress: number): void {
		this.memory.ramData().fill(0, this.management, this.management + RUNTIME_MANAGEMENT_SIZE);
		this.memory.invalidateRamWrite(this.management, RUNTIME_MANAGEMENT_SIZE);
		const floor = this.floorOffset(floorAddress);
		this.arena.reset(floor, this.management);
		this.publishFloor(floor);
	}

	public setFloor(floorAddress: number): boolean {
		const floor = this.floorOffset(floorAddress);
		if (this.arena.setFloor(floor) === 0) return false;
		this.publishFloor(floor);
		return true;
	}

	/** The allocator has accepted this offset; now publish the system bus decode. */
	public publishFloor(offset: number): void { this.memory.setRamBusEnd(RAM_BASE + offset); }

	public floorAddress(): number { return this.memory.ramBusEnd(); }
	public capacityBytes(): number { return RAM_BASE + this.management - this.floorAddress(); }
	public occupiedBytes(): number { return this.arena.occupiedBytes(); }
	public unoccupiedBytes(): number { return this.capacityBytes() - this.occupiedBytes(); }
	public allocationBytes(address: number): number { return this.arena.allocationBytes(address - RAM_BASE); }
	public issuedObjectStart(offset: number): boolean { return this.arena.isObject(offset) !== 0; }

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
