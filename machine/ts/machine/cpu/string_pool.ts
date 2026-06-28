import { utf8ByteLength, utf8CodepointCount } from '../../common/utf8';
import { addTrackedLuaHeapBytes, enforceLuaHeapBudget } from '../memory/lua_heap_usage';

export type StringId = number;

export type StringPoolStateEntry = {
	id: StringId;
	value: string;
	tracked: boolean;
};

export type StringPoolState = {
	entries: StringPoolStateEntry[];
};

export class StringPool {
	private readonly byText = new Map<string, StringId>();
	private readonly values: string[] = [];
	private readonly codepointCounts: number[] = [];
	private readonly trackedByteLengths: number[] = [];
	private nextId = 0;
	private trackedBytes = 0;
	private reachable = new Uint8Array(0);

	public constructor(private readonly trackLuaHeap: boolean = false) {}

	public intern(value: string, tracked: boolean = this.trackLuaHeap): StringId {
		const existing = this.byText.get(value);
		if (existing !== undefined) {
			if (tracked && this.trackedByteLengths[existing] === 0) {
				this.trackStringEntry(existing);
			}
			return existing;
		}
		const id = this.insert(this.nextId, value);
		if (tracked) {
			this.trackStringEntry(id);
		}
		return id;
	}

	public toString(id: StringId): string {
		return this.values[id];
	}

	public codepointCount(id: StringId): number {
		return this.codepointCounts[id];
	}

	public trackedLuaHeapBytes(): number {
		return this.trackedBytes;
	}

	public beginReachabilityEpoch(): void {
		if (!this.trackLuaHeap) {
			return;
		}
		if (this.reachable.length < this.values.length) {
			this.reachable = new Uint8Array(this.values.length);
			return;
		}
		this.reachable.fill(0, 0, this.values.length);
	}

	public markReachable(id: StringId): void {
		if (!this.trackLuaHeap) {
			return;
		}
		this.reachable[id] = 1;
	}

	public reclaimUnreachableTracked(): void {
		if (!this.trackLuaHeap) {
			this.trackedBytes = 0;
			return;
		}
		let reclaimed = 0;
		for (let id = 0; id < this.trackedByteLengths.length; id += 1) {
			const byteLength = this.trackedByteLengths[id];
			if (byteLength === 0 || this.reachable[id] !== 0) {
				continue;
			}
			reclaimed += byteLength;
			this.trackedByteLengths[id] = 0;
		}
		if (reclaimed === 0) {
			return;
		}
		this.trackedBytes -= reclaimed;
		addTrackedLuaHeapBytes(-reclaimed);
	}

	public captureState(): StringPoolState {
		const entries: StringPoolStateEntry[] = [];
		for (let id = 0; id < this.values.length; id += 1) {
			const value = this.values[id];
			if (value !== undefined) {
				entries.push({ id, value, tracked: this.trackedByteLengths[id] > 0 });
			}
		}
		return { entries };
	}

	public restoreState(state: StringPoolState): void {
		const previousBytes = this.trackedBytes;
		this.byText.clear();
		this.values.length = 0;
		this.codepointCounts.length = 0;
		this.trackedByteLengths.length = 0;
		this.nextId = 0;
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
		if (this.trackLuaHeap) {
			addTrackedLuaHeapBytes(this.trackedBytes - previousBytes);
			enforceLuaHeapBudget();
		}
	}

	private insert(id: StringId, value: string): StringId {
		this.values[id] = value;
		this.codepointCounts[id] = utf8CodepointCount(value);
		this.trackedByteLengths[id] = 0;
		this.byText.set(value, id);
		if (id >= this.nextId) {
			this.nextId = id + 1;
		}
		return id;
	}

	private trackStringEntry(id: StringId): void {
		const byteLength = utf8ByteLength(this.values[id]);
		this.trackedByteLengths[id] = byteLength;
		this.trackedBytes += byteLength;
		addTrackedLuaHeapBytes(byteLength);
		enforceLuaHeapBudget();
	}
}
