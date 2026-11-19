import { byteStringToText } from '../../common/byte_string';
import type { LuaHeap } from './lua_heap';
import { ceilDiv4 } from '../common/numeric';
import { valueString } from './value';

export type StringId = number;

export type StringPoolStateEntry = {
	id: StringId;
	value: string;
	tracked: boolean;
	reachable: boolean;
};

export type StringPoolState = {
	/** Occupied slots in ascending ID order. */
	entries: StringPoolStateEntry[];
	freeIds: StringId[];
	slots: number;
	sweep: number;
	sweepEnd: number;
};

export class StringPool {
	private readonly byText = new Map<string, number>();
	private readonly values: (string | undefined)[] = [];
	private readonly trackedByteLengths: number[] = [];
	private readonly freeIds: StringId[] = [];
	private readonly localRoots: StringId[] = [];
	private readonly localRootBases: number[] = [];
	private trackedBytes = 0;
	private reachable: number[] = [];
	private sweep = -1;
	private sweepEnd = 0;

	public constructor(private readonly luaHeap: LuaHeap) {}

	public intern(value: string, tracked: boolean = true): StringId {
		const interned = this.byText.get(value) | 0;
		if (interned !== 0) {
			const existing = interned - 1;
			this.markReachable(existing);
			if (tracked && this.trackedByteLengths[existing] === 0) {
				const byteLength = this.values[existing]!.length;
				this.luaHeap.reserve(byteLength, valueString(existing));
				this.trackStringEntry(existing, byteLength);
			}
			if (this.localRootBases.length !== 0) this.localRoots.push(existing);
			return existing;
		}
		const byteLength = tracked ? value.length : 0;
		if (tracked) {
			this.luaHeap.reserve(byteLength);
		}
		const id = this.insert(this.freeIds.length === 0 ? this.values.length : this.freeIds.pop()!, value);
		if (tracked) {
			this.trackStringEntry(id, byteLength);
		}
		if (this.localRootBases.length !== 0) this.localRoots.push(id);
		return id;
	}

	public find(value: string): StringId | undefined {
		const interned = this.byText.get(value);
		return interned ? interned - 1 : undefined;
	}

	public bytes(id: StringId): string { return this.values[id]!; }

	public toString(id: StringId): string { return byteStringToText(this.values[id]!); }

	public compare(left: StringId, right: StringId): number {
		const a = this.values[left]!, b = this.values[right]!;
		return a < b ? -1 : a > b ? 1 : 0;
	}

	public byteLength(id: StringId): number { return this.values[id]!.length; }

	public byteAt(id: StringId, index: number): number { return this.values[id]!.charCodeAt(index); }

	public trackedLuaHeapBytes(): number {
		return this.trackedBytes;
	}

	public beginLocalRoots(): void {
		this.localRootBases.push(this.localRoots.length);
	}

	public endLocalRoots(): void {
		this.localRoots.length = this.localRootBases.pop()!;
	}

	public beginReachabilityEpoch(): void {
		this.reachable.fill(0);
		this.markLocalRoots();
	}
	public markLocalRoots(): void {
		for (const id of this.localRoots) this.reachable[id] = 1;
	}
	public markReachable(id: StringId): void { this.reachable[id] = 1; }
	public beginSweep(): void { this.sweep = 0; this.sweepEnd = this.values.length; }
	public sweeping(): boolean { return this.sweep >= 0; }
	public sweepStep(words: number): number {
		let work = 0, reclaimed = 0;
		while (this.sweep < this.sweepEnd && work < words) {
			const id = this.sweep++, value = this.values[id];
			++work;
			if (value === undefined) continue;
			work += ceilDiv4(this.trackedByteLengths[id]);
			if (this.reachable[id] !== 0) continue;
			this.byText.delete(value);
			this.values[id] = undefined;
			reclaimed += this.trackedByteLengths[id]; this.trackedByteLengths[id] = 0;
			this.freeIds.push(id);
		}
		this.trackedBytes -= reclaimed; this.luaHeap.release(reclaimed);
		if (this.sweep === this.sweepEnd) { this.sweep = -1; this.sweepEnd = 0; }
		return work;
	}

	public captureState(): StringPoolState {
		const entries: StringPoolStateEntry[] = [];
		for (let id = 0; id < this.values.length; id += 1) {
			const value = this.values[id];
			if (value !== undefined) entries.push({ id, value, tracked: this.trackedByteLengths[id] > 0, reachable: this.reachable[id] !== 0 });
		}
		return { entries, freeIds: this.freeIds.slice(), slots: this.values.length, sweep: this.sweep, sweepEnd: this.sweepEnd };
	}

	public restoreState(state: StringPoolState): void {
		const previousBytes = this.trackedBytes;
		this.byText.clear();
		this.values.length = 0;
		this.trackedByteLengths.length = 0;
		this.freeIds.length = 0;
		this.trackedBytes = 0;
		for (let index = 0; index < state.entries.length; index += 1) {
			const stateEntry = state.entries[index];
			this.insert(stateEntry.id, stateEntry.value);
			this.reachable[stateEntry.id] = stateEntry.reachable ? 1 : 0;
			if (stateEntry.tracked) {
				const byteLength = stateEntry.value.length;
				this.trackedByteLengths[stateEntry.id] = byteLength;
				this.trackedBytes += byteLength;
			}
		}
		this.values.length = state.slots; this.reachable.length = state.slots;
		this.trackedByteLengths.length = state.slots;
		this.freeIds.length = 0; for (const id of state.freeIds) this.freeIds.push(id);
		this.sweep = state.sweep; this.sweepEnd = state.sweepEnd;
		this.luaHeap.adjustForRestore(previousBytes, this.trackedBytes);
	}

	private insert(id: StringId, value: string): StringId {
		for (let vacant = this.values.length; vacant < id; vacant += 1) {
			this.freeIds.push(vacant);
			this.trackedByteLengths[vacant] = 0;
		}
		this.reachable[id] = 1;
		this.values[id] = value;
		this.trackedByteLengths[id] = 0;
		this.byText.set(value, id + 1);
		return id;
	}

	private trackStringEntry(id: StringId, byteLength: number): void {
		this.trackedByteLengths[id] = byteLength;
		this.trackedBytes += byteLength;
	}
}
