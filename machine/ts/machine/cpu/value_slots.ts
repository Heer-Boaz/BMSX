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
	private base = 0;
	private ram: Memory | null = null;
	private mirrored = false;
	private wordAddress = 0;
	private tagAddress = 0;
	private size: number;
	constructor(size: number) {
		this.storage = new ValueStorage(size);
		this.words = this.storage.words; this.floats = this.storage.floats; this.tags = this.storage.tags; this.size = size;
	}
	public capacity(): number { return this.size; }
	public byteLength(): number { return this.size * 5; }
	public ramOffset(): number { return this.wordAddress; }
	public writeWatched(index: number): boolean {
		const watches = this.ram!.ramWriteWatches(), slot = this.base + index;
		return watches.anyWatched(this.wordAddress + slot * 4, 4) || watches.anyWatched(this.tagAddress + slot, 1);
	}
	public ramMirrored(): boolean { return this.mirrored; }
	public bindRam(memory: Memory, offset: number, size: number, relocate = false, requirePort = false): void {
		const buffer = memory.ramData().buffer;
		const tagOffset = (offset + size * 4) & (MAIN_RAM_SIZE - 1);
		const mirrored = requirePort || size > (MAIN_RAM_SIZE - offset) / 5;
		if (!relocate && this.ram === memory && this.wordAddress === offset && this.size === size && this.mirrored === mirrored) return;
		if (mirrored) {
			this.words = empty.words; this.tags = empty.tags; this.floats = empty.floats;
		} else {
			const words = new Uint32Array(buffer, offset, size);
			const tags = new Uint8Array(buffer, tagOffset, size);
			if (relocate) {
				const kept = Math.min(this.size, size);
				for (let i = 0; i < kept; ++i) { words[i] = this.getPayload(i); tags[i] = this.getTag(i); }
				words.fill(0, kept); tags.fill(0, kept);
				memory.invalidateRamWrite(offset, size * 5);
			}
			this.words = words; this.floats = new Float32Array(buffer, offset, size); this.tags = tags;
		}
		this.storage = null; this.ram = memory; this.base = 0; this.size = size;
		this.wordAddress = offset; this.tagAddress = tagOffset; this.mirrored = mirrored;
	}
	private reportWrite(first: number, count: number): void {
		if (this.ram === null) return;
		const byte = this.tagAddress + first;
		this.ram.invalidateRamWrite(this.wordAddress + first * 4, count * 4);
		this.ram.invalidateRamWrite(byte, count);
	}
	public rebind(source: ValueSlots, base: number, size: number): void {
		this.storage = null; this.ram = source.ram;
		this.wordAddress = source.wordAddress; this.tagAddress = source.tagAddress; this.mirrored = source.mirrored || (source.ram !== null && base + size > source.size);
		this.words = source.words; this.floats = source.floats; this.tags = source.tags;
		this.base = source.base + base; this.size = size;
	}
	public unbind(): void {
		this.storage = null; this.ram = null; this.mirrored = false;
		this.words = empty.words; this.floats = empty.floats; this.tags = empty.tags; this.base = 0; this.size = 0;
	}
	public clear(count: number, offset = 0): void {
		const start = this.base + offset, end = start + count;
		if (this.mirrored) {
			const ram = this.ram!;
			const word = this.wordAddress + start * 4, byte = this.tagAddress + start;
			const words = Math.min(count, MAIN_RAM_SIZE >>> 2), tags = Math.min(count, MAIN_RAM_SIZE);
			for (let i = 0; i < words; ++i) ram.writeRamRecordWord(word + i * 4, 0);
			for (let i = 0; i < tags; ++i) ram.writeRamRecordByte(byte + i, 0);
			return;
		}
		this.words.fill(0, start, end); this.tags.fill(ValueTag.Nil, start, end);
		this.reportWrite(start, count);
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
		if (this.mirrored) { this.setEncoded(destination, this.getTag(source), this.getPayload(source)); return; }
		const dst = this.base + destination, src = this.base + source;
		this.words[dst] = this.words[src]; this.tags[dst] = this.tags[src];
		this.reportWrite(dst, 1);
	}
	public copySlotFrom(source: ValueSlots, destination: number, first: number): void {
		if (this.mirrored || source.mirrored) {
			this.setEncoded(destination, source.getTag(first), source.getPayload(first));
			return;
		}
		const dst = this.base + destination, src = source.base + first;
		this.words[dst] = source.words[src]; this.tags[dst] = source.tags[src];
		this.reportWrite(dst, 1);
	}
	public copyRangeFrom(source: ValueSlots, destination: number, first: number, count: number): void {
		const dst = this.base + destination, src = source.base + first;
		const dstPort = this.mirrored || (destination + count > this.size && this.ram !== null);
		const srcPort = source.mirrored || (first + count > source.size && source.ram !== null);
		if (dstPort || srcPort) {
			const dstWord = this.wordAddress + dst * 4, srcWord = source.wordAddress + src * 4;
			const dstTag = this.tagAddress + dst, srcTag = source.tagAddress + src;
			const delta = (dstWord - srcWord) & (MAIN_RAM_SIZE - 4);
			const backward = this.ram === source.ram && delta > 0 && (delta >>> 2) < count;
			for (let i = backward ? count - 1 : 0, end = backward ? -1 : count, step = backward ? -1 : 1; i !== end; i += step) {
				const word = srcPort ? source.ram!.readRamRecordWord(srcWord + i * 4) : source.words[src + i];
				const tag = srcPort ? source.ram!.readRamRecordByte(srcTag + i) : source.tags[src + i];
				if (dstPort) {
					this.ram!.writeRamRecordWord(dstWord + i * 4, word);
					this.ram!.writeRamRecordByte(dstTag + i, tag);
				} else this.setEncoded(destination + i, tag, word);
			}
			return;
		}
		if (this.words === source.words) {
			this.words.copyWithin(dst, src, src + count); this.tags.copyWithin(dst, src, src + count);
			this.reportWrite(dst, count);
		} else {
			for (let i = 0; i < count; ++i) {
				this.words[dst + i] = source.words[src + i]; this.tags[dst + i] = source.tags[src + i];
			}
			this.reportWrite(dst, count);
		}
	}
	public copyWithin(destination: number, source: number, count: number): void {
		this.copyRangeFrom(this, destination, source, count);
	}
	public getTag(index: number): ValueTag {
		const slot = this.base + index;
		return this.mirrored ? this.ram!.readRamRecordByte(this.tagAddress + slot) : this.tags[slot];
	}
	public getPayload(index: number): number {
		const slot = this.base + index;
		return this.mirrored ? this.ram!.readRamRecordWord(this.wordAddress + slot * 4) : this.words[slot];
	}
	public getInteger(index: number): number { return this.getPayload(index) | 0; }
	public getFloat(index: number): number { return this.mirrored ? f32BitsToNumber(this.getPayload(index)) : this.floats[this.base + index]; }
	public getStringId(index: number): StringId { return this.getPayload(index); }
	public getBuiltinFunctionId(index: number): BuiltinFunctionId { return this.getPayload(index); }
	public getClosure(index: number, heap: GcHeap): number { return heap.closureRecordAddress(this.getPayload(index))!; }
	public getThread(index: number, heap: GcHeap): number { return heap.threadRecordAddress(this.getPayload(index)); }
	public isTruthy(index: number): boolean { const tag = this.getTag(index); return tag !== ValueTag.Nil && tag !== ValueTag.False; }
	public get(index: number): Value { return valueFromTag(this.getTag(index), this.getPayload(index)); }
	public set(index: number, value: Value): void { this.setEncoded(index, valueTag(value), valuePayload(value)); }
	public setEncoded(index: number, tag: ValueTag, word: number): void {
		const slot = this.base + index;
		if (this.mirrored) {
			const ram = this.ram!, wordAddress = this.wordAddress + slot * 4, tagAddress = this.tagAddress + slot;
			ram.writeRamRecordWord(wordAddress, word);
			ram.writeRamRecordByte(tagAddress, tag);
			return;
		}
		this.words[slot] = word; this.tags[slot] = tag;
		this.reportWrite(slot, 1);
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
