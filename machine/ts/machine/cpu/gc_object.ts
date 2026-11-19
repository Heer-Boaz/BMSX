import type { Memory } from '../memory/memory';

export const GC_COLOR_OFFSET = 1;

/** Collector-owned allocation header; separate from a guest Value's tag. */
export const enum GcKind { Table, Closure, Upvalue, Thread }
export type GrayQueue = { grayAgain: GcObject | null; readonly memory: Memory };
export abstract class GcObject {
	public hashId = 0;
	public restored = false;
	// 0/1 alternate white generations; 2 is queued gray, 3 is scanned black.
	public abstract readonly address: number;
	public get gcColor(): number { return this.gcOwner.memory.readRamRecordByte(this.address + GC_COLOR_OFFSET); }
	public set gcColor(color: number) { this.gcOwner.memory.writeRamRecordByte(this.address + GC_COLOR_OFFSET, color); }
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
