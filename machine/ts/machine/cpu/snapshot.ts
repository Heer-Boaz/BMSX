import type { GarbageAllocation } from './gc_object';
import type { Closure, Upvalue } from './closure';
import type { Table } from './table';
import type { Thread } from './thread';
import type { GcHeap } from './gc_heap';
import { ValueTag, valueFromTag, type Value } from './value';

// Snapshot-local word offsets, not a guest ABI. Values are a tag and one
// payload word; references use object ordinals, never heap handles/hash ids.
export const CPU_SNAPSHOT_VALUE_WORDS = 2;
export const enum CpuSnapshotObjectKind { Table, Closure, Upvalue, Thread, Garbage }
export const enum CpuSnapshotTable { Kind, HashId, Record, Size }
export const enum CpuSnapshotClosure { Kind, HashId, FunctionAddress, Canonical, UpvalueCount, CodeAddress, NumParams, MaxStack, Flags, UpvalueTableAddress, RecordUpvalueCount, ExecutionDomainId, Record, Size }
export const enum CpuSnapshotUpvalue { Kind, HashId, Open, Index, ThreadRef, FrameIndex, Address, Size }
export const enum CpuSnapshotThread { Kind, HashId, Index, Size }
export type CpuSnapshotObject = Table | Closure | Upvalue | Thread | GarbageAllocation;
export type CpuSnapshotValueWriter = (offset: number, value: Value) => void;

/** Exact active views of exclusively owned buffers. Spare capacity is not state. */
export class CpuSnapshot {
	public constructor(public words: Uint32Array = new Uint32Array(0), public objectWords: Uint32Array = new Uint32Array(0)) {}
	public get objectCount(): number { return this.objectWords.length; }
	public get capacityBytes(): number { return this.words.buffer.byteLength + this.objectWords.buffer.byteLength; }
	public objectWord(id: number): number { return this.objectWords[id]; }
	public word(offset: number): number { return this.words[offset]; }
	public int(offset: number): number { return this.words[offset] | 0; }

}

/** Capture sink. Reusing a snapshot relinquishes its previous active contents. */
export class CpuSnapshotWriter {
	private words: Uint32Array;
	private objects: Uint32Array;
	private size = 0;
	private count = 0;

	public constructor(private readonly snapshot: CpuSnapshot) {
		this.words = new Uint32Array(snapshot.words.buffer);
		this.objects = new Uint32Array(snapshot.objectWords.buffer);
	}

	public reserveWords(count: number): number {
		const offset = this.size;
		const size = offset + count;
		if (size > this.words.length) {
			const words = new Uint32Array(Math.max(size, this.words.length * 2, 256));
			words.set(this.words);
			this.words = words;
		}
		this.size = size;
		return offset;
	}
	public addObject(): number {
		if (this.count === this.objects.length) {
			const objects = new Uint32Array(Math.max(this.count * 2, 64));
			objects.set(this.objects);
			this.objects = objects;
		}
		return this.count++;
	}
	public setObjectWord(id: number, offset: number): void { this.objects[id] = offset; }
	public setWord(offset: number, value: number): void { this.words[offset] = value; }
	public finish(): CpuSnapshot {
		this.snapshot.words = this.words.subarray(0, this.size);
		this.snapshot.objectWords = this.objects.subarray(0, this.count);
		return this.snapshot;
	}
}

/** One decoded register value, reused throughout the restore. */
export class CpuSnapshotReader {
	public tag = ValueTag.Nil;
	public payload = 0;
	public constructor(public readonly snapshot: CpuSnapshot, private readonly objects: CpuSnapshotObject[], private readonly heap: GcHeap) {}
	public readValue(offset: number): void {
		this.tag = this.snapshot.word(offset);
		this.payload = this.snapshot.word(offset + 1);
		switch (this.tag) {
			case ValueTag.Thread:
				this.payload = this.heap.reference(this.objects[this.payload]); break;
		}
	}
	public value(): Value { return valueFromTag(this.tag, this.payload); }
}
