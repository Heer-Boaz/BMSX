import { ceilLog2, nextPowerOfTwo } from '../common/numeric';
import { LUA_FAULT_REASON_INDEX_NIL } from './cop0';
import { LuaExecutionError } from './errors';
import { addTrackedLuaHeapBytes } from '../memory/lua_heap_usage';
import {
	VALUE_TAG,
	ValueTag,
	valueIsNumber,
	valueTag,
	type BuiltinFunction,
	type NativeFunction,
	type NativeObject,
	type StringValue,
	type Value,
} from './value';
import type { Closure } from './closure';

// start repeated-sequence-acceptable -- Lua table mutation hot paths keep direct array/hash updates instead of routing through dispatch helpers.

const TABLE_HEAP_BYTES = 32;
const TABLE_ARRAY_SLOT_HEAP_BYTES = 8;
const TABLE_HASH_SLOT_HEAP_BYTES = 20;
const EMPTY_TABLE_HASH_NEXT = new Int32Array(0);

type HashNode = {
	key: Value;
	value: Value;
	next: number;
};

export type TableRuntimeState = {
	array: Value[];
	arrayLength: number;
	hash: HashNode[];
	hashFree: number;
	metatable: Table | null;
};

export class Table {
	public readonly [VALUE_TAG] = ValueTag.Table;
	public hashId = 0;
	private array: Value[];
	public arrayLength = 0;
	private hashKeys: Value[];
	private hashValues: Value[];
	private hashNext: Int32Array;
	private hashFree = -1;
	private tableMetatable: Table | null = null;
	private version = 1;

	private static readonly numberBuffer = new ArrayBuffer(8);
	private static readonly float64View = new Float64Array(Table.numberBuffer);
	private static readonly uint32View = new Uint32Array(Table.numberBuffer);
	private static readonly rehashIntegerCounts: number[] = [];

	constructor(arraySize: number, hashSize: number) {
		this.array = new Array<Value>(arraySize);
		this.array.fill(null);
		const size = hashSize > 0 ? nextPowerOfTwo(hashSize) : 0;
		this.hashKeys = new Array<Value>(size);
		this.hashKeys.fill(null);
		this.hashValues = new Array<Value>(size);
		this.hashValues.fill(null);
		this.hashNext = new Int32Array(size);
		this.hashNext.fill(-1);
		this.hashFree = size > 0 ? size - 1 : -1;
		addTrackedLuaHeapBytes(this.getTrackedHeapBytes());
	}

	public get metatable(): Table | null {
		return this.tableMetatable;
	}

	public set metatable(metatable: Table | null) {
		this.tableMetatable = metatable;
		this.bumpVersion();
	}

	public get(key: Value): Value {
		if (key === null) {
			throw new LuaExecutionError('Table index is nil.', LUA_FAULT_REASON_INDEX_NIL);
		}
		const index = this.getArrayIndex(key);
		if (index !== null && index < this.array.length) {
			return this.array[index];
		}
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			return this.hashValues[nodeIndex];
		}
		return null;
	}

	public set(key: Value, value: Value): void {
		if (key === null) {
			throw new LuaExecutionError('Table index is nil.', LUA_FAULT_REASON_INDEX_NIL);
		}
		const index = this.getArrayIndex(key);
		if (index !== null) {
			if (index < this.array.length) {
				if (value === null) {
					this.array[index] = value;
					if (index < this.arrayLength) {
						this.arrayLength = index;
					}
					this.bumpVersion();
					return;
				}
				this.array[index] = value;
				if (index === this.arrayLength) {
					this.updateArrayLengthFrom(this.arrayLength);
				}
				this.bumpVersion();
				return;
			}
			if (value === null) {
				this.removeFromHash(key);
				if (index < this.arrayLength) {
					this.arrayLength = index;
				}
				this.bumpVersion();
				return;
			}
			const nodeIndex = this.findNodeIndex(key);
			if (nodeIndex >= 0) {
				this.hashValues[nodeIndex] = value;
				this.bumpVersion();
				return;
			}
			if (this.hashKeys.length === 0 || this.hashFree < 0) {
				this.rehash(key);
			}
			this.rawSet(key, value);
			this.bumpVersion();
			return;
		}
		if (value === null) {
			this.removeFromHash(key);
			this.bumpVersion();
			return;
		}
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			this.hashValues[nodeIndex] = value;
			this.bumpVersion();
			return;
		}
		if (this.hashKeys.length === 0 || this.hashFree < 0) {
			this.rehash(key);
		}
		this.rawSet(key, value);
		this.bumpVersion();
	}

	public getInteger(indexValue: number): Value {
		const index = indexValue - 1;
		if (index >= 0 && index < this.array.length) {
			return this.array[index];
		}
		const nodeIndex = this.findNodeIndex(indexValue);
		if (nodeIndex >= 0) {
			return this.hashValues[nodeIndex];
		}
		return null;
	}

	public setInteger(indexValue: number, value: Value): void {
		const index = indexValue - 1;
		if (index >= 0 && index < this.array.length) {
			if (value === null) {
				this.array[index] = value;
				if (index < this.arrayLength) {
					this.arrayLength = index;
				}
				this.bumpVersion();
				return;
			}
			this.array[index] = value;
			if (index === this.arrayLength) {
				this.updateArrayLengthFrom(this.arrayLength);
			}
			this.bumpVersion();
			return;
		}
		if (value === null) {
			this.removeFromHash(indexValue);
			if (index >= 0 && index < this.arrayLength) {
				this.arrayLength = index;
			}
			this.bumpVersion();
			return;
		}
		const nodeIndex = this.findNodeIndex(indexValue);
		if (nodeIndex >= 0) {
			this.hashValues[nodeIndex] = value;
			this.bumpVersion();
			return;
		}
		if (this.hashKeys.length === 0 || this.hashFree < 0) {
			this.rehash(indexValue);
		}
		this.rawSet(indexValue, value);
		this.bumpVersion();
	}

	public getStringKey(key: StringValue): Value {
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			return this.hashValues[nodeIndex];
		}
		return null;
	}

	public setStringKey(key: StringValue, value: Value): void {
		if (value === null) {
			this.removeFromHash(key);
			this.bumpVersion();
			return;
		}
		const nodeIndex = this.findNodeIndex(key);
		if (nodeIndex >= 0) {
			this.hashValues[nodeIndex] = value;
			this.bumpVersion();
			return;
		}
		if (this.hashKeys.length === 0 || this.hashFree < 0) {
			this.rehash(key);
		}
		this.rawSet(key, value);
		this.bumpVersion();
	}

	public clear(): void {
		const previousBytes = this.getTrackedHeapBytes();
		this.array.length = 0;
		this.arrayLength = 0;
		this.hashKeys.length = 0;
		this.hashValues.length = 0;
		this.hashNext = EMPTY_TABLE_HASH_NEXT;
		this.hashFree = -1;
		this.bumpVersion();
		addTrackedLuaHeapBytes(this.getTrackedHeapBytes() - previousBytes);
	}

	public forEachEntry(visitor: (key: Value, value: Value) => void): void {
		for (let index = 0; index < this.array.length; index += 1) {
			const value = this.array[index];
			if (value === null) {
				continue;
			}
			visitor(index + 1, value);
		}
		for (let index = 0; index < this.hashKeys.length; index += 1) {
			const key = this.hashKeys[index];
			if (key !== null) {
				visitor(key, this.hashValues[index]);
			}
		}
	}

	public getVersion(): number {
		return this.version;
	}

	public captureRuntimeState(): TableRuntimeState {
		const array = this.array.slice();
		const hash: HashNode[] = new Array(this.hashKeys.length);
		for (let index = 0; index < this.hashKeys.length; index += 1) {
			hash[index] = { key: this.hashKeys[index], value: this.hashValues[index], next: this.hashNext[index] };
		}
		return {
			array,
			arrayLength: this.arrayLength,
			hash,
			hashFree: this.hashFree,
			metatable: this.tableMetatable,
		};
	}

	public restoreRuntimeState(state: TableRuntimeState): void {
		const previousBytes = this.getTrackedHeapBytes();
		this.array = state.array.slice();
		this.arrayLength = state.arrayLength;
		this.hashKeys = new Array<Value>(state.hash.length);
		this.hashValues = new Array<Value>(state.hash.length);
		this.hashNext = new Int32Array(state.hash.length);
		for (let index = 0; index < state.hash.length; index += 1) {
			const node = state.hash[index];
			this.hashKeys[index] = node.key;
			this.hashValues[index] = node.value;
			this.hashNext[index] = node.next;
		}
		this.hashFree = state.hashFree;
		this.tableMetatable = state.metatable;
		this.bumpVersion();
		addTrackedLuaHeapBytes(this.getTrackedHeapBytes() - previousBytes);
	}

	public walkTrackedValues(visitor: (value: Value) => void): void {
		visitor(this.tableMetatable);
		for (let index = 0; index < this.array.length; index += 1) {
			const value = this.array[index];
			if (value !== null) {
				visitor(value);
			}
		}
		for (let index = 0; index < this.hashKeys.length; index += 1) {
			visitor(this.hashKeys[index]);
			visitor(this.hashValues[index]);
		}
	}

	public getTrackedHeapBytes(): number {
		return TABLE_HEAP_BYTES
			+ (this.array.length * TABLE_ARRAY_SLOT_HEAP_BYTES)
			+ (this.hashKeys.length * TABLE_HASH_SLOT_HEAP_BYTES);
	}

	public nextEntry(after: Value): [Value, Value] | null {
		if (after === null) {
			for (let index = 0; index < this.array.length; index += 1) {
				const value = this.array[index];
				if (value !== null) {
					return [index + 1, value];
				}
			}
			for (let index = 0; index < this.hashKeys.length; index += 1) {
				const key = this.hashKeys[index];
				if (key !== null) {
					return [key, this.hashValues[index]];
				}
			}
			return null;
		}
		const index = this.getArrayIndex(after);
		if (index !== null && index < this.array.length) {
			if (this.array[index] === null) {
				return null;
			}
			for (let cursor = index + 1; cursor < this.array.length; cursor += 1) {
				const value = this.array[cursor];
				if (value !== null) {
					return [cursor + 1, value];
				}
			}
			for (let i = 0; i < this.hashKeys.length; i += 1) {
				const key = this.hashKeys[i];
				if (key !== null) {
					return [key, this.hashValues[i]];
				}
			}
			return null;
		}
		const nodeIndex = this.findNodeIndex(after);
		if (nodeIndex < 0) {
			return null;
		}
		for (let i = nodeIndex + 1; i < this.hashKeys.length; i += 1) {
			const key = this.hashKeys[i];
			if (key !== null) {
				return [key, this.hashValues[i]];
			}
		}
		return null;
	}

	public nextEntryFromCursor(arrayCursor: number, hashCursor: number, previousHashKey: Value = null): [number, number, Value, Value] | null {
		for (let index = arrayCursor; index < this.array.length; index += 1) {
			const value = this.array[index];
			if (value !== null) {
				return [index + 1, 0, index + 1, value];
			}
		}
		const hashStart = hashCursor > 0 ? hashCursor - 1 : 0;
		for (let index = hashStart; index < this.hashKeys.length; index += 1) {
			const key = this.hashKeys[index];
			if (key !== null) {
				if (hashCursor > 0 && index === hashCursor - 1 && previousHashKey !== null && this.keyEquals(key, previousHashKey)) {
					continue;
				}
				return [this.array.length, index + 1, key, this.hashValues[index]];
			}
		}
		return null;
	}

	private hashValue(key: Value): number {
		switch (valueTag(key)) {
			case ValueTag.Number: {
				const numberKey = key as number;
				const normalized = numberKey === 0 ? 0 : numberKey;
				if (normalized !== normalized) {
					return 0x7ff80000;
				}
				Table.float64View[0] = normalized;
				return (Table.uint32View[0] ^ Table.uint32View[1]) >>> 0;
			}
			case ValueTag.False:
				return 0x85ebca6b;
			case ValueTag.True:
				return 0x9e3779b9;
			case ValueTag.String:
				return ((key as StringValue).id * 2654435761) >>> 0;
			case ValueTag.BuiltinFunction:
				return (((key as BuiltinFunction).id + 1) * 0x27d4eb2d) >>> 0;
			case ValueTag.Table:
			case ValueTag.Closure:
			case ValueTag.NativeFunction:
			case ValueTag.NativeObject:
				return ((key as Table | Closure | NativeFunction | NativeObject).hashId * 2654435761) >>> 0;
			case ValueTag.Nil:
				return 0x27d4eb2d;
		}
	}

	private keyEquals(a: Value, b: Value): boolean {
		const tag = valueTag(a);
		if (tag !== valueTag(b)) {
			return false;
		}
		switch (tag) {
			case ValueTag.Number: {
				const left = a as number;
				const right = b as number;
				return left === right || (left !== left && right !== right);
			}
			case ValueTag.String:
				return (a as StringValue).id === (b as StringValue).id;
			default:
				return a === b;
		}
	}

	private findNodeIndex(key: Value): number {
		if (this.hashKeys.length === 0) {
			return -1;
		}
		const mask = this.hashKeys.length - 1;
		let index = (this.hashValue(key) & mask) >>> 0;
		while (index >= 0) {
			const nodeKey = this.hashKeys[index];
			if (nodeKey !== null && this.keyEquals(nodeKey, key)) {
				return index;
			}
			index = this.hashNext[index];
		}
		return -1;
	}

	private getFreeIndex(): number {
		const start = this.hashFree >= 0 ? this.hashFree : this.hashKeys.length - 1;
		for (let i = start; i >= 0; i -= 1) {
			if (this.hashKeys[i] === null) {
				this.hashFree = i - 1;
				return i;
			}
		}
		this.hashFree = -1;
		return -1;
	}

	private rehash(key: Value): void {
		let totalKeys = 0;
		const counts = Table.rehashIntegerCounts;
		let countBins = 0;

		for (let i = 0; i < this.array.length; i += 1) {
			if (this.array[i] !== null) {
				totalKeys += 1;
				countBins = Table.countRehashIntegerKey(counts, countBins, i + 1);
			}
		}
		for (let i = 0; i < this.hashKeys.length; i += 1) {
			const key = this.hashKeys[i];
			if (key !== null) {
				totalKeys += 1;
				const index = this.getArrayIndex(key);
				if (index !== null) {
					countBins = Table.countRehashIntegerKey(counts, countBins, index + 1);
				}
			}
		}
		if (key !== null) {
			totalKeys += 1;
			const index = this.getArrayIndex(key);
			if (index !== null) {
				countBins = Table.countRehashIntegerKey(counts, countBins, index + 1);
			}
		}

		let arraySize = 0;
		let arrayKeys = 0;
		let total = 0;
		let power = 1;
		for (let i = 0; i < countBins; i += 1) {
			total += counts[i];
			if (total > power / 2) {
				arraySize = power;
				arrayKeys = total;
			}
			power *= 2;
		}

		const hashKeys = totalKeys - arrayKeys;
		const hashSize = hashKeys > 0 ? nextPowerOfTwo(hashKeys) : 0;
		this.resize(arraySize, hashSize);
	}

	private static countRehashIntegerKey(counts: number[], countBins: number, index: number): number {
		const log = ceilLog2(index);
		while (countBins <= log) {
			counts[countBins] = 0;
			countBins += 1;
		}
		counts[log] += 1;
		return countBins;
	}

	private resize(newArraySize: number, newHashSize: number): void {
		const previousBytes = this.getTrackedHeapBytes();
		const oldArray = this.array;
		const oldHashKeys = this.hashKeys;
		const oldHashValues = this.hashValues;

		this.array = new Array<Value>(newArraySize);
		this.array.fill(null);
		this.arrayLength = 0;
		this.hashKeys = new Array<Value>(newHashSize);
		this.hashKeys.fill(null);
		this.hashValues = new Array<Value>(newHashSize);
		this.hashValues.fill(null);
		this.hashNext = new Int32Array(newHashSize);
		this.hashNext.fill(-1);
		this.hashFree = newHashSize > 0 ? newHashSize - 1 : -1;

		for (let i = 0; i < oldArray.length; i += 1) {
			if (oldArray[i] !== null) {
				this.rawSet(i + 1, oldArray[i]);
			}
		}
		for (let i = 0; i < oldHashKeys.length; i += 1) {
			const key = oldHashKeys[i];
			if (key !== null) {
				this.rawSet(key, oldHashValues[i]);
			}
		}
		addTrackedLuaHeapBytes(this.getTrackedHeapBytes() - previousBytes);
	}

	private rawSet(key: Value, value: Value): void {
		const index = this.getArrayIndex(key);
		if (index !== null && index < this.array.length) {
			this.array[index] = value;
			if (value === null) {
				if (index < this.arrayLength) {
					this.arrayLength = index;
				}
			} else if (index === this.arrayLength) {
				this.updateArrayLengthFrom(this.arrayLength);
			}
			return;
		}
		this.insertHash(key, value);
		if (index !== null && index === this.arrayLength) {
			this.updateArrayLengthFrom(this.arrayLength);
		}
	}

	private insertHash(key: Value, value: Value): void {
		if (this.hashKeys.length === 0) {
			this.rehash(key);
			this.rawSet(key, value);
			return;
		}
		const mask = this.hashKeys.length - 1;
		const mainIndex = (this.hashValue(key) & mask) >>> 0;
		const mainKey = this.hashKeys[mainIndex];
		if (mainKey === null) {
			this.hashKeys[mainIndex] = key;
			this.hashValues[mainIndex] = value;
			this.hashNext[mainIndex] = -1;
			return;
		}
		const freeIndex = this.getFreeIndex();
		if (freeIndex < 0) {
			this.rehash(key);
			this.rawSet(key, value);
			return;
		}
		const mainIndexOfOccupied = (this.hashValue(mainKey) & mask) >>> 0;
		if (mainIndexOfOccupied !== mainIndex) {
			this.hashKeys[freeIndex] = mainKey;
			this.hashValues[freeIndex] = this.hashValues[mainIndex];
			this.hashNext[freeIndex] = this.hashNext[mainIndex];
			let prev = mainIndexOfOccupied;
			while (this.hashNext[prev] !== mainIndex) {
				prev = this.hashNext[prev];
			}
			this.hashNext[prev] = freeIndex;
			this.hashKeys[mainIndex] = key;
			this.hashValues[mainIndex] = value;
			this.hashNext[mainIndex] = -1;
			return;
		}
		this.hashKeys[freeIndex] = key;
		this.hashValues[freeIndex] = value;
		this.hashNext[freeIndex] = this.hashNext[mainIndex];
		this.hashNext[mainIndex] = freeIndex;
	}

	private removeFromHash(key: Value): void {
		if (this.hashKeys.length === 0) {
			return;
		}
		const mask = this.hashKeys.length - 1;
		const mainIndex = (this.hashValue(key) & mask) >>> 0;
		let prev = -1;
		let index = mainIndex;
		while (index >= 0) {
			const nodeKey = this.hashKeys[index];
			if (nodeKey !== null && this.keyEquals(nodeKey, key)) {
				const next = this.hashNext[index];
				if (prev >= 0) {
					this.hashNext[prev] = next;
					this.hashKeys[index] = null;
					this.hashValues[index] = null;
					this.hashNext[index] = -1;
					if (index > this.hashFree) {
						this.hashFree = index;
					}
					return;
				}
				if (next >= 0) {
					this.hashKeys[index] = this.hashKeys[next];
					this.hashValues[index] = this.hashValues[next];
					this.hashNext[index] = this.hashNext[next];
					this.hashKeys[next] = null;
					this.hashValues[next] = null;
					this.hashNext[next] = -1;
					if (next > this.hashFree) {
						this.hashFree = next;
					}
					return;
				}
				this.hashKeys[index] = null;
				this.hashValues[index] = null;
				this.hashNext[index] = -1;
				if (index > this.hashFree) {
					this.hashFree = index;
				}
				return;
			}
			prev = index;
			index = this.hashNext[index];
		}
	}

	private getArrayIndex(key: Value): number | null {
		if (!valueIsNumber(key)) {
			return null;
		}
		if (key - key !== 0) {
			return null;
		}
		if (key < 1) {
			return null;
		}
		if (key % 1 !== 0) {
			return null;
		}
		return key - 1;
	}

	private hasArrayIndex(index: number): boolean {
		if (index < this.array.length) {
			const value = this.array[index];
			return value !== null;
		}
		const key = index + 1;
		return this.findNodeIndex(key) >= 0;
	}

	private updateArrayLengthFrom(startIndex: number): void {
		let newLength = startIndex;
		while (this.hasArrayIndex(newLength)) {
			newLength += 1;
		}
		this.arrayLength = newLength;
	}

	private bumpVersion(): void {
		this.version = (this.version + 1) >>> 0;
		if (this.version === 0) {
			this.version = 1;
		}
	}
}
