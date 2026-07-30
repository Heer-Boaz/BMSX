import { ceilLog2, nextPowerOfTwo } from '../common/numeric';
import { LUA_FAULT_REASON_INDEX_NIL } from '../../spec/blua32/cop0';
import { LuaExecutionError } from './errors';
import type { Closure } from './closure';
import type { LuaHeap } from './lua_heap';
import type { StringId } from './string_pool';
import {
	VALUE_TAG,
	ValueTag,
	asStringId,
	materializeValue,
	valueFromNumber,
	valueTag,
	type BuiltinFunction,
	type StringValue,
	type Value,
	type ValueReference,
} from './value';
import type { ValueWriteTarget } from './value_slots';

// start repeated-sequence-acceptable -- Lua table mutation hot paths keep direct column writes instead of routing through host-value dispatch.

const TABLE_HEAP_BYTES = 32;
const TABLE_ARRAY_SLOT_HEAP_BYTES = 8;
const TABLE_HASH_SLOT_HEAP_BYTES = 20;
const TABLE_HASH_NEXT_END = -1;
const TABLE_MAX_ARRAY_INDEX = 0x7fffffff;
const TABLE_ENTRY_MISSING = -1;
const TABLE_HASH_ENTRY_BASE = -2;
const EMPTY_TABLE_HASH_NEXT = new Int32Array(0);

export type TableRuntimeState = {
	tags: Uint8Array;
	scalars: Float64Array;
	references: ValueReference[];
	arrayCapacity: number;
	arrayLength: number;
	hashSize: number;
	hashNext: Int32Array;
	hashFree: number;
	metatable: Table | null;
};

type StoredEntryVisitor = (
	keyTag: ValueTag,
	keyScalar: number,
	keyReference: ValueReference,
	valueTag: ValueTag,
	valueScalar: number,
	valueReference: ValueReference,
) => void;

type StoredValuePredicate = (
	tag: ValueTag,
	scalar: number,
	reference: ValueReference,
) => boolean;

export class Table {
	public readonly [VALUE_TAG] = ValueTag.Table;
	public hashId = 0;
	public arrayLength = 0;
	private tags: Uint8Array;
	private scalars: Float64Array;
	private references: ValueReference[];
	private arrayCapacity: number;
	private hashSize: number;
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
		this.arrayCapacity = arraySize;
		this.hashSize = hashCapacity;
		const slotCount = arraySize + (hashCapacity * 2);
		this.tags = new Uint8Array(slotCount);
		this.scalars = new Float64Array(slotCount);
		this.scalars.fill(NaN);
		this.references = new Array<ValueReference>(slotCount);
		this.references.fill(null);
		this.hashNext = hashCapacity === 0 ? EMPTY_TABLE_HASH_NEXT : new Int32Array(hashCapacity);
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
		const tag = valueTag(key);
		switch (tag) {
			case ValueTag.Nil:
			case ValueTag.False:
			case ValueTag.True:
				return this.getByParts(tag, NaN, null);
			case ValueTag.Number:
				return this.getByParts(tag, key as number, null);
			case ValueTag.String:
				return this.getByParts(tag, asStringId(key as StringValue), null);
			case ValueTag.BuiltinFunction:
				return this.getByParts(tag, (key as BuiltinFunction).id, null);
			case ValueTag.Table:
			case ValueTag.Closure:
				return this.getByParts(tag, NaN, key as Table | Closure);
		}
	}

	public set(key: Value, value: Value): void {
		const tag = valueTag(key);
		switch (tag) {
			case ValueTag.Nil:
			case ValueTag.False:
			case ValueTag.True:
				this.setHostValue(tag, NaN, null, value);
				return;
			case ValueTag.Number:
				this.setHostValue(tag, valueFromNumber(key as number), null, value);
				return;
			case ValueTag.String:
				this.setHostValue(tag, asStringId(key as StringValue), null, value);
				return;
			case ValueTag.BuiltinFunction:
				this.setHostValue(tag, (key as BuiltinFunction).id, null, value);
				return;
			case ValueTag.Table:
			case ValueTag.Closure:
				this.setHostValue(tag, NaN, key as Table | Closure, value);
				return;
		}
	}

	public load(
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		target: ValueWriteTarget,
		targetIndex: number,
	): void {
		if (keyTag === ValueTag.Nil) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		}
		const arrayIndex = this.getArrayIndex(keyTag, keyScalar);
		if (arrayIndex >= 0 && arrayIndex < this.arrayCapacity) {
			target.setEncoded(
				targetIndex,
				this.tags[arrayIndex],
				this.scalars[arrayIndex],
				this.references[arrayIndex],
			);
			return;
		}
		const nodeIndex = this.findNodeIndex(keyTag, keyScalar, keyReference);
		if (nodeIndex >= 0) {
			const valueSlot = this.hashValueSlot(nodeIndex);
			target.setEncoded(
				targetIndex,
				this.tags[valueSlot],
				this.scalars[valueSlot],
				this.references[valueSlot],
			);
			return;
		}
		target.setNil(targetIndex);
	}

	public getInteger(indexValue: number): Value {
		const index = indexValue - 1;
		if (index >= 0 && index < this.arrayCapacity) {
			return this.valueAt(index);
		}
		const nodeIndex = this.findNodeIndex(ValueTag.Number, indexValue, null);
		return nodeIndex >= 0 ? this.valueAt(this.hashValueSlot(nodeIndex)) : null;
	}

	public loadInteger(indexValue: number, target: ValueWriteTarget, targetIndex: number): void {
		const index = indexValue - 1;
		if (index >= 0 && index < this.arrayCapacity) {
			target.setEncoded(
				targetIndex,
				this.tags[index],
				this.scalars[index],
				this.references[index],
			);
			return;
		}
		const nodeIndex = this.findNodeIndex(ValueTag.Number, indexValue, null);
		if (nodeIndex >= 0) {
			const valueSlot = this.hashValueSlot(nodeIndex);
			target.setEncoded(
				targetIndex,
				this.tags[valueSlot],
				this.scalars[valueSlot],
				this.references[valueSlot],
			);
			return;
		}
		target.setNil(targetIndex);
	}

	public setInteger(indexValue: number, value: Value): void {
		this.setHostValue(ValueTag.Number, indexValue, null, value);
	}

	public storeInteger(
		indexValue: number,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void {
		this.store(
			ValueTag.Number,
			indexValue,
			null,
			valueTag,
			valueScalar,
			valueReference,
		);
	}

	public getStringKey(key: StringValue): Value {
		const nodeIndex = this.findNodeIndex(ValueTag.String, asStringId(key), null);
		return nodeIndex >= 0 ? this.valueAt(this.hashValueSlot(nodeIndex)) : null;
	}

	public loadStringKey(key: StringId, target: ValueWriteTarget, targetIndex: number): void {
		const nodeIndex = this.findNodeIndex(ValueTag.String, key, null);
		if (nodeIndex >= 0) {
			const valueSlot = this.hashValueSlot(nodeIndex);
			target.setEncoded(
				targetIndex,
				this.tags[valueSlot],
				this.scalars[valueSlot],
				this.references[valueSlot],
			);
			return;
		}
		target.setNil(targetIndex);
	}

	public setStringKey(key: StringValue, value: Value): void {
		this.setHostValue(ValueTag.String, asStringId(key), null, value);
	}

	public storeStringKey(
		key: StringId,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void {
		this.store(
			ValueTag.String,
			key,
			null,
			valueTag,
			valueScalar,
			valueReference,
		);
	}

	public clear(): void {
		const previousBytes = this.getTrackedHeapBytes();
		this.arrayCapacity = 0;
		this.arrayLength = 0;
		this.hashSize = 0;
		this.tags = new Uint8Array(0);
		this.scalars = new Float64Array(0);
		this.references = [];
		this.hashNext = EMPTY_TABLE_HASH_NEXT;
		this.hashFree = -1;
		this.hashDeadCount = 0;
		this.bumpVersion();
		this.luaHeap.release(previousBytes - this.getTrackedHeapBytes());
	}

	public forEachStoredEntry(visitor: StoredEntryVisitor): void {
		for (let index = 0; index < this.arrayCapacity; index += 1) {
			const valueTag = this.tags[index];
			if (valueTag === ValueTag.Nil) {
				continue;
			}
			visitor(
				ValueTag.Number,
				index + 1,
				null,
				valueTag,
				this.scalars[index],
				this.references[index],
			);
		}
		for (let index = 0; index < this.hashSize; index += 1) {
			const keySlot = this.hashKeySlot(index);
			const valueSlot = this.hashValueSlot(index);
			if (this.tags[keySlot] === ValueTag.Nil || this.tags[valueSlot] === ValueTag.Nil) {
				continue;
			}
			visitor(
				this.tags[keySlot],
				this.scalars[keySlot],
				this.references[keySlot],
				this.tags[valueSlot],
				this.scalars[valueSlot],
				this.references[valueSlot],
			);
		}
	}

	public clearWeakEntries(
		weakKeys: boolean,
		weakValues: boolean,
		valueIsAlive: StoredValuePredicate,
	): void {
		let changed = false;
		if (weakValues) {
			for (let index = 0; index < this.arrayCapacity; index += 1) {
				const tag = this.tags[index];
				if (tag === ValueTag.Nil
					|| valueIsAlive(tag, this.scalars[index], this.references[index])) {
					continue;
				}
				this.setNil(index);
				if (index < this.arrayLength) {
					this.arrayLength = index;
				}
				changed = true;
			}
		}
		for (let index = 0; index < this.hashSize; index += 1) {
			const keySlot = this.hashKeySlot(index);
			const valueSlot = this.hashValueSlot(index);
			const keyTag = this.tags[keySlot];
			const valueTag = this.tags[valueSlot];
			if (keyTag === ValueTag.Nil || valueTag === ValueTag.Nil) {
				continue;
			}
			const keyIsAlive = !weakKeys || valueIsAlive(
				keyTag,
				this.scalars[keySlot],
				this.references[keySlot],
			);
			const valueIsStillAlive = !weakValues || valueIsAlive(
				valueTag,
				this.scalars[valueSlot],
				this.references[valueSlot],
			);
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
		return {
			tags: this.tags.slice(),
			scalars: this.scalars.slice(),
			references: this.references.slice(),
			arrayCapacity: this.arrayCapacity,
			arrayLength: this.arrayLength,
			hashSize: this.hashSize,
			hashNext: this.hashNext.slice(),
			hashFree: this.hashFree,
			metatable: this.tableMetatable,
		};
	}

	public restoreRuntimeState(state: TableRuntimeState): number {
		const previousBytes = this.getTrackedHeapBytes();
		this.arrayCapacity = state.arrayCapacity;
		this.hashSize = state.hashSize;
		this.tags = state.tags.slice();
		this.scalars = state.scalars.slice();
		this.references = state.references.slice();
		this.hashNext = state.hashNext.slice();
		this.arrayLength = state.arrayLength;
		this.hashDeadCount = 0;
		let maxDeadKeyHashId = 0;
		for (let index = 0; index < this.hashSize; index += 1) {
			const keySlot = this.hashKeySlot(index);
			const valueSlot = this.hashValueSlot(index);
			if ((this.tags[keySlot] === ValueTag.Nil) !== (this.tags[valueSlot] === ValueTag.Nil)) {
				this.hashDeadCount += 1;
				if (this.tags[keySlot] === ValueTag.Nil) {
					const deadKeyHashId = this.scalars[valueSlot];
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
		return Table.trackedHeapBytesForCapacities(this.arrayCapacity, this.hashSize);
	}

	public prepareRestoreStorage(arrayCapacity: number, hashCapacity: number): void {
		const previousBytes = this.getTrackedHeapBytes();
		this.arrayCapacity = arrayCapacity;
		this.arrayLength = 0;
		this.hashSize = hashCapacity;
		const slotCount = arrayCapacity + (hashCapacity * 2);
		this.tags = new Uint8Array(slotCount);
		this.scalars = new Float64Array(slotCount);
		this.scalars.fill(NaN);
		this.references = new Array<ValueReference>(slotCount);
		this.references.fill(null);
		this.hashNext = hashCapacity === 0 ? EMPTY_TABLE_HASH_NEXT : new Int32Array(hashCapacity);
		this.hashNext.fill(TABLE_HASH_NEXT_END);
		this.hashFree = hashCapacity > 0 ? hashCapacity - 1 : -1;
		this.hashDeadCount = 0;
		this.bumpVersion();
		this.luaHeap.adjustForRestore(previousBytes, this.getTrackedHeapBytes());
	}

	public next(
		afterTag: ValueTag,
		afterScalar: number,
		afterReference: ValueReference,
		target: ValueWriteTarget,
		targetIndex: number,
	): boolean {
		const entry = this.findNextEntry(afterTag, afterScalar, afterReference);
		if (entry === TABLE_ENTRY_MISSING) {
			return false;
		}
		if (entry >= 0) {
			target.setNumber(targetIndex, entry + 1);
			target.setEncoded(
				targetIndex + 1,
				this.tags[entry],
				this.scalars[entry],
				this.references[entry],
			);
			return true;
		}
		const hashIndex = TABLE_HASH_ENTRY_BASE - entry;
		const keySlot = this.hashKeySlot(hashIndex);
		const valueSlot = this.hashValueSlot(hashIndex);
		target.setEncoded(
			targetIndex,
			this.tags[keySlot],
			this.scalars[keySlot],
			this.references[keySlot],
		);
		target.setEncoded(
			targetIndex + 1,
			this.tags[valueSlot],
			this.scalars[valueSlot],
			this.references[valueSlot],
		);
		return true;
	}

	private getByParts(tag: ValueTag, scalar: number, reference: ValueReference): Value {
		if (tag === ValueTag.Nil) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		}
		const arrayIndex = this.getArrayIndex(tag, scalar);
		if (arrayIndex >= 0 && arrayIndex < this.arrayCapacity) {
			return this.valueAt(arrayIndex);
		}
		const nodeIndex = this.findNodeIndex(tag, scalar, reference);
		return nodeIndex >= 0 ? this.valueAt(this.hashValueSlot(nodeIndex)) : null;
	}

	private setHostValue(
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		value: Value,
	): void {
		const tag = valueTag(value);
		switch (tag) {
			case ValueTag.Nil:
			case ValueTag.False:
			case ValueTag.True:
				this.store(keyTag, keyScalar, keyReference, tag, NaN, null);
				return;
			case ValueTag.Number:
				this.store(keyTag, keyScalar, keyReference, tag, valueFromNumber(value as number), null);
				return;
			case ValueTag.String:
				this.store(keyTag, keyScalar, keyReference, tag, asStringId(value as StringValue), null);
				return;
			case ValueTag.BuiltinFunction:
				this.store(keyTag, keyScalar, keyReference, tag, (value as BuiltinFunction).id, null);
				return;
			case ValueTag.Table:
			case ValueTag.Closure:
				this.store(keyTag, keyScalar, keyReference, tag, NaN, value as Table | Closure);
				return;
		}
	}

	public store(
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void {
		if (keyTag === ValueTag.Nil) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		}
		const arrayIndex = this.getArrayIndex(keyTag, keyScalar);
		if (arrayIndex >= 0) {
			if (arrayIndex < this.arrayCapacity) {
				this.setEncoded(arrayIndex, valueTag, valueScalar, valueReference);
				if (valueTag === ValueTag.Nil) {
					if (arrayIndex < this.arrayLength) {
						this.arrayLength = arrayIndex;
					}
				} else if (arrayIndex === this.arrayLength) {
					this.updateArrayLengthFrom(this.arrayLength);
				}
				this.bumpVersion();
				return;
			}
			if (valueTag === ValueTag.Nil) {
				this.removeFromHash(keyTag, keyScalar, keyReference);
				if (arrayIndex < this.arrayLength) {
					this.arrayLength = arrayIndex;
				}
				this.bumpVersion();
				return;
			}
		}
		if (valueTag === ValueTag.Nil) {
			this.removeFromHash(keyTag, keyScalar, keyReference);
			this.bumpVersion();
			return;
		}
		const nodeIndex = this.findNodeIndex(keyTag, keyScalar, keyReference);
		if (nodeIndex >= 0) {
			const valueSlot = this.hashValueSlot(nodeIndex);
			if (this.tags[valueSlot] === ValueTag.Nil) {
				this.hashDeadCount -= 1;
			}
			this.setEncoded(valueSlot, valueTag, valueScalar, valueReference);
			this.bumpVersion();
			return;
		}
		if (this.hashSize === 0 || this.hashFree < 0) {
			this.rehash(
				keyTag,
				keyScalar,
				keyReference,
				valueTag,
				valueScalar,
				valueReference,
			);
		}
		this.rawSet(
			keyTag,
			keyScalar,
			keyReference,
			valueTag,
			valueScalar,
			valueReference,
		);
		this.bumpVersion();
	}

	private valueAt(slot: number): Value {
		return materializeValue(this.tags[slot], this.scalars[slot], this.references[slot]);
	}

	private setEncoded(slot: number, tag: ValueTag, scalar: number, reference: ValueReference): void {
		this.tags[slot] = tag;
		this.scalars[slot] = scalar;
		this.references[slot] = reference;
	}

	private setNil(slot: number): void {
		this.tags[slot] = ValueTag.Nil;
		this.scalars[slot] = NaN;
		this.references[slot] = null;
	}

	private hashKeySlot(index: number): number {
		return this.arrayCapacity + index;
	}

	private hashValueSlot(index: number): number {
		return this.arrayCapacity + this.hashSize + index;
	}

	private hashValue(tag: ValueTag, scalar: number, reference: ValueReference): number {
		switch (tag) {
			case ValueTag.Number: {
				const normalized = scalar === 0 ? 0 : scalar;
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
				return Math.imul(scalar, 2654435761) >>> 0;
			case ValueTag.BuiltinFunction:
				return Math.imul(scalar + 1, 0x27d4eb2d) >>> 0;
			case ValueTag.Table:
			case ValueTag.Closure:
				return Math.imul((reference as Table | Closure).hashId, 2654435761) >>> 0;
			case ValueTag.Nil:
				return 0x27d4eb2d;
		}
	}

	private keyEquals(
		storedSlot: number,
		tag: ValueTag,
		scalar: number,
		reference: ValueReference,
	): boolean {
		if (this.tags[storedSlot] !== tag) {
			return false;
		}
		switch (tag) {
			case ValueTag.Number: {
				const stored = this.scalars[storedSlot];
				return stored === scalar || (stored !== stored && scalar !== scalar);
			}
			case ValueTag.String:
			case ValueTag.BuiltinFunction:
				return this.scalars[storedSlot] === scalar;
			case ValueTag.Table:
			case ValueTag.Closure:
				return this.references[storedSlot] === reference;
			case ValueTag.Nil:
			case ValueTag.False:
			case ValueTag.True:
				return true;
		}
	}

	private findNodeIndex(tag: ValueTag, scalar: number, reference: ValueReference): number {
		if (this.hashSize === 0) {
			return -1;
		}
		const mask = this.hashSize - 1;
		let index = (this.hashValue(tag, scalar, reference) & mask) >>> 0;
		while (index >= 0) {
			const keySlot = this.hashKeySlot(index);
			if (this.tags[keySlot] !== ValueTag.Nil
				&& this.keyEquals(keySlot, tag, scalar, reference)) {
				return index;
			}
			index = this.hashNext[index];
		}
		return -1;
	}

	private findNextLiveHashIndex(start: number): number {
		for (let index = start; index < this.hashSize; index += 1) {
			if (this.tags[this.hashKeySlot(index)] !== ValueTag.Nil
				&& this.tags[this.hashValueSlot(index)] !== ValueTag.Nil) {
				return index;
			}
		}
		return -1;
	}

	private findNodeIndexForNext(
		tag: ValueTag,
		scalar: number,
		reference: ValueReference,
	): number {
		if (this.hashSize === 0) {
			return -1;
		}
		const deadKeyHashId = tag === ValueTag.Table || tag === ValueTag.Closure
			? (reference as Table | Closure).hashId
			: 0;
		const mask = this.hashSize - 1;
		let index = (this.hashValue(tag, scalar, reference) & mask) >>> 0;
		while (index >= 0) {
			const keySlot = this.hashKeySlot(index);
			const valueSlot = this.hashValueSlot(index);
			if ((this.tags[keySlot] !== ValueTag.Nil
					&& this.keyEquals(keySlot, tag, scalar, reference))
				|| (this.tags[keySlot] === ValueTag.Nil
					&& deadKeyHashId !== 0
					&& this.tags[valueSlot] === ValueTag.Number
					&& this.scalars[valueSlot] === deadKeyHashId)) {
				return index;
			}
			index = this.hashNext[index];
		}
		return -1;
	}

	private findNextEntry(
		afterTag: ValueTag,
		afterScalar: number,
		afterReference: ValueReference,
	): number {
		let hashIndex = -1;
		if (afterTag === ValueTag.Nil) {
			for (let index = 0; index < this.arrayCapacity; index += 1) {
				if (this.tags[index] !== ValueTag.Nil) {
					return index;
				}
			}
			hashIndex = this.findNextLiveHashIndex(0);
		} else {
			const arrayIndex = this.getArrayIndex(afterTag, afterScalar);
			if (arrayIndex >= 0 && arrayIndex < this.arrayCapacity) {
				for (let cursor = arrayIndex + 1; cursor < this.arrayCapacity; cursor += 1) {
					if (this.tags[cursor] !== ValueTag.Nil) {
						return cursor;
					}
				}
				hashIndex = this.findNextLiveHashIndex(0);
			} else {
				const nodeIndex = this.findNodeIndexForNext(afterTag, afterScalar, afterReference);
				if (nodeIndex < 0) {
					return TABLE_ENTRY_MISSING;
				}
				hashIndex = this.findNextLiveHashIndex(nodeIndex + 1);
			}
		}
		return hashIndex >= 0 ? TABLE_HASH_ENTRY_BASE - hashIndex : TABLE_ENTRY_MISSING;
	}

	private getFreeIndex(): number {
		const start = this.hashFree >= 0 ? this.hashFree : this.hashSize - 1;
		for (let index = start; index >= 0; index -= 1) {
			if (this.tags[this.hashKeySlot(index)] === ValueTag.Nil
				&& this.tags[this.hashValueSlot(index)] === ValueTag.Nil) {
				this.hashFree = index - 1;
				return index;
			}
		}
		this.hashFree = -1;
		return -1;
	}

	private rehash(
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void {
		let totalKeys = 0;
		const counts = Table.rehashIntegerCounts;
		let countBins = 0;

		for (let index = 0; index < this.arrayCapacity; index += 1) {
			if (this.tags[index] !== ValueTag.Nil) {
				totalKeys += 1;
				countBins = Table.countRehashIntegerKey(counts, countBins, index + 1);
			}
		}
		for (let index = 0; index < this.hashSize; index += 1) {
			const keySlot = this.hashKeySlot(index);
			if (this.tags[keySlot] !== ValueTag.Nil
				&& this.tags[this.hashValueSlot(index)] !== ValueTag.Nil) {
				totalKeys += 1;
				const arrayIndex = this.getArrayIndex(this.tags[keySlot], this.scalars[keySlot]);
				if (arrayIndex >= 0) {
					countBins = Table.countRehashIntegerKey(counts, countBins, arrayIndex + 1);
				}
			}
		}
		if (keyTag !== ValueTag.Nil) {
			totalKeys += 1;
			const arrayIndex = this.getArrayIndex(keyTag, keyScalar);
			if (arrayIndex >= 0) {
				countBins = Table.countRehashIntegerKey(counts, countBins, arrayIndex + 1);
			}
		}

		let arraySize = 0;
		let arrayKeys = 0;
		let total = 0;
		let power = 1;
		for (let index = 0; index < countBins; index += 1) {
			total += counts[index];
			if (total > power / 2) {
				arraySize = power;
				arrayKeys = total;
			}
			power *= 2;
		}

		const hashKeys = totalKeys - arrayKeys;
		const hashSize = hashKeys > 0 ? nextPowerOfTwo(hashKeys) : 0;
		this.resize(
			arraySize,
			hashSize,
			keyTag,
			keyScalar,
			keyReference,
			valueTag,
			valueScalar,
			valueReference,
		);
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

	private resize(
		newArraySize: number,
		newHashSize: number,
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void {
		const previousBytes = this.getTrackedHeapBytes();
		const resizedBytes = Table.trackedHeapBytesForCapacities(newArraySize, newHashSize);
		if (resizedBytes > previousBytes) {
			this.luaHeap.reserve(
				resizedBytes - previousBytes,
				ValueTag.Table,
				NaN,
				this,
				keyTag,
				keyScalar,
				keyReference,
				valueTag,
				valueScalar,
				valueReference,
			);
		}
		const oldTags = this.tags;
		const oldScalars = this.scalars;
		const oldReferences = this.references;
		const oldArrayCapacity = this.arrayCapacity;
		const oldHashSize = this.hashSize;

		this.arrayCapacity = newArraySize;
		this.hashSize = newHashSize;
		const slotCount = newArraySize + (newHashSize * 2);
		this.tags = new Uint8Array(slotCount);
		this.scalars = new Float64Array(slotCount);
		this.scalars.fill(NaN);
		this.references = new Array<ValueReference>(slotCount);
		this.references.fill(null);
		this.hashNext = newHashSize === 0 ? EMPTY_TABLE_HASH_NEXT : new Int32Array(newHashSize);
		this.hashNext.fill(TABLE_HASH_NEXT_END);
		this.arrayLength = 0;
		this.hashFree = newHashSize > 0 ? newHashSize - 1 : -1;
		this.hashDeadCount = 0;

		for (let index = 0; index < oldArrayCapacity; index += 1) {
			if (oldTags[index] !== ValueTag.Nil) {
				this.rawSet(
					ValueTag.Number,
					index + 1,
					null,
					oldTags[index],
					oldScalars[index],
					oldReferences[index],
				);
			}
		}
		for (let index = 0; index < oldHashSize; index += 1) {
			const oldKeySlot = oldArrayCapacity + index;
			const oldValueSlot = oldArrayCapacity + oldHashSize + index;
			if (oldTags[oldKeySlot] !== ValueTag.Nil
				&& oldTags[oldValueSlot] !== ValueTag.Nil) {
				this.rawSet(
					oldTags[oldKeySlot],
					oldScalars[oldKeySlot],
					oldReferences[oldKeySlot],
					oldTags[oldValueSlot],
					oldScalars[oldValueSlot],
					oldReferences[oldValueSlot],
				);
			}
		}
		if (resizedBytes < previousBytes) {
			this.luaHeap.release(previousBytes - resizedBytes);
		}
	}

	private rawSet(
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void {
		const arrayIndex = this.getArrayIndex(keyTag, keyScalar);
		if (arrayIndex >= 0 && arrayIndex < this.arrayCapacity) {
			this.setEncoded(arrayIndex, valueTag, valueScalar, valueReference);
			if (valueTag === ValueTag.Nil) {
				if (arrayIndex < this.arrayLength) {
					this.arrayLength = arrayIndex;
				}
			} else if (arrayIndex === this.arrayLength) {
				this.updateArrayLengthFrom(this.arrayLength);
			}
			return;
		}
		this.insertHash(
			keyTag,
			keyScalar,
			keyReference,
			valueTag,
			valueScalar,
			valueReference,
		);
		if (arrayIndex >= 0 && arrayIndex === this.arrayLength) {
			this.updateArrayLengthFrom(this.arrayLength);
		}
	}

	private insertHash(
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): void {
		if (this.hashDeadCount > 0 || this.hashSize === 0) {
			this.rehash(
				keyTag,
				keyScalar,
				keyReference,
				valueTag,
				valueScalar,
				valueReference,
			);
			this.rawSet(
				keyTag,
				keyScalar,
				keyReference,
				valueTag,
				valueScalar,
				valueReference,
			);
			return;
		}
		const mask = this.hashSize - 1;
		const mainIndex = (this.hashValue(keyTag, keyScalar, keyReference) & mask) >>> 0;
		const mainKeySlot = this.hashKeySlot(mainIndex);
		const mainValueSlot = this.hashValueSlot(mainIndex);
		if (this.tags[mainKeySlot] === ValueTag.Nil) {
			this.setEncoded(mainKeySlot, keyTag, keyScalar, keyReference);
			this.setEncoded(mainValueSlot, valueTag, valueScalar, valueReference);
			this.hashNext[mainIndex] = TABLE_HASH_NEXT_END;
			return;
		}
		const freeIndex = this.getFreeIndex();
		if (freeIndex < 0) {
			this.rehash(
				keyTag,
				keyScalar,
				keyReference,
				valueTag,
				valueScalar,
				valueReference,
			);
			this.rawSet(
				keyTag,
				keyScalar,
				keyReference,
				valueTag,
				valueScalar,
				valueReference,
			);
			return;
		}
		const freeKeySlot = this.hashKeySlot(freeIndex);
		const freeValueSlot = this.hashValueSlot(freeIndex);
		const mainIndexOfOccupied = (
			this.hashValue(
				this.tags[mainKeySlot],
				this.scalars[mainKeySlot],
				this.references[mainKeySlot],
			) & mask
		) >>> 0;
		if (mainIndexOfOccupied !== mainIndex) {
			this.setEncoded(
				freeKeySlot,
				this.tags[mainKeySlot],
				this.scalars[mainKeySlot],
				this.references[mainKeySlot],
			);
			this.setEncoded(
				freeValueSlot,
				this.tags[mainValueSlot],
				this.scalars[mainValueSlot],
				this.references[mainValueSlot],
			);
			this.hashNext[freeIndex] = this.hashNext[mainIndex];
			let previous = mainIndexOfOccupied;
			while (this.hashNext[previous] !== mainIndex) {
				previous = this.hashNext[previous];
			}
			this.hashNext[previous] = freeIndex;
			this.setEncoded(mainKeySlot, keyTag, keyScalar, keyReference);
			this.setEncoded(mainValueSlot, valueTag, valueScalar, valueReference);
			this.hashNext[mainIndex] = TABLE_HASH_NEXT_END;
			return;
		}
		this.setEncoded(freeKeySlot, keyTag, keyScalar, keyReference);
		this.setEncoded(freeValueSlot, valueTag, valueScalar, valueReference);
		this.hashNext[freeIndex] = this.hashNext[mainIndex];
		this.hashNext[mainIndex] = freeIndex;
	}

	private removeFromHash(
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
	): void {
		const existingIndex = this.findNodeIndex(keyTag, keyScalar, keyReference);
		if (existingIndex < 0
			|| this.tags[this.hashValueSlot(existingIndex)] === ValueTag.Nil) {
			return;
		}
		if (this.hashDeadCount > 0) {
			this.rehash(ValueTag.Nil, NaN, null, ValueTag.Nil, NaN, null);
			const arrayIndex = this.getArrayIndex(keyTag, keyScalar);
			if (arrayIndex >= 0 && arrayIndex < this.arrayCapacity) {
				this.setNil(arrayIndex);
				return;
			}
		}
		if (this.hashSize === 0) {
			return;
		}
		const mask = this.hashSize - 1;
		const mainIndex = (this.hashValue(keyTag, keyScalar, keyReference) & mask) >>> 0;
		let previous = -1;
		let index = mainIndex;
		while (index >= 0) {
			const keySlot = this.hashKeySlot(index);
			if (this.tags[keySlot] !== ValueTag.Nil
				&& this.keyEquals(keySlot, keyTag, keyScalar, keyReference)) {
				const next = this.hashNext[index];
				if (previous >= 0) {
					this.hashNext[previous] = next;
					this.setNil(keySlot);
					this.setNil(this.hashValueSlot(index));
					this.hashNext[index] = TABLE_HASH_NEXT_END;
					if (index > this.hashFree) {
						this.hashFree = index;
					}
					return;
				}
				if (next >= 0) {
					const nextKeySlot = this.hashKeySlot(next);
					const nextValueSlot = this.hashValueSlot(next);
					this.setEncoded(
						keySlot,
						this.tags[nextKeySlot],
						this.scalars[nextKeySlot],
						this.references[nextKeySlot],
					);
					this.setEncoded(
						this.hashValueSlot(index),
						this.tags[nextValueSlot],
						this.scalars[nextValueSlot],
						this.references[nextValueSlot],
					);
					this.hashNext[index] = this.hashNext[next];
					this.setNil(nextKeySlot);
					this.setNil(nextValueSlot);
					this.hashNext[next] = TABLE_HASH_NEXT_END;
					if (next > this.hashFree) {
						this.hashFree = next;
					}
					return;
				}
				this.setNil(keySlot);
				this.setNil(this.hashValueSlot(index));
				this.hashNext[index] = TABLE_HASH_NEXT_END;
				if (index > this.hashFree) {
					this.hashFree = index;
				}
				return;
			}
			previous = index;
			index = this.hashNext[index];
		}
	}

	private markHashNodeDead(index: number): void {
		const keySlot = this.hashKeySlot(index);
		const valueSlot = this.hashValueSlot(index);
		switch (this.tags[keySlot]) {
			case ValueTag.Table:
			case ValueTag.Closure:
				this.setEncoded(
					valueSlot,
					ValueTag.Number,
					(this.references[keySlot] as Table | Closure).hashId,
					null,
				);
				this.setNil(keySlot);
				break;
			default:
				this.setNil(valueSlot);
		}
		this.hashDeadCount += 1;
	}

	private getArrayIndex(tag: ValueTag, scalar: number): number {
		if (tag !== ValueTag.Number
			|| scalar - scalar !== 0
			|| scalar < 1
			|| scalar > TABLE_MAX_ARRAY_INDEX
			|| scalar % 1 !== 0) {
			return -1;
		}
		return scalar - 1;
	}

	private hasArrayIndex(index: number): boolean {
		if (index < this.arrayCapacity) {
			return this.tags[index] !== ValueTag.Nil;
		}
		const nodeIndex = this.findNodeIndex(ValueTag.Number, index + 1, null);
		return nodeIndex >= 0
			&& this.tags[this.hashValueSlot(nodeIndex)] !== ValueTag.Nil;
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
