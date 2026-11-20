import { RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { heapAllocationBytes } from './heap_allocator';
import { GC_RECORD_LINK } from './gc_object';
import { ceilLog2, nextPowerOfTwo } from '../common/numeric';
import { LUA_FAULT_REASON_INDEX_NIL, LUA_FAULT_REASON_INVALID_NEXT_KEY } from '../../spec/blua32/cop0';
import { LuaExecutionError } from './errors';
import type { GcHeap } from './gc_heap';
import type { StringId } from './string_pool';
import {
	ValueTag, canonicalTableKey, isNil, valueFromTag, valueInteger,
	valueNil, valuePayload, valueString, valueTable, valueTag, type Value,
} from './value';
import { ValueSlots, type ValueWriteTarget } from './value_slots';

const TABLE_HASH_NEXT_END = -1;
const TABLE_MAX_ARRAY_INDEX = 0x7fffffff;
export const TABLE_INDEX_CHAIN_LIMIT = 32;
export const TABLE_STORE_REQUIRES_GROWTH = -2;
export type TableLengthWork = { probes: number };
export const enum TableLookupStatus { Resolved, ChainExhausted }
export type TableLookupResult = { values: ValueSlots; slot: number; extraVisits: number; status: TableLookupStatus };
type StoredEntryVisitor = (key: Value, value: Value) => void;
type StoredValuePredicate = (value: Value) => boolean;

export const enum TableHeader {
	Kind = 0, Gray = 4, Metatable = 8, Storage = 12, Array = 16, Hash = 20, Length = 24, Free = 28,
}
export class TableRecords {
	private static readonly rehashIntegerCounts = new Uint32Array(32);
	static readonly HEADER_BYTES = 32;
	public constructor(private readonly heap: GcHeap) {}
	public initialize(record: number, array: number, hash: number): void {
		this.writeHeader(record, TableHeader.Kind, ValueTag.Table | (this.heap.white() << 8));
		this.writeHeader(record, TableHeader.Gray, 0);
		this.writeHeader(record, TableHeader.Metatable, 0);
		this.writeHeader(record, TableHeader.Length, 0);
		this.bindStorage(record, array, hash, this.storageAddress(record));
		this.initializeStorage(record);
	}
	public static hashCapacity(size: number): number { return size > 0 ? nextPowerOfTwo(size) : 0; }
	public static storageBytes(array: number, hash: number): number { return (5 * array + 14 * hash) >>> 0; }
	public static trackedHeapBytesForCapacities(array: number, hash: number): number {
		const bytes = TableRecords.storageBytes(array, hash);
		return TableRecords.HEADER_BYTES + (bytes === 0 ? 0 : heapAllocationBytes(bytes));
	}
	private readHeader(record: number, field: TableHeader): number { return this.heap.memory.readRamRecordWord(record + field); }
	private writeHeader(record: number, field: TableHeader, word: number): void { this.heap.memory.writeRamRecordWord(record + field, word); }
	public metatableAddress(record: number): number { return this.readHeader(record, TableHeader.Metatable); }
	public setMetatableAddress(record: number, address: number): void {
		this.writeBarrier(record);
		this.writeHeader(record, TableHeader.Metatable, address);
	}
	private writeBarrier(record: number): void { this.heap.writeBarrier(record, GC_RECORD_LINK); }
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
	private initializeStorage(record: number): void {
		const bytes = TableRecords.storageBytes(this.arrayCapacity(record), this.hashSize(record));
		if (bytes === 0) return;
		const memory = this.heap.memory;
		const words = this.storageAddress(record) & RAM_RECORD_WORD_MASK;
		const links = words + (this.arrayCapacity(record) + 2 * this.hashSize(record)) * 4;
		const tags = links + this.hashSize(record) * 4;
		const ram = memory.ramData();
		ram.fill(0, words, links);
		ram.fill(0xff, links, tags);
		ram.fill(0, tags, words + bytes);
		memory.invalidateRamWrite(words, bytes);
	}
	private freeStorage(record: number): void {
		const storage = this.storageAddress(record);
		if (storage !== 0) this.heap.arena.free(storage);
	}
	public freeRecord(record: number): void {
		this.freeStorage(record);
		this.heap.arena.free(record);
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
	// keys are Integer keys, including -0; every NaN key has one canonical word.
	private getArrayIndex(key: Value): number {
		return valueTag(key) === ValueTag.Integer && (valuePayload(key) | 0) > 0 ? valuePayload(key) - 1 : -1;
	}
	private findNodeIndex(record: number, key: Value, matchDead = false): number {
		const hash = this.hashSize(record);
		if (hash === 0) return -1;
		const memory = this.heap.memory, array = this.arrayCapacity(record), words = this.storageAddress(record);
		const links = words + (array + 2 * hash) * 4, tags = links + hash * 4;
		const tag = valueTag(key), payload = valuePayload(key);
		const collectable = matchDead && (tag === ValueTag.Table || tag === ValueTag.Closure || tag === ValueTag.Thread);
		let index = this.heap.hash(key) & (hash - 1);
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
	private findStringNodeIndex(key: StringId, hash: number, array: number, words: number, tags: number): number {
		const memory = this.heap.memory, links = tags - hash * 4;
		let index = this.heap.hash(valueString(key)) & (hash - 1);
		for (let remaining = hash; index >= 0 && remaining !== 0; --remaining) {
			const slot = array + index;
			if (memory.readRamRecordByte(tags + slot) === ValueTag.String
				&& memory.readRamRecordWord(words + slot * 4) === key) return index;
			index = memory.readRamRecordWord(links + index * 4) | 0;
		}
		return -1;
	}

	public get(record: number, rawKey: Value): Value {
		const key = canonicalTableKey(rawKey);
		if (isNil(key)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		const array = this.getArrayIndex(key);
		if (array >= 0 && array < this.arrayCapacity(record)) return this.valueAt(record, array);
		const index = this.findNodeIndex(record, key);
		return index >= 0 ? this.valueAt(record, this.hashValueSlot(record, index)) : valueNil();
	}
	public load(record: number, keyTag: ValueTag, keyWord: number, target: ValueWriteTarget, destination: number): void {
		const value = this.get(record, valueFromTag(keyTag, keyWord));
		target.setEncoded(destination, valueTag(value), valuePayload(value));
	}
	public getInteger(record: number, index: number): Value {
		const array = (index >>> 0) - 1;
		if (array >= 0 && array < this.arrayCapacity(record)) return this.valueAt(record, array);
		const slot = this.findNodeIndex(record, valueInteger(index));
		return slot >= 0 ? this.valueAt(record, this.hashValueSlot(record, slot)) : valueNil();
	}
	public loadInteger(record: number, index: number, target: ValueWriteTarget, destination: number): void {
		const array = (index >>> 0) - 1;
		if (array >= 0 && array < this.arrayCapacity(record)) {
			target.setEncoded(destination, this.tagAt(record, array), this.wordAt(record, array)); return;
		}
		const value = this.getInteger(record, index);
		target.setEncoded(destination, valueTag(value), valuePayload(value));
	}
	public loadIntegerArrayKey(record: number, index: number, target: ValueWriteTarget, destination: number): boolean {
		const slot = (index >>> 0) - 1;
		if (slot < 0 || slot >= this.arrayCapacity(record) || (this.readHeader(record, TableHeader.Metatable) !== 0 && this.tagAt(record, slot) === ValueTag.Nil)) return false;
		target.setEncoded(destination, this.tagAt(record, slot), this.wordAt(record, slot)); return true;
	}
	public storeIntegerArrayKey(record: number, index: number, tag: ValueTag, word: number): boolean {
		const slot = (index >>> 0) - 1;
		if (slot < 0 || slot >= this.arrayCapacity(record)) return false;
		this.writeBarrier(record); this.setEncoded(record, slot, tag, word); this.updateLengthHint(record, slot, tag !== ValueTag.Nil); return true;
	}
	public setInteger(record: number, index: number, value: Value): void { this.set(record, valueInteger(index), value); }
	public storeInteger(record: number, index: number, tag: ValueTag, word: number): void { this.set(record, valueInteger(index), valueFromTag(tag, word)); }
	public getStringKey(record: number, key: StringId): Value {
		const hash = this.hashSize(record);
		if (hash === 0) return valueNil();
		const array = this.arrayCapacity(record), words = this.storageAddress(record);
		const tags = words + (array + 3 * hash) * 4;
		const index = this.findStringNodeIndex(key, hash, array, words, tags);
		if (index < 0) return valueNil();
		const memory = this.heap.memory, slot = array + hash + index;
		return valueFromTag(memory.readRamRecordByte(tags + slot), memory.readRamRecordWord(words + slot * 4));
	}
	public loadStringKey(record: number, key: StringId, target: ValueWriteTarget, destination: number): void {
		const hash = this.hashSize(record);
		if (hash !== 0) {
			const array = this.arrayCapacity(record), words = this.storageAddress(record);
			const tags = words + (array + 3 * hash) * 4;
			const index = this.findStringNodeIndex(key, hash, array, words, tags);
			if (index >= 0) {
				const memory = this.heap.memory, slot = array + hash + index;
				target.setEncoded(destination, memory.readRamRecordByte(tags + slot), memory.readRamRecordWord(words + slot * 4));
				return;
			}
		}
		target.setNil(destination);
	}
	private readPredictedStringKey(key: StringId, keySlot: number, hash: number, words: number, tags: number,
		target: ValueWriteTarget, destination: number): boolean {
		const memory = this.heap.memory;
		if (memory.readRamRecordByte(tags + keySlot) !== ValueTag.String
			|| memory.readRamRecordWord(words + keySlot * 4) !== key) return false;
		const valueSlot = keySlot + hash, tag = memory.readRamRecordByte(tags + valueSlot);
		if (tag === ValueTag.Nil) return false;
		target.setEncoded(destination, tag, memory.readRamRecordWord(words + valueSlot * 4));
		return true;
	}
	public loadPredictedStringKey(record: number, key: StringId, predicted: number, target: ValueWriteTarget, destination: number): boolean {
		const hash = this.hashSize(record);
		if (predicted < 0 || predicted >= hash) return false;
		const array = this.arrayCapacity(record), words = this.storageAddress(record);
		const tags = words + (array + 3 * hash) * 4;
		return this.readPredictedStringKey(key, array + predicted, hash, words, tags, target, destination);
	}

	public loadStringKeyCached(record: number, key: StringId, predicted: number, target: ValueWriteTarget, destination: number): number {
		const hash = this.hashSize(record);
		if (hash !== 0) {
			const array = this.arrayCapacity(record), words = this.storageAddress(record);
			const tags = words + (array + 3 * hash) * 4;
			if (predicted >= 0 && predicted < hash
				&& this.readPredictedStringKey(key, array + predicted, hash, words, tags, target, destination)) return predicted;
			const index = this.findStringNodeIndex(key, hash, array, words, tags);
			if (index >= 0) {
				const memory = this.heap.memory, slot = array + hash + index;
				const tag = memory.readRamRecordByte(tags + slot);
				if (tag !== ValueTag.Nil) { target.setEncoded(destination, tag, memory.readRamRecordWord(words + slot * 4)); return index; }
			}
		}
		target.setNil(destination); return -1;
	}
	public metatableIndexValue(record: number, indexKey: StringId): Value {
		const address = this.metatableAddress(record);
		return address !== 0 ? this.getStringKey(address, indexKey) : valueNil();
	}
	public resolveIndex(record: number, indexKey: StringId, keyTag: ValueTag, keyWord: number, result: TableLookupResult): void {
		const key = canonicalTableKey(valueFromTag(keyTag, keyWord));
		if (isNil(key)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		const arrayIndex = this.getArrayIndex(key);
		let current = record;
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			let slot = arrayIndex;
			if (slot < 0 || slot >= this.arrayCapacity(current)) {
				const index = this.findNodeIndex(current, key); slot = index >= 0 ? this.hashValueSlot(current, index) : -1;
			}
			if (slot >= 0 && this.tagAt(current, slot) !== ValueTag.Nil) {
				result.values.setEncoded(0, this.tagAt(current, slot), this.wordAt(current, slot));
				result.slot = -1; result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return;
			}
			const next = this.metatableIndexValue(current, indexKey);
			if (valueTag(next) !== ValueTag.Table) {
				result.values.setNil(0); result.slot = -1; result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return;
			}
			current = valuePayload(next);
		}
		result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1; result.status = TableLookupStatus.ChainExhausted;
	}
	public resolveIntegerIndex(record: number, indexKey: StringId, key: number, result: TableLookupResult): void {
		this.resolveIndex(record, indexKey, ValueTag.Integer, key >>> 0, result);
	}
	public resolveStringIndex(record: number, indexKey: StringId, key: StringId, result: TableLookupResult): void {
		this.resolveStringIndexCached(record, indexKey, key, -1, result);
	}
	public resolveStringIndexCached(record: number, indexKey: StringId, key: StringId, predicted: number, result: TableLookupResult): void {
		let current = record;
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			const index = this.loadStringKeyCached(current, key, predicted, result.values, 0);
			if (result.values.getTag(0) !== ValueTag.Nil) {
				result.slot = index; result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return;
			}
			predicted = -1;
			const next = this.metatableIndexValue(current, indexKey);
			if (valueTag(next) !== ValueTag.Table) {
				result.slot = -1; result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return;
			}
			current = valuePayload(next);
		}
		result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1; result.status = TableLookupStatus.ChainExhausted;
	}
	public set(record: number, rawKey: Value, value: Value): void {
		const key = canonicalTableKey(rawKey);
		if (isNil(key)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		this.writeBarrier(record);
		const array = this.getArrayIndex(key);
		if (array >= 0 && array < this.arrayCapacity(record)) {
			this.setValue(record, array, value); this.updateLengthHint(record, array, !isNil(value)); return;
		}
		if (isNil(value)) {
			this.removeFromHash(record, key); if (array >= 0) this.updateLengthHint(record, array, false); return;
		}
		const index = this.findNodeIndex(record, key, true);
		if (index >= 0) {
			const keySlot = this.hashKeySlot(record, index);
			if (this.tagAt(record, keySlot) === ValueTag.Nil) this.setValue(record, keySlot, key);
			this.setValue(record, this.hashValueSlot(record, index), value);
		} else this.rawSet(record, key, value);
		if (array >= 0) this.updateLengthHint(record, array, true);
	}
	public store(record: number, keyTag: ValueTag, keyWord: number, tag: ValueTag, word: number): void {
		this.set(record, valueFromTag(keyTag, keyWord), valueFromTag(tag, word));
	}
	public setStringKey(record: number, key: StringId, value: Value): void { this.storeStringKey(record, key, valueTag(value), valuePayload(value)); }
	public storeStringKey(record: number, key: StringId, tag: ValueTag, word: number): number {
		const index = this.storeStringKeyWithoutGrowth(record, key, tag, word);
		if (index !== TABLE_STORE_REQUIRES_GROWTH) return index;
		const k = valueString(key), value = valueFromTag(tag, word);
		this.rehash(record, k, value); return this.rawSet(record, k, value);
	}
	public storeStringKeyWithoutGrowth(record: number, key: StringId, tag: ValueTag, word: number): number {
		this.writeBarrier(record);
		const k = valueString(key);
		if (tag === ValueTag.Nil) { this.removeFromHash(record, k); return -1; }
		const hash = this.hashSize(record);
		if (hash === 0) return TABLE_STORE_REQUIRES_GROWTH;
		const array = this.arrayCapacity(record), words = this.storageAddress(record);
		const tags = words + (array + 3 * hash) * 4;
		const index = this.findStringNodeIndex(key, hash, array, words, tags);
		if (index >= 0) {
			this.writeSlot(words, tags, array + hash + index, tag, word);
			return index;
		}
		const inserted = this.insertHashWithoutGrowth(record, k, valueFromTag(tag, word), array, hash, words, tags);
		return inserted >= 0 ? inserted : TABLE_STORE_REQUIRES_GROWTH;
	}
	public storePredictedStringKey(record: number, key: StringId, predicted: number, tag: ValueTag, word: number): boolean {
		this.writeBarrier(record);
		if (tag === ValueTag.Nil || predicted < 0) return false;
		const hash = this.hashSize(record);
		if (predicted >= hash) return false;
		const memory = this.heap.memory, array = this.arrayCapacity(record), words = this.storageAddress(record);
		const tags = words + (array + 3 * hash) * 4, keySlot = array + predicted, valueSlot = keySlot + hash;
		if (memory.readRamRecordByte(tags + keySlot) !== ValueTag.String || memory.readRamRecordWord(words + keySlot * 4) !== key
			|| memory.readRamRecordByte(tags + valueSlot) === ValueTag.Nil) return false;
		this.writeSlot(words, tags, valueSlot, tag, word); return true;
	}
	public storeStringKeyCached(record: number, key: StringId, predicted: number, tag: ValueTag, word: number): number {
		return this.storePredictedStringKey(record, key, predicted, tag, word) ? predicted : this.storeStringKey(record, key, tag, word);
	}
	private getFreeIndex(record: number, array: number, hash: number, tags: number): number {
		const memory = this.heap.memory;
		for (let index = this.hashFree(record); index >= 0; --index) {
			const keyTag = tags + array + index;
			if (memory.readRamRecordByte(keyTag) === ValueTag.Nil && memory.readRamRecordByte(keyTag + hash) === ValueTag.Nil) {
				this.writeHeader(record, TableHeader.Free, index - 1); return index;
			}
		}
		this.writeHeader(record, TableHeader.Free, -1); return -1;
	}
	private insertHashWithoutGrowth(record: number, key: Value, value: Value, array: number, hash: number, words: number, tags: number): number {
		const memory = this.heap.memory, links = tags - hash * 4;
		const mask = hash - 1, main = this.heap.hash(key) & mask;
		const keySlot = array + main, valueSlot = keySlot + hash;
		const keyTag = memory.readRamRecordByte(tags + keySlot);
		const tag = valueTag(key), word = valuePayload(key), nextTag = valueTag(value), nextWord = valuePayload(value);
		if (keyTag === ValueTag.Nil || memory.readRamRecordByte(tags + valueSlot) === ValueTag.Nil) {
			this.writeSlot(words, tags, keySlot, tag, word); this.writeSlot(words, tags, valueSlot, nextTag, nextWord); return main;
		}
		const mainWord = memory.readRamRecordWord(words + keySlot * 4);
		const free = this.getFreeIndex(record, array, hash, tags);
		if (free < 0) return -1;
		const freeKey = array + free, freeValue = freeKey + hash;
		const occupiedMain = this.heap.hash(valueFromTag(keyTag, mainWord)) & mask;
		if (occupiedMain !== main) {
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
	private rawSet(record: number, key: Value, value: Value): number {
		this.writeBarrier(record);
		const slot = this.getArrayIndex(key), array = this.arrayCapacity(record);
		if (slot >= 0 && slot < array) { this.setValue(record, slot, value); return -1; }
		const hash = this.hashSize(record);
		if (hash !== 0) {
			const words = this.storageAddress(record), tags = words + (array + 3 * hash) * 4;
			const index = this.insertHashWithoutGrowth(record, key, value, array, hash, words, tags);
			if (index >= 0) return index;
		}
		this.rehash(record, key, value); return this.rawSet(record, key, value);
	}
	private markHashNodeDead(record: number, index: number): void {
		const keySlot = this.hashKeySlot(record, index), valueSlot = this.hashValueSlot(record, index), tag = this.tagAt(record, keySlot);
		if (tag === ValueTag.Table || tag === ValueTag.Thread || tag === ValueTag.Closure) {
			const hashId = this.wordAt(record, keySlot);
			this.setEncoded(record, keySlot, ValueTag.Nil, tag); this.setEncoded(record, valueSlot, ValueTag.DeadKey, hashId);
		} else this.setEncoded(record, valueSlot, ValueTag.Nil, 0);
	}
	private removeFromHash(record: number, key: Value): void {
		const index = this.findNodeIndex(record, key);
		if (index >= 0 && this.tagAt(record, this.hashValueSlot(record, index)) !== ValueTag.Nil) this.markHashNodeDead(record, index);
	}
	private static countIntegerKey(counts: Uint32Array, bins: number, index: number): number {
		const log = ceilLog2(index);
		while (bins <= log) counts[bins++] = 0;
		++counts[log]; return bins;
	}
	private rehash(record: number, key: Value, value: Value): void {
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
		this.heap.budget.accountTableStorageWork(oldArray + 2 * oldHash);
		this.resize(record, arraySize, hashKeys > 0 ? nextPowerOfTwo(hashKeys) : 0, key, value);
	}
	private resize(record: number, array: number, hash: number, key: Value, value: Value): void {
		const storage = this.heap.budget.allocateRecord(TableRecords.storageBytes(array, hash), true, 0, 0,
			valueTable(record), key, value);
		const oldWords = this.storageAddress(record), oldTags = this.tags(record), oldArray = this.arrayCapacity(record), oldHash = this.hashSize(record);
		const memory = this.heap.memory;
		this.bindStorage(record, array, hash, storage);
		this.initializeStorage(record);
		this.heap.budget.accountTableStorageWork(array + 2 * hash);
		let relocated = 0;
		for (let slot = 0; slot < oldArray; ++slot) {
			const tag = memory.readRamRecordByte(oldTags + slot);
			if (tag !== ValueTag.Nil) {
				const destination = this.rawSet(record, valueInteger(slot + 1), valueFromTag(tag, memory.readRamRecordWord(oldWords + slot * 4)));
				relocated += destination < 0 ? 1 : 2;
			}
		}
		for (let index = 0; index < oldHash; ++index) {
			const oldKey = oldArray + index, oldValue = oldKey + oldHash;
			const keyTag = memory.readRamRecordByte(oldTags + oldKey), valueTag = memory.readRamRecordByte(oldTags + oldValue);
			if (keyTag !== ValueTag.Nil && valueTag !== ValueTag.Nil) {
				const destination = this.rawSet(record, valueFromTag(keyTag, memory.readRamRecordWord(oldWords + oldKey * 4)),
					valueFromTag(valueTag, memory.readRamRecordWord(oldWords + oldValue * 4)));
				relocated += destination < 0 ? 1 : 2;
			}
		}
		this.heap.budget.accountTableStorageWork(oldArray + 2 * oldHash + relocated);
		if (oldWords !== 0) this.heap.arena.free(oldWords);

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
	public length(record: number, work?: TableLengthWork): number {
		let low = this.lengthHint(record), high: number, probes = low === 0 ? 0 : 1;
		if (low !== 0 && !this.hasIntegerKey(record, low)) { high = low; low = 0; }
		else if (low === TABLE_MAX_ARRAY_INDEX) { if (work) work.probes = probes; return low; }
		else {
			++probes;
			if (!this.hasIntegerKey(record, low + 1)) { if (work) work.probes = probes; return low; }
			++low;
			if (low === TABLE_MAX_ARRAY_INDEX) { if (work) work.probes = probes; return low; }
			high = Math.min(low * 2, TABLE_MAX_ARRAY_INDEX);
			for (;;) {
				++probes; if (!this.hasIntegerKey(record, high)) break;
				low = high;
				if (low === TABLE_MAX_ARRAY_INDEX) { if (work) work.probes = probes; return low; }
				high = Math.min(low * 2, TABLE_MAX_ARRAY_INDEX);
			}
		}
		while (high - low > 1) {
			const middle = low + ((high - low) >>> 1); ++probes;
			if (this.hasIntegerKey(record, middle)) low = middle; else high = middle;
		}
		if (work) work.probes = probes; return low;
	}
	public clear(record: number): void {
		this.writeHeader(record, TableHeader.Length, 0); this.freeStorage(record); this.bindStorage(record, 0, 0, 0);

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
	public forEachStoredEntry(record: number, visitor: StoredEntryVisitor): void {
		const memory = this.heap.memory;
		const array = this.arrayCapacity(record), hash = this.hashSize(record), words = this.storageAddress(record);
		const tags = words + (array + 3 * hash) * 4, end = array + hash;
		for (let slot = 0; slot < array; ++slot) {
			const tag = memory.readRamRecordByte(tags + slot);
			if (tag !== ValueTag.Nil) visitor(valueInteger(slot + 1), valueFromTag(tag, memory.readRamRecordWord(words + slot * 4)));
		}
		for (let key = array; key < end; ++key) {
			const value = key + hash;
			const keyTag = memory.readRamRecordByte(tags + key), valueTag = memory.readRamRecordByte(tags + value);
			if (keyTag === ValueTag.Nil || valueTag === ValueTag.Nil) continue;
			visitor(valueFromTag(keyTag, memory.readRamRecordWord(words + key * 4)),
				valueFromTag(valueTag, memory.readRamRecordWord(words + value * 4)));
		}
	}
	public clearWeakEntries(record: number, weakKeys: boolean, weakValues: boolean, isAlive: StoredValuePredicate): void {
		if (weakValues) for (let slot = 0; slot < this.arrayCapacity(record); ++slot)
			if (this.tagAt(record, slot) !== ValueTag.Nil && !isAlive(this.valueAt(record, slot))) this.setEncoded(record, slot, ValueTag.Nil, 0);
		for (let index = 0; index < this.hashSize(record); ++index) {
			const key = this.hashKeySlot(record, index), value = this.hashValueSlot(record, index);
			if (this.tagAt(record, key) === ValueTag.Nil || this.tagAt(record, value) === ValueTag.Nil) continue;
			if ((weakKeys && !isAlive(this.valueAt(record, key))) || (weakValues && !isAlive(this.valueAt(record, value)))) this.markHashNodeDead(record, index);
		}
	}
	public next(record: number, rawAfter: Value, target: ValueWriteTarget, destination: number): number {
		const after = canonicalTableKey(rawAfter);
		let arrayStart = 0, hashStart = 0;
		if (!isNil(after)) {
			const array = this.getArrayIndex(after);
			if (array >= 0 && array < this.arrayCapacity(record)) arrayStart = array + 1;
			else {
				const index = this.findNodeIndex(record, after, true);
				if (index < 0) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
				arrayStart = this.arrayCapacity(record); hashStart = index + 1;
			}
		}
		for (let slot = arrayStart; slot < this.arrayCapacity(record); ++slot) if (this.tagAt(record, slot) !== ValueTag.Nil) {
			target.setEncoded(destination, ValueTag.Integer, slot + 1); target.setEncoded(destination + 1, this.tagAt(record, slot), this.wordAt(record, slot)); return slot - arrayStart + 1;
		}
		const arrayWork = this.arrayCapacity(record) - arrayStart;
		for (let index = hashStart; index < this.hashSize(record); ++index) {
			const key = this.hashKeySlot(record, index), value = this.hashValueSlot(record, index);
			if (this.tagAt(record, key) === ValueTag.Nil || this.tagAt(record, value) === ValueTag.Nil) continue;
			target.setEncoded(destination, this.tagAt(record, key), this.wordAt(record, key)); target.setEncoded(destination + 1, this.tagAt(record, value), this.wordAt(record, value)); return arrayWork + 2 * (index - hashStart + 1);
		}
		target.setNil(destination); return arrayWork + 2 * (this.hashSize(record) - hashStart);
	}
	public getTrackedHeapBytes(record: number): number { return TableRecords.trackedHeapBytesForCapacities(this.arrayCapacity(record), this.hashSize(record)); }
}
