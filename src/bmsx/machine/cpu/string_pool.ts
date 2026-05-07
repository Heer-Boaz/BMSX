import { utf8ByteLength, utf8CodepointCount } from '../../common/utf8';
import { addTrackedLuaHeapBytes, enforceLuaHeapBudget, replaceTrackedLuaHeapBytes } from '../memory/lua_heap_usage';

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

	public constructor(private readonly trackLuaHeap = false) {}

	public intern(text: string): StringId {
		return this.internWithOwnership(text, this.trackLuaHeap);
	}

	public internRom(text: string): StringId {
		return this.internWithOwnership(text, false);
	}

	private internWithOwnership(text: string, tracked: boolean): StringId {
		const existing = this.byText.get(text);
		if (existing !== undefined) {
			if (tracked && this.trackedByteLengths[existing] === 0) {
				const byteLength = utf8ByteLength(text);
				this.trackedByteLengths[existing] = byteLength;
				this.trackedBytes += byteLength;
				addTrackedLuaHeapBytes(byteLength);
				enforceLuaHeapBudget();
			}
			return existing;
		}
		const id = this.insert(this.nextId, text);
		if (tracked) {
			const byteLength = utf8ByteLength(text);
			this.trackedByteLengths[id] = byteLength;
			this.trackedBytes += byteLength;
			addTrackedLuaHeapBytes(byteLength);
			enforceLuaHeapBudget();
		}
		return id;
	}

	public toString(id: StringId): string {
		const value = this.values[id];
		if (value === undefined) {
			throw new Error(`[StringPool] Unknown string id ${id}.`);
		}
		return value;
	}

	public codepointCount(id: StringId): number {
		return this.codepointCounts[id];
	}

	public trackedLuaHeapBytes(): number {
		return this.trackLuaHeap ? this.trackedBytes : 0;
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
			replaceTrackedLuaHeapBytes(previousBytes, this.trackedBytes);
			enforceLuaHeapBudget();
		}
	}

	private insert(id: StringId, text: string): StringId {
		this.values[id] = text;
		this.codepointCounts[id] = utf8CodepointCount(text);
		this.trackedByteLengths[id] = 0;
		this.byText.set(text, id);
		if (id >= this.nextId) {
			this.nextId = id + 1;
		}
		return id;
	}
}
