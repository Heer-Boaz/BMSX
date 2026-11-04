import { utf8ByteLength, utf8CodepointCount } from '../../common/utf8';
import type { LuaHeap } from './lua_heap';
import { ValueTag } from './value';

export type StringId = number;

export type StringPoolStateEntry = {
	id: StringId;
	value: string;
	tracked: boolean;
};

export type StringPoolState = {
	/** Occupied slots in ascending ID order. */
	entries: StringPoolStateEntry[];
};

export class StringPool {
	private readonly byText = new Map<string, number>();
	private readonly values: (string | undefined)[] = [];
	private readonly codepointCounts: number[] = [];
	private readonly trackedByteLengths: number[] = [];
	private readonly freeIds: StringId[] = [];
	private readonly localRoots: StringId[] = [];
	private readonly localRootBases: number[] = [];
	private trackedBytes = 0;
	private reachable = new Uint8Array(0);

	public constructor(private readonly luaHeap: LuaHeap) {}

	public intern(value: string, tracked: boolean = true): StringId {
		const interned = this.byText.get(value) | 0;
		if (interned !== 0) {
			const existing = interned - 1;
			if (tracked && this.trackedByteLengths[existing] === 0) {
				const byteLength = utf8ByteLength(this.values[existing]!);
				this.luaHeap.reserve(byteLength, ValueTag.String, existing);
				this.trackStringEntry(existing, byteLength);
			}
			if (this.localRootBases.length !== 0) this.localRoots.push(existing);
			return existing;
		}
		const byteLength = tracked ? utf8ByteLength(value) : 0;
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

	public toString(id: StringId): string {
		return this.values[id]!;
	}

	public codepointCount(id: StringId): number {
		return this.codepointCounts[id];
	}

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
		if (this.reachable.length < this.values.length) {
			this.reachable = new Uint8Array(this.values.length);
		} else {
			this.reachable.fill(0, 0, this.values.length);
		}
		for (const id of this.localRoots) this.reachable[id] = 1;
	}

	public markReachable(id: StringId): void {
		this.reachable[id] = 1;
	}

	public reclaimUnreachable(): void {
		let reclaimed = 0;
		this.freeIds.length = 0;
		for (let id = 0; id < this.values.length; id += 1) {
			const value = this.values[id];
			if (value === undefined) {
				this.freeIds.push(id);
				continue;
			}
			if (this.reachable[id] !== 0) {
				continue;
			}
			this.byText.delete(value);
			this.values[id] = undefined;
			this.codepointCounts[id] = 0;
			reclaimed += this.trackedByteLengths[id];
			this.trackedByteLengths[id] = 0;
			this.freeIds.push(id);
		}
		while (this.values.length > 0 && this.values[this.values.length - 1] === undefined) {
			this.values.pop();
			this.freeIds.pop();
		}
		this.codepointCounts.length = this.values.length;
		this.trackedByteLengths.length = this.values.length;
		this.trackedBytes -= reclaimed;
		this.luaHeap.release(reclaimed);
	}

	public captureState(): StringPoolState {
		const entries: StringPoolStateEntry[] = [];
		for (let id = 0; id < this.values.length; id += 1) {
			const value = this.values[id];
			if (value !== undefined) entries.push({ id, value, tracked: this.trackedByteLengths[id] > 0 });
		}
		return { entries };
	}

	public restoreState(state: StringPoolState): void {
		const previousBytes = this.trackedBytes;
		this.byText.clear();
		this.values.length = 0;
		this.codepointCounts.length = 0;
		this.trackedByteLengths.length = 0;
		this.freeIds.length = 0;
		this.trackedBytes = 0;
		for (let index = 0; index < state.entries.length; index += 1) {
			const stateEntry = state.entries[index];
			this.insert(stateEntry.id, stateEntry.value);
			if (stateEntry.tracked) {
				const byteLength = utf8ByteLength(stateEntry.value);
				this.trackedByteLengths[stateEntry.id] = byteLength;
				this.trackedBytes += byteLength;
			}
		}
		this.luaHeap.adjustForRestore(previousBytes, this.trackedBytes);
	}

	private insert(id: StringId, value: string): StringId {
		for (let vacant = this.values.length; vacant < id; vacant += 1) {
			this.freeIds.push(vacant);
			this.codepointCounts[vacant] = 0;
			this.trackedByteLengths[vacant] = 0;
		}
		this.values[id] = value;
		this.codepointCounts[id] = utf8CodepointCount(value);
		this.trackedByteLengths[id] = 0;
		this.byText.set(value, id + 1);
		return id;
	}

	private trackStringEntry(id: StringId, byteLength: number): void {
		this.trackedByteLengths[id] = byteLength;
		this.trackedBytes += byteLength;
	}
}
