import { GlobalBankField } from '../../spec/blua32/execution_domain';
import { HeapServiceRootBankField } from '../../spec/bmsx/heap_service';
import { MAIN_RAM_SIZE, RAM_BASE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';
import type { GcHeap } from './gc_heap';
import type { StringId } from './string_pool';
import { hashCanonicalTableKey, valueInteger, valueNil, valuePayload, valueString, valueTag, valueTagHasGcEdge, ValueTag, type Value } from './value';
import { ValueSlots } from './value_slots';

const GLOBAL_NAME_BUDGET_BYTES = 9;

// The triples are owned by RAM. Ordinals are stable even when the backing moves:
// name words, two hash buckets per slot, payloads, then tags.
export class GlobalBank {
	public readonly slots = new ValueSlots(0);

	public constructor(private readonly memory: Memory, private readonly gc: GcHeap, private readonly descriptor: number) {}
	public get count(): number { return this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Count); }
	public name(slot: number): StringId {
		const base = this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Base);
		return this.memory.readRamRecordWord(base + 4 * slot);
	}
	public writeSlot(slot: number, value: Value): void {
		const tag = valueTag(value), word = valuePayload(value);
		this.slots.setEncoded(slot, tag, word);
		if (valueTagHasGcEdge(tag)) this.gc.writeGlobalRoot(tag, word);
	}

	public publishHeapRootBank(descriptor: number): void {
		const memory = this.memory;
		const base = memory.readRamRecordWord(this.descriptor + GlobalBankField.Base);
		const capacity = memory.readRamRecordWord(this.descriptor + GlobalBankField.Capacity);
		const names = RAM_BASE + (base & RAM_RECORD_WORD_MASK);
		const payloads = RAM_BASE + ((base + 12 * capacity) & RAM_RECORD_WORD_MASK);
		const tags = RAM_BASE + ((base + 16 * capacity) & (MAIN_RAM_SIZE - 1));
		memory.writeRamRecordPair(descriptor + HeapServiceRootBankField.Count, this.count, payloads);
		memory.writeRamRecordPair(descriptor + HeapServiceRootBankField.Tags, tags, names);
	}

	// RAM has already been restored by the machine; reconstruct only the borrowed view.
	public bind(): void {
		const capacity = this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Capacity);
		if (capacity === 0) this.slots.unbind();
		else {
			const base = this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Base);
			this.slots.bindRam(this.memory, (base + 12 * capacity) & RAM_RECORD_WORD_MASK, capacity);
		}
	}

	public clear(): void {
		const memory = this.memory, descriptor = this.descriptor;
		const base = memory.readRamRecordWord(descriptor + GlobalBankField.Base);
		if (base !== 0) this.gc.budget.releaseRecord(base, GLOBAL_NAME_BUDGET_BYTES * this.count);
		memory.writeRamRecordWord(descriptor + GlobalBankField.Base, 0);
		memory.writeRamRecordWord(descriptor + GlobalBankField.Capacity, 0);
		memory.writeRamRecordWord(descriptor + GlobalBankField.Count, 0);
		this.slots.unbind();
	}

	private bucketFor(base: number, capacity: number, key: StringId): number {
		const slots = base + 4 * capacity;
		const mask = 2 * capacity - 1;
		const start = hashCanonicalTableKey(valueInteger(key)) & mask;
		let bucket = start;
		do {
			const slot = this.memory.readRamRecordWord(slots + 4 * bucket);
			if (slot === 0 || this.memory.readRamRecordWord(base + 4 * ((slot - 1) & (capacity - 1))) === key) return bucket;
			bucket = (bucket + 1) & mask;
		} while (bucket !== start);
		return start;
	}

	private findSlot(base: number, capacity: number, key: StringId): number | undefined {
		if (capacity === 0) return undefined;
		const stored = this.memory.readRamRecordWord(base + 4 * (capacity + this.bucketFor(base, capacity, key)));
		const slot = (stored - 1) & (capacity - 1);
		return stored !== 0 && this.memory.readRamRecordWord(base + 4 * slot) === key ? slot : undefined;
	}

	public find(key: StringId): number | undefined {
		return this.findSlot(this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Base),
			this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Capacity), key);
	}

	private grow(oldBase: number, base: number, capacity: number, count: number): void {
		const memory = this.memory, descriptor = this.descriptor;
		const offset = base & RAM_RECORD_WORD_MASK, source = oldBase & RAM_RECORD_WORD_MASK;
		const ram = memory.ramData();
		ram.fill(0, offset, offset + 12 * capacity);
		ram.copyWithin(offset, source, source + 4 * count);
		memory.invalidateRamWrite(offset, 12 * capacity);
		memory.writeRamRecordWord(descriptor + GlobalBankField.Base, base);
		memory.writeRamRecordWord(descriptor + GlobalBankField.Capacity, capacity);
		this.slots.bindRam(memory, offset + 12 * capacity, capacity, true);
		for (let slot = 0; slot < count; ++slot) {
			const key = memory.readRamRecordWord(base + 4 * slot);
			memory.writeRamRecordWord(base + 4 * (capacity + this.bucketFor(base, capacity, key)), slot + 1);
		}
	}

	public registerName(key: StringId, pending: Value = valueNil()): number {
		const memory = this.memory, descriptor = this.descriptor;
		let base = memory.readRamRecordWord(descriptor + GlobalBankField.Base);
		let capacity = memory.readRamRecordWord(descriptor + GlobalBankField.Capacity);
		const prior = this.findSlot(base, capacity, key);
		if (prior !== undefined) return prior;
		const slot = this.count;
		let oldBase = 0;
		if (slot === capacity) {
			capacity = capacity === 0 ? 8 : 2 * capacity;
			const backing = this.gc.budget.reserveBacking(17 * capacity, GLOBAL_NAME_BUDGET_BYTES, valueString(key), pending);
			oldBase = base;
			this.grow(oldBase, backing, capacity, slot);
			base = backing;
		} else {
			this.gc.budget.admit(GLOBAL_NAME_BUDGET_BYTES, valueString(key), pending);
		}
		const bucket = this.bucketFor(base, capacity, key);
		memory.writeRamRecordWord(base + 4 * slot, key);
		this.slots.setNil(slot);
		memory.writeRamRecordWord(base + 4 * (capacity + bucket), slot + 1);
		memory.writeRamRecordWord(descriptor + GlobalBankField.Count, slot + 1);
		this.gc.budget.replaceRecord(oldBase, 0, GLOBAL_NAME_BUDGET_BYTES);
		this.gc.writeGlobalRoot(ValueTag.String, key);
		return slot;
	}
}
