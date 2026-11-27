import { RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { HeapServiceBiosCallKind, HeapServiceTableGrowthMode, HeapServiceTableGrowthStage } from '../../spec/bmsx/heap_service';
import { GC_OBJECT_PREFIX, GC_RECORD_LINK } from './gc_object';
import { ceilLog2, nextPowerOfTwo } from '../common/numeric';
import { LUA_FAULT_REASON_INDEX_NAN, LUA_FAULT_REASON_INDEX_NIL, LUA_FAULT_REASON_INVALID_NEXT_KEY } from '../../spec/blua32/cop0';
import { LuaExecutionError } from './errors';
import { LuaAllocationMode, LuaAllocationRecovery } from './lua_heap';
import { gcPacedPhase, type GcHeap } from './gc_heap';
import type { CPU } from './cpu';
import type { StringId } from './string_pool';
import {
	ValueTag, asInteger, canonicalTableKey, isNil, hashCanonicalTableKey, valueFromTag, valueInteger,
	valueIsNaN, valueNil, valuePayload, valueString, valueTable, valueTag, type Value,
} from './value';
import type { ValueWriteTarget } from './value_slots';

const TABLE_HASH_NEXT_END = -1;
const TABLE_MAX_ARRAY_INDEX = 0x7fffffff;
const TABLE_STRING_HIT_BASE_NODES = 64;
const TABLE_HASH_SLOT_BUDGET_BYTES = 10;
// A fixed-string Store carries an unprobed, absent (-1), or matched hash node,
// including a matched tombstone.
export const TABLE_HASH_UNPROBED = -2;
export const HASH_STORE_DECLINED = -3;
export const HASH_STORE_PENDING = -4;
const enum HashStore { General, Scheduled, Resume }
export const TABLE_INDEX_CHAIN_LIMIT = 32;
export const enum TableLookupStatus { Resolved, ChainExhausted, Invoke, Forward, Store }
type TableLookupSlot = { value: Value; slot: number };
export type TableLookupResult = TableLookupSlot & { extraVisits: number; status: TableLookupStatus; receiver: number };
type StoredEntryVisitor = (key: Value, value: Value) => void;
type StoredValuePredicate = (value: Value) => boolean;
export interface TableStringProbe extends TableLookupSlot { node: number; remaining: number }

export const enum TableHeader {
	Kind = 0, NewIndexAbsent = 2, Gray = 4, Metatable = 8, HashStorage = 12, Array = 16, Hash = 20, Length = 24, Free = 28, ArrayStorage = 32,
}
export const enum TableStoreReturn { None, Call, Protected }
export const enum TableCensus { None, General, Scheduled, RetryCurrent, RetryFresh }
class ArrayDensity { scanned = 0; live = 0; slots = 0; kept = 0; }
export class TableRebuild extends ArrayDensity {
	census = TableCensus.None; recovery = LuaAllocationRecovery.CurrentOrFresh;
	record = 0; source = 0; count = 0; storage = 0; capacity = 0;
	arrayStorage = 0; arraySlots = 0; arrayCleared = 0;
	cleared = 0; homes = 0; cursor = 0; free = 0; collisions = 0;
	key = valueNil(); value = valueNil();
	result = TableStoreReturn.None; destination = 0; wanted = 0; instructionPc = 0;
}
export class TableRecords {
	private readonly directDensity = new ArrayDensity();
	private readonly resizePlan = { array: 0, hash: 0, keepHash: false };
	private static readonly rehashIntegerCounts = new Uint32Array(32);
	static readonly HEADER_BYTES = 36;
	static readonly HEADER_CHARGE = 32;
	public readonly newIndexKey: Value;
	public constructor(private readonly heap: GcHeap, newIndexKey: StringId) {
		this.newIndexKey = valueString(newIndexKey);
	}
	public initialize(record: number, array: number, hash: number): void {
		const memory = this.heap.memory;
		const kind = ValueTag.Table | (this.heap.white() << 8) | (1 << (8 * TableHeader.NewIndexAbsent));
		memory.writeRamRecordPair(record + TableHeader.Kind, kind, 0);
		this.writeHeader(record, TableHeader.Metatable, 0);
		memory.writeRamRecordPair(record + TableHeader.Array, array, hash);
		memory.writeRamRecordPair(record + TableHeader.Length, 0, hash - 1);
		this.initializeArray(this.arrayAddress(record), array, 0);
		this.initializeHash(this.hashAddress(record), hash);
	}
	public copyOwn(source: number): number {
		const array = this.arrayCapacity(source), hash = this.hashSize(source);
		const copy = this.heap.budget.allocateRecord(TableRecords.HEADER_BYTES, true, array * 5, TableHeader.ArrayStorage,
			valueTable(source), valueNil(), valueNil(), TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(array, hash), LuaAllocationMode.Direct,
			TableRecords.hashStorageBytes(hash), TableHeader.HashStorage);
		// The rooted source keeps its layout, but admission can clear weak entries.
		const memory = this.heap.memory;
		const absence = memory.readRamRecordByte(source + TableHeader.NewIndexAbsent);
		const kind = ValueTag.Table | (this.heap.white() << 8) | (absence << (8 * TableHeader.NewIndexAbsent));
		memory.writeRamRecordPair(copy + TableHeader.Kind, kind, 0);
		this.writeHeader(copy, TableHeader.Metatable, 0);
		memory.writeRamRecordPair(copy + TableHeader.Array, array, hash);
		memory.writeRamRecordPair(copy + TableHeader.Length, this.lengthHint(source), this.readHeader(source, TableHeader.Free));
		this.copyStorage(this.arrayAddress(copy), this.arrayAddress(source), array * 5);
		this.copyStorage(this.hashAddress(copy), this.hashAddress(source), TableRecords.hashStorageBytes(hash));
		this.heap.publishObject(copy);
		return copy;
	}
	private copyStorage(dst: number, src: number, bytes: number): void {
		if (!bytes) return;
		const start = src & RAM_RECORD_WORD_MASK, target = dst & RAM_RECORD_WORD_MASK;
		this.heap.memory.ramData().copyWithin(target, start, start + bytes);
		this.heap.memory.invalidateRamWrite(target, bytes);
	}
	public static hashCapacity(size: number): number { return size > 0 ? nextPowerOfTwo(size) : 0; }
	// Two word lanes, two tag lanes and a signed chain cursor per node.
	// A byte covers -1 and every index of a power-of-two table up to 128.
	public static readonly HASH_CENSUS_LIMIT = 64;
	private static readonly HASH_BAND_CAPACITY = 1024;
	private static hashNodeBytes(hash: number): number { return hash * (hash <= 128 ? 11 : 14); }
	public static hashStorageBytes(hash: number): number { return TableRecords.hashNodeBytes(hash) + (hash > TableRecords.HASH_CENSUS_LIMIT ? 4 : 0) + (hash >= TableRecords.HASH_BAND_CAPACITY ? 32 * 4 : 0); }
	private adjustIntegerBand(words: number, hash: number, tag: ValueTag, word: number, delta: number): void {
		if (hash < TableRecords.HASH_BAND_CAPACITY || tag !== ValueTag.Integer || (word | 0) <= 0) return;
		const bin = 32 - Math.clz32(word - 1);
		const address = words + TableRecords.hashNodeBytes(hash) + 4 * (1 + bin), memory = this.heap.memory;
		memory.writeRamRecordWord(address, memory.readRamRecordWord(address) + delta);
	}
	private adjustHashLive(words: number, hash: number, delta: number): void {
		if (hash <= TableRecords.HASH_CENSUS_LIMIT) return;
		const memory = this.heap.memory, address = words + TableRecords.hashNodeBytes(hash);
		memory.writeRamRecordWord(address, memory.readRamRecordWord(address) + delta);
	}
	private hashNext(links: number, count: number, node: number): number {
		return count <= 128 ? (this.heap.memory.readRamRecordByte(links + node) << 24) >> 24
			: this.heap.memory.readRamRecordWord(links + node * 4) | 0;
	}
	private setHashNext(links: number, count: number, node: number, next: number): void {
		if (count <= 128) this.heap.memory.writeRamRecordByte(links + node, next);
		else this.heap.memory.writeRamRecordWord(links + node * 4, next);
	}
	public static storageBytes(array: number, hash: number): number { return 5 * array + TableRecords.hashStorageBytes(hash); }
	public static allocationCharge(array: number, hash: number): number { return 5 * array + TABLE_HASH_SLOT_BUDGET_BYTES * hash; }
	private readHeader(record: number, field: TableHeader): number { return this.heap.memory.readRamRecordWord(record + field); }
	private writeHeader(record: number, field: TableHeader, word: number): void { this.heap.memory.writeRamRecordWord(record + field, word); }
	public metatableAddress(record: number): number { return this.readHeader(record, TableHeader.Metatable); }
	// Only the metatable's own mapping matters. Its mutation paths maintain the proof.
	private newIndexMetatable(record: number): number {
		const meta = this.metatableAddress(record);
		return meta !== 0 && this.heap.memory.readRamRecordByte(meta + TableHeader.NewIndexAbsent) === 1 ? 0 : meta;
	}
	public setMetatableAddress(record: number, address: number): void {
		this.heap.writeBarrier(record, GC_RECORD_LINK);
		this.writeHeader(record, TableHeader.Metatable, address);
	}
	public arrayCapacity(record: number): number { return this.readHeader(record, TableHeader.Array); }
	public hashSize(record: number): number { return this.readHeader(record, TableHeader.Hash); }
	private lengthHint(record: number): number { return this.readHeader(record, TableHeader.Length); }
	private hashFree(record: number): number { return this.readHeader(record, TableHeader.Free) | 0; }
	public arrayAddress(record: number): number { return this.readHeader(record, TableHeader.ArrayStorage); }
	public hashAddress(record: number): number { return this.readHeader(record, TableHeader.HashStorage); }
	private tags(record: number): number { return this.hashAddress(record) + 8 * this.hashSize(record); }
	private bindHash(record: number, hash: number, address: number): void {
		this.writeHeader(record, TableHeader.HashStorage, address);
		this.writeHeader(record, TableHeader.Hash, hash);
		this.writeHeader(record, TableHeader.Free, hash - 1);
	}
	private initializeArray(address: number, capacity: number, retained: number): void {
		if (!capacity) return;
		const memory = this.heap.memory, ram = memory.ramData();
		const base = address & RAM_RECORD_WORD_MASK, first = base + retained * 4;
		ram.fill(0, first, base + capacity * 4);
		ram.fill(0, base + capacity * 4 + retained, base + capacity * 5);
		memory.invalidateRamWrite(first, capacity * 5 - retained * 4);
	}
	private initializeHash(address: number, count: number): void {
		if (!count) return;
		const memory = this.heap.memory, ram = memory.ramData(), base = address & RAM_RECORD_WORD_MASK;
		const bytes = TableRecords.hashNodeBytes(count);
		let total = bytes;
		ram.fill(0, base, base + count * 10);
		ram.fill(0xff, base + count * 10, base + bytes);
		if (count > TableRecords.HASH_CENSUS_LIMIT) {
			total = TableRecords.hashStorageBytes(count);
			ram.fill(0, base + bytes, base + total);
		}
		memory.invalidateRamWrite(base, total);
	}
	private freeStorage(record: number): void {
		const array = this.arrayAddress(record), hash = this.hashAddress(record);
		if (array) this.heap.budget.releaseRecord(array, this.arrayCapacity(record) * 5);
		if (hash) this.heap.budget.releaseRecord(hash, this.hashSize(record) * TABLE_HASH_SLOT_BUDGET_BYTES);
	}
	public freeRecord(record: number): void {
		this.freeStorage(record);
		this.heap.budget.releaseObject(record, TableRecords.HEADER_CHARGE);
	}
	private wordAt(record: number, slot: number): number { return this.heap.memory.readRamRecordWord(this.hashAddress(record) + slot * 4); }
	private tagAt(record: number, slot: number): ValueTag { return this.heap.memory.readRamRecordByte(this.tags(record) + slot); }
	private setEncoded(record: number, slot: number, tag: ValueTag, word: number): void {
		const words = this.hashAddress(record), tags = words + 8 * this.hashSize(record);
		this.writeSlot(words, tags, slot, tag, word);
	}
	private writeSlot(words: number, tags: number, slot: number, tag: ValueTag, word: number): void {
		this.heap.memory.writeRamRecordWord(words + slot * 4, word);
		this.heap.memory.writeRamRecordByte(tags + slot, tag);
	}
	private hashValueSlot(record: number, index: number): number { return this.hashSize(record) + index; }
	// Callers normalize the key once before lookup/insertion. Integral Float
	// keys are Integer keys, including -0. Nil and NaN cannot name entries.
	private getArrayIndex(key: Value): number {
		return valueTag(key) === ValueTag.Integer ? this.integerArrayIndex(asInteger(key)) : -1;
	}
	private integerArrayIndex(key: number): number { return key > 0 ? key - 1 : -1; }
	private findNodeIndex(record: number, key: Value, matchDead = false): number {
		const hash = this.hashSize(record);
		if (hash === 0) return -1;
		const words = this.hashAddress(record);
		const home = hashCanonicalTableKey(key) & (hash - 1);
		return this.probeHash(key, home, hash, words, words + 8 * hash, matchDead);
	}
	private probeHash(key: Value, home: number, hash: number, words: number, tags: number, matchDead: boolean): number {
		const memory = this.heap.memory, links = tags + hash * 2;
		const tag = valueTag(key), payload = valuePayload(key);
		const collectable = matchDead && (tag === ValueTag.Table || tag === ValueTag.Closure || tag === ValueTag.Thread);
		let index = home;
		for (let remaining = hash; index >= 0 && remaining !== 0; --remaining) {
			const keySlot = index;
			const nodeTag = memory.readRamRecordByte(tags + keySlot);
			if (nodeTag === tag) {
				if (memory.readRamRecordWord(words + keySlot * 4) === payload) return index;
			} else if (collectable && nodeTag === ValueTag.Nil && memory.readRamRecordWord(words + keySlot * 4) === tag) {
				const valueSlot = keySlot + hash;
				if (memory.readRamRecordByte(tags + valueSlot) === ValueTag.DeadKey
					&& memory.readRamRecordWord(words + valueSlot * 4) === payload) return index;
			}
			index = this.hashNext(links, hash, index);
		}
		return -1;
	}
	private findStringNodeIndex(key: StringId, home: number, hash: number, words: number, tags: number): number {
		const links = tags + hash * 2;
		let index = home;
		for (let remaining = hash; index >= 0 && remaining !== 0; --remaining) {
			if (this.matchingStringValueSlot(key, index, hash, words, tags) >= 0) return index;
			index = this.hashNext(links, hash, index);
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
		if (arrayIndex >= 0 && arrayIndex < array) return this.arrayValue(record, arrayIndex);
		if (!hash) return valueNil();
		const words = this.hashAddress(record), tags = words + hash * 8;
		const index = this.probeHash(key, hashCanonicalTableKey(key) & (hash - 1), hash, words, tags, false);
		if (index < 0) return valueNil();
		const slot = hash + index;
		return valueFromTag(this.heap.memory.readRamRecordByte(tags + slot), this.heap.memory.readRamRecordWord(words + slot * 4));
	}
	private arrayValue(record: number, slot: number): Value {
		const words = this.arrayAddress(record), memory = this.heap.memory;
		return valueFromTag(memory.readRamRecordByte(words + this.arrayCapacity(record) * 4 + slot), memory.readRamRecordWord(words + slot * 4));
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
			const value = this.arrayValue(record, array); target.setEncoded(destination, valueTag(value), valuePayload(value)); return;
		}
		const value = this.getInteger(record, index);
		target.setEncoded(destination, valueTag(value), valuePayload(value));
	}
	public loadIntegerArrayKey(record: number, index: number, target: ValueWriteTarget, destination: number): boolean {
		const slot = this.integerArrayIndex(index), array = this.arrayCapacity(record);
		if (slot < 0 || slot >= array) return false;
		const memory = this.heap.memory, words = this.arrayAddress(record);
		const tags = words + array * 4;
		const tag = memory.readRamRecordByte(tags + slot);
		if (tag === ValueTag.Nil && this.metatableAddress(record) !== 0) return false;
		target.setEncoded(destination, tag, memory.readRamRecordWord(words + slot * 4)); return true;
	}
	public storeIntegerArrayKey(record: number, index: number, tag: ValueTag, word: number): boolean {
		const slot = this.integerArrayIndex(index), array = this.arrayCapacity(record);
		if (slot < 0 || slot >= array) return false;
		const words = this.arrayAddress(record), tags = words + array * 4;
		if (this.heap.memory.readRamRecordByte(tags + slot) === ValueTag.Nil) {
			const meta = this.newIndexMetatable(record);
			if (meta !== 0 && !isNil(this.getStringKey(meta, valuePayload(this.newIndexKey)))) return false;
		}
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
		const words = this.hashAddress(record);
		const tags = words + 8 * hash;
		const index = this.findStringNodeIndex(key, hashCanonicalTableKey(valueString(key)) & (hash - 1), hash, words, tags);
		if (index < 0) return valueNil();
		const memory = this.heap.memory, slot = hash + index;
		return valueFromTag(memory.readRamRecordByte(tags + slot), memory.readRamRecordWord(words + slot * 4));
	}
	public loadStringKey(record: number, key: StringId, target: ValueWriteTarget, destination: number): void {
		const hash = this.hashSize(record);
		if (hash !== 0) {
			const words = this.hashAddress(record);
			const tags = words + 8 * hash;
			const index = this.findStringNodeIndex(key, hashCanonicalTableKey(valueString(key)) & (hash - 1), hash, words, tags);
			if (index >= 0) {
				const memory = this.heap.memory, slot = hash + index;
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
		probe.value = valueNil(); probe.slot = -1;
	}
	public advanceStringProbe(record: number, key: StringId, probe: TableStringProbe, limit: number): number {
		const hash = this.hashSize(record), words = this.hashAddress(record);
		return this.scanStringNodes(key, probe.node, hash, words, words + 8 * hash, Math.min(limit, probe.remaining), probe, probe);
	}
	private scanStringNodes(key: StringId, node: number, hash: number, words: number, tags: number,
		allowance: number, result: TableLookupSlot, cursor?: TableStringProbe): number {
		const memory = this.heap.memory, links = tags + hash * 2;
		let inspected = 0;
		while (node >= 0 && inspected < allowance) {
			++inspected;
			const slot = this.matchingStringValueSlot(key, node, hash, words, tags);
			if (slot >= 0) {
				result.slot = node;
				result.value = valueFromTag(memory.readRamRecordByte(tags + slot), memory.readRamRecordWord(words + slot * 4));
				if (cursor) {
					cursor.node = -1;
					cursor.remaining -= inspected;
				}
				return inspected;
			}
			node = this.hashNext(links, hash, node);
		}
		result.value = valueNil(); result.slot = -1;
		if (cursor) {
			cursor.node = node;
			cursor.remaining -= inspected;
		}
		return inspected;
	}
	private matchingStringValueSlot(key: StringId, keySlot: number, hash: number, words: number, tags: number): number {
		const memory = this.heap.memory;
		return memory.readRamRecordByte(tags + keySlot) === ValueTag.String
			&& memory.readRamRecordWord(words + keySlot * 4) === key ? keySlot + hash : -1;
	}
	public loadPredictedStringKey(record: number, key: StringId, predicted: number, target: ValueWriteTarget, destination: number): boolean {
		const hash = this.hashSize(record);
		if (hash > TABLE_STRING_HIT_BASE_NODES) predicted = hashCanonicalTableKey(valueString(key)) & (hash - 1);
		if (predicted < 0 || predicted >= hash) return false;
		const words = this.hashAddress(record);
		const tags = words + 8 * hash;
		const keySlot = predicted;
		const slot = this.matchingStringValueSlot(key, keySlot, hash, words, tags);
		if (slot < 0) return false;
		const memory = this.heap.memory, tag = memory.readRamRecordByte(tags + slot);
		if (tag === ValueTag.Nil) return false;
		target.setEncoded(destination, tag, memory.readRamRecordWord(words + slot * 4));
		return true;
	}

	public getStringKeyCached(record: number, key: StringId, predicted: number, result: TableLookupSlot): number {
		const hash = this.hashSize(record);
		if (hash !== 0) {
			const words = this.hashAddress(record);
			const tags = words + 8 * hash, memory = this.heap.memory;
			if (hash <= TABLE_STRING_HIT_BASE_NODES && predicted >= 0 && predicted < hash) {
				const slot = this.matchingStringValueSlot(key, predicted, hash, words, tags);
				if (slot >= 0) {
					const tag = memory.readRamRecordByte(tags + slot);
					if (tag !== ValueTag.Nil) {
						result.value = valueFromTag(tag, memory.readRamRecordWord(words + slot * 4)); result.slot = predicted; return 0;
					}
				}
			}
			const home = hashCanonicalTableKey(valueString(key)) & (hash - 1);
			const inspected = this.scanStringNodes(key, home, hash, words, tags, hash, result);
			if (result.slot < 0) return Math.max(0, inspected - 1);
			if (isNil(result.value)) { result.slot = -1; result.value = valueNil(); }
			return Math.max(0, inspected - TABLE_STRING_HIT_BASE_NODES);
		}
		result.value = valueNil(); result.slot = -1; return 0;
	}
	public resolveIndex(record: number, indexKey: StringId, rawKey: Value, result: TableLookupResult,
		visitLimit = TABLE_INDEX_CHAIN_LIMIT): number {
		if (valueTag(rawKey) === ValueTag.String) return this.resolveStringIndexCached(record, indexKey, valuePayload(rawKey), -1, result, visitLimit);
		const validKey = !isNil(rawKey) && !valueIsNaN(rawKey);
		const key = canonicalTableKey(rawKey);
		const arrayIndex = this.getArrayIndex(key);
		result.value = validKey ? this.getCanonical(record, key, arrayIndex) : valueNil();
		result.slot = -1;
		if (!isNil(result.value)) {
			result.extraVisits = 0; result.status = TableLookupStatus.Resolved; return 0;
		}
		return this.resolveIndexMiss(record, indexKey, key, validKey, arrayIndex, result, visitLimit, 0);
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
	public resolveStringIndexCached(record: number, indexKey: StringId, key: StringId, predicted: number, result: TableLookupResult, visitLimit = TABLE_INDEX_CHAIN_LIMIT): number {
		const links = this.getStringKeyCached(record, key, predicted, result);
		if (result.slot >= 0) {
			result.extraVisits = 0; result.status = TableLookupStatus.Resolved; return links;
		}
		return this.resolveIndexMiss(record, indexKey, valueString(key), true, -1, result, visitLimit, links);
	}
	private resolveIndexMiss(current: number, indexKey: StringId, key: Value, validKey: boolean, arrayIndex: number,
		result: TableLookupResult, visitLimit: number, links: number): number {
		const stringKey = valueTag(key) === ValueTag.String;
		let depth = 0, anchor = 0, anchorDepth = 0, anchorLinks = 0;
		for (;;) {
			const meta = this.metatableAddress(current);
			if (meta === 0) {
				if (depth !== 0) result.value = valueNil();
				result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return links;
			}
			links += this.getStringKeyCached(meta, indexKey, -1, result);
			const next = result.value;
			result.slot = -1;
			const tag = valueTag(next);
			if (tag !== ValueTag.Table) {
				result.extraVisits = depth;
				if (tag === ValueTag.Closure || tag === ValueTag.BuiltinFunction) {
					result.receiver = current; result.status = TableLookupStatus.Invoke;
				} else result.status = tag === ValueTag.Nil ? TableLookupStatus.Resolved : TableLookupStatus.Forward;
				return links;
			}
			current = valuePayload(next);
			++depth;
			// An inherited visit never uses the original receiver's slot hint.
			// A complete repeated period has the same key, edges and probe cost.
			if (anchorDepth !== 0 && current === anchor) {
				const period = depth - anchorDepth;
				const repeats = ((visitLimit - depth) / period) >>> 0;
				links += repeats * (links - anchorLinks);
				depth += repeats * period;
			} else if ((depth & (depth - 1)) === 0) {
				anchor = current; anchorDepth = depth; anchorLinks = links;
			}
			if (depth === visitLimit) {
				result.extraVisits = visitLimit - 1; result.status = TableLookupStatus.ChainExhausted; return links;
			}
			if (stringKey) {
				links += this.getStringKeyCached(current, valuePayload(key), -1, result);
			} else {
				result.value = validKey ? this.getCanonical(current, key, arrayIndex) : valueNil();
			}
			if (!isNil(result.value)) {
				result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return links;
			}
		}
	}
	public resolveAssignment(record: number, rawKey: Value, result: TableLookupResult,
		fixedString = false): void {
		const validKey = fixedString || (!isNil(rawKey) && !valueIsNaN(rawKey));
		const key = fixedString ? rawKey : canonicalTableKey(rawKey);
		const arrayIndex = fixedString ? -1 : this.getArrayIndex(key);
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			const meta = this.newIndexMetatable(record);
			let slot = meta === 0 ? TABLE_HASH_UNPROBED : -1;
			let next = valueNil();
			if (meta !== 0) {
				if (fixedString) {
					const hash = this.hashSize(record);
					let own = false;
					if (hash !== 0) {
						const words = this.hashAddress(record);
						const tags = words + 8 * hash;
						slot = this.findStringNodeIndex(valuePayload(key), hashCanonicalTableKey(key) & (hash - 1), hash, words, tags);
						own = slot >= 0 && this.heap.memory.readRamRecordByte(tags + hash + slot) !== ValueTag.Nil;
					}
					if (!own) next = this.getStringKey(meta, valuePayload(this.newIndexKey));
				} else if (!validKey || isNil(this.getCanonical(record, key, arrayIndex))) {
					next = this.getStringKey(meta, valuePayload(this.newIndexKey));
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
	public set(record: number, key: Value, value: Value, budget?: CPU,
		kind = HeapServiceBiosCallKind.Discard, target = 0, resultWord = 0): number {
		return this.setOwn(record, key, value, TABLE_HASH_UNPROBED, HashStore.General, 0, budget, HeapServiceTableGrowthStage.Idle, kind, target, resultWord);
	}
	public assignScheduled(record: number, key: Value, value: Value, budget: CPU, slot = TABLE_HASH_UNPROBED, extraHashSlots = 0): number {
		return this.setOwn(record, key, value, slot, HashStore.Scheduled, extraHashSlots, budget);
	}
	public resumeAssignment(record: number, key: Value, value: Value, extraHashSlots: number, budget?: CPU,
		growthStage = HeapServiceTableGrowthStage.Idle): boolean {
		return this.setOwn(record, key, value, TABLE_HASH_UNPROBED, HashStore.Resume, extraHashSlots, budget, growthStage) !== HASH_STORE_DECLINED;
	}
	private setOwn(record: number, rawKey: Value, value: Value, resolved: number, policy: HashStore, extraHashSlots = 0, budget?: CPU,
		growthStage = policy === HashStore.Scheduled ? HeapServiceTableGrowthStage.Scheduled : HeapServiceTableGrowthStage.Idle,
		kind = HeapServiceBiosCallKind.Discard, target = 0, resultWord = 0): number {
		if (isNil(rawKey)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		if (valueIsNaN(rawKey)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NAN);
		const key = canonicalTableKey(rawKey);
		const tag = valueTag(value);
		const slot = this.getArrayIndex(key), array = this.arrayCapacity(record);
		if (slot >= 0 && slot < array) {
			const word = valuePayload(value);
			this.heap.writeTableAssignment(record, tag, word);
			const words = this.arrayAddress(record);
			this.writeSlot(words, words + array * 4, slot, tag, word); this.updateLengthHint(record, slot, tag !== ValueTag.Nil); return -1;
		}
		const node = this.setHash(record, key, value, resolved, policy, extraHashSlots, budget, growthStage, kind, target, resultWord);
		if (node !== HASH_STORE_DECLINED && node !== HASH_STORE_PENDING && slot >= 0) this.updateLengthHint(record, slot, tag !== ValueTag.Nil);
		return node;
	}
	private setHash(record: number, key: Value, value: Value, resolved = TABLE_HASH_UNPROBED,
		policy = HashStore.General, extraHashSlots = 0, budget?: CPU, growthStage = HeapServiceTableGrowthStage.Idle,
		kind = HeapServiceBiosCallKind.Discard, target = 0, resultWord = 0): number {
		const tag = valueTag(value), word = valuePayload(value);
		if (tag === ValueTag.Nil) { this.removeFromHash(record, key, resolved); return -1; }
		const keyTag = valueTag(key), keyWord = valuePayload(key);
		const hash = this.hashSize(record), words = this.hashAddress(record), tags = words + 8 * hash;
		const home = hashCanonicalTableKey(key) & (hash - 1);
		const memory = this.heap.memory;
		let index = resolved;
		if (index === TABLE_HASH_UNPROBED) {
			index = hash === 0 ? -1 : keyTag === ValueTag.String
				? this.findStringNodeIndex(keyWord, home, hash, words, tags)
				: this.probeHash(key, home, hash, words, tags, true);
		}
		if (index >= 0) {
			const valueSlot = index + hash, prior = memory.readRamRecordByte(tags + valueSlot);
			if (prior !== ValueTag.Nil && prior !== ValueTag.DeadKey) {
				this.heap.writeTableAssignment(record, tag, word);
				this.writeSlot(words, tags, valueSlot, tag, word);
				return index;
			}
		}
		if (hash !== 0) {
			if (index >= 0) {
				this.writeSlot(words, tags, index, keyTag, keyWord);
				this.writeSlot(words, tags, index + hash, tag, word);
			} else index = this.insertHashWithoutGrowth(record, home, key, value, hash, words, tags, false);
			if (index >= 0) {
				this.adjustHashLive(words, hash, 1);
				this.adjustIntegerBand(words, hash, keyTag, keyWord, 1);
				this.publishHashInsertion(record, key, tag, word);
				return index;
			}
		}
		index = this.insertHashWithAdmission(record, key, value, policy, extraHashSlots, budget, undefined,
			LuaAllocationRecovery.CurrentOrFresh, growthStage, kind, target, resultWord);
		if (index === HASH_STORE_DECLINED || index === HASH_STORE_PENDING) return index;
		// resize() invalidates an outstanding scan; relocated old edges keep their marks.
		this.publishHashInsertion(record, key, tag, word);
		return index;
	}
	private publishHashInsertion(record: number, key: Value, tag: ValueTag, word: number): void {
		if (key === this.newIndexKey) this.heap.memory.writeRamRecordByte(record + TableHeader.NewIndexAbsent, 0);
		this.heap.writeTableAssignment(record, tag, word, key);
	}
	public store(record: number, keyTag: ValueTag, keyWord: number, tag: ValueTag, word: number): void {
		this.set(record, valueFromTag(keyTag, keyWord), valueFromTag(tag, word));
	}
	public setStringKey(record: number, key: StringId, value: Value): void { this.setHash(record, valueString(key), value); }
	public storeStringKey(record: number, key: StringId, tag: ValueTag, word: number,
		resolved = TABLE_HASH_UNPROBED, extraHashSlots = 0, budget?: CPU): number {
		return this.setHash(record, valueString(key), valueFromTag(tag, word), resolved, HashStore.General, extraHashSlots, budget);
	}
	public storePredictedStringKey(record: number, key: StringId, predicted: number, tag: ValueTag, word: number): boolean {
		if (tag === ValueTag.Nil || predicted < 0) return false;
		const hash = this.hashSize(record);
		if (predicted >= hash) return false;
		const memory = this.heap.memory, words = this.hashAddress(record);
		const tags = words + 8 * hash, keySlot = predicted, valueSlot = keySlot + hash;
		if (memory.readRamRecordByte(tags + keySlot) !== ValueTag.String || memory.readRamRecordWord(words + keySlot * 4) !== key
			|| memory.readRamRecordByte(tags + valueSlot) === ValueTag.Nil) return false;
		this.heap.writeTableAssignment(record, tag, word);
		this.writeSlot(words, tags, valueSlot, tag, word); return true;
	}
	private findFreeIndex(record: number, hash: number, tags: number): number {
		const memory = this.heap.memory;
		for (let index = this.hashFree(record); index >= 0; --index) {
			const keyTag = tags + index;
			if (memory.readRamRecordByte(keyTag) === ValueTag.Nil && memory.readRamRecordByte(keyTag + hash) === ValueTag.Nil) return index;
		}
		return -1;
	}
	private insertHashWithoutGrowth(record: number, main: number, key: Value, value: Value, hash: number, words: number, tags: number,
		rebuilding: boolean): number {
		const memory = this.heap.memory, links = tags + hash * 2;
		const keySlot = main, valueSlot = keySlot + hash;
		const keyTag = memory.readRamRecordByte(tags + keySlot);
		const tag = valueTag(key), word = valuePayload(key), nextTag = valueTag(value), nextWord = valuePayload(value);
		if (keyTag === ValueTag.Nil || memory.readRamRecordByte(tags + valueSlot) === ValueTag.Nil) {
			this.writeSlot(words, tags, keySlot, tag, word); this.writeSlot(words, tags, valueSlot, nextTag, nextWord); return main;
		}
		const mainWord = memory.readRamRecordWord(words + keySlot * 4);
		if (!rebuilding && hash > TableRecords.HASH_CENSUS_LIMIT && memory.readRamRecordWord(words + TableRecords.hashNodeBytes(hash)) === hash) return -1;
		const free = this.findFreeIndex(record, hash, tags);
		if (free < 0) return -1;
		this.writeHeader(record, TableHeader.Free, free - 1);
		const freeKey = free, freeValue = freeKey + hash;
		const occupiedMain = hashCanonicalTableKey(valueFromTag(keyTag, mainWord)) & (hash - 1);
		if (occupiedMain !== main) {
			if (!rebuilding) this.heap.tableEntriesMoved(record);
			this.writeSlot(words, tags, freeKey, keyTag, mainWord);
			this.writeSlot(words, tags, freeValue, memory.readRamRecordByte(tags + valueSlot), memory.readRamRecordWord(words + valueSlot * 4));
			this.setHashNext(links, hash, free, this.hashNext(links, hash, main));
			let previous = occupiedMain;
			for (let remaining = hash; remaining !== 0; --remaining) {
				const next = this.hashNext(links, hash, previous);
				if (next === main || next < 0) break;
				previous = next;
			}
			this.setHashNext(links, hash, previous, free);
			this.writeSlot(words, tags, keySlot, tag, word); this.writeSlot(words, tags, valueSlot, nextTag, nextWord);
			this.setHashNext(links, hash, main, TABLE_HASH_NEXT_END); return main;
		}
		this.writeSlot(words, tags, freeKey, tag, word); this.writeSlot(words, tags, freeValue, nextTag, nextWord);
		this.setHashNext(links, hash, free, this.hashNext(links, hash, main));
		this.setHashNext(links, hash, main, free); return free;
	}
	// The resize supplies the destination layout and already cleared its scan cursor.
	private reinsertMapping(record: number, key: Value, value: Value, array: number, hash: number, words: number, tags: number): number {
		if (valueTag(key) === ValueTag.Integer) {
			const slot = asInteger(key) - 1;
			if (slot >= 0 && slot < array) {
				const base = this.arrayAddress(record);
				this.writeSlot(base, base + array * 4, slot, valueTag(value), valuePayload(value));
				return -1;
			}
			this.adjustIntegerBand(words, hash, ValueTag.Integer, valuePayload(key), 1);
		}
		const home = hashCanonicalTableKey(key) & (hash - 1);
		return this.insertHashWithoutGrowth(record, home, key, value, hash, words, tags, true);
	}
	private markHashNodeDead(record: number, index: number): void {
		const words = this.hashAddress(record), hash = this.hashSize(record);
		this.adjustHashLive(words, hash, -1);
		const keySlot = index, valueSlot = this.hashValueSlot(record, index), tag = this.tagAt(record, keySlot);
		if (hash >= TableRecords.HASH_BAND_CAPACITY && tag === ValueTag.Integer)
			this.adjustIntegerBand(words, hash, tag, this.heap.memory.readRamRecordWord(words + 4 * keySlot), -1);
		if (tag === ValueTag.Table || tag === ValueTag.Thread || tag === ValueTag.Closure) {
			const hashId = this.wordAt(record, keySlot);
			this.setEncoded(record, keySlot, ValueTag.Nil, tag); this.setEncoded(record, valueSlot, ValueTag.DeadKey, hashId);
		} else {
			this.setEncoded(record, valueSlot, ValueTag.Nil, 0);
			if (tag === ValueTag.String && this.wordAt(record, keySlot) === valuePayload(this.newIndexKey))
				this.heap.memory.writeRamRecordByte(record + TableHeader.NewIndexAbsent, 1);
		}
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
	private countArrayRange(record: number, capacity: number, d: ArrayDensity, end: number): void {
		const tags = (this.arrayAddress(record) & RAM_RECORD_WORD_MASK) + 4 * capacity, ram = this.heap.memory.ramData();
		while (d.scanned < end) {
			const power = 2 ** (32 - Math.clz32(d.scanned)), stop = Math.min(end, power);
			let n = 0;
			for (let i = d.scanned; i < stop; ++i) n += +(ram[tags + i] !== ValueTag.Nil);
			d.live += n; d.scanned = stop;
			if (stop === power && d.live > power / 2) { d.slots = power; d.kept = d.live; }
		}
	}
	private spendCensusGrant(record: number, capacity: number, d: ArrayDensity, cpu: CPU): void {
		const paidStart = Math.max(d.scanned, 64), n = Math.min(capacity - paidStart, 4 * Math.max(0, cpu.instructionBudgetRemaining));
		this.countArrayRange(record, capacity, d, paidStart + n);
		cpu.instructionBudgetRemaining -= (n + 3) >>> 2;
	}
	private planRehash(record: number, key: Value, extraHashSlots: number, counted?: ArrayDensity): void {
		const plan = this.resizePlan;
		const added = valueTag(key) === ValueTag.Integer ? asInteger(key) - 1 : -1;
		const memory = this.heap.memory, oldArray = this.arrayCapacity(record), oldHash = this.hashSize(record);
		const words = this.hashAddress(record), tags = words + 8 * oldHash;
		// A hash-only addition never repartitions the reserved array.
		if (added < 0) {
			let live = 1 + extraHashSlots;
			if (oldHash > TableRecords.HASH_CENSUS_LIMIT) live += memory.readRamRecordWord(words + TableRecords.hashNodeBytes(oldHash));
			else for (let slot = 0; slot < oldHash; ++slot) {
				if (memory.readRamRecordByte(tags + slot) !== ValueTag.Nil
					&& memory.readRamRecordByte(tags + slot + oldHash) !== ValueTag.Nil) ++live;
			}
			plan.keepHash = false;
			plan.array = oldArray;
			plan.hash = nextPowerOfTwo(live);
			return;
		}
		if (oldArray === 0 && oldHash === 0) {
			// Only index 1 is dense enough by itself to select an array.
			plan.keepHash = added === 0;
			plan.array = added === 0 ? 1 : 0;
			plan.hash = added === 0 ? 0 : 1;
			return;
		}
		const counts = TableRecords.rehashIntegerCounts;
		if (!counted) {
			counted = this.directDensity;
			counted.scanned = counted.live = counted.slots = counted.kept = 0;
			this.countArrayRange(record, oldArray, counted, oldArray);
		}
		let bins = 0, totalKeys = counted.live, firstHashArrayKey = TABLE_MAX_ARRAY_INDEX + 1;
		if (oldHash >= TableRecords.HASH_BAND_CAPACITY) {
			const census = words + TableRecords.hashNodeBytes(oldHash);
			totalKeys += memory.readRamRecordWord(census);
			for (let bin = 0; bin < counts.length; ++bin) {
				const n = memory.readRamRecordWord(census + 4 * (bin + 1));
				if (!n) continue;
				while (bins <= bin) counts[bins++] = 0;
				counts[bin] += n;
				firstHashArrayKey = Math.min(firstHashArrayKey, bin ? 1 + (1 << (bin - 1)) : 1);
			}
		} else for (let index = 0; index < oldHash; ++index) {
			const slot = index, keyTag = memory.readRamRecordByte(tags + slot);
			if (keyTag === ValueTag.Nil || memory.readRamRecordByte(tags + slot + oldHash) === ValueTag.Nil) continue;
			++totalKeys;
			if (keyTag !== ValueTag.Integer) continue;
			const integer = memory.readRamRecordWord(words + slot * 4) | 0;
			if (integer > 0) {
				firstHashArrayKey = Math.min(firstHashArrayKey, integer);
				bins = TableRecords.countIntegerKey(counts, bins, integer);
			}
		}
		++totalKeys;
		bins = TableRecords.countIntegerKey(counts, bins, added + 1);
		let arraySize = counted.slots, arrayKeys = counted.kept, total = counted.live;
		const firstBin = 32 - Math.clz32(oldArray);
		let power = 2 ** firstBin;
		for (let bin = firstBin; bin < bins; ++bin) {
			total += counts[bin];
			if (total > power / 2) { arraySize = power; arrayKeys = total; }
			power *= 2;
		}
		const hashKeys = totalKeys - arrayKeys;
		plan.array = arraySize;
		plan.hash = TableRecords.hashCapacity(hashKeys);
		plan.keepHash = arraySize > oldArray && added < arraySize && plan.hash === oldHash && firstHashArrayKey > arraySize;
	}
	private insertHashWithAdmission(record: number, key: Value, value: Value, policy: HashStore, extraHashSlots: number, cycleBudget?: CPU,
		counted?: ArrayDensity, recovery = LuaAllocationRecovery.CurrentOrFresh, growthStage = HeapServiceTableGrowthStage.Idle,
		kind = HeapServiceBiosCallKind.Discard, target = 0, resultWord = 0): number {
		if (policy !== HashStore.Resume && !counted && cycleBudget?.beginTableGrowth(record, key, value, extraHashSlots,
			policy === HashStore.Scheduled ? HeapServiceTableGrowthMode.Scheduled : HeapServiceTableGrowthMode.General, kind, target, resultWord))
			return HASH_STORE_PENDING;
		const budget = this.heap.budget, owner = valueTable(record), plan = this.resizePlan;
		const array = this.arrayCapacity(record), hash = this.hashSize(record);
		const previous = TableRecords.allocationCharge(array, hash);
		const arrayCycles = array > 64 && valueTag(key) === ValueTag.Integer && asInteger(key) > 0
			? (array - 64 + 3) >>> 2 : 0;
		const hashCycles = hash > 64 && hash < TableRecords.HASH_BAND_CAPACITY && valueTag(key) === ValueTag.Integer && asInteger(key) > 0
			? (hash - 64) >>> 1 : 0;
		for (;;) {
			if (cycleBudget && !counted && array >= 1024 && arrayCycles &&
				(policy === HashStore.Resume || arrayCycles > cycleBudget.instructionBudgetRemaining)) {
				const j = cycleBudget.tableRebuild;
				j.record = record; j.key = key; j.value = value; j.instructionPc = cycleBudget.readCurrentInstructionPc();
				j.census = policy === HashStore.General ? TableCensus.General : policy === HashStore.Scheduled ? TableCensus.Scheduled
					: growthStage === HeapServiceTableGrowthStage.RetryFresh ? TableCensus.RetryFresh : TableCensus.RetryCurrent;
				j.recovery = recovery; j.scanned = j.live = j.slots = j.kept = 0;
				j.source = j.count = j.storage = j.capacity = j.arrayStorage = j.arraySlots = j.arrayCleared = 0;
				j.cleared = j.homes = j.cursor = j.free = j.collisions = j.destination = j.wanted = 0; j.result = TableStoreReturn.None;
				if (policy !== HashStore.Resume) this.spendCensusGrant(record, array, j, cycleBudget);
				return HASH_STORE_PENDING;
			}
			if (cycleBudget) cycleBudget.instructionBudgetRemaining -= (counted ? 0 : arrayCycles) + hashCycles;
			this.planRehash(record, key, extraHashSlots, counted);
			counted = undefined;
			const requested = TableRecords.allocationCharge(plan.array, plan.hash);
			const admitted = requested <= previous || (policy === HashStore.Resume || recovery !== LuaAllocationRecovery.CurrentOrFresh
				? budget.usedBytes() + requested - previous <= budget.capacity()
				: budget.prepareAllocation(requested - previous, owner, key, value));
			if (admitted) {
				const bytes = TableRecords.storageBytes(plan.array > array ? plan.array : 0, plan.keepHash ? 0 : plan.hash);
				if (policy !== HashStore.Resume && gcPacedPhase(this.heap.phase())) {
					this.heap.assistBeforeReservation(bytes, owner, key, value);
				}
				const slot = this.resize(record, key, value, previous, requested, cycleBudget);
				if (slot !== HASH_STORE_DECLINED) return slot;
			}
			if (extraHashSlots) {
				extraHashSlots = 0;
				continue;
			}
			if (policy !== HashStore.General) return HASH_STORE_DECLINED;
			recovery = this.heap.recoverAllocation(recovery, owner, key, value);
			// Weak clearing can make the existing reservation fit.
			if (hash !== 0) {
				const words = this.hashAddress(record), tags = words + 8 * hash;
				const home = hashCanonicalTableKey(key) & (hash - 1);
				const slot = this.insertHashWithoutGrowth(record, home, key, value, hash, words, tags, false);
				if (slot >= 0) { this.adjustHashLive(words, hash, 1); this.adjustIntegerBand(words, hash, valueTag(key), valuePayload(key), 1); return slot; }
			}
		}
	}
	public installTableRebuild(j: TableRebuild, record: number, key: Value, value: Value,
		array: number, hash: number, keepHash: boolean, storage: number, base: number): void {
		const oldArray = this.arrayCapacity(record);
		j.census = TableCensus.None; j.recovery = LuaAllocationRecovery.CurrentOrFresh;
		j.scanned = j.live = j.slots = j.kept = 0;
		j.record = record; j.source = keepHash ? 0 : this.hashAddress(record); j.count = keepHash ? 0 : this.hashSize(record);
		j.storage = keepHash ? 0 : storage; j.capacity = keepHash ? 0 : hash;
		j.arraySlots = array !== oldArray ? array : 0; j.arrayStorage = array !== oldArray ? base : 0; j.arrayCleared = 0;
		j.cleared = j.homes = j.cursor = j.collisions = 0; j.free = (j.capacity - 1) >>> 0; j.key = key; j.value = value;
		j.result = TableStoreReturn.None; j.destination = j.wanted = j.instructionPc = 0;
	}
	private resize(record: number, key: Value, value: Value, previous: number, requested: number, budget?: CPU): number {
		const { array, hash, keepHash } = this.resizePlan;
		const oldArray = this.arrayCapacity(record), oldHash = this.hashSize(record);
		const oldWords = this.hashAddress(record), oldTags = oldWords + oldHash * 8;
		const memory = this.heap.memory, arena = this.heap.arena;
		const oldBase = this.arrayAddress(record), stagedGrowth = oldArray >= 1024 && array > oldArray;
		const staged = stagedGrowth || (oldArray >= 1024 && array < oldArray) || (oldHash > 64 && (oldArray === array || !oldArray) && !keepHash);
		const storage = keepHash ? oldWords : hash ? arena.allocate(TableRecords.hashStorageBytes(hash), true) : 0;
		if (hash && !storage) return HASH_STORE_DECLINED;
		let base = oldBase;
		if (array > oldArray) {
			base = !oldBase ? arena.allocate(array * 5, true) : budget && stagedGrowth
				? arena.reserveBacking(oldBase, array * 5) : arena.resizeBacking(oldBase, array * 5);
			if (!base) {
				if (storage && !keepHash) arena.free(storage);
				return HASH_STORE_DECLINED;
			}
		}
		if (budget && staged) {
			const j = budget.tableRebuild;
			this.installTableRebuild(j, record, key, value, array, hash, keepHash, storage, base);
			budget.instructionBudgetRemaining = this.advanceRebuild(j, budget.instructionBudgetRemaining);
			return HASH_STORE_PENDING;
		}
		this.heap.tableEntriesMoved(record);
		this.writeHeader(record, TableHeader.Array, array);
		if (!keepHash) this.bindHash(record, hash, storage);
		this.writeHeader(record, TableHeader.ArrayStorage, base);
		if (!keepHash) this.initializeHash(storage, hash);
		if (oldHash > 64 && oldArray === array && !keepHash) {
			const slot = this.rebuildHashOnly(record, oldWords, oldHash, storage, hash, key, value);
			this.heap.budget.replaceRecord(oldWords, previous, requested);
			return slot;
		}
		let live = 0;
		const tags = storage + hash * 8, offset = base & RAM_RECORD_WORD_MASK;
		if (array < oldArray) {
			for (let i = array; i < oldArray; ++i) {
				const tag = memory.readRamRecordByte(base + oldArray * 4 + i);
				if (tag !== ValueTag.Nil) live += this.reinsertMapping(record, valueInteger(i + 1),
					valueFromTag(tag, memory.readRamRecordWord(base + 4 * i)), array, hash, storage, tags) >= 0 ? 1 : 0;
			}
		}
		if (array !== oldArray) {
			const keep = Math.min(array, oldArray);
			memory.ramData().copyWithin(offset + array * 4, offset + oldArray * 4, offset + oldArray * 4 + keep);
			if (array) {
				this.initializeArray(base, array, keep);
				if (array < oldArray) arena.resizeBacking(base, array * 5);
			} else {
				arena.free(base);
				this.writeHeader(record, TableHeader.ArrayStorage, 0);
			}
		}
		for (let i = 0, n = keepHash ? 0 : oldHash; i < n; ++i) {
			const kt = memory.readRamRecordByte(oldTags + i), vt = memory.readRamRecordByte(oldTags + i + oldHash);
			if (kt !== ValueTag.Nil && vt !== ValueTag.Nil) live += this.reinsertMapping(record,
				valueFromTag(kt, memory.readRamRecordWord(oldWords + i * 4)),
				valueFromTag(vt, memory.readRamRecordWord(oldWords + (i + oldHash) * 4)), array, hash, storage, tags) >= 0 ? 1 : 0;
		}
		const slot = this.reinsertMapping(record, key, value, array, hash, storage, tags);
		if (!keepHash && hash > TableRecords.HASH_CENSUS_LIMIT) memory.writeRamRecordWord(storage + TableRecords.hashNodeBytes(hash), live + (slot >= 0 ? 1 : 0));
		this.heap.budget.replaceRecord(keepHash ? 0 : oldWords, previous, requested);
		return slot;
	}
	public advanceCensus(cpu: CPU): boolean {
		const j = cpu.tableRebuild, record = j.record, capacity = this.arrayCapacity(record);
		this.spendCensusGrant(record, capacity, j, cpu);
		if (j.scanned !== capacity) return true;
		const policy = j.census === TableCensus.General ? HashStore.General : j.census === TableCensus.Scheduled ? HashStore.Scheduled : HashStore.Resume;
		const growthStage = j.census === TableCensus.Scheduled ? HeapServiceTableGrowthStage.Scheduled
			: j.census === TableCensus.RetryCurrent ? HeapServiceTableGrowthStage.RetryCurrent
			: j.census === TableCensus.RetryFresh ? HeapServiceTableGrowthStage.RetryFresh : HeapServiceTableGrowthStage.Idle;
		const { key, value, result, instructionPc, destination, wanted } = j;
		j.record = 0; j.census = TableCensus.None;
		const slot = this.insertHashWithAdmission(record, key, value, policy, 0, cpu, j, j.recovery, growthStage);
		if (slot === HASH_STORE_DECLINED) return false;
		j.result = result; j.instructionPc = instructionPc; j.destination = destination; j.wanted = wanted;
		if (slot !== HASH_STORE_PENDING) {
			this.heap.writeTableAssignment(record, valueTag(value), valuePayload(value), key);
			this.updateLengthHint(record, this.getArrayIndex(key), true);
		}
		return true;
	}
	private emptyTailSlots(tagOffset: number, remaining: number, cycles: number): number {
		const ram = this.heap.memory.ramData(), limit = Math.min(remaining, cycles * 4);
		let n = 0;
		while (n < limit && !ram[tagOffset + n]) ++n;
		return n;
	}
	public advanceRebuild(j: TableRebuild, cycles: number): number {
		if (cycles <= 0) return cycles;
		const memory = this.heap.memory;
		const tags = j.storage + 8 * j.capacity, oldTags = j.source + 8 * j.count;
		const mask = j.capacity - 1, bytes = TableRecords.hashNodeBytes(j.capacity);
		const oldArray = this.arrayCapacity(j.record), array = j.arrayStorage ? j.arraySlots : oldArray;
		const oldBase = this.arrayAddress(j.record), base = j.arrayStorage || oldBase, trigger = this.getArrayIndex(j.key) >>> 0;
		const inPlace = j.arrayStorage !== 0 && j.arrayStorage === oldBase;
		const shrinking = array < oldArray, sources = j.count + (shrinking ? oldArray - array : 0);
		const transfer = shrinking ? 0 : 5 * j.arraySlots - (inPlace ? 4 * oldArray : 0);
		if (j.arrayCleared < transfer) {
			const n = Math.min(transfer - j.arrayCleared, 16 * cycles);
			const start = (j.arrayStorage & RAM_RECORD_WORD_MASK) + j.arrayCleared;
			const ram = memory.ramData(), target = base & RAM_RECORD_WORD_MASK, end = j.arrayCleared + n;
			if (inPlace) {
				// The tag planes can overlap. Move from the high end first, then clear the two extensions.
				const payloadEnd = transfer - (array - oldArray);
				for (let at = j.arrayCleared; at < end;) {
					const next = Math.min(end, at < oldArray ? oldArray : at < payloadEnd ? payloadEnd : transfer);
					const dest = target + (at < oldArray ? 4 * array + oldArray - next :
						at < payloadEnd ? 4 * oldArray + at - oldArray : 4 * array + oldArray + at - payloadEnd);
					if (at < oldArray) {
						const source = target + 5 * oldArray - next;
						ram.copyWithin(dest, source, source + next - at);
					} else ram.fill(0, dest, dest + next - at);
					memory.invalidateRamWrite(dest, next - at);
					at = next;
				}
			} else if (!oldArray) ram.fill(0, start, start + n);
			else {
				const source = this.arrayAddress(j.record) & RAM_RECORD_WORD_MASK;
				for (let at = j.arrayCleared; at < end;) {
					const next = Math.min(end, at < oldArray * 4 ? oldArray * 4 : at < array * 4 ? array * 4
						: at < array * 4 + oldArray ? array * 4 + oldArray : 5 * array);
					if (at < oldArray * 4) ram.copyWithin(target + at, source + at, source + next);
					else if (at >= array * 4 && at < array * 4 + oldArray) {
						const tag = source + oldArray * 4 + (at - array * 4);
						ram.copyWithin(target + at, tag, tag + next - at);
					} else ram.fill(0, target + at, target + next);
					at = next;
				}
			}
			if (!inPlace) memory.invalidateRamWrite(start, n);
			j.arrayCleared += n;
			cycles -= (n + 15) >>> 4;
			if (j.arrayCleared < transfer || (cycles === 0 && j.cleared < bytes)) return cycles;
		}
		if (j.cleared < bytes) {
			const n = Math.min(bytes - j.cleared, 16 * cycles);
			const end = j.cleared + n, split = Math.max(j.cleared, Math.min(end, 10 * j.capacity));
			const ram = memory.ramData(), base = j.storage & RAM_RECORD_WORD_MASK;
			ram.fill(0, base + j.cleared, base + split);
			ram.fill(0xff, base + split, base + end);
			memory.invalidateRamWrite(base + j.cleared, n);
			j.cleared = end;
			cycles -= (n + 15) >>> 4;
			if (end < bytes) return cycles;
			if (j.capacity > TableRecords.HASH_CENSUS_LIMIT) {
				const source = j.source + TableRecords.hashNodeBytes(j.count);
				memory.writeRamRecordWord(j.storage + bytes, (j.count > TableRecords.HASH_CENSUS_LIMIT ? memory.readRamRecordWord(source) : 0) + (trigger >= array ? 1 : 0));
				if (j.capacity >= TableRecords.HASH_BAND_CAPACITY) {
					const target = (j.storage + bytes + 4) & RAM_RECORD_WORD_MASK;
					memory.ramData().fill(0, target, target + 32 * 4);
					memory.invalidateRamWrite(target, 32 * 4);
					if (trigger >= array) this.adjustIntegerBand(j.storage, j.capacity, valueTag(j.key), valuePayload(j.key), 1);
				}
			}
			const home = hashCanonicalTableKey(j.key) & mask;
			if (trigger >= array) {
				this.writeSlot(j.storage, tags, home, valueTag(j.key), valuePayload(j.key));
				this.writeSlot(j.storage, tags, j.capacity + home, valueTag(j.value), valuePayload(j.value));
			}
		}
		while (j.homes < sources && cycles > 0) {
			const slot = array + j.homes - j.count;
			if (j.homes >= j.count) {
				const n = this.emptyTailSlots((oldBase & RAM_RECORD_WORD_MASK) + 4 * oldArray + slot, sources - j.homes, cycles);
				if (n) { j.homes += n; cycles -= (n + 3) >>> 2; continue; }
			}
			const i = j.homes++;
			cycles -= 8;
			const tail = i >= j.count;
			const kt = tail ? ValueTag.Integer : memory.readRamRecordByte(oldTags + i);
			const vt = memory.readRamRecordByte(tail ? oldBase + 4 * oldArray + slot : oldTags + j.count + i);
			const valueAddress = tail ? oldBase + 4 * slot : j.source + 4 * (j.count + i);
			if (kt === ValueTag.Nil || vt === ValueTag.Nil) continue;
			const kw = tail ? slot + 1 : memory.readRamRecordWord(j.source + 4 * i), vw = memory.readRamRecordWord(valueAddress);
			const index = (kw - 1) >>> 0;
			if (kt === ValueTag.Integer && index < array) {
				this.writeSlot(base, base + 4 * array, index, vt, vw);
				if (j.count > TableRecords.HASH_CENSUS_LIMIT) this.adjustHashLive(j.storage, j.capacity, -1);
				continue;
			}
			if (tail || j.count <= TableRecords.HASH_CENSUS_LIMIT) this.adjustHashLive(j.storage, j.capacity, 1);
			this.adjustIntegerBand(j.storage, j.capacity, kt, kw, 1);
			const home = hashCanonicalTableKey(valueFromTag(kt, kw)) & mask;
			if (memory.readRamRecordByte(tags + home) === ValueTag.Nil) {
				this.writeSlot(j.storage, tags, home, kt, kw);
				this.writeSlot(j.storage, tags, j.capacity + home, vt, vw);
			} else ++j.collisions;
		}
		if (j.homes < sources) return cycles;
		const links = tags + 2 * j.capacity;
		while (j.collisions && j.cursor < sources && cycles > 0) {
			const slot = array + j.cursor - j.count;
			if (j.cursor >= j.count) {
				const n = this.emptyTailSlots((oldBase & RAM_RECORD_WORD_MASK) + 4 * oldArray + slot, sources - j.cursor, cycles);
				if (n) { j.cursor += n; cycles -= (n + 3) >>> 2; continue; }
			}
			cycles -= 8;
			const i = j.cursor;
			const tail = i >= j.count;
			const kt = tail ? ValueTag.Integer : memory.readRamRecordByte(oldTags + i);
			const vt = memory.readRamRecordByte(tail ? oldBase + 4 * oldArray + slot : oldTags + j.count + i);
			const valueAddress = tail ? oldBase + 4 * slot : j.source + 4 * (j.count + i);
			const kw = tail ? slot + 1 : memory.readRamRecordWord(j.source + 4 * i);
			if (kt !== ValueTag.Nil && vt !== ValueTag.Nil && !(kt === ValueTag.Integer && ((kw - 1) >>> 0) < array)) {
				const home = hashCanonicalTableKey(valueFromTag(kt, kw)) & mask;
				if (memory.readRamRecordByte(tags + home) !== kt || memory.readRamRecordWord(j.storage + 4 * home) !== kw) {
					const free = j.free & mask;
					j.free = (j.free - 1) >>> 0;
					if (memory.readRamRecordByte(tags + free) !== ValueTag.Nil) continue;
					this.writeSlot(j.storage, tags, free, kt, kw);
					this.writeSlot(j.storage, tags, j.capacity + free, vt, memory.readRamRecordWord(valueAddress));
					this.setHashNext(links, j.capacity, free, this.hashNext(links, j.capacity, home));
					this.setHashNext(links, j.capacity, home, free);
					--j.collisions;
				}
			}
			++j.cursor;
		}
		if (j.collisions && j.cursor < sources) return cycles;
		if (shrinking && j.arrayCleared < array) {
			if (cycles <= 0) return cycles;
			const n = Math.min(array - j.arrayCleared, 16 * cycles);
			const dest = (oldBase & RAM_RECORD_WORD_MASK) + 4 * array + j.arrayCleared;
			const from = dest + 4 * (oldArray - array);
			memory.ramData().copyWithin(dest, from, from + n);
			memory.invalidateRamWrite(dest, n);
			j.arrayCleared += n; cycles -= (n + 15) >>> 4;
			if (j.arrayCleared < array) return cycles;
		}
		this.heap.tableEntriesMoved(j.record);
		const oldHash = this.hashSize(j.record);
		if (j.arrayStorage) {
			if (shrinking && array) this.heap.arena.shrinkBacking(oldBase, 5 * array);
			else if (!array || (oldArray && !inPlace)) this.heap.arena.free(oldBase);
			this.writeHeader(j.record, TableHeader.ArrayStorage, array ? base : 0);
			this.writeHeader(j.record, TableHeader.Array, array);
		}
		if (trigger < array) this.writeSlot(base, base + 4 * array, trigger, valueTag(j.value), valuePayload(j.value));
		if (j.source || j.storage) {
			this.bindHash(j.record, j.capacity, j.storage);
			if (j.free !== mask) this.writeHeader(j.record, TableHeader.Free, j.free);
		}
		this.heap.budget.replaceRecord(j.source, TableRecords.allocationCharge(oldArray, oldHash), TableRecords.allocationCharge(array, this.hashSize(j.record)));
		if (j.key === this.newIndexKey) memory.writeRamRecordByte(j.record + TableHeader.NewIndexAbsent, 0);
		this.heap.writeTableAssignment(j.record, valueTag(j.value), valuePayload(j.value), j.key);
		const index = this.getArrayIndex(j.key);
		if (index >= 0) this.updateLengthHint(j.record, index, true);
		j.record = 0;
		return cycles;
	}
	private rebuildHashOnly(record: number, oldWords: number, oldHash: number, storage: number, hash: number,
		key: Value, value: Value): number {
		const memory = this.heap.memory, oldTags = oldWords + 8 * oldHash, tags = storage + 8 * hash;
		const mask = hash - 1, trigger = hashCanonicalTableKey(key) & mask;
		this.writeSlot(storage, tags, trigger, valueTag(key), valuePayload(key));
		this.writeSlot(storage, tags, hash + trigger, valueTag(value), valuePayload(value));
		const oldLinks = oldTags + oldHash * 2, links = tags + hash * 2;
		const array = this.arrayCapacity(record), base = this.arrayAddress(record);
		this.adjustIntegerBand(storage, hash, valueTag(key), valuePayload(key), 1);
		let collisions = 0, nextFree = mask, live = 1;
		// Reserve each home once. Only colliding source slots need a second
		// visit; the retired link lane holds their indices until placement.
		for (let i = 0; i < oldHash; ++i) {
			const kt = memory.readRamRecordByte(oldTags + i), vt = memory.readRamRecordByte(oldTags + oldHash + i);
			if (kt === ValueTag.Nil || vt === ValueTag.Nil) continue;
			const kw = memory.readRamRecordWord(oldWords + 4 * i);
			const index = (kw - 1) >>> 0;
			if (kt === ValueTag.Integer && index < array) {
				this.writeSlot(base, base + array * 4, index, vt, memory.readRamRecordWord(oldWords + 4 * (oldHash + i)));
				continue;
			}
			++live;
			this.adjustIntegerBand(storage, hash, kt, kw, 1);
			const home = hashCanonicalTableKey(valueFromTag(kt, kw)) & mask;
			if (memory.readRamRecordByte(tags + home) === ValueTag.Nil) {
				this.writeSlot(storage, tags, home, kt, kw);
				this.writeSlot(storage, tags, hash + home, vt, memory.readRamRecordWord(oldWords + 4 * (oldHash + i)));
			} else {
				this.setHashNext(oldLinks, oldHash, collisions++, i);
			}
		}
		for (let c = 0; c < collisions; ++c) {
			const i = this.hashNext(oldLinks, oldHash, c);
			const kt = memory.readRamRecordByte(oldTags + i), kw = memory.readRamRecordWord(oldWords + 4 * i);
			const home = hashCanonicalTableKey(valueFromTag(kt, kw)) & mask;
			while (memory.readRamRecordByte(tags + nextFree) !== ValueTag.Nil) --nextFree;
			const dst = nextFree--;
			this.writeSlot(storage, tags, dst, kt, kw);
			this.writeSlot(storage, tags, hash + dst, memory.readRamRecordByte(oldTags + oldHash + i),
				memory.readRamRecordWord(oldWords + 4 * (oldHash + i)));
			this.setHashNext(links, hash, dst, this.hashNext(links, hash, home));
			this.setHashNext(links, hash, home, dst);
		}
		if (nextFree !== mask) this.writeHeader(record, TableHeader.Free, nextFree);
		if (hash > TableRecords.HASH_CENSUS_LIMIT) memory.writeRamRecordWord(storage + TableRecords.hashNodeBytes(hash), live);
		return trigger;
	}
	private updateLengthHint(record: number, slot: number, present: boolean): void {
		const hint = this.lengthHint(record);
		if (present ? slot === hint : slot + 1 === hint) this.writeHeader(record, TableHeader.Length, present ? hint + 1 : hint - 1);
	}
	private hasIntegerKey(record: number, key: number): boolean {
		if (key <= this.arrayCapacity(record)) return !isNil(this.arrayValue(record, key - 1));
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
		this.heap.memory.writeRamRecordByte(record + TableHeader.NewIndexAbsent, 1);
		this.freeStorage(record);
		this.bindHash(record, 0, 0);
		this.writeHeader(record, TableHeader.Array, 0);
		this.writeHeader(record, TableHeader.ArrayStorage, 0);

	}
	public storedSlotCount(record: number): number { return this.arrayCapacity(record) + this.hashSize(record); }
	public loadStoredEntry(record: number, slot: number, target: ValueWriteTarget, destination: number): boolean {
		if (slot < this.arrayCapacity(record)) {
			const element = this.arrayValue(record, slot);
			if (isNil(element)) return false;
			target.setEncoded(destination, ValueTag.Integer, slot + 1);
			target.setEncoded(destination + 1, valueTag(element), valuePayload(element)); return true;
		}
		const index = slot - this.arrayCapacity(record), key = index, value = this.hashValueSlot(record, index);
		if (this.tagAt(record, key) === ValueTag.Nil || this.tagAt(record, value) === ValueTag.Nil) return false;
		target.setEncoded(destination, this.tagAt(record, key), this.wordAt(record, key)); target.setEncoded(destination + 1, this.tagAt(record, value), this.wordAt(record, value)); return true;
	}
	public scanSlots(record: number): number { return this.arrayCapacity(record) + 2 * this.hashSize(record); }
	public forEachStoredEntry(record: number, visitor: StoredEntryVisitor, first = 0, last = 0x7fffffff): void {
		const memory = this.heap.memory;
		const array = this.arrayCapacity(record), hash = this.hashSize(record), words = this.hashAddress(record);
		const tags = words + 8 * hash, end = Math.min(array + hash, last);
		const base = this.arrayAddress(record), arrayTags = base + array * 4;
		const arrayEnd = Math.min(array, last);
		for (let slot = first; slot < arrayEnd; ++slot) {
			const tag = memory.readRamRecordByte(arrayTags + slot);
			if (tag !== ValueTag.Nil) visitor(valueInteger(slot + 1), valueFromTag(tag, memory.readRamRecordWord(base + slot * 4)));
		}
		for (let key = Math.max(first - array, 0); key < end - array; ++key) {
			const value = key + hash;
			const keyTag = memory.readRamRecordByte(tags + key), valueTag = memory.readRamRecordByte(tags + value);
			if (keyTag === ValueTag.Nil || valueTag === ValueTag.Nil) continue;
			visitor(valueFromTag(keyTag, memory.readRamRecordWord(words + key * 4)),
				valueFromTag(valueTag, memory.readRamRecordWord(words + value * 4)));
		}
	}
	public clearWeakEntries(record: number, weakKeys: boolean, weakValues: boolean, isAlive: StoredValuePredicate,
		first = 0, end = this.storedSlotCount(record)): void {
		const memory = this.heap.memory;
		const array = this.arrayCapacity(record), hash = this.hashSize(record);
		const base = this.arrayAddress(record), arrayTags = base + array * 4;
		for (let slot = first; slot < Math.min(array, end); ++slot) {
			const tag = memory.readRamRecordByte(arrayTags + slot);
			if (tag === ValueTag.Nil) continue;
			const word = memory.readRamRecordWord(base + slot * 4);
			if (weakValues && !isAlive(valueFromTag(tag, word))) {
				this.writeSlot(base, arrayTags, slot, ValueTag.Nil, 0);
			} else if (tag === ValueTag.String) this.heap.markString(word);
		}
		const words = this.hashAddress(record), tags = words + 8 * hash;
		for (let key = Math.max(first - array, 0); key < Math.min(hash, end - array); ++key) {
			const value = key + hash;
			const kt = memory.readRamRecordByte(tags + key), vt = memory.readRamRecordByte(tags + value);
			if (kt === ValueTag.Nil || vt === ValueTag.Nil) continue;
			const kw = memory.readRamRecordWord(words + key * 4), vw = memory.readRamRecordWord(words + value * 4);
			if ((weakKeys && !isAlive(valueFromTag(kt, kw))) || (weakValues && !isAlive(valueFromTag(vt, vw)))) {
				this.markHashNodeDead(record, key);
			} else {
				if (kt === ValueTag.String) this.heap.markString(kw);
				if (vt === ValueTag.String) this.heap.markString(vw);
			}
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
			const element = this.arrayValue(record, position), tag = valueTag(element);
			if (tag === ValueTag.Nil) continue;
			target.setInteger(destination, position + 1);
			if (wantsValue) target.setEncoded(destination + 1, tag, valuePayload(element));
			return position + 1;
		}
		const hashSize = this.hashSize(record);
		for (let index = position - arraySize; index < hashSize; ++index) {
			const key = index, value = key + hashSize;
			if (this.tagAt(record, key) === ValueTag.Nil || this.tagAt(record, value) === ValueTag.Nil) continue;
			target.setEncoded(destination, this.tagAt(record, key), this.wordAt(record, key));
			if (wantsValue) target.setEncoded(destination + 1, this.tagAt(record, value), this.wordAt(record, value));
			return arraySize + key + 1;
		}
		target.setNil(destination);
		return 0;
	}
	public getTrackedHeapBytes(record: number): number {
		const storage = this.hashAddress(record), array = this.arrayAddress(record);
		return (array ? this.heap.arena.allocationBytes(array) : 0) + this.heap.arena.allocationBytes(record - GC_OBJECT_PREFIX)
			+ (storage !== 0 ? this.heap.arena.allocationBytes(storage) : 0);
	}
}
