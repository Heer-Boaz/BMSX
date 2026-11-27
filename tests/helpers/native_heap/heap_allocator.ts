import { HeapAllocator as AllocatorView } from '../../../machine/ts/machine/cpu/heap_allocator';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import type { Memory } from '../../../machine/ts/machine/memory/memory';
import { bindReferenceDlmalloc, type DlmallocArena } from './dlmalloc_wasm';

export { HEAP_COLLECTION_TARGET_OFFSET, HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET, HEAP_STRING_MARK_WORK_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';

export class HeapAllocator extends AllocatorView {
	private referenceArena: DlmallocArena | undefined;
	public constructor(private readonly fixtureMemory: Memory) { super(fixtureMemory); }

	private get arena(): DlmallocArena {
		return this.referenceArena ??= bindReferenceDlmalloc(this.fixtureMemory, this.allocatorStateOffset());
	}

	public allocationBytes(address: number): number { return this.arena.allocationBytes(address - RAM_BASE); }
	public setFloor(floorAddress: number): boolean {
		const floor = this.floorOffset(floorAddress);
		if (this.arena.setFloor(floor) === 0) return false;
		this.fixtureMemory.setRamBusEnd(RAM_BASE + floor);
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
