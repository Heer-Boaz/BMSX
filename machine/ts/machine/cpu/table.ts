import { ceilLog2, nextPowerOfTwo } from '../common/numeric';
import { LUA_FAULT_REASON_INDEX_NIL, LUA_FAULT_REASON_INVALID_NEXT_KEY } from '../../spec/blua32/cop0';
import { LuaExecutionError } from './errors';
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
import { type CpuSnapshotWriter, CpuSnapshotObjectKind, CpuSnapshotTable, CPU_SNAPSHOT_VALUE_WORDS, type CpuSnapshotValueWriter, type CpuSnapshotReader } from './snapshot';
import { ValueSlots, type ValueWriteTarget } from './value_slots';

// start repeated-sequence-acceptable -- Lua table mutation hot paths keep direct column writes instead of routing through host-value dispatch.

const TABLE_HEAP_BYTES = 32;
const TABLE_ARRAY_SLOT_HEAP_BYTES = 8;
const TABLE_HASH_SLOT_HEAP_BYTES = 20;
const TABLE_HASH_NEXT_END = -1;
const TABLE_MAX_ARRAY_INDEX = 0x7fffffff;
const EMPTY_TABLE_HASH_NEXT = new Int32Array(0);
export const TABLE_INDEX_CHAIN_LIMIT = 32;
export const TABLE_STORE_REQUIRES_GROWTH = -2;

export const enum TableLookupStatus { Resolved, ChainExhausted }

// Raw result storage belongs to the CPU scratch owner, not a guest allocation.
export type TableLookupResult = {
	values: ValueSlots;
	slot: number;
	extraVisits: number;
	status: TableLookupStatus;
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
	private lengthHint = 0;
	private tags: Uint8Array;
	private scalars: Float64Array;
	private references: ValueReference[];
	private arrayCapacity: number;
	private hashSize: number;
	private hashNext: Int32Array;
	private hashFree = -1;
	private tableMetatable: Table | null = null;

	private static readonly numberBits = new DataView(new ArrayBuffer(8));
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
			case ValueTag.Thread:
			case ValueTag.Closure:
				return this.getByParts(tag, NaN, key as NonNullable<ValueReference>);
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
			case ValueTag.Thread:
			case ValueTag.Closure:
				this.setHostValue(tag, NaN, key as NonNullable<ValueReference>, value);
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

	public loadIntegerArrayKey(
		indexValue: number,
		target: ValueWriteTarget,
		targetIndex: number,
	): boolean {
		return this.loadArraySlot(indexValue - 1, target, targetIndex);
	}

	public loadNumberArrayKey(indexValue: number, target: ValueWriteTarget, targetIndex: number): boolean {
		return this.loadArraySlot(this.getArrayIndex(ValueTag.Number, indexValue), target, targetIndex);
	}

	private loadArraySlot(index: number, target: ValueWriteTarget, targetIndex: number): boolean {
		if (index < 0 || index >= this.arrayCapacity
			|| (this.tableMetatable !== null && this.tags[index] === ValueTag.Nil)) {
			return false;
		}
		target.setEncoded(
			targetIndex,
			this.tags[index],
			this.scalars[index],
			this.references[index],
		);
		return true;
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

	public storeIntegerArrayKey(
		indexValue: number,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): boolean {
		return this.storeArraySlot(indexValue - 1, valueTag, valueScalar, valueReference);
	}

	public storeNumberArrayKey(indexValue: number, valueTag: ValueTag, valueScalar: number, valueReference: ValueReference): boolean {
		return this.storeArraySlot(this.getArrayIndex(ValueTag.Number, indexValue), valueTag, valueScalar, valueReference);
	}

	private storeArraySlot(index: number, valueTag: ValueTag, valueScalar: number, valueReference: ValueReference): boolean {
		if (index < 0 || index >= this.arrayCapacity) {
			return false;
		}
		this.setEncoded(index, valueTag, valueScalar, valueReference);
		this.updateLengthHint(index, valueTag !== ValueTag.Nil);
		return true;
	}

	public getStringKey(key: StringId): Value {
		const nodeIndex = this.findStringNodeIndex(key);
		return nodeIndex >= 0 ? this.valueAt(this.hashValueSlot(nodeIndex)) : null;
	}

	public loadStringKey(key: StringId, target: ValueWriteTarget, targetIndex: number): void {
		const nodeIndex = this.findStringNodeIndex(key);
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

	public loadPredictedStringKey(
		key: StringId,
		predictedSlot: number,
		target: ValueWriteTarget,
		targetIndex: number,
	): boolean {
		if (predictedSlot >= 0 && predictedSlot < this.hashSize) {
			const keySlot = this.hashKeySlot(predictedSlot);
			const valueSlot = this.hashValueSlot(predictedSlot);
			if (this.tags[keySlot] === ValueTag.String
				&& this.scalars[keySlot] === key
				&& this.tags[valueSlot] !== ValueTag.Nil) {
				target.setEncoded(
					targetIndex,
					this.tags[valueSlot],
					this.scalars[valueSlot],
					this.references[valueSlot],
				);
				return true;
			}
		}
		return false;
	}

	public loadStringKeyCached(
		key: StringId,
		predictedSlot: number,
		target: ValueWriteTarget,
		targetIndex: number,
	): number {
		if (this.loadPredictedStringKey(key, predictedSlot, target, targetIndex)) return predictedSlot;
		const nodeIndex = this.findStringNodeIndex(key);
		if (nodeIndex >= 0) {
			const valueSlot = this.hashValueSlot(nodeIndex);
			if (this.tags[valueSlot] !== ValueTag.Nil) {
				target.setEncoded(
					targetIndex,
					this.tags[valueSlot],
					this.scalars[valueSlot],
					this.references[valueSlot],
				);
				return nodeIndex;
			}
		}
		target.setNil(targetIndex);
		return -1;
	}

	public metatableIndexTable(indexKey: StringId): Table | null {
		const metatable = this.tableMetatable;
		if (!metatable) {
			return null;
		}
		const nodeIndex = metatable.findStringNodeIndex(indexKey);
		if (nodeIndex < 0) {
			return null;
		}
		const valueSlot = metatable.hashValueSlot(nodeIndex);
		return metatable.tags[valueSlot] === ValueTag.Table
			? metatable.references[valueSlot] as Table
			: null;
	}

	public resolveIndex(
		indexKey: StringId,
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		result: TableLookupResult,
	): void {
		if (keyTag === ValueTag.Nil) {
			throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		}
		const arrayIndex = this.getArrayIndex(keyTag, keyScalar);
		let current: Table = this;
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; depth += 1) {
			let valueSlot = arrayIndex;
			if (valueSlot < 0 || valueSlot >= current.arrayCapacity) {
				const nodeIndex = current.findNodeIndex(keyTag, keyScalar, keyReference);
				valueSlot = nodeIndex >= 0 ? current.hashValueSlot(nodeIndex) : -1;
			}
			if (valueSlot >= 0 && current.tags[valueSlot] !== ValueTag.Nil) {
				result.values.setEncoded(0, current.tags[valueSlot], current.scalars[valueSlot], current.references[valueSlot]);
				result.slot = -1;
				result.extraVisits = depth;
				result.status = TableLookupStatus.Resolved;
				return;
			}
			const next = current.metatableIndexTable(indexKey);
			if (!next) {
				result.values.setNil(0);
				result.slot = -1;
				result.extraVisits = depth;
				result.status = TableLookupStatus.Resolved;
				return;
			}
			current = next;
		}
		result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1;
		result.status = TableLookupStatus.ChainExhausted;
	}

	public resolveIntegerIndex(
		indexKey: StringId,
		key: number,
		result: TableLookupResult,
	): void {
		const arrayIndex = key - 1;
		let current: Table = this;
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; depth += 1) {
			let valueSlot = arrayIndex;
			if (valueSlot < 0 || valueSlot >= current.arrayCapacity) {
				const nodeIndex = current.findNodeIndex(ValueTag.Number, key, null);
				valueSlot = nodeIndex >= 0 ? current.hashValueSlot(nodeIndex) : -1;
			}
			if (valueSlot >= 0 && current.tags[valueSlot] !== ValueTag.Nil) {
				result.values.setEncoded(0, current.tags[valueSlot], current.scalars[valueSlot], current.references[valueSlot]);
				result.slot = -1;
				result.extraVisits = depth;
				result.status = TableLookupStatus.Resolved;
				return;
			}
			const next = current.metatableIndexTable(indexKey);
			if (!next) {
				result.values.setNil(0);
				result.slot = -1;
				result.extraVisits = depth;
				result.status = TableLookupStatus.Resolved;
				return;
			}
			current = next;
		}
		result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1;
		result.status = TableLookupStatus.ChainExhausted;
	}

	public resolveStringIndex(
		indexKey: StringId,
		key: StringId,
		result: TableLookupResult,
	): void {
		let current: Table = this;
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; depth += 1) {
			const nodeIndex = current.findStringNodeIndex(key);
			if (nodeIndex >= 0) {
				const valueSlot = current.hashValueSlot(nodeIndex);
				if (current.tags[valueSlot] !== ValueTag.Nil) {
					result.values.setEncoded(0, current.tags[valueSlot], current.scalars[valueSlot], current.references[valueSlot]);
					result.slot = -1;
					result.extraVisits = depth;
					result.status = TableLookupStatus.Resolved;
					return;
				}
			}
			const next = current.metatableIndexTable(indexKey);
			if (!next) {
				result.values.setNil(0);
				result.slot = -1;
				result.extraVisits = depth;
				result.status = TableLookupStatus.Resolved;
				return;
			}
			current = next;
		}
		result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1;
		result.status = TableLookupStatus.ChainExhausted;
	}

	public resolveStringIndexCached(
		indexKey: StringId,
		key: StringId,
		predictedSlot: number,
		result: TableLookupResult,
	): void {
		let current: Table = this;
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; depth += 1) {
			if (current.loadPredictedStringKey(key, predictedSlot, result.values, 0)) {
				result.slot = predictedSlot;
				result.extraVisits = depth;
				result.status = TableLookupStatus.Resolved;
				return;
			}
			const nodeIndex = current.findStringNodeIndex(key);
			if (nodeIndex >= 0) {
				const valueSlot = current.hashValueSlot(nodeIndex);
				if (current.tags[valueSlot] !== ValueTag.Nil) {
					result.values.setEncoded(0, current.tags[valueSlot], current.scalars[valueSlot], current.references[valueSlot]);
					result.slot = nodeIndex;
					result.extraVisits = depth;
					result.status = TableLookupStatus.Resolved;
					return;
				}
			}
			predictedSlot = -1;
			const next = current.metatableIndexTable(indexKey);
			if (!next) {
				result.values.setNil(0);
				result.slot = -1;
				result.extraVisits = depth;
				result.status = TableLookupStatus.Resolved;
				return;
			}
			current = next;
		}
		result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1;
		result.status = TableLookupStatus.ChainExhausted;
	}

	public setStringKey(key: StringId, value: Value): void {
		this.setHostValue(ValueTag.String, key, null, value);
	}

	public storeStringKey(
		key: StringId,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): number {
		const nodeIndex = this.storeStringKeyWithoutGrowth(key, valueTag, valueScalar, valueReference);
		if (nodeIndex !== TABLE_STORE_REQUIRES_GROWTH) return nodeIndex;
		this.rehash(ValueTag.String, key, null, valueTag, valueScalar, valueReference);
		return this.rawSet(ValueTag.String, key, null, valueTag, valueScalar, valueReference);
	}

	// Completes mutations within allocated storage; growth leaves the mapping unchanged.
	public storeStringKeyWithoutGrowth(
		key: StringId,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): number {
		if (valueTag === ValueTag.Nil) {
			this.removeFromHash(ValueTag.String, key, null);
			return -1;
		}
		const nodeIndex = this.findStringNodeIndex(key);
		if (nodeIndex >= 0) {
			const valueSlot = this.hashValueSlot(nodeIndex);
			this.setEncoded(valueSlot, valueTag, valueScalar, valueReference);
			return nodeIndex;
		}
		const inserted = this.insertHashWithoutGrowth(
			ValueTag.String,
			key,
			null,
			valueTag,
			valueScalar,
			valueReference,
		);
		return inserted >= 0 ? inserted : TABLE_STORE_REQUIRES_GROWTH;
	}

	public storePredictedStringKey(
		key: StringId,
		predictedSlot: number,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): boolean {
		if (valueTag !== ValueTag.Nil
			&& predictedSlot >= 0
			&& predictedSlot < this.hashSize) {
			const keySlot = this.hashKeySlot(predictedSlot);
			const valueSlot = this.hashValueSlot(predictedSlot);
			if (this.tags[keySlot] === ValueTag.String
				&& this.scalars[keySlot] === key
				&& this.tags[valueSlot] !== ValueTag.Nil) {
				this.setEncoded(valueSlot, valueTag, valueScalar, valueReference);
				return true;
			}
		}
		return false;
	}

	public storeStringKeyCached(
		key: StringId,
		predictedSlot: number,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): number {
		if (this.storePredictedStringKey(key, predictedSlot, valueTag, valueScalar, valueReference)) return predictedSlot;
		return this.storeStringKey(key, valueTag, valueScalar, valueReference);
	}

	public clear(): void {
		const previousBytes = this.getTrackedHeapBytes();
		this.arrayCapacity = 0;
		this.lengthHint = 0;
		this.hashSize = 0;
		this.tags = new Uint8Array(0);
		this.scalars = new Float64Array(0);
		this.references = [];
		this.hashNext = EMPTY_TABLE_HASH_NEXT;
		this.hashFree = -1;
		this.luaHeap.release(previousBytes - this.getTrackedHeapBytes());
	}

	/** Physical array positions followed by hash nodes, including vacant/dead slots. */
	public get storedSlotCount(): number { return this.arrayCapacity + this.hashSize; }

	/**
	 * Constant-work read for bounded inspection. Slot is in [0, storedSlotCount);
	 * its identity is valid only until a table mutation. False leaves target untouched.
	 */
	public loadStoredEntry(slot: number, target: ValueWriteTarget, targetIndex: number): boolean {
		if (slot < this.arrayCapacity) {
			if (this.tags[slot] === ValueTag.Nil) return false;
			target.setNumber(targetIndex, slot + 1);
			target.setEncoded(targetIndex + 1, this.tags[slot], this.scalars[slot], this.references[slot]);
			return true;
		}
		const hashIndex = slot - this.arrayCapacity;
		const keySlot = this.hashKeySlot(hashIndex), valueSlot = this.hashValueSlot(hashIndex);
		if (this.tags[keySlot] === ValueTag.Nil || this.tags[valueSlot] === ValueTag.Nil) return false;
		target.setEncoded(targetIndex, this.tags[keySlot], this.scalars[keySlot], this.references[keySlot]);
		target.setEncoded(targetIndex + 1, this.tags[valueSlot], this.scalars[valueSlot], this.references[valueSlot]);
		return true;
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
		if (weakValues) {
			for (let index = 0; index < this.arrayCapacity; index += 1) {
				const tag = this.tags[index];
				if (tag === ValueTag.Nil
					|| valueIsAlive(tag, this.scalars[index], this.references[index])) {
					continue;
				}
				this.setNil(index);
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
		}
	}

	public captureSnapshot(snapshot: CpuSnapshotWriter, writeValue: CpuSnapshotValueWriter): number {
		const offset = snapshot.reserveWords(CpuSnapshotTable.Data + this.arrayCapacity * CPU_SNAPSHOT_VALUE_WORDS + this.hashSize * (2 * CPU_SNAPSHOT_VALUE_WORDS + 1));
		snapshot.setWord(offset + CpuSnapshotTable.Kind, CpuSnapshotObjectKind.Table);
		snapshot.setWord(offset + CpuSnapshotTable.HashId, this.hashId);
		snapshot.setWord(offset + CpuSnapshotTable.LengthHint, this.lengthHint);
		snapshot.setWord(offset + CpuSnapshotTable.ArrayCapacity, this.arrayCapacity);
		snapshot.setWord(offset + CpuSnapshotTable.HashSize, this.hashSize);
		snapshot.setWord(offset + CpuSnapshotTable.HashFree, this.hashFree);
		writeValue(offset + CpuSnapshotTable.Metatable, this.tableMetatable ? ValueTag.Table : ValueTag.Nil, NaN, this.tableMetatable);
		let cursor = offset + CpuSnapshotTable.Data;
		for (let slot = 0; slot < this.arrayCapacity; slot += 1) {
			writeValue(cursor, this.tags[slot], this.scalars[slot], this.references[slot]);
			cursor += CPU_SNAPSHOT_VALUE_WORDS;
		}
		for (let index = 0; index < this.hashSize; index += 1) {
			const keySlot = this.arrayCapacity + index;
			const valueSlot = this.arrayCapacity + this.hashSize + index;
			writeValue(cursor, this.tags[keySlot], this.scalars[keySlot], this.references[keySlot]);
			writeValue(cursor + CPU_SNAPSHOT_VALUE_WORDS, this.tags[valueSlot], this.scalars[valueSlot], this.references[valueSlot]);
			snapshot.setWord(cursor + 2 * CPU_SNAPSHOT_VALUE_WORDS, this.hashNext[index]);
			cursor += 2 * CPU_SNAPSHOT_VALUE_WORDS + 1;
		}
		return offset;
	}

	public restoreSnapshot(reader: CpuSnapshotReader, offset: number): void {
		const snapshot = reader.snapshot;
		const previousBytes = this.getTrackedHeapBytes();
		const arrayCapacity = snapshot.word(offset + CpuSnapshotTable.ArrayCapacity);
		const hashSize = snapshot.word(offset + CpuSnapshotTable.HashSize);
		if (this.arrayCapacity !== arrayCapacity || this.hashSize !== hashSize) {
			const size = arrayCapacity + 2 * hashSize;
			this.tags = new Uint8Array(size);
			this.scalars = new Float64Array(size);
			this.references = new Array<ValueReference>(size);
			this.hashNext = hashSize === 0 ? EMPTY_TABLE_HASH_NEXT : new Int32Array(hashSize);
		}
		this.arrayCapacity = arrayCapacity;
		this.hashSize = hashSize;
		this.lengthHint = snapshot.word(offset + CpuSnapshotTable.LengthHint);
		this.hashFree = snapshot.int(offset + CpuSnapshotTable.HashFree);
		reader.readValue(offset + CpuSnapshotTable.Metatable);
		this.tableMetatable = reader.reference as Table | null;
		let cursor = offset + CpuSnapshotTable.Data;
		for (let slot = 0; slot < this.arrayCapacity; slot += 1) {
			reader.readValue(cursor);
			this.tags[slot] = reader.tag;
			this.scalars[slot] = reader.scalar;
			this.references[slot] = reader.reference;
			cursor += CPU_SNAPSHOT_VALUE_WORDS;
		}
		for (let index = 0; index < this.hashSize; index += 1) {
			const keySlot = this.arrayCapacity + index;
			const valueSlot = this.arrayCapacity + this.hashSize + index;
			reader.readValue(cursor);
			this.tags[keySlot] = reader.tag;
			this.scalars[keySlot] = reader.scalar;
			this.references[keySlot] = reader.reference;
			reader.readValue(cursor + CPU_SNAPSHOT_VALUE_WORDS);
			this.tags[valueSlot] = reader.tag;
			this.scalars[valueSlot] = reader.scalar;
			this.references[valueSlot] = reader.reference;
			this.hashNext[index] = snapshot.int(cursor + 2 * CPU_SNAPSHOT_VALUE_WORDS);
			cursor += 2 * CPU_SNAPSHOT_VALUE_WORDS + 1;
		}
		this.luaHeap.adjustForRestore(previousBytes, this.getTrackedHeapBytes());
	}

	public getTrackedHeapBytes(): number {
		return Table.trackedHeapBytesForCapacities(this.arrayCapacity, this.hashSize);
	}

	public prepareRestoreStorage(arrayCapacity: number, hashCapacity: number): void {
		const previousBytes = this.getTrackedHeapBytes();
		this.arrayCapacity = arrayCapacity;
		this.lengthHint = 0;
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
		this.luaHeap.adjustForRestore(previousBytes, this.getTrackedHeapBytes());
	}

	/** Writes the next Lua result tuple and returns inspected Value slots. */
	public next(
		afterTag: ValueTag,
		afterScalar: number,
		afterReference: ValueReference,
		target: ValueWriteTarget,
		targetIndex: number,
	): number {
		let arrayStart = 0;
		let hashStart = 0;
		if (afterTag !== ValueTag.Nil) {
			const arrayIndex = this.getArrayIndex(afterTag, afterScalar);
			if (arrayIndex >= 0 && arrayIndex < this.arrayCapacity) {
				arrayStart = arrayIndex + 1;
			} else {
				const nodeIndex = this.findNodeIndex(afterTag, afterScalar, afterReference, true);
				if (nodeIndex < 0) {
					throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
				}
				arrayStart = this.arrayCapacity;
				hashStart = nodeIndex + 1;
			}
		}
		for (let index = arrayStart; index < this.arrayCapacity; index += 1) {
			if (this.tags[index] !== ValueTag.Nil) {
				target.setNumber(targetIndex, index + 1);
				target.setEncoded(targetIndex + 1, this.tags[index], this.scalars[index], this.references[index]);
				return index - arrayStart + 1;
			}
		}
		const arraySlots = this.arrayCapacity - arrayStart;
		const hashIndex = this.findNextLiveHashIndex(hashStart);
		if (hashIndex < 0) {
			target.setNil(targetIndex);
			return arraySlots + 2 * (this.hashSize - hashStart);
		}
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
		return arraySlots + 2 * (hashIndex - hashStart + 1);
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
			case ValueTag.Thread:
			case ValueTag.Closure:
				this.store(keyTag, keyScalar, keyReference, tag, NaN, value as NonNullable<ValueReference>);
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
				this.updateLengthHint(arrayIndex, valueTag !== ValueTag.Nil);
				return;
			}
			if (valueTag === ValueTag.Nil) {
				this.removeFromHash(keyTag, keyScalar, keyReference);
				this.updateLengthHint(arrayIndex, false);
				return;
			}
		}
		if (valueTag === ValueTag.Nil) {
			this.removeFromHash(keyTag, keyScalar, keyReference);
			return;
		}
		const nodeIndex = this.findNodeIndex(keyTag, keyScalar, keyReference, true);
		if (nodeIndex >= 0) {
			const keySlot = this.hashKeySlot(nodeIndex);
			if (this.tags[keySlot] === ValueTag.Nil) {
				this.setEncoded(keySlot, keyTag, keyScalar, keyReference);
			}
			const valueSlot = this.hashValueSlot(nodeIndex);
			this.setEncoded(valueSlot, valueTag, valueScalar, valueReference);
			if (arrayIndex >= 0) this.updateLengthHint(arrayIndex, true);
			return;
		}
		this.rawSet(
			keyTag,
			keyScalar,
			keyReference,
			valueTag,
			valueScalar,
			valueReference,
		);
		if (arrayIndex >= 0) this.updateLengthHint(arrayIndex, true);
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
				Table.numberBits.setFloat64(0, scalar === 0 ? 0 : scalar, true);
				let lo = scalar !== scalar ? 0 : Table.numberBits.getUint32(0, true);
				let hi = (scalar !== scalar ? 0x7ff80000 : Table.numberBits.getUint32(4, true)) << 1;
				lo ^= hi;
				lo = (lo - ((hi << 14) | (hi >>> 18))) | 0;
				hi = lo ^ ((hi << 19) | (hi >>> 13));
				return (hi - ((lo << 13) | (lo >>> 19))) >>> 0;
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
			case ValueTag.Thread:
			case ValueTag.Closure:
				return Math.imul((reference as NonNullable<ValueReference>).hashId, 2654435761) >>> 0;
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
			case ValueTag.Thread:
			case ValueTag.Closure:
				return this.references[storedSlot] === reference;
			case ValueTag.Nil:
			case ValueTag.False:
			case ValueTag.True:
				return true;
		}
	}

	private findNodeIndex(
		tag: ValueTag,
		scalar: number,
		reference: ValueReference,
		matchDead = false,
	): number {
		if (this.hashSize === 0) {
			return -1;
		}
		const collectableKey = matchDead
			&& (tag === ValueTag.Table || tag === ValueTag.Closure || tag === ValueTag.Thread);
		const deadKeyHashId = collectableKey ? (reference as NonNullable<ValueReference>).hashId : 0;
		const mask = this.hashSize - 1;
		let index = (this.hashValue(tag, scalar, reference) & mask) >>> 0;
		while (index >= 0) {
			const keySlot = this.hashKeySlot(index);
			const valueSlot = this.hashValueSlot(index);
			if ((this.tags[keySlot] !== ValueTag.Nil && this.keyEquals(keySlot, tag, scalar, reference))
				|| (this.tags[keySlot] === ValueTag.Nil && collectableKey
					&& this.tags[valueSlot] === ValueTag.Number && this.scalars[valueSlot] === deadKeyHashId)) {
				return index;
			}
			index = this.hashNext[index];
		}
		return -1;
	}

	private findStringNodeIndex(key: StringId): number {
		if (this.hashSize === 0) {
			return -1;
		}
		let index = (this.hashValue(ValueTag.String, key, null) & (this.hashSize - 1)) >>> 0;
		while (index >= 0) {
			const keySlot = this.hashKeySlot(index);
			if (this.tags[keySlot] === ValueTag.String && this.scalars[keySlot] === key) {
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

	private getFreeIndex(): number {
		for (let index = this.hashFree; index >= 0; index -= 1) {
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
		this.luaHeap.accountTableStorageWork(this.arrayCapacity + 2 * this.hashSize);
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
		this.hashFree = newHashSize > 0 ? newHashSize - 1 : -1;
		this.luaHeap.accountTableStorageWork(slotCount);

		let relocatedSlots = 0;
		for (let index = 0; index < oldArrayCapacity; index += 1) {
			if (oldTags[index] !== ValueTag.Nil) {
				const destination = this.rawSet(
					ValueTag.Number,
					index + 1,
					null,
					oldTags[index],
					oldScalars[index],
					oldReferences[index],
				);
				relocatedSlots += destination < 0 ? 1 : 2;
			}
		}
		for (let index = 0; index < oldHashSize; index += 1) {
			const oldKeySlot = oldArrayCapacity + index;
			const oldValueSlot = oldArrayCapacity + oldHashSize + index;
			if (oldTags[oldKeySlot] !== ValueTag.Nil
				&& oldTags[oldValueSlot] !== ValueTag.Nil) {
				const destination = this.rawSet(
					oldTags[oldKeySlot],
					oldScalars[oldKeySlot],
					oldReferences[oldKeySlot],
					oldTags[oldValueSlot],
					oldScalars[oldValueSlot],
					oldReferences[oldValueSlot],
				);
				relocatedSlots += destination < 0 ? 1 : 2;
			}
		}
		this.luaHeap.accountTableStorageWork(oldArrayCapacity + 2 * oldHashSize + relocatedSlots);
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
	): number {
		const arrayIndex = this.getArrayIndex(keyTag, keyScalar);
		if (arrayIndex >= 0 && arrayIndex < this.arrayCapacity) {
			this.setEncoded(arrayIndex, valueTag, valueScalar, valueReference);
			return -1;
		}
		const nodeIndex = this.insertHash(
			keyTag,
			keyScalar,
			keyReference,
			valueTag,
			valueScalar,
			valueReference,
		);
		return nodeIndex;
	}

	private insertHash(
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): number {
		const nodeIndex = this.insertHashWithoutGrowth(keyTag, keyScalar, keyReference, valueTag, valueScalar, valueReference);
		if (nodeIndex >= 0) return nodeIndex;
		this.rehash(keyTag, keyScalar, keyReference, valueTag, valueScalar, valueReference);
		return this.rawSet(keyTag, keyScalar, keyReference, valueTag, valueScalar, valueReference);
	}

	private insertHashWithoutGrowth(
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
		valueTag: ValueTag,
		valueScalar: number,
		valueReference: ValueReference,
	): number {
		if (this.hashSize === 0) {
			return -1;
		}
		const mask = this.hashSize - 1;
		const mainIndex = (this.hashValue(keyTag, keyScalar, keyReference) & mask) >>> 0;
		const mainKeySlot = this.hashKeySlot(mainIndex);
		const mainValueSlot = this.hashValueSlot(mainIndex);
		if (this.tags[mainKeySlot] === ValueTag.Nil || this.tags[mainValueSlot] === ValueTag.Nil) {
			this.setEncoded(mainKeySlot, keyTag, keyScalar, keyReference);
			this.setEncoded(mainValueSlot, valueTag, valueScalar, valueReference);
			return mainIndex;
		}
		const freeIndex = this.getFreeIndex();
		if (freeIndex < 0) {
			return -1;
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
			return mainIndex;
		}
		this.setEncoded(freeKeySlot, keyTag, keyScalar, keyReference);
		this.setEncoded(freeValueSlot, valueTag, valueScalar, valueReference);
		this.hashNext[freeIndex] = this.hashNext[mainIndex];
		this.hashNext[mainIndex] = freeIndex;
		return freeIndex;
	}

	private removeFromHash(
		keyTag: ValueTag,
		keyScalar: number,
		keyReference: ValueReference,
	): void {
		const index = this.findNodeIndex(keyTag, keyScalar, keyReference);
		if (index >= 0 && this.tags[this.hashValueSlot(index)] !== ValueTag.Nil) {
			this.markHashNodeDead(index);
		}
	}

	private markHashNodeDead(index: number): void {
		const keySlot = this.hashKeySlot(index);
		const valueSlot = this.hashValueSlot(index);
		switch (this.tags[keySlot]) {
			case ValueTag.Table:
			case ValueTag.Thread:
			case ValueTag.Closure:
				this.setEncoded(
					valueSlot,
					ValueTag.Number,
					(this.references[keySlot] as NonNullable<ValueReference>).hashId,
					null,
				);
				this.setNil(keySlot);
				break;
			default:
				this.setNil(valueSlot);
		}
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

	private hasIntegerKey(key: number): boolean {
		if (key <= this.arrayCapacity) {
			return this.tags[key - 1] !== ValueTag.Nil;
		}
		const nodeIndex = this.findNodeIndex(ValueTag.Number, key, null);
		return nodeIndex >= 0 && this.tags[this.hashValueSlot(nodeIndex)] !== ValueTag.Nil;
	}

	private updateLengthHint(slot: number, present: boolean): void {
		if (present) {
			if (slot === this.lengthHint) this.lengthHint += 1;
		} else if (slot + 1 === this.lengthHint) {
			this.lengthHint -= 1;
		}
	}

	public length(): number {
		const maxBoundary = 0x1fffffffffffff;
		let low = this.lengthHint;
		let high: number;
		if (low !== 0 && !this.hasIntegerKey(low)) {
			high = low;
			low = 0;
		} else {
			if (!this.hasIntegerKey(low + 1)) return low;
			low += 1;
			high = low * 2;
			while (this.hasIntegerKey(high)) {
				low = high;
				if (low === maxBoundary) return low;
				high = Math.min(low * 2, maxBoundary);
			}
		}
		while (high - low > 1) {
			const middle = low + Math.trunc((high - low) / 2);
			if (this.hasIntegerKey(middle)) low = middle;
			else high = middle;
		}
		return low;
	}
}
