import { RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';
import type { HeapAllocator } from './heap_allocator';
import type { LuaHeap } from './lua_heap';
import type { StringId } from './string_pool';
import { hashCanonicalTableKey, valueFromTag, valueInteger, valueNil, valuePayload, valueString, valueTag, type Value } from './value';
import { ValueSlots } from './value_slots';

export type GlobalBankState = { base: number; capacity: number; count: number };

// A CPU-owned namespace. Ordinals are stable even when the bank moves.
// Guest bytes are name words, two hash buckets per slot, payloads, then tags.
export class GlobalBank {
	private base = 0;
	private capacity = 0;
	public count = 0;
	public readonly slots = new ValueSlots(0);

	public constructor(private readonly memory: Memory, private readonly allocator: HeapAllocator, private readonly heap: LuaHeap) {}
	public readSlot(slot: number): Value {
		const word = this.memory.readRamRecordWord(this.base + 12 * this.capacity + 4 * slot);
		const tag = this.memory.readRamRecordByte(this.base + 16 * this.capacity + slot);
		return valueFromTag(tag, word);
	}
	public writeSlot(slot: number, value: Value): void {
		this.memory.writeRamRecordWord(this.base + 12 * this.capacity + 4 * slot, valuePayload(value));
		this.memory.writeRamRecordByte(this.base + 16 * this.capacity + slot, valueTag(value));
	}
	public name(slot: number): StringId { return this.memory.readRamRecordWord(this.base + 4 * slot); }
	public captureState(): GlobalBankState { return { base: this.base, capacity: this.capacity, count: this.count }; }

	public bind(state: GlobalBankState): void {
		this.base = state.base; this.capacity = state.capacity; this.count = state.count;
		if (state.capacity === 0) this.slots.unbind();
		else this.slots.bindRam(this.memory, (state.base + 12 * state.capacity) & RAM_RECORD_WORD_MASK, state.capacity);
	}

	public clear(): void {
		if (this.base !== 0) this.allocator.free(this.base);
		this.base = 0; this.capacity = 0; this.count = 0;
		this.slots.unbind();
	}

	private readBucket(bucket: number): number { return this.memory.readRamRecordWord(this.base + 4 * (this.capacity + bucket)); }
	private writeBucket(bucket: number, slot: number): void { this.memory.writeRamRecordWord(this.base + 4 * (this.capacity + bucket), slot + 1); }

	private bucketFor(key: StringId): number {
		const mask = 2 * this.capacity - 1;
		const start = hashCanonicalTableKey(valueInteger(key)) & mask;
		let bucket = start;
		do {
			const slot = this.readBucket(bucket);
			if (slot === 0 || this.name((slot - 1) & (this.capacity - 1)) === key) return bucket;
			bucket = (bucket + 1) & mask;
		} while (bucket !== start);
		return start;
	}

	public find(key: StringId): number | undefined {
		if (this.capacity === 0) return undefined;
		const stored = this.readBucket(this.bucketFor(key));
		const slot = (stored - 1) & (this.capacity - 1);
		return stored !== 0 && this.name(slot) === key ? slot : undefined;
	}

	private grow(key: StringId, pending: Value): void {
		const capacity = this.capacity === 0 ? 8 : 2 * this.capacity;
		const base = this.heap.allocateRecord(17 * capacity, true, 0, 0, valueString(key), pending);
		const oldBase = this.base;
		const offset = base & RAM_RECORD_WORD_MASK, source = oldBase & RAM_RECORD_WORD_MASK;
		const ram = this.memory.ramData();
		ram.fill(0, offset, offset + 12 * capacity);
		ram.copyWithin(offset, source, source + 4 * this.count);
		this.memory.invalidateRamWrite(offset, 12 * capacity);
		this.base = base; this.capacity = capacity;
		this.slots.bindRam(this.memory, offset + 12 * capacity, capacity, true);
		for (let slot = 0; slot < this.count; ++slot) this.writeBucket(this.bucketFor(this.name(slot)), slot);
		if (oldBase !== 0) this.allocator.free(oldBase);
	}

	public registerName(key: StringId, pending: Value = valueNil()): number {
		const prior = this.find(key);
		if (prior !== undefined) return prior;
		if (this.count === this.capacity) this.grow(key, pending);
		const slot = this.count, bucket = this.bucketFor(key);
		this.memory.writeRamRecordWord(this.base + 4 * slot, key);
		this.slots.setNil(slot);
		this.writeBucket(bucket, slot);
		++this.count;
		return slot;
	}
}
