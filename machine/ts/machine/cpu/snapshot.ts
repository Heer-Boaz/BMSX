import type { Closure, Upvalue } from './closure';
import type { Table } from './table';
import { ValueTag, type ValueReference } from './value';

// Snapshot-local word offsets, not a guest ABI. Values are tag + f64/u32
// payload; references use object ordinals, never host pointers or hash ids.
export const CPU_SNAPSHOT_VALUE_WORDS = 3;
export const enum CpuSnapshotObjectKind { Table, Closure, Upvalue }
export const enum CpuSnapshotTable {
	Kind, HashId, ArrayLength, ArrayCapacity, HashSize, HashFree, Metatable,
	Data = 9,
}
export const enum CpuSnapshotClosure { Kind, HashId, FunctionAddress, Canonical, UpvalueCount, Data }
export const enum CpuSnapshotUpvalue { Kind, HashId, Open, Index, FrameIndex, Value }
export type CpuSnapshotObject = Table | Closure | Upvalue;
export type CpuSnapshotValueWriter = (offset: number, tag: ValueTag, scalar: number, reference: ValueReference) => void;

const numberBits = new DataView(new ArrayBuffer(8));

/** Exact active views of exclusively owned buffers. Spare capacity is not state. */
export class CpuSnapshot {
	public constructor(public words: Uint32Array = new Uint32Array(0), public objectWords: Uint32Array = new Uint32Array(0)) {}
	public get objectCount(): number { return this.objectWords.length; }
	public get capacityBytes(): number { return this.words.buffer.byteLength + this.objectWords.buffer.byteLength; }
	public objectWord(id: number): number { return this.objectWords[id]; }
	public word(offset: number): number { return this.words[offset]; }
	public int(offset: number): number { return this.words[offset] | 0; }
	public number(offset: number): number {
		numberBits.setUint32(0, this.words[offset], true);
		numberBits.setUint32(4, this.words[offset + 1], true);
		return numberBits.getFloat64(0, true);
	}
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
	public setNumber(offset: number, value: number): void {
		numberBits.setFloat64(0, value, true);
		this.words[offset] = numberBits.getUint32(0, true);
		this.words[offset + 1] = numberBits.getUint32(4, true);
	}
	public finish(): CpuSnapshot {
		this.snapshot.words = this.words.subarray(0, this.size);
		this.snapshot.objectWords = this.objects.subarray(0, this.count);
		return this.snapshot;
	}
}

/** One decoded register value, reused throughout the restore. */
export class CpuSnapshotReader {
	public tag = ValueTag.Nil;
	public scalar = NaN;
	public reference: ValueReference = null;
	public constructor(public readonly snapshot: CpuSnapshot, private readonly objects: CpuSnapshotObject[]) {}
	public readValue(offset: number): void {
		const snapshot = this.snapshot;
		this.tag = snapshot.word(offset);
		this.scalar = NaN;
		this.reference = null;
		switch (this.tag) {
			case ValueTag.Number: this.scalar = snapshot.number(offset + 1); break;
			case ValueTag.String:
			case ValueTag.BuiltinFunction: this.scalar = snapshot.word(offset + 1); break;
			case ValueTag.Table:
			case ValueTag.Closure: this.reference = this.objects[snapshot.word(offset + 1)] as ValueReference; break;
		}
	}
}
