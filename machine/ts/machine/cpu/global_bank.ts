import { GlobalBankField } from '../../spec/blua32/execution_domain';
import { RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';
import type { StringId } from './string_pool';
import { hashCanonicalTableKey, valueInteger } from './value';
import { ValueSlots } from './value_slots';

// Ordinals are stable even when firmware relocates the Value planes.
export class GlobalBank {
	public readonly slots = new ValueSlots(0);

	public constructor(private readonly memory: Memory, private readonly descriptor: number) {}
	public get count(): number { return this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Count); }
	public name(slot: number): StringId {
		const capacity = this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Capacity);
		const names = this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Values) - 12 * capacity;
		return this.memory.readRamRecordWord(names + 4 * slot);
	}

	// Refresh the view of the RAM descriptor without moving its contents.
	public bind(): void {
		const capacity = this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Capacity);
		if (capacity === 0) {
			if (this.slots.capacity() !== 0) this.slots.unbind();
		}
		else {
			const values = this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Values);
			this.slots.bindRam(this.memory, values & RAM_RECORD_WORD_MASK, capacity);
		}
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
		const capacity = this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Capacity);
		const names = this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Values) - 12 * capacity;
		return this.findSlot(names, capacity, key);
	}
}
