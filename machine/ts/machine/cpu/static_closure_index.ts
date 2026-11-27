import type { Memory } from '../memory/memory';
import { RAM_BASE } from '../../spec/bmsx/memory_map';
import { CLOSURE_PROTOTYPE_ADDRESS } from './closure';
import { ValueTag } from './value';

// Host-side weak index into the canonical Closure records owned by language RAM.
// The sparse lane exists only for multi-entry groups; most prototypes need none.
export class StaticClosureIndex {
	private readonly groups = new Map<number, number[]>();
	private readonly positions = new Map<number, number>();

	public constructor(private readonly memory: Memory) {
		memory.onRamWrite(offset => {
			if (memory.readRamRecordByte(offset) !== ValueTag.Closure)
				this.retire(memory.readRamRecordWord(offset + CLOSURE_PROTOTYPE_ADDRESS), RAM_BASE + offset);
		});
	}

	public find(prototype: number): readonly number[] | undefined {
		return this.groups.get(prototype);
	}

	public insert(prototype: number, address: number): void {
		const entries = this.groups.get(prototype);
		if (entries === undefined) {
			this.groups.set(prototype, [address]);
			this.memory.watchRamByte(address - RAM_BASE);
			return;
		}
		// Restore can rebuild the inventory between publication and the caller's RET.
		if (entries.length === 1) {
			if (entries[0] === address) return;
			this.positions.set(entries[0], 0);
		} else if (this.positions.has(address)) return;
		this.positions.set(address, entries.length);
		entries.push(address);
		this.memory.watchRamByte(address - RAM_BASE);
	}

	private retire(prototype: number, address: number): void {
		const entries = this.groups.get(prototype);
		if (entries === undefined) return;
		const last = entries.length - 1;
		if (last === 0) {
			if (entries[0] === address) {
				this.groups.delete(prototype);
				this.memory.unwatchRamByte(address - RAM_BASE);
			}
			return;
		}
		// Reattaching during Sweep excludes garbage which still has to retire.
		const index = this.positions.get(address);
		if (index === undefined) return;
		this.memory.unwatchRamByte(address - RAM_BASE);
		this.positions.delete(address);
		if (index !== last) {
			const moved = entries[last];
			entries[index] = moved;
			if (last > 1) this.positions.set(moved, index);
		}
		entries.pop();
		if (last === 1) this.positions.delete(entries[0]);
	}

	public clear(): void {
		for (const entries of this.groups.values())
			for (const address of entries) this.memory.unwatchRamByte(address - RAM_BASE);
		this.groups.clear();
		this.positions.clear();
	}

	public addressGroups(): IterableIterator<readonly number[]> {
		return this.groups.values();
	}
}
