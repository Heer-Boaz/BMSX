import { GlobalBankField } from '../../spec/blua32/execution_domain';
import { RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';
import { ValueSlots } from './value_slots';

// Ordinals are stable even when firmware relocates the Value planes.
export class GlobalBank {
	public readonly slots = new ValueSlots(0);

	public constructor(private readonly memory: Memory, private readonly descriptor: number) {}
	public get count(): number { return this.memory.readRamRecordWord(this.descriptor + GlobalBankField.Count); }

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
}
