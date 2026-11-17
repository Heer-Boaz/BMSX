import type { StringId } from './string_pool';
import type { GcHeap } from './gc_heap';
import type { Table } from './table';
import type { Closure } from './closure';
import type { Thread } from './thread';
import type { BuiltinFunctionId } from '../../spec/blua32/builtin';
import { luaFloatResultBits } from '../../spec/blua32/numeric';
import { ValueTag, valueTag, valuePayload, valueFromTag, type Value } from './value';
import { ValueStorage } from './value_storage';

export type ValueWriteTarget = {
	setEncoded(index: number, tag: ValueTag, word: number): void;
	setInteger(index: number, value: number): void;
	setFloatBits(index: number, bits: number): void;
	setNil(index: number): void;
};
const empty = new ValueStorage();

export class ValueSlots implements ValueWriteTarget {
	private storage: ValueStorage | null;
	private words: Uint32Array;
	private floats: Float32Array;
	private tags: Uint8Array;
	private base = 0;
	private size: number;
	constructor(size: number) {
		this.storage = new ValueStorage(size);
		this.words = this.storage.words; this.floats = this.storage.floats; this.tags = this.storage.tags; this.size = size;
	}
	public capacity(): number { return this.size; }
	public byteLength(): number { return this.size * 5; }
	public rebind(source: ValueSlots, base: number, size: number): void {
		this.storage = null;
		this.words = source.words; this.floats = source.floats; this.tags = source.tags;
		this.base = source.base + base; this.size = size;
	}
	public unbind(): void {
		this.storage = null;
		this.words = empty.words; this.floats = empty.floats; this.tags = empty.tags; this.base = 0; this.size = 0;
	}
	public clear(count: number, offset = 0): void {
		const start = this.base + offset, end = start + count;
		this.words.fill(0, start, end); this.tags.fill(ValueTag.Nil, start, end);
	}
	public reserveCapacity(capacity: number): void {
		if (capacity > this.size) this.resizeCapacity(Math.max(capacity, this.size * 2, 8));
	}
	public resizeCapacity(capacity: number): void {
		this.storage!.resize(capacity);
		this.words = this.storage!.words; this.floats = this.storage!.floats; this.tags = this.storage!.tags;
		this.base = 0; this.size = capacity;
	}
	public copyTo(target: Value[], count: number): void {
		target.length = count;
		for (let i = 0; i < count; ++i) target[i] = this.get(i);
	}
	public copySlot(destination: number, source: number): void {
		const dst = this.base + destination, src = this.base + source;
		this.words[dst] = this.words[src]; this.tags[dst] = this.tags[src];
	}
	public copySlotFrom(source: ValueSlots, destination: number, first: number): void {
		const dst = this.base + destination, src = source.base + first;
		this.words[dst] = source.words[src]; this.tags[dst] = source.tags[src];
	}
	public copyRangeFrom(source: ValueSlots, destination: number, first: number, count: number): void {
		if (this.words === source.words) {
			const dst = this.base + destination, src = source.base + first;
			this.words.copyWithin(dst, src, src + count); this.tags.copyWithin(dst, src, src + count);
		} else for (let i = 0; i < count; ++i) this.copySlotFrom(source, destination + i, first + i);
	}
	public copyWithin(destination: number, source: number, count: number): void {
		const dst = this.base + destination, src = this.base + source;
		this.words.copyWithin(dst, src, src + count); this.tags.copyWithin(dst, src, src + count);
	}
	public getTag(index: number): ValueTag { return this.tags[this.base + index]; }
	public getPayload(index: number): number { return this.words[this.base + index]; }
	public getInteger(index: number): number { return this.words[this.base + index] | 0; }
	public getFloat(index: number): number { return this.floats[this.base + index]; }
	public getStringId(index: number): StringId { return this.words[this.base + index]; }
	public getBuiltinFunctionId(index: number): BuiltinFunctionId { return this.words[this.base + index]; }
	public getTable(index: number, heap: GcHeap): Table { return heap.object(this.words[this.base + index]) as Table; }
	public getClosure(index: number, heap: GcHeap): Closure { return heap.object(this.words[this.base + index]) as Closure; }
	public getThread(index: number, heap: GcHeap): Thread { return heap.object(this.words[this.base + index]) as Thread; }
	public isTruthy(index: number): boolean { const tag = this.getTag(index); return tag !== ValueTag.Nil && tag !== ValueTag.False; }
	public get(index: number): Value { const slot = this.base + index; return valueFromTag(this.tags[slot], this.words[slot]); }
	public set(index: number, value: Value): void { this.setEncoded(index, valueTag(value), valuePayload(value)); }
	public setEncoded(index: number, tag: ValueTag, word: number): void {
		const slot = this.base + index; this.words[slot] = word; this.tags[slot] = tag;
	}
	public setNil(index: number): void { this.setEncoded(index, ValueTag.Nil, 0); }
	public setBoolean(index: number, value: boolean): void { this.setEncoded(index, value ? ValueTag.True : ValueTag.False, 0); }
	public setInteger(index: number, value: number): void { this.setEncoded(index, ValueTag.Integer, value >>> 0); }
	public setFloat(index: number, value: number): void { this.setFloatBits(index, luaFloatResultBits(value)); }
	public setFloatBits(index: number, bits: number): void { this.setEncoded(index, ValueTag.Float, bits); }
	public setString(index: number, id: StringId): void { this.setEncoded(index, ValueTag.String, id); }
	public setTable(index: number, reference: number): void { this.setEncoded(index, ValueTag.Table, reference); }
	public setClosure(index: number, reference: number): void { this.setEncoded(index, ValueTag.Closure, reference); }
	public setThread(index: number, reference: number): void { this.setEncoded(index, ValueTag.Thread, reference); }
	public setBuiltinFunction(index: number, id: BuiltinFunctionId): void { this.setEncoded(index, ValueTag.BuiltinFunction, id); }
}
