import { ceilLog2, nextPowerOfTwo } from '../common/numeric';
import { LUA_FAULT_REASON_INDEX_NIL } from '../../spec/blua32/cop0';
import { LuaExecutionError } from './errors';
import {
	VALUE_TAG,
	ValueTag,
	valueIsNumber,
	valueTag,
	type BuiltinFunction,
	type StringValue,
	type Value,
} from './value';
import type { Closure } from './closure';
import type { LuaHeap } from './lua_heap';

// start repeated-sequence-acceptable -- Lua table mutation hot paths keep direct array/hash updates instead of routing through dispatch helpers.

const TABLE_HEAP_BYTES = 32;
const TABLE_ARRAY_SLOT_HEAP_BYTES = 8;
const TABLE_HASH_SLOT_HEAP_BYTES = 20;
const TABLE_HASH_NEXT_END = -1;
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
	private hashDeadCount = 0;
	private tableMetatable: Table | null = null;
	private version = 1;

	private static readonly numberBuffer = new ArrayBuffer(8);
	private static readonly float64View = new Float64Array(Table.numberBuffer);
	private static readonly uint32View = new Uint32Array(Table.numberBuffer);
	private static readonly rehashIntegerCounts: number[] = [];

	constructor(
		private readonly luaHeap: LuaHeap,
		arraySize: number,
		hashCapacity: number,
	) {
		this.array = new Array<Value>(arraySize);
		this.array.fill(null);
		this.hashKeys = new Array<Value>(hashCapacity);
		this.hashKeys.fill(null);
		this.hashValues = new Array<Value>(hashCapacity);
		this.hashValues.fill(null);
		this.hashNext = new Int32Array(hashCapacity);
		this.hashNext.fill(TABLE_HASH_NEXT_END);
		this.hashFree = hashCapacity > 0 ? hashCapacity - 1 : -1;
	}

	public static hashCapacity(hashSize: number): number {
		return hashSize > 0 ? nextPowerOfTwo(hashSize) : 0;
	}

	public static trackedHeapBytesForCapacities(arrayCapacity: number, hashCapacity: number): number {
		return TABLE_HEAP_BYTES
			+ (arrayCapacity * TABLE_ARRAY_SLOT_HEAP_BYTES)
			+ (hashCapacity * TABLE_HASH_SLOT_HEAP_BYTES);
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
			throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
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
			throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
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
				if (this.hashValues[nodeIndex] === null) {
					this.hashDeadCount -= 1;
				}
				this.hashValues[nodeIndex] = value;
				this.bumpVersion();
				return;
			}
			if (this.hashKeys.length === 0 || this.hashFree < 0) {
				this.rehash(key, value);
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
			if (this.hashValues[nodeIndex] === null) {
				this.hashDeadCount -= 1;
			}
			this.hashValues[nodeIndex] = value;
			this.bumpVersion();
			return;
		}
		if (this.hashKeys.length === 0 || this.hashFree < 0) {
			this.rehash(key, value);
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
			if (this.hashValues[nodeIndex] === null) {
				this.hashDeadCount -= 1;
			}
			this.hashValues[nodeIndex] = value;
			this.bumpVersion();
			return;
		}
		if (this.hashKeys.length === 0 || this.hashFree < 0) {
			this.rehash(indexValue, value);
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
			if (this.hashValues[nodeIndex] === null) {
				this.hashDeadCount -= 1;
			}
			this.hashValues[nodeIndex] = value;
			this.bumpVersion();
			return;
		}
		if (this.hashKeys.length === 0 || this.hashFree < 0) {
			this.rehash(key, value);
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
		this.hashDeadCount = 0;
		this.bumpVersion();
		this.luaHeap.release(previousBytes - this.getTrackedHeapBytes());
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
			const value = this.hashValues[index];
			if (key !== null && value !== null) {
				visitor(key, value);
			}
		}
	}

	public clearWeakEntries(
		weakKeys: boolean,
		weakValues: boolean,
		valueIsAlive: (value: Value) => boolean,
	): void {
		let changed = false;
		if (weakValues) {
			for (let index = 0; index < this.array.length; index += 1) {
				const value = this.array[index];
				if (value === null || valueIsAlive(value)) {
					continue;
				}
				this.array[index] = null;
				if (index < this.arrayLength) {
					this.arrayLength = index;
				}
				changed = true;
			}
		}
		for (let index = 0; index < this.hashKeys.length; index += 1) {
			const key = this.hashKeys[index];
			const value = this.hashValues[index];
			if (key === null || value === null) {
				continue;
			}
			const keyIsAlive = !weakKeys || valueIsAlive(key);
			const valueIsStillAlive = !weakValues || valueIsAlive(value);
			if (keyIsAlive && valueIsStillAlive) {
				continue;
			}
			this.markHashNodeDead(index);
			changed = true;
		}
		if (changed) {
			this.bumpVersion();
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

	public restoreRuntimeState(state: TableRuntimeState): number {
		const previousBytes = this.getTrackedHeapBytes();
		this.array = state.array.slice();
		this.arrayLength = state.arrayLength;
		this.hashKeys = new Array<Value>(state.hash.length);
		this.hashValues = new Array<Value>(state.hash.length);
		this.hashNext = new Int32Array(state.hash.length);
		this.hashDeadCount = 0;
		let maxDeadKeyHashId = 0;
		for (let index = 0; index < state.hash.length; index += 1) {
			const node = state.hash[index];
			this.hashKeys[index] = node.key;
			this.hashValues[index] = node.value;
			this.hashNext[index] = node.next;
			if ((node.key === null) !== (node.value === null)) {
				this.hashDeadCount += 1;
				if (node.key === null) {
					const deadKeyHashId = node.value as number;
					if (deadKeyHashId > maxDeadKeyHashId) {
						maxDeadKeyHashId = deadKeyHashId;
					}
				}
			}
		}
		this.hashFree = state.hashFree;
		this.tableMetatable = state.metatable;
		this.bumpVersion();
		this.luaHeap.adjustForRestore(previousBytes, this.getTrackedHeapBytes());
		return maxDeadKeyHashId;
	}

	public getTrackedHeapBytes(): number {
		return Table.trackedHeapBytesForCapacities(this.array.length, this.hashKeys.length);
	}

	public prepareRestoreStorage(arrayCapacity: number, hashCapacity: number): void {
		const previousBytes = this.getTrackedHeapBytes();
		this.array = new Array<Value>(arrayCapacity);
		this.array.fill(null);
		this.arrayLength = 0;
		this.hashKeys = new Array<Value>(hashCapacity);
		this.hashKeys.fill(null);
		this.hashValues = new Array<Value>(hashCapacity);
		this.hashValues.fill(null);
		this.hashNext = new Int32Array(hashCapacity);
		this.hashNext.fill(TABLE_HASH_NEXT_END);
		this.hashFree = hashCapacity > 0 ? hashCapacity - 1 : -1;
		this.hashDeadCount = 0;
		this.bumpVersion();
		this.luaHeap.adjustForRestore(previousBytes, this.getTrackedHeapBytes());
	}

	public nextEntry(after: Value): [Value, Value] | null {
		let hashIndex = -1;
		if (after === null) {
			for (let index = 0; index < this.array.length; index += 1) {
				const value = this.array[index];
				if (value !== null) {
					return [index + 1, value];
				}
			}
			hashIndex = this.findNextLiveHashIndex(0);
		} else {
			const index = this.getArrayIndex(after);
			if (index !== null && index < this.array.length) {
				for (let cursor = index + 1; cursor < this.array.length; cursor += 1) {
					const value = this.array[cursor];
					if (value !== null) {
						return [cursor + 1, value];
					}
				}
				hashIndex = this.findNextLiveHashIndex(0);
			} else {
				const nodeIndex = this.findNodeIndexForNext(after);
				if (nodeIndex < 0) {
					return null;
				}
				hashIndex = this.findNextLiveHashIndex(nodeIndex + 1);
			}
		}
		if (hashIndex >= 0) {
			return [this.hashKeys[hashIndex], this.hashValues[hashIndex]];
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
		let hashIndex = this.findNextLiveHashIndex(hashStart);
		if (hashCursor > 0
			&& hashIndex === hashCursor - 1
			&& previousHashKey !== null
			&& this.keyEquals(this.hashKeys[hashIndex], previousHashKey)) {
			hashIndex = this.findNextLiveHashIndex(hashIndex + 1);
		}
		if (hashIndex >= 0) {
			return [
				this.array.length,
				hashIndex + 1,
				this.hashKeys[hashIndex],
				this.hashValues[hashIndex],
			];
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
				return ((key as Table | Closure).hashId * 2654435761) >>> 0;
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

	private findNextLiveHashIndex(start: number): number {
		for (let index = start; index < this.hashKeys.length; index += 1) {
			if (this.hashKeys[index] !== null && this.hashValues[index] !== null) {
				return index;
			}
		}
		return -1;
	}

	private findNodeIndexForNext(key: Value): number {
		if (this.hashKeys.length === 0) {
			return -1;
		}
		let deadKeyHashId = 0;
		switch (valueTag(key)) {
			case ValueTag.Table:
			case ValueTag.Closure:
				deadKeyHashId = (key as Table | Closure).hashId;
				break;
		}
		const mask = this.hashKeys.length - 1;
		let index = (this.hashValue(key) & mask) >>> 0;
		while (index >= 0) {
			const nodeKey = this.hashKeys[index];
			if ((nodeKey !== null && this.keyEquals(nodeKey, key))
				|| (nodeKey === null
					&& deadKeyHashId !== 0
					&& this.hashValues[index] === deadKeyHashId)) {
				return index;
			}
			index = this.hashNext[index];
		}
		return -1;
	}

	private getFreeIndex(): number {
		const start = this.hashFree >= 0 ? this.hashFree : this.hashKeys.length - 1;
		for (let i = start; i >= 0; i -= 1) {
			if (this.hashKeys[i] === null && this.hashValues[i] === null) {
				this.hashFree = i - 1;
				return i;
			}
		}
		this.hashFree = -1;
		return -1;
	}

	private rehash(key: Value, value: Value): void {
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
			if (key !== null && this.hashValues[i] !== null) {
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
		this.resize(arraySize, hashSize, key, value);
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

	private resize(newArraySize: number, newHashSize: number, key: Value, value: Value): void {
		const previousBytes = this.getTrackedHeapBytes();
		const resizedBytes = Table.trackedHeapBytesForCapacities(newArraySize, newHashSize);
		if (resizedBytes > previousBytes) {
			this.luaHeap.reserve(resizedBytes - previousBytes, this, key, value);
		}
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
		this.hashNext.fill(TABLE_HASH_NEXT_END);
		this.hashFree = newHashSize > 0 ? newHashSize - 1 : -1;
		this.hashDeadCount = 0;

		for (let i = 0; i < oldArray.length; i += 1) {
			if (oldArray[i] !== null) {
				this.rawSet(i + 1, oldArray[i]);
			}
		}
		for (let i = 0; i < oldHashKeys.length; i += 1) {
			const key = oldHashKeys[i];
			if (key !== null && oldHashValues[i] !== null) {
				this.rawSet(key, oldHashValues[i]);
			}
		}
		if (resizedBytes < previousBytes) {
			this.luaHeap.release(previousBytes - resizedBytes);
		}
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
		if (this.hashDeadCount > 0) {
			this.rehash(key, value);
			this.rawSet(key, value);
			return;
		}
		if (this.hashKeys.length === 0) {
			this.rehash(key, value);
			this.rawSet(key, value);
			return;
		}
		const mask = this.hashKeys.length - 1;
		const mainIndex = (this.hashValue(key) & mask) >>> 0;
		const mainKey = this.hashKeys[mainIndex];
		if (mainKey === null) {
			this.hashKeys[mainIndex] = key;
			this.hashValues[mainIndex] = value;
			this.hashNext[mainIndex] = TABLE_HASH_NEXT_END;
			return;
		}
		const freeIndex = this.getFreeIndex();
		if (freeIndex < 0) {
			this.rehash(key, value);
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
			this.hashNext[mainIndex] = TABLE_HASH_NEXT_END;
			return;
		}
		this.hashKeys[freeIndex] = key;
		this.hashValues[freeIndex] = value;
		this.hashNext[freeIndex] = this.hashNext[mainIndex];
		this.hashNext[mainIndex] = freeIndex;
	}

	private removeFromHash(key: Value): void {
		const existingIndex = this.findNodeIndex(key);
		if (existingIndex < 0 || this.hashValues[existingIndex] === null) {
			return;
		}
		if (this.hashDeadCount > 0) {
			this.rehash(null, null);
			const arrayIndex = this.getArrayIndex(key);
			if (arrayIndex !== null && arrayIndex < this.array.length) {
				this.array[arrayIndex] = null;
				return;
			}
		}
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
					this.hashNext[index] = TABLE_HASH_NEXT_END;
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
					this.hashNext[next] = TABLE_HASH_NEXT_END;
					if (next > this.hashFree) {
						this.hashFree = next;
					}
					return;
				}
				this.hashKeys[index] = null;
				this.hashValues[index] = null;
				this.hashNext[index] = TABLE_HASH_NEXT_END;
				if (index > this.hashFree) {
					this.hashFree = index;
				}
				return;
			}
			prev = index;
			index = this.hashNext[index];
		}
	}

	private markHashNodeDead(index: number): void {
		const key = this.hashKeys[index];
		switch (valueTag(key)) {
			case ValueTag.Table:
			case ValueTag.Closure:
				this.hashKeys[index] = null;
				this.hashValues[index] = (key as Table | Closure).hashId;
				break;
			default:
				this.hashValues[index] = null;
		}
		this.hashDeadCount += 1;
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
		const nodeIndex = this.findNodeIndex(key);
		return nodeIndex >= 0 && this.hashValues[nodeIndex] !== null;
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
