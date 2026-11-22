// Host-side weak index into the canonical Closure records owned by language RAM.
// The sparse lane exists only for multi-entry groups; most prototypes need none.
export class StaticClosureIndex {
	private readonly groups = new Map<number, number[]>();
	private readonly positions = new Map<number, number>();

	public find(prototype: number): readonly number[] | undefined {
		return this.groups.get(prototype);
	}

	public insert(prototype: number, address: number): void {
		const entries = this.groups.get(prototype);
		if (entries === undefined) {
			this.groups.set(prototype, [address]);
			return;
		}
		if (entries.length === 1) this.positions.set(entries[0], 0);
		this.positions.set(address, entries.length);
		entries.push(address);
	}

	public retire(prototype: number, address: number): void {
		const entries = this.groups.get(prototype);
		if (entries === undefined) return;
		const last = entries.length - 1;
		if (last === 0) {
			if (entries[0] === address) this.groups.delete(prototype);
			return;
		}
		// Reattaching during Sweep excludes garbage which still has to retire.
		const index = this.positions.get(address);
		if (index === undefined) return;
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
		this.groups.clear();
		this.positions.clear();
	}

	public addressGroups(): IterableIterator<readonly number[]> {
		return this.groups.values();
	}
}
