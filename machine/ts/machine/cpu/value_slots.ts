import type { StringId } from './string_pool';
import type { GcHeap } from './gc_heap';
import type { BuiltinFunctionId } from '../../spec/blua32/builtin';
import { luaFloatResultBits } from '../../spec/blua32/numeric';
import { ValueTag, valueTag, valuePayload, valueFromTag, type Value } from './value';
import { ValueStorage } from './value_storage';
import type { Memory } from '../memory/memory';
import { MAIN_RAM_SIZE } from '../../spec/bmsx/memory_map';
import { f32BitsToNumber } from '../../common/float32';

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
	private wordBase = 0;
	private tagBase = 0;
	private ram: Memory | null = null;
	private mirrored = false;
	private size: number;
	constructor(size: number) {
		this.storage = new ValueStorage(size);
		this.words = this.storage.words; this.floats = this.storage.floats; this.tags = this.storage.tags; this.size = size;
	}
	public capacity(): number { return this.size; }
	public byteLength(): number { return this.size * 5; }
	public ramOffset(): number { return this.wordBase * 4; }
	public writeWatched(index: number): boolean {
		const watches = this.ram!.ramWriteWatches();
		return watches.anyWatched((this.wordBase + index) * 4, 4) || watches.anyWatched(this.tagBase + index, 1);
	}
	public ramMirrored(): boolean { return this.mirrored; }
	public bindRam(memory: Memory, offset: number, size: number, relocate = false, requirePort = false): void {
		const wordBase = offset >>> 2;
		const tagBase = (offset + size * 4) & (MAIN_RAM_SIZE - 1);
		const mirrored = requirePort || size > (MAIN_RAM_SIZE - offset) / 5;
		if (!relocate && this.ram === memory && this.wordBase === wordBase && this.size === size && this.mirrored === mirrored) return;
		const words = memory.ramWords, tags = memory.ramData();
		if (relocate && !mirrored) {
			const kept = Math.min(this.size, size);
			for (let i = 0; i < kept; ++i) { words[wordBase + i] = this.getPayload(i); tags[tagBase + i] = this.getTag(i); }
			words.fill(0, wordBase + kept, wordBase + size);
			tags.fill(0, tagBase + kept, tagBase + size);
			memory.invalidateRamWrite(offset, size * 5);
		}
		this.words = words; this.tags = tags; this.floats = memory.ramFloats;
		this.storage = null; this.ram = memory; this.size = size;
		this.wordBase = wordBase; this.tagBase = tagBase; this.mirrored = mirrored;
	}
	private reportWrite(first: number, count: number): void {
		if (this.ram === null) return;
		this.ram.invalidateRamWrite((this.wordBase + first) * 4, count * 4);
		this.ram.invalidateRamWrite(this.tagBase + first, count);
	}
	public rebind(source: ValueSlots, base: number, size: number): void {
		this.storage = null; this.ram = source.ram;
		this.mirrored = source.mirrored || (source.ram !== null && base + size > source.size);
		this.words = source.words; this.floats = source.floats; this.tags = source.tags;
		this.wordBase = source.wordBase + base; this.tagBase = source.tagBase + base; this.size = size;
	}
	public unbind(): void {
		this.storage = null; this.ram = null; this.mirrored = false;
		this.words = empty.words; this.floats = empty.floats; this.tags = empty.tags;
		this.wordBase = 0; this.tagBase = 0; this.size = 0;
	}
	public clear(count: number, offset = 0): void {
		const word = this.wordBase + offset, tag = this.tagBase + offset;
		if (this.mirrored) {
			const ram = this.ram!;
			const words = Math.min(count, MAIN_RAM_SIZE >>> 2), tags = Math.min(count, MAIN_RAM_SIZE);
			for (let i = 0; i < words; ++i) ram.writeRamRecordWord((word + i) * 4, 0);
			for (let i = 0; i < tags; ++i) ram.writeRamRecordByte(tag + i, 0);
			return;
		}
		this.words.fill(0, word, word + count); this.tags.fill(ValueTag.Nil, tag, tag + count);
		this.reportWrite(offset, count);
	}
	public reserveCapacity(capacity: number): void {
		if (capacity > this.size) this.resizeCapacity(Math.max(capacity, this.size * 2, 8));
	}
	public resizeCapacity(capacity: number): void {
		this.storage!.resize(capacity);
		this.words = this.storage!.words; this.floats = this.storage!.floats; this.tags = this.storage!.tags;
		this.wordBase = 0; this.tagBase = 0; this.size = capacity;
	}
	public copyTo(target: Value[], count: number): void {
		target.length = count;
		for (let i = 0; i < count; ++i) target[i] = this.get(i);
	}
	public copySlot(destination: number, source: number): void {
		if (this.mirrored) { this.setEncoded(destination, this.getTag(source), this.getPayload(source)); return; }
		this.words[this.wordBase + destination] = this.words[this.wordBase + source];
		this.tags[this.tagBase + destination] = this.tags[this.tagBase + source];
		this.reportWrite(destination, 1);
	}
	public copySlotFrom(source: ValueSlots, destination: number, first: number): void {
		if (this.mirrored || source.mirrored) {
			this.setEncoded(destination, source.getTag(first), source.getPayload(first));
			return;
		}
		this.words[this.wordBase + destination] = source.words[source.wordBase + first];
		this.tags[this.tagBase + destination] = source.tags[source.tagBase + first];
		this.reportWrite(destination, 1);
	}
	public copyRangeFrom(source: ValueSlots, destination: number, first: number, count: number): void {
		const dstWord = this.wordBase + destination, srcWord = source.wordBase + first;
		const dstTag = this.tagBase + destination, srcTag = source.tagBase + first;
		const dstPort = this.mirrored || (destination + count > this.size && this.ram !== null);
		const srcPort = source.mirrored || (first + count > source.size && source.ram !== null);
		if (dstPort || srcPort) {
			const delta = ((dstWord - srcWord) * 4) & (MAIN_RAM_SIZE - 4);
			const backward = this.ram === source.ram && delta > 0 && (delta >>> 2) < count;
			for (let i = backward ? count - 1 : 0, end = backward ? -1 : count, step = backward ? -1 : 1; i !== end; i += step) {
				const word = srcPort ? source.ram!.readRamRecordWord((srcWord + i) * 4) : source.words[srcWord + i];
				const tag = srcPort ? source.ram!.readRamRecordByte(srcTag + i) : source.tags[srcTag + i];
				if (dstPort) {
					this.ram!.writeRamRecordWord((dstWord + i) * 4, word);
					this.ram!.writeRamRecordByte(dstTag + i, tag);
				} else this.setEncoded(destination + i, tag, word);
			}
			return;
		}
		// Distinct logical windows can overlap in physical RAM.
		if (this.words === source.words) {
			this.words.copyWithin(dstWord, srcWord, srcWord + count);
			this.tags.copyWithin(dstTag, srcTag, srcTag + count);
		} else {
			for (let i = 0; i < count; ++i) {
				this.words[dstWord + i] = source.words[srcWord + i]; this.tags[dstTag + i] = source.tags[srcTag + i];
			}
		}
		this.reportWrite(destination, count);
	}
	public copyWithin(destination: number, source: number, count: number): void {
		this.copyRangeFrom(this, destination, source, count);
	}
	public getTag(index: number): ValueTag {
		const tag = this.tagBase + index;
		return this.mirrored ? this.ram!.readRamRecordByte(tag) : this.tags[tag];
	}
	public getPayload(index: number): number {
		const word = this.wordBase + index;
		return this.mirrored ? this.ram!.readRamRecordWord(word * 4) : this.words[word];
	}
	public getInteger(index: number): number { return this.getPayload(index) | 0; }
	public getFloat(index: number): number { return this.mirrored ? f32BitsToNumber(this.getPayload(index)) : this.floats[this.wordBase + index]; }
	public getStringId(index: number): StringId { return this.getPayload(index); }
	public getBuiltinFunctionId(index: number): BuiltinFunctionId { return this.getPayload(index); }
	public getClosure(index: number, heap: GcHeap): number { return heap.closureRecordAddress(this.getPayload(index))!; }
	public getThread(index: number, heap: GcHeap): number { return heap.threadRecordAddress(this.getPayload(index)); }
	public isTruthy(index: number): boolean { const tag = this.getTag(index); return tag !== ValueTag.Nil && tag !== ValueTag.False; }
	public get(index: number): Value { return valueFromTag(this.getTag(index), this.getPayload(index)); }
	public set(index: number, value: Value): void { this.setEncoded(index, valueTag(value), valuePayload(value)); }
	public setEncoded(index: number, tag: ValueTag, word: number): void {
		const wordIndex = this.wordBase + index, tagIndex = this.tagBase + index;
		if (this.mirrored) {
			const ram = this.ram!;
			ram.writeRamRecordWord(wordIndex * 4, word);
			ram.writeRamRecordByte(tagIndex, tag);
			return;
		}
		this.words[wordIndex] = word; this.tags[tagIndex] = tag;
		this.reportWrite(index, 1);
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
