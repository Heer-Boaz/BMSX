import type { GcHeap } from './gc_heap';

export const GC_COLOR_OFFSET = 1;
export const GC_RECORD_SHIFT = 3;
export const GC_RECORD_LINK = 4;
// A four-MiB RAM bank has 19 index bits at eight-byte record alignment.
export const GC_GRAY_INDEX_BITS = 19;
export const GC_GRAY_INDEX_MASK = (1 << GC_GRAY_INDEX_BITS) - 1;

/** Collector-owned allocation header; separate from a guest Value's tag. */
export const enum GcKind { Closure, Thread }
export abstract class GcObject {
	// 0/1 alternate white generations; 2 is queued gray, 3 is scanned black.
	public abstract readonly address: number;
	public get gcColor(): number { return this.gcOwner.memory.readRamRecordByte(this.address + GC_COLOR_OFFSET); }
	public set gcColor(color: number) { this.gcOwner.memory.writeRamRecordByte(this.address + GC_COLOR_OFFSET, color); }
	public gcNext: GcObject | null = null;
	public gcPrevious: GcObject | null = null;
	public gcOwner!: GcHeap;
	public constructor(public readonly gcKind: GcKind) {}
}
