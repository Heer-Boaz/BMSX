/** Collector-owned allocation header; separate from a guest Value's tag. */
export const enum GcKind { Table, Closure, Upvalue, Thread, Garbage }
export type GrayQueue = { grayAgain: GcObject | null };
export class GcObject {
	public hashId = 0;
	// Heap-local payload identity, not a hash id or snapshot object index.
	public referenceId = 0;
	public restored = false;
	// 0/1 alternate white generations; 2 is queued gray, 3 is scanned black.
	public gcColor = 0;
	public gcNext: GcObject | null = null;
	public gcPrevious: GcObject | null = null;
	public gcGrayNext: GcObject | null = null;
	public gcOwner!: GrayQueue;
	public constructor(public readonly gcKind: GcKind) {}
	public writeBarrier(): void {
		if (this.gcColor !== 3) return;
		this.gcColor = 2;
		this.gcGrayNext = this.gcOwner.grayAgain;
		this.gcOwner.grayAgain = this;
	}
}
/** Sweep state retains allocation work without retaining dead graph edges. */
export class GarbageAllocation extends GcObject {
	public constructor(public readonly bytes: number, public readonly storage: number, public readonly record: number) { super(GcKind.Garbage); }
}
