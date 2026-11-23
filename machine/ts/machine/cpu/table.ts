import { RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { GC_OBJECT_PREFIX, GC_RECORD_LINK } from './gc_object';
import { ceilLog2, nextPowerOfTwo } from '../common/numeric';
import { LUA_FAULT_REASON_INDEX_NAN, LUA_FAULT_REASON_INDEX_NIL, LUA_FAULT_REASON_INVALID_NEXT_KEY } from '../../spec/blua32/cop0';
import { LuaExecutionError } from './errors';
import { LuaAllocationRecovery } from './lua_heap';
import type { GcHeap } from './gc_heap';
import type { StringId } from './string_pool';
import {
	ValueTag, asInteger, canonicalTableKey, isNil, hashCanonicalTableKey, valueFromTag, valueInteger,
	valueIsNaN, valueNil, valuePayload, valueString, valueTable, valueTag, valueTagHasGcEdge, type Value,
} from './value';
import type { ValueWriteTarget } from './value_slots';

const TABLE_HASH_NEXT_END = -1;
const TABLE_MAX_ARRAY_INDEX = 0x7fffffff;
// An explicit reservation can outlive its physical hash.
const TABLE_EXPLICIT_HASH_RESERVE = 1 << 16;
const TABLE_HASH_WATERMARK_SHIFT = 17;
const TABLE_HASH_WATERMARK_MASK = 31 << TABLE_HASH_WATERMARK_SHIFT;
const TABLE_HASH_MAPPING_BYTES = 10;
// A fixed-string Store carries an unprobed, absent (-1), or matched hash node,
// including a matched tombstone.
export const TABLE_HASH_UNPROBED = -2;
export const HASH_STORE_DECLINED = -3;
const enum HashStore { General, Scheduled, Resume }
export const TABLE_INDEX_CHAIN_LIMIT = 32;
export const enum TableLookupStatus { Resolved, ChainExhausted, Invoke, Forward, Store }
type TableLookupSlot = { value: Value; slot: number };
export type TableLookupResult = TableLookupSlot & { extraVisits: number; status: TableLookupStatus; receiver: number };
type StoredEntryVisitor = (key: Value, value: Value) => void;
type StoredValuePredicate = (value: Value) => boolean;
export interface TableStringProbe { node: number; remaining: number; value: Value }

export const enum TableHeader {
	Kind = 0, Gray = 4, Metatable = 8, Storage = 12, Array = 16, Hash = 20, Length = 24, Free = 28,
}
export class TableRecords {
	private readonly resizePlan = { array: 0, hash: 0, members: 0, watermark: 0 };
	private static readonly rehashIntegerCounts = new Uint32Array(32);
	static readonly HEADER_BYTES = 32;
	public constructor(private readonly heap: GcHeap) {}
	public initialize(record: number, array: number, hash: number, reserve: number): void {
		this.writeHeader(record, TableHeader.Kind, ValueTag.Table | (this.heap.white() << 8) | (reserve !== 0 ? TABLE_EXPLICIT_HASH_RESERVE : 0));
		this.writeHeader(record, TableHeader.Gray, 0);
		this.writeHeader(record, TableHeader.Metatable, 0);
		this.writeHeader(record, TableHeader.Length, 0);
		this.bindStorage(record, array, hash, this.storageAddress(record));
		this.initializeStorage(record);
		if (hash !== 0 || reserve !== 0) this.heap.memory.writeRamRecordPair(this.hashMetadata(record), reserve, 0);
	}
	public copyOwn(source: number): number {
		const array = this.arrayCapacity(source), hash = this.hashSize(source);
		const reserve = Math.max(this.hashReserve(source), this.hashMembers(source));
		const bytes = TableRecords.storageBytes(array, hash, reserve);
		const copy = this.heap.budget.allocateRecord(TableRecords.HEADER_BYTES, true, bytes, TableHeader.Storage,
			valueTable(source), valueNil(), valueNil(), TableRecords.allocationCharge(array, reserve));
		// The rooted source keeps its layout, but admission can clear weak entries.
		const memory = this.heap.memory;
		const watermark = this.readHeader(source, TableHeader.Kind) & TABLE_HASH_WATERMARK_MASK;
		const kind = ValueTag.Table | (this.heap.white() << 8) | watermark | (reserve !== 0 ? TABLE_EXPLICIT_HASH_RESERVE : 0);
		memory.writeRamRecordPair(copy + TableHeader.Kind, kind, 0);
		this.writeHeader(copy, TableHeader.Metatable, 0);
		memory.writeRamRecordPair(copy + TableHeader.Array, array, hash);
		memory.writeRamRecordPair(copy + TableHeader.Length, this.lengthHint(source), this.readHeader(source, TableHeader.Free));
		if (bytes !== 0) {
			const start = this.storageAddress(source) & RAM_RECORD_WORD_MASK;
			const target = this.storageAddress(copy) & RAM_RECORD_WORD_MASK;
			const body = 5 * array + 14 * hash;
			memory.ramData().copyWithin(target, start, start + body);
			memory.invalidateRamWrite(target, body);
			if (hash !== 0 || reserve !== 0) {
				const metadata = TableRecords.hashMetadataOffset(array, hash);
				const members = hash !== 0 ? memory.readRamRecordWord(start + metadata + 4) : 0;
				memory.writeRamRecordPair(target + metadata, reserve, members);
			}
		}
		this.heap.publishObject(copy);
		return copy;
	}
	public static hashCapacity(size: number): number { return size > 0 ? nextPowerOfTwo(size) : 0; }
	private static hashMetadataOffset(array: number, hash: number): number { return ((5 * array + 14 * hash + 7) & ~7) >>> 0; }
	public static storageBytes(array: number, hash: number, reserve = 0): number {
		return hash !== 0 || reserve !== 0 ? TableRecords.hashMetadataOffset(array, hash) + 8 : 5 * array;
	}
	public static allocationCharge(array: number, hashEntries: number): number { return 5 * array + TABLE_HASH_MAPPING_BYTES * hashEntries; }
	private readHeader(record: number, field: TableHeader): number { return this.heap.memory.readRamRecordWord(record + field); }
	private writeHeader(record: number, field: TableHeader, word: number): void { this.heap.memory.writeRamRecordWord(record + field, word); }
	private hashMetadata(record: number): number {
		return this.storageAddress(record) + TableRecords.hashMetadataOffset(this.arrayCapacity(record), this.hashSize(record));
	}
	public hashReserve(record: number): number {
		return (this.readHeader(record, TableHeader.Kind) & TABLE_EXPLICIT_HASH_RESERVE) !== 0
			? this.heap.memory.readRamRecordWord(this.hashMetadata(record)) : 0;
	}
	private hashMembers(record: number): number {
		return this.hashSize(record) !== 0 ? this.heap.memory.readRamRecordWord(this.hashMetadata(record) + 4) : 0;
	}
	private hashWatermark(record: number): number {
		const exponent = (this.readHeader(record, TableHeader.Kind) & TABLE_HASH_WATERMARK_MASK) >>> TABLE_HASH_WATERMARK_SHIFT;
		return exponent !== 0 ? 1 << (exponent - 1) : 0;
	}
	private publishHashWatermark(record: number, watermark: number): void {
		const kind = this.readHeader(record, TableHeader.Kind);
		const next = (kind & ~TABLE_HASH_WATERMARK_MASK) | ((32 - Math.clz32(watermark)) << TABLE_HASH_WATERMARK_SHIFT);
		if (next !== kind) this.writeHeader(record, TableHeader.Kind, next);
	}
	private publishHashMembers(record: number, previous: number, members: number, reserve: number): void {
		this.heap.memory.writeRamRecordWord(this.hashMetadata(record) + 4, members);
		this.heap.budget.replaceRecord(0, Math.max(reserve, previous) * TABLE_HASH_MAPPING_BYTES,
			Math.max(reserve, members) * TABLE_HASH_MAPPING_BYTES);
	}
	public metatableAddress(record: number): number { return this.readHeader(record, TableHeader.Metatable); }
	public setMetatableAddress(record: number, address: number): void {
		this.heap.writeBarrier(record, GC_RECORD_LINK);
		this.writeHeader(record, TableHeader.Metatable, address);
	}
	public arrayCapacity(record: number): number { return this.readHeader(record, TableHeader.Array); }
	public hashSize(record: number): number { return this.readHeader(record, TableHeader.Hash); }
	private lengthHint(record: number): number { return this.readHeader(record, TableHeader.Length); }
	private hashFree(record: number): number { return this.readHeader(record, TableHeader.Free) | 0; }
	public storageAddress(record: number): number { return this.readHeader(record, TableHeader.Storage); }
	private tags(record: number): number { return this.storageAddress(record) + (this.arrayCapacity(record) + 3 * this.hashSize(record)) * 4; }
	private bindStorage(record: number, array: number, hash: number, address: number): void {
		this.writeHeader(record, TableHeader.Storage, address);
		this.writeHeader(record, TableHeader.Array, array);
		this.writeHeader(record, TableHeader.Hash, hash);
		this.writeHeader(record, TableHeader.Free, hash - 1);
	}
	private initializeStorage(record: number, retainedArray = 0): void {
		const bytes = 5 * this.arrayCapacity(record) + 14 * this.hashSize(record);
		if (bytes === 0) return;
		const memory = this.heap.memory;
		const words = this.storageAddress(record) & RAM_RECORD_WORD_MASK;
		const links = words + (this.arrayCapacity(record) + 2 * this.hashSize(record)) * 4;
		const tags = links + this.hashSize(record) * 4;
		const ram = memory.ramData();
		ram.fill(0, words + retainedArray * 4, links);
		ram.fill(0xff, links, tags);
		ram.fill(0, tags + retainedArray, words + bytes);
		memory.invalidateRamWrite(words, bytes);
	}
	private freeStorage(record: number): void {
		const storage = this.storageAddress(record);
		if (storage !== 0) this.heap.budget.releaseRecord(storage, TableRecords.allocationCharge(this.arrayCapacity(record),
			Math.max(this.hashReserve(record), this.hashMembers(record))));
	}
	public freeRecord(record: number): void {
		this.freeStorage(record);
		this.heap.budget.releaseObject(record, TableRecords.HEADER_BYTES);
	}
	private wordAt(record: number, slot: number): number { return this.heap.memory.readRamRecordWord(this.storageAddress(record) + slot * 4); }
	private tagAt(record: number, slot: number): ValueTag { return this.heap.memory.readRamRecordByte(this.tags(record) + slot); }
	private valueAt(record: number, slot: number): Value { return valueFromTag(this.tagAt(record, slot), this.wordAt(record, slot)); }
	private setEncoded(record: number, slot: number, tag: ValueTag, word: number): void {
		const words = this.storageAddress(record), tags = words + (this.arrayCapacity(record) + 3 * this.hashSize(record)) * 4;
		this.writeSlot(words, tags, slot, tag, word);
	}
	private writeSlot(words: number, tags: number, slot: number, tag: ValueTag, word: number): void {
		this.heap.memory.writeRamRecordWord(words + slot * 4, word);
		this.heap.memory.writeRamRecordByte(tags + slot, tag);
	}
	private setValue(record: number, slot: number, value: Value): void { this.setEncoded(record, slot, valueTag(value), valuePayload(value)); }
	private hashKeySlot(record: number, index: number): number { return this.arrayCapacity(record) + index; }
	private hashValueSlot(record: number, index: number): number { return this.arrayCapacity(record) + this.hashSize(record) + index; }
	// Callers normalize the key once before lookup/insertion. Integral Float
	// keys are Integer keys, including -0. Nil and NaN cannot name entries.
	private getArrayIndex(key: Value): number {
		return valueTag(key) === ValueTag.Integer ? this.integerArrayIndex(asInteger(key)) : -1;
	}
	private integerArrayIndex(key: number): number { return key > 0 ? key - 1 : -1; }
	private findNodeIndex(record: number, key: Value, matchDead = false): number {
		const hash = this.hashSize(record);
		if (hash === 0) return -1;
		const array = this.arrayCapacity(record), words = this.storageAddress(record);
		const home = hashCanonicalTableKey(key) & (hash - 1);
		return this.probeHash(key, home, hash, array, words, words + (array + 3 * hash) * 4, matchDead);
	}
	private probeHash(key: Value, home: number, hash: number, array: number, words: number, tags: number, matchDead: boolean): number {
		const memory = this.heap.memory, links = tags - hash * 4;
		const tag = valueTag(key), payload = valuePayload(key);
		const collectable = matchDead && (tag === ValueTag.Table || tag === ValueTag.Closure || tag === ValueTag.Thread);
		let index = home;
		for (let remaining = hash; index >= 0 && remaining !== 0; --remaining) {
			const keySlot = array + index;
			const nodeTag = memory.readRamRecordByte(tags + keySlot);
			if (nodeTag === tag) {
				if (memory.readRamRecordWord(words + keySlot * 4) === payload) return index;
			} else if (collectable && nodeTag === ValueTag.Nil && memory.readRamRecordWord(words + keySlot * 4) === tag) {
				const valueSlot = keySlot + hash;
				if (memory.readRamRecordByte(tags + valueSlot) === ValueTag.DeadKey
					&& memory.readRamRecordWord(words + valueSlot * 4) === payload) return index;
			}
			index = memory.readRamRecordWord(links + index * 4) | 0;
		}
		return -1;
	}
	private findStringNodeIndex(key: StringId, home: number, hash: number, array: number, words: number, tags: number): number {
		const memory = this.heap.memory, links = tags - hash * 4;
		let index = home;
		for (let remaining = hash; index >= 0 && remaining !== 0; --remaining) {
			const slot = array + index;
			if (memory.readRamRecordByte(tags + slot) === ValueTag.String
				&& memory.readRamRecordWord(words + slot * 4) === key) return index;
			index = memory.readRamRecordWord(links + index * 4) | 0;
		}
		return -1;
	}

	public get(record: number, rawKey: Value): Value {
		if (isNil(rawKey) || valueIsNaN(rawKey)) return valueNil();
		const key = canonicalTableKey(rawKey);
		return this.getCanonical(record, key, this.getArrayIndex(key));
	}
	private getCanonical(record: number, key: Value, arrayIndex: number): Value {
		const array = this.arrayCapacity(record), hash = this.hashSize(record);
		const inArray = arrayIndex >= 0 && arrayIndex < array;
		if (!inArray && hash === 0) return valueNil();
		const words = this.storageAddress(record), tags = words + (array + 3 * hash) * 4;
		let slot = arrayIndex;
		if (!inArray) {
			const home = hashCanonicalTableKey(key) & (hash - 1);
			const index = this.probeHash(key, home, hash, array, words, tags, false);
			if (index < 0) return valueNil();
			slot = array + hash + index;
		}
		const memory = this.heap.memory;
		return valueFromTag(memory.readRamRecordByte(tags + slot), memory.readRamRecordWord(words + slot * 4));
	}
	public load(record: number, keyTag: ValueTag, keyWord: number, target: ValueWriteTarget, destination: number): void {
		const value = this.get(record, valueFromTag(keyTag, keyWord));
		target.setEncoded(destination, valueTag(value), valuePayload(value));
	}
	public getInteger(record: number, index: number): Value {
		return this.getCanonical(record, valueInteger(index), this.integerArrayIndex(index));
	}
	public loadInteger(record: number, index: number, target: ValueWriteTarget, destination: number): void {
		const array = this.integerArrayIndex(index);
		if (array >= 0 && array < this.arrayCapacity(record)) {
			target.setEncoded(destination, this.tagAt(record, array), this.wordAt(record, array)); return;
		}
		const value = this.getInteger(record, index);
		target.setEncoded(destination, valueTag(value), valuePayload(value));
	}
	public loadIntegerArrayKey(record: number, index: number, target: ValueWriteTarget, destination: number): boolean {
		const slot = this.integerArrayIndex(index), array = this.arrayCapacity(record);
		if (slot < 0 || slot >= array) return false;
		const memory = this.heap.memory, words = this.storageAddress(record);
		const tags = words + (array + 3 * this.hashSize(record)) * 4;
		const tag = memory.readRamRecordByte(tags + slot);
		if (tag === ValueTag.Nil && this.metatableAddress(record) !== 0) return false;
		target.setEncoded(destination, tag, memory.readRamRecordWord(words + slot * 4)); return true;
	}
	public storeIntegerArrayKey(record: number, index: number, tag: ValueTag, word: number, newIndexKey: StringId): boolean {
		const slot = this.integerArrayIndex(index), array = this.arrayCapacity(record);
		if (slot < 0 || slot >= array) return false;
		const words = this.storageAddress(record), tags = words + (array + 3 * this.hashSize(record)) * 4;
		if (this.heap.memory.readRamRecordByte(tags + slot) === ValueTag.Nil
			&& !isNil(this.metafield(record, newIndexKey))) return false;
		this.heap.writeTableAssignment(record, tag, word);
		this.writeSlot(words, tags, slot, tag, word);
		this.updateLengthHint(record, slot, tag !== ValueTag.Nil);
		return true;
	}
	public setInteger(record: number, index: number, value: Value): void { this.set(record, valueInteger(index), value); }
	public storeInteger(record: number, index: number, tag: ValueTag, word: number): void { this.set(record, valueInteger(index), valueFromTag(tag, word)); }
	public getStringKey(record: number, key: StringId): Value {
		const hash = this.hashSize(record);
		if (hash === 0) return valueNil();
		const array = this.arrayCapacity(record), words = this.storageAddress(record);
		const tags = words + (array + 3 * hash) * 4;
		const index = this.findStringNodeIndex(key, hashCanonicalTableKey(valueString(key)) & (hash - 1), hash, array, words, tags);
		if (index < 0) return valueNil();
		const memory = this.heap.memory, slot = array + hash + index;
		return valueFromTag(memory.readRamRecordByte(tags + slot), memory.readRamRecordWord(words + slot * 4));
	}
	public loadStringKey(record: number, key: StringId, target: ValueWriteTarget, destination: number): void {
		const hash = this.hashSize(record);
		if (hash !== 0) {
			const array = this.arrayCapacity(record), words = this.storageAddress(record);
			const tags = words + (array + 3 * hash) * 4;
			const index = this.findStringNodeIndex(key, hashCanonicalTableKey(valueString(key)) & (hash - 1), hash, array, words, tags);
			if (index >= 0) {
				const memory = this.heap.memory, slot = array + hash + index;
				target.setEncoded(destination, memory.readRamRecordByte(tags + slot), memory.readRamRecordWord(words + slot * 4));
				return;
			}
		}
		target.setNil(destination);
	}
	public beginStringProbe(record: number, key: StringId, probe: TableStringProbe): void {
		const count = this.hashSize(record);
		probe.node = count === 0 ? -1 : hashCanonicalTableKey(valueString(key)) & (count - 1);
		probe.remaining = count;
		probe.value = valueNil();
	}
	public advanceStringProbe(record: number, key: StringId, probe: TableStringProbe, limit: number): number {
		const hash = this.hashSize(record), array = this.arrayCapacity(record), words = this.storageAddress(record);
		const memory = this.heap.memory, tags = words + (array + 3 * hash) * 4, links = tags - hash * 4;
		const available = Math.min(probe.remaining, limit);
		let inspected = 0;
		while (probe.node >= 0 && inspected < available) {
			const slot = array + probe.node;
			++inspected;
			if (memory.readRamRecordByte(tags + slot) === ValueTag.String && memory.readRamRecordWord(words + slot * 4) === key) {
				probe.value = valueFromTag(memory.readRamRecordByte(tags + slot + hash), memory.readRamRecordWord(words + (slot + hash) * 4));
				probe.node = -1;
				break;
			}
			probe.node = memory.readRamRecordWord(links + probe.node * 4) | 0;
		}
		probe.remaining -= inspected;
		return inspected;
	}
	private predictedStringValueSlot(key: StringId, keySlot: number, hash: number, words: number, tags: number): number {
		const memory = this.heap.memory;
		return memory.readRamRecordByte(tags + keySlot) === ValueTag.String
			&& memory.readRamRecordWord(words + keySlot * 4) === key ? keySlot + hash : -1;
	}
	public loadPredictedStringKey(record: number, key: StringId, predicted: number, target: ValueWriteTarget, destination: number): boolean {
		if (predicted < 0) return false;
		const hash = this.hashSize(record);
		if (predicted >= hash) return false;
		const array = this.arrayCapacity(record), words = this.storageAddress(record);
		const tags = words + (array + 3 * hash) * 4;
		const keySlot = array + predicted;
		const slot = this.predictedStringValueSlot(key, keySlot, hash, words, tags);
		if (slot < 0) return false;
		const memory = this.heap.memory, tag = memory.readRamRecordByte(tags + slot);
		if (tag === ValueTag.Nil) return false;
		target.setEncoded(destination, tag, memory.readRamRecordWord(words + slot * 4));
		return true;
	}

	public getStringKeyCached(record: number, key: StringId, predicted: number, result: TableLookupSlot): void {
		const hash = this.hashSize(record);
		if (hash !== 0) {
			const array = this.arrayCapacity(record), words = this.storageAddress(record);
			const tags = words + (array + 3 * hash) * 4, memory = this.heap.memory;
			if (predicted >= 0 && predicted < hash) {
				const slot = this.predictedStringValueSlot(key, array + predicted, hash, words, tags);
				if (slot >= 0) {
					const tag = memory.readRamRecordByte(tags + slot);
					if (tag !== ValueTag.Nil) {
						result.value = valueFromTag(tag, memory.readRamRecordWord(words + slot * 4)); result.slot = predicted; return;
					}
				}
			}
			const index = this.findStringNodeIndex(key, hashCanonicalTableKey(valueString(key)) & (hash - 1), hash, array, words, tags);
			if (index >= 0) {
				const slot = array + hash + index;
				const tag = memory.readRamRecordByte(tags + slot);
				if (tag !== ValueTag.Nil) {
					result.value = valueFromTag(tag, memory.readRamRecordWord(words + slot * 4)); result.slot = index; return;
				}
			}
		}
		result.value = valueNil(); result.slot = -1;
	}
	public resolveIndex(record: number, indexKey: StringId, rawKey: Value, result: TableLookupResult,
		visitLimit = TABLE_INDEX_CHAIN_LIMIT): void {
		const validKey = !isNil(rawKey) && !valueIsNaN(rawKey);
		const key = canonicalTableKey(rawKey);
		const arrayIndex = this.getArrayIndex(key);
		let current = record;
		for (let depth = 0; depth < visitLimit; ++depth) {
			const own = validKey ? this.getCanonical(current, key, arrayIndex) : valueNil();
			if (!isNil(own)) {
				result.value = own; result.slot = -1; result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return;
			}
			const meta = this.metatableAddress(current);
			if (meta === 0) {
				result.value = depth === 0 ? own : valueNil();
				result.slot = -1; result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return;
			}
			const next = this.getStringKey(meta, indexKey);
			const tag = valueTag(next);
			if (tag !== ValueTag.Table) {
				result.value = tag === ValueTag.Nil ? valueNil() : next;
				result.slot = -1; result.extraVisits = depth;
				if (tag === ValueTag.Closure || tag === ValueTag.BuiltinFunction) {
					result.receiver = current; result.status = TableLookupStatus.Invoke;
				} else result.status = tag === ValueTag.Nil ? TableLookupStatus.Resolved : TableLookupStatus.Forward;
				return;
			}
			current = valuePayload(next);
		}
		result.extraVisits = visitLimit - 1; result.status = TableLookupStatus.ChainExhausted;
	}
	public resolveIntegerIndex(record: number, indexKey: StringId, key: number, result: TableLookupResult): void {
		this.resolveIndex(record, indexKey, valueInteger(key), result);
	}
	public resolveStringIndex(record: number, indexKey: StringId, key: StringId, result: TableLookupResult): void {
		this.resolveStringIndexCached(record, indexKey, key, -1, result);
	}
	public metafield(record: number, key: StringId): Value {
		const meta = this.metatableAddress(record);
		return meta !== 0 ? this.getStringKey(meta, key) : valueNil();
	}
	public resolveStringIndexCached(record: number, indexKey: StringId, key: StringId, predicted: number, result: TableLookupResult): void {
		let current = record;
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			this.getStringKeyCached(current, key, predicted, result);
			if (result.slot >= 0) {
				result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return;
			}
			const next = this.metafield(current, indexKey);
			const tag = valueTag(next);
			if (tag !== ValueTag.Table) {
				result.extraVisits = depth;
				if (tag === ValueTag.Closure || tag === ValueTag.BuiltinFunction) {
					result.value = next; result.receiver = current; result.status = TableLookupStatus.Invoke;
				} else if (tag !== ValueTag.Nil) {
					result.value = next; result.status = TableLookupStatus.Forward;
				} else result.status = TableLookupStatus.Resolved;
				return;
			}
			predicted = -1;
			current = valuePayload(next);
		}
		result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1; result.status = TableLookupStatus.ChainExhausted;
	}
	public resolveAssignment(record: number, newIndexKey: StringId, rawKey: Value, result: TableLookupResult,
		fixedString = false): void {
		const validKey = fixedString || (!isNil(rawKey) && !valueIsNaN(rawKey));
		const key = fixedString ? rawKey : canonicalTableKey(rawKey);
		const arrayIndex = fixedString ? -1 : this.getArrayIndex(key);
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			const meta = this.metatableAddress(record);
			let slot = meta === 0 ? TABLE_HASH_UNPROBED : -1;
			let next = valueNil();
			if (meta !== 0) {
				if (fixedString) {
					const hash = this.hashSize(record);
					let own = false;
					if (hash !== 0) {
						const array = this.arrayCapacity(record), words = this.storageAddress(record);
						const tags = words + (array + 3 * hash) * 4;
						slot = this.findStringNodeIndex(valuePayload(key), hashCanonicalTableKey(key) & (hash - 1), hash, array, words, tags);
						own = slot >= 0 && this.heap.memory.readRamRecordByte(tags + array + hash + slot) !== ValueTag.Nil;
					}
					if (!own) next = this.getStringKey(meta, newIndexKey);
				} else if (!validKey || isNil(this.getCanonical(record, key, arrayIndex))) {
					next = this.getStringKey(meta, newIndexKey);
				}
			}
			const tag = valueTag(next);
			if (tag === ValueTag.Table) {
				record = valuePayload(next);
				continue;
			}
			result.extraVisits = depth;
			result.receiver = record;
			result.value = next;
			result.status = tag === ValueTag.Nil ? TableLookupStatus.Store
				: tag === ValueTag.Closure || tag === ValueTag.BuiltinFunction ? TableLookupStatus.Invoke
				: TableLookupStatus.Forward;
			result.slot = tag === ValueTag.Nil ? slot : -1;
			return;
		}
		result.slot = -1; result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1; result.status = TableLookupStatus.ChainExhausted;
	}
	public set(record: number, key: Value, value: Value): void {
		this.setOwn(record, key, value, TABLE_HASH_UNPROBED, HashStore.General);
	}
	public assignScheduled(record: number, key: Value, value: Value, slot = TABLE_HASH_UNPROBED): number {
		return this.setOwn(record, key, value, slot, HashStore.Scheduled);
	}
	public resumeAssignment(record: number, key: Value, value: Value): boolean {
		return this.setOwn(record, key, value, TABLE_HASH_UNPROBED, HashStore.Resume) !== HASH_STORE_DECLINED;
	}
	private setOwn(record: number, rawKey: Value, value: Value, resolved: number, policy: HashStore): number {
		if (isNil(rawKey)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		if (valueIsNaN(rawKey)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NAN);
		const key = canonicalTableKey(rawKey);
		const tag = valueTag(value);
		const slot = this.getArrayIndex(key), array = this.arrayCapacity(record);
		if (slot >= 0 && slot < array) {
			const word = valuePayload(value);
			this.heap.writeTableAssignment(record, tag, word);
			this.setEncoded(record, slot, tag, word); this.updateLengthHint(record, slot, tag !== ValueTag.Nil); return -1;
		}
		const node = this.setHash(record, array, key, value, resolved, policy);
		if (node !== HASH_STORE_DECLINED && slot >= 0) this.updateLengthHint(record, slot, tag !== ValueTag.Nil);
		return node;
	}
	private setHash(record: number, array: number, key: Value, value: Value, resolved = TABLE_HASH_UNPROBED, policy = HashStore.General): number {
		const tag = valueTag(value), word = valuePayload(value);
		if (tag === ValueTag.Nil) { this.removeFromHash(record, key, resolved); return -1; }
		const keyTag = valueTag(key), keyWord = valuePayload(key);
		const hash = this.hashSize(record), words = this.storageAddress(record), tags = words + (array + 3 * hash) * 4;
		const home = hashCanonicalTableKey(key) & (hash - 1);
		const memory = this.heap.memory;
		let index = resolved;
		if (index === TABLE_HASH_UNPROBED) {
			index = hash === 0 ? -1 : keyTag === ValueTag.String
				? this.findStringNodeIndex(keyWord, home, hash, array, words, tags)
				: this.probeHash(key, home, hash, array, words, tags, true);
		}
		if (index >= 0) {
			const valueSlot = array + index + hash, prior = memory.readRamRecordByte(tags + valueSlot);
			if (prior !== ValueTag.Nil && prior !== ValueTag.DeadKey) {
				this.heap.writeTableAssignment(record, tag, word);
				this.writeSlot(words, tags, valueSlot, tag, word);
				return index;
			}
		}
		const reserve = this.hashReserve(record), members = this.hashMembers(record), watermark = this.hashWatermark(record);
		const repartition = members + 1 > Math.max(reserve, watermark);
		if (repartition || hash === 0) {
			index = this.insertHashWithAdmission(record, key, value, reserve, members, watermark, index, policy);
		} else {
			const useHome = this.vacantHome(home, array, hash, tags);
			const available = index >= 0 || useHome ? -1 : this.findFreeIndex(record, array, hash, tags);
			if (index < 0 && !useHome && available < 0) {
				index = this.insertHashWithAdmission(record, key, value, reserve, members, watermark, index, policy);
			} else {
				if (members >= reserve) {
					const budget = this.heap.budget;
					if (policy === HashStore.Resume) {
						if (budget.usedBytes() + TABLE_HASH_MAPPING_BYTES > budget.capacity()) return HASH_STORE_DECLINED;
					} else budget.admit(TABLE_HASH_MAPPING_BYTES, valueTable(record), key, value);
				}
				index = this.placeHashMapping(record, home, key, value, array, hash, words, tags, index, available);
				const retained = this.hashMembers(record);
				this.publishHashMembers(record, retained, retained + 1, reserve);
				this.heap.writeTableAssignment(record, tag, word, key);
				return index;
			}
		}
		if (index === HASH_STORE_DECLINED) return index;
		if (valueTagHasGcEdge(keyTag) || valueTagHasGcEdge(tag)) this.heap.writeBarrier(record, GC_RECORD_LINK);
		return index;
	}
	public store(record: number, keyTag: ValueTag, keyWord: number, tag: ValueTag, word: number): void {
		this.set(record, valueFromTag(keyTag, keyWord), valueFromTag(tag, word));
	}
	public setStringKey(record: number, key: StringId, value: Value): void { this.setHash(record, this.arrayCapacity(record), valueString(key), value); }
	public storeStringKey(record: number, key: StringId, tag: ValueTag, word: number, resolved = TABLE_HASH_UNPROBED): number {
		return this.setHash(record, this.arrayCapacity(record), valueString(key), valueFromTag(tag, word), resolved);
	}
	public storePredictedStringKey(record: number, key: StringId, predicted: number, tag: ValueTag, word: number): boolean {
		if (tag === ValueTag.Nil || predicted < 0) return false;
		const hash = this.hashSize(record);
		if (predicted >= hash) return false;
		const memory = this.heap.memory, array = this.arrayCapacity(record), words = this.storageAddress(record);
		const tags = words + (array + 3 * hash) * 4, keySlot = array + predicted, valueSlot = keySlot + hash;
		if (memory.readRamRecordByte(tags + keySlot) !== ValueTag.String || memory.readRamRecordWord(words + keySlot * 4) !== key
			|| memory.readRamRecordByte(tags + valueSlot) === ValueTag.Nil) return false;
		this.heap.writeTableAssignment(record, tag, word);
		this.writeSlot(words, tags, valueSlot, tag, word); return true;
	}
	private vacantHome(home: number, array: number, hash: number, tags: number): boolean {
		const memory = this.heap.memory, slot = tags + array + home;
		return memory.readRamRecordByte(slot) === ValueTag.Nil || memory.readRamRecordByte(slot + hash) === ValueTag.Nil;
	}
	private findFreeIndex(record: number, array: number, hash: number, tags: number): number {
		const memory = this.heap.memory;
		for (let index = this.hashFree(record); index >= 0; --index) {
			const keyTag = tags + array + index;
			if (memory.readRamRecordByte(keyTag) === ValueTag.Nil && memory.readRamRecordByte(keyTag + hash) === ValueTag.Nil) return index;
		}
		return -1;
	}
	private insertHashWithoutGrowth(record: number, main: number, key: Value, value: Value, array: number, hash: number, words: number, tags: number, free: number): number {
		const memory = this.heap.memory, links = tags - hash * 4;
		const keySlot = array + main, valueSlot = keySlot + hash;
		const keyTag = memory.readRamRecordByte(tags + keySlot);
		const tag = valueTag(key), word = valuePayload(key), nextTag = valueTag(value), nextWord = valuePayload(value);
		if (keyTag === ValueTag.Nil || memory.readRamRecordByte(tags + valueSlot) === ValueTag.Nil) {
			this.writeSlot(words, tags, keySlot, tag, word); this.writeSlot(words, tags, valueSlot, nextTag, nextWord); return main;
		}
		const mainWord = memory.readRamRecordWord(words + keySlot * 4);
		this.writeHeader(record, TableHeader.Free, free >= 0 ? free - 1 : -1);
		if (free < 0) return -1;
		const freeKey = array + free, freeValue = freeKey + hash;
		const occupiedMain = hashCanonicalTableKey(canonicalTableKey(valueFromTag(keyTag, mainWord))) & (hash - 1);
		if (occupiedMain !== main) {
			this.heap.tableEntriesMoved(record);
			this.writeSlot(words, tags, freeKey, keyTag, mainWord);
			this.writeSlot(words, tags, freeValue, memory.readRamRecordByte(tags + valueSlot), memory.readRamRecordWord(words + valueSlot * 4));
			memory.writeRamRecordWord(links + free * 4, memory.readRamRecordWord(links + main * 4));
			let previous = occupiedMain;
			for (let remaining = hash; remaining !== 0; --remaining) {
				const next = memory.readRamRecordWord(links + previous * 4) | 0;
				if (next === main || next < 0) break;
				previous = next;
			}
			memory.writeRamRecordWord(links + previous * 4, free);
			this.writeSlot(words, tags, keySlot, tag, word); this.writeSlot(words, tags, valueSlot, nextTag, nextWord);
			memory.writeRamRecordWord(links + main * 4, TABLE_HASH_NEXT_END); return main;
		}
		this.writeSlot(words, tags, freeKey, tag, word); this.writeSlot(words, tags, freeValue, nextTag, nextWord);
		memory.writeRamRecordWord(links + free * 4, memory.readRamRecordWord(links + main * 4));
		memory.writeRamRecordWord(links + main * 4, free); return free;
	}
	private placeHashMapping(record: number, home: number, key: Value, value: Value, array: number, hash: number,
		words: number, tags: number, existing: number, available: number): number {
		if (existing < 0) return this.insertHashWithoutGrowth(record, home, key, value, array, hash, words, tags, available);
		const slot = array + existing;
		this.writeSlot(words, tags, slot, valueTag(key), valuePayload(key));
		this.writeSlot(words, tags, slot + hash, valueTag(value), valuePayload(value));
		return existing;
	}
	// Storage relocation transfers existing edges, not new ones.
	private rawSet(record: number, key: Value, value: Value): number {
		const slot = this.getArrayIndex(key), array = this.arrayCapacity(record);
		if (slot >= 0 && slot < array) { this.setValue(record, slot, value); return -1; }
		const hash = this.hashSize(record), words = this.storageAddress(record), tags = words + (array + 3 * hash) * 4;
		const home = hashCanonicalTableKey(key) & (hash - 1);
		const available = this.vacantHome(home, array, hash, tags) ? -1 : this.findFreeIndex(record, array, hash, tags);
		return this.insertHashWithoutGrowth(record, home, key, value, array, hash, words, tags, available);
	}
	private markHashNodeDead(record: number, index: number): void {
		const members = this.hashMembers(record);
		this.publishHashMembers(record, members, members - 1, this.hashReserve(record));
		const keySlot = this.hashKeySlot(record, index), valueSlot = this.hashValueSlot(record, index), tag = this.tagAt(record, keySlot);
		if (tag === ValueTag.Table || tag === ValueTag.Thread || tag === ValueTag.Closure) {
			const hashId = this.wordAt(record, keySlot);
			this.setEncoded(record, keySlot, ValueTag.Nil, tag); this.setEncoded(record, valueSlot, ValueTag.DeadKey, hashId);
		} else this.setEncoded(record, valueSlot, ValueTag.Nil, 0);
	}
	private removeFromHash(record: number, key: Value, resolved: number): void {
		const index = resolved === TABLE_HASH_UNPROBED ? this.findNodeIndex(record, key) : resolved;
		if (index >= 0 && this.tagAt(record, this.hashValueSlot(record, index)) !== ValueTag.Nil) this.markHashNodeDead(record, index);
	}
	private static countIntegerKey(counts: Uint32Array, bins: number, index: number): number {
		const log = ceilLog2(index);
		while (bins <= log) counts[bins++] = 0;
		++counts[log]; return bins;
	}
	private planRehash(record: number, key: Value, reserve: number, members: number, watermark: number): void {
		const plan = this.resizePlan;
		// Physical tombstones alone do not change the reserved array range.
		if (members + 1 <= Math.max(reserve, watermark)) {
			plan.array = this.arrayCapacity(record);
			plan.hash = TableRecords.hashCapacity(members + 1);
			plan.members = members + 1;
			plan.watermark = watermark;
			return;
		}
		const counts = TableRecords.rehashIntegerCounts;
		const memory = this.heap.memory, oldArray = this.arrayCapacity(record), oldHash = this.hashSize(record);
		const words = this.storageAddress(record), tags = words + (oldArray + 3 * oldHash) * 4;
		let bins = 0, totalKeys = 0;
		for (let slot = 0; slot < oldArray; ++slot) {
			if (memory.readRamRecordByte(tags + slot) === ValueTag.Nil) continue;
			++totalKeys; bins = TableRecords.countIntegerKey(counts, bins, slot + 1);
		}
		for (let index = 0; index < oldHash; ++index) {
			const slot = oldArray + index, keyTag = memory.readRamRecordByte(tags + slot);
			if (keyTag === ValueTag.Nil || memory.readRamRecordByte(tags + slot + oldHash) === ValueTag.Nil) continue;
			++totalKeys;
			if (keyTag !== ValueTag.Integer) continue;
			const integer = memory.readRamRecordWord(words + slot * 4) | 0;
			if (integer > 0) bins = TableRecords.countIntegerKey(counts, bins, integer);
		}
		++totalKeys; const added = this.getArrayIndex(key);
		if (added >= 0) bins = TableRecords.countIntegerKey(counts, bins, added + 1);
		let arraySize = 0, arrayKeys = 0, total = 0, power = 1;
		for (let bin = 0; bin < bins; ++bin) {
			total += counts[bin];
			if (total > power / 2) { arraySize = power; arrayKeys = total; }
			power *= 2;
		}
		const hashKeys = totalKeys - arrayKeys;
		plan.array = arraySize;
		plan.members = hashKeys;
		plan.hash = TableRecords.hashCapacity(hashKeys);
		plan.watermark = arraySize === oldArray ? TableRecords.hashCapacity(members + 1) : plan.hash;
	}
	private insertHashWithAdmission(record: number, key: Value, value: Value, reserve: number, members: number, watermark: number, existing: number, policy: HashStore): number {
		const budget = this.heap.budget, owner = valueTable(record), plan = this.resizePlan;
		this.planRehash(record, key, reserve, members, watermark);
		let previous = TableRecords.allocationCharge(this.arrayCapacity(record), Math.max(reserve, members));
		let requested = TableRecords.allocationCharge(plan.array, Math.max(reserve, plan.members));
		let admitted = requested <= previous || (policy === HashStore.Resume
			? budget.usedBytes() + requested - previous <= budget.capacity()
			: budget.prepareAllocation(requested - previous, owner, key, value));
		const parkOnRefusal = policy === HashStore.Resume || (policy === HashStore.Scheduled && admitted);
		let recovery = LuaAllocationRecovery.CurrentOrFresh;
		for (;;) {
			if (admitted) {
				const array = this.arrayCapacity(record), hash = this.hashSize(record);
				if (plan.array === array && hash !== 0) {
					const words = this.storageAddress(record), tags = words + (array + 3 * hash) * 4;
					const home = hashCanonicalTableKey(key) & (hash - 1);
					const vacant = this.vacantHome(home, array, hash, tags);
					const available = existing >= 0 || vacant ? -1 : this.findFreeIndex(record, array, hash, tags);
					if (existing >= 0 || vacant || available >= 0) {
						const slot = this.placeHashMapping(record, home, key, value, array, hash, words, tags, existing, available);
						this.publishHashMembers(record, members, plan.members, reserve);
						this.publishHashWatermark(record, plan.watermark);
						return slot;
					}
				}
				const storage = this.heap.arena.allocate(TableRecords.storageBytes(plan.array, plan.hash, reserve), true);
				if (storage !== 0) return this.resize(record, storage, key, value, reserve, previous, requested);
			}
			if (parkOnRefusal) return HASH_STORE_DECLINED;
			recovery = this.heap.recoverAllocation(recovery, owner, key, value);
			members = this.hashMembers(record);
			this.planRehash(record, key, reserve, members, watermark);
			previous = TableRecords.allocationCharge(this.arrayCapacity(record), Math.max(reserve, members));
			requested = TableRecords.allocationCharge(plan.array, Math.max(reserve, plan.members));
			admitted = requested <= previous || budget.usedBytes() + requested - previous <= budget.capacity();
		}
	}
	private resize(record: number, storage: number, key: Value, value: Value, reserve: number, previous: number, requested: number): number {
		const { array, hash, members, watermark } = this.resizePlan;
		this.heap.tableEntriesMoved(record);
		const oldWords = this.storageAddress(record), oldTags = this.tags(record);
		const oldArray = this.arrayCapacity(record), oldHash = this.hashSize(record);
		const memory = this.heap.memory;
		this.bindStorage(record, array, hash, storage);
		const retainedArray = Math.min(oldArray, array);
		if (retainedArray !== 0) {
			const ram = memory.ramData();
			const wordSource = oldWords & RAM_RECORD_WORD_MASK, tagSource = oldTags & RAM_RECORD_WORD_MASK;
			ram.copyWithin(storage & RAM_RECORD_WORD_MASK, wordSource, wordSource + retainedArray * 4);
			ram.copyWithin(this.tags(record) & RAM_RECORD_WORD_MASK, tagSource, tagSource + retainedArray);
		}
		this.initializeStorage(record, retainedArray);
		for (let slot = retainedArray; slot < oldArray; ++slot) {
			const tag = memory.readRamRecordByte(oldTags + slot);
			if (tag !== ValueTag.Nil) this.rawSet(record, valueInteger(slot + 1), valueFromTag(tag, memory.readRamRecordWord(oldWords + slot * 4)));
		}
		for (let index = 0; index < oldHash; ++index) {
			const oldKey = oldArray + index, oldValue = oldKey + oldHash;
			const keyTag = memory.readRamRecordByte(oldTags + oldKey), valueTag = memory.readRamRecordByte(oldTags + oldValue);
			if (keyTag !== ValueTag.Nil && valueTag !== ValueTag.Nil) this.rawSet(record,
				valueFromTag(keyTag, memory.readRamRecordWord(oldWords + oldKey * 4)),
				valueFromTag(valueTag, memory.readRamRecordWord(oldWords + oldValue * 4)));
		}
		const slot = this.rawSet(record, key, value);
		if (hash !== 0 || reserve !== 0) memory.writeRamRecordPair(this.hashMetadata(record), reserve, members);
		this.publishHashWatermark(record, watermark);
		this.heap.budget.replaceRecord(oldWords, previous, requested);
		return slot;
	}
	private updateLengthHint(record: number, slot: number, present: boolean): void {
		const hint = this.lengthHint(record);
		if (present ? slot === hint : slot + 1 === hint) this.writeHeader(record, TableHeader.Length, present ? hint + 1 : hint - 1);
	}
	private hasIntegerKey(record: number, key: number): boolean {
		if (key <= this.arrayCapacity(record)) return this.tagAt(record, key - 1) !== ValueTag.Nil;
		const index = this.findNodeIndex(record, valueInteger(key));
		return index >= 0 && this.tagAt(record, this.hashValueSlot(record, index)) !== ValueTag.Nil;
	}
	public length(record: number): number {
		let low = this.lengthHint(record), high: number;
		if (low !== 0 && !this.hasIntegerKey(record, low)) { high = low; low = 0; }
		else if (low === TABLE_MAX_ARRAY_INDEX) return low;
		else {
			if (!this.hasIntegerKey(record, low + 1)) return low;
			++low;
			high = Math.min(low * 2, TABLE_MAX_ARRAY_INDEX);
			while (low !== TABLE_MAX_ARRAY_INDEX && this.hasIntegerKey(record, high)) {
				low = high;
				high = Math.min(low * 2, TABLE_MAX_ARRAY_INDEX);
			}
		}
		while (high - low > 1) {
			const middle = low + ((high - low) >>> 1);
			if (this.hasIntegerKey(record, middle)) low = middle; else high = middle;
		}
		this.writeHeader(record, TableHeader.Length, low);
		return low;
	}
	public clear(record: number): void {
		this.heap.tableEntriesMoved(record);
		this.writeHeader(record, TableHeader.Length, 0);
		this.freeStorage(record);
		this.writeHeader(record, TableHeader.Kind, this.readHeader(record, TableHeader.Kind) & ~(TABLE_EXPLICIT_HASH_RESERVE | TABLE_HASH_WATERMARK_MASK));
		this.bindStorage(record, 0, 0, 0);

	}
	public storedSlotCount(record: number): number { return this.arrayCapacity(record) + this.hashSize(record); }
	public loadStoredEntry(record: number, slot: number, target: ValueWriteTarget, destination: number): boolean {
		if (slot < this.arrayCapacity(record)) {
			if (this.tagAt(record, slot) === ValueTag.Nil) return false;
			target.setEncoded(destination, ValueTag.Integer, slot + 1);
			target.setEncoded(destination + 1, this.tagAt(record, slot), this.wordAt(record, slot)); return true;
		}
		const index = slot - this.arrayCapacity(record), key = this.hashKeySlot(record, index), value = this.hashValueSlot(record, index);
		if (this.tagAt(record, key) === ValueTag.Nil || this.tagAt(record, value) === ValueTag.Nil) return false;
		target.setEncoded(destination, this.tagAt(record, key), this.wordAt(record, key)); target.setEncoded(destination + 1, this.tagAt(record, value), this.wordAt(record, value)); return true;
	}
	public scanSlots(record: number): number { return this.arrayCapacity(record) + 2 * this.hashSize(record); }
	public forEachStoredEntry(record: number, visitor: StoredEntryVisitor, first = 0, last = 0x7fffffff): void {
		const memory = this.heap.memory;
		const array = this.arrayCapacity(record), hash = this.hashSize(record), words = this.storageAddress(record);
		const tags = words + (array + 3 * hash) * 4, end = Math.min(array + hash, last);
		const arrayEnd = Math.min(array, last);
		for (let slot = first; slot < arrayEnd; ++slot) {
			const tag = memory.readRamRecordByte(tags + slot);
			if (tag !== ValueTag.Nil) visitor(valueInteger(slot + 1), valueFromTag(tag, memory.readRamRecordWord(words + slot * 4)));
		}
		for (let key = Math.max(first, array); key < end; ++key) {
			const value = key + hash;
			const keyTag = memory.readRamRecordByte(tags + key), valueTag = memory.readRamRecordByte(tags + value);
			if (keyTag === ValueTag.Nil || valueTag === ValueTag.Nil) continue;
			visitor(valueFromTag(keyTag, memory.readRamRecordWord(words + key * 4)),
				valueFromTag(valueTag, memory.readRamRecordWord(words + value * 4)));
		}
	}
	public clearWeakEntries(record: number, weakKeys: boolean, weakValues: boolean, isAlive: StoredValuePredicate,
		first = 0, end = this.storedSlotCount(record)): void {
		const array = this.arrayCapacity(record), hash = this.hashSize(record);
		if (weakValues) for (let slot = first; slot < Math.min(array, end); ++slot)
			if (this.tagAt(record, slot) !== ValueTag.Nil && !isAlive(this.valueAt(record, slot))) this.setEncoded(record, slot, ValueTag.Nil, 0);
		for (let key = Math.max(first, array); key < Math.min(array + hash, end); ++key) {
			const value = key + hash;
			if (this.tagAt(record, key) === ValueTag.Nil || this.tagAt(record, value) === ValueTag.Nil) continue;
			if ((weakKeys && !isAlive(this.valueAt(record, key))) || (weakValues && !isAlive(this.valueAt(record, value)))) this.markHashNodeDead(record, key - array);
		}
	}
	public next(record: number, rawAfter: Value, target: ValueWriteTarget, destination: number): void {
		const after = canonicalTableKey(rawAfter);
		const arraySize = this.arrayCapacity(record);
		let position = 0;
		if (!isNil(after)) {
			const array = this.getArrayIndex(after);
			if (array >= 0 && array < arraySize) position = array + 1;
			else {
				const index = this.findNodeIndex(record, after, true);
				if (index < 0) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
				position = arraySize + index + 1;
			}
		}
		this.nextStoredEntry(record, position, target, destination, true);
	}
	public nextStoredEntry(record: number, position: number, target: ValueWriteTarget, destination: number, wantsValue: boolean): number {
		const arraySize = this.arrayCapacity(record);
		for (; position < arraySize; ++position) {
			const tag = this.tagAt(record, position);
			if (tag === ValueTag.Nil) continue;
			target.setInteger(destination, position + 1);
			if (wantsValue) target.setEncoded(destination + 1, tag, this.wordAt(record, position));
			return position + 1;
		}
		const hashSize = this.hashSize(record);
		for (let index = position - arraySize; index < hashSize; ++index) {
			const key = arraySize + index, value = key + hashSize;
			if (this.tagAt(record, key) === ValueTag.Nil || this.tagAt(record, value) === ValueTag.Nil) continue;
			target.setEncoded(destination, this.tagAt(record, key), this.wordAt(record, key));
			if (wantsValue) target.setEncoded(destination + 1, this.tagAt(record, value), this.wordAt(record, value));
			return key + 1;
		}
		target.setNil(destination);
		return 0;
	}
	public getTrackedHeapBytes(record: number): number {
		const storage = this.storageAddress(record);
		return this.heap.arena.allocationBytes(record - GC_OBJECT_PREFIX)
			+ (storage !== 0 ? this.heap.arena.allocationBytes(storage) : 0);
	}
}
