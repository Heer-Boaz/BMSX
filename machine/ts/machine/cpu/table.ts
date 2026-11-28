import { nextPowerOfTwo } from '../common/numeric';
import { COP0_TABLE_ASSIGN_KEY, COP0_TABLE_LENGTH_KEY, COP0_TABLE_LOOKUP_KEY, LUA_FAULT_REASON_INDEX_NAN, LUA_FAULT_REASON_INDEX_NIL, LUA_FAULT_REASON_INVALID_NEXT_KEY } from '../../spec/blua32/cop0';
import { LuaExecutionError } from './errors';
import type { Memory } from '../memory/memory';
import type { StringId } from './string_pool';
import {
	ValueTag, asInteger, canonicalTableKey, isNil, hashCanonicalTableKey, valueFromTag, valueInteger,
	valueIsNaN, valueNil, valuePayload, valueString, valueTag, valueTagHasGcEdge, type Value,
} from './value';
import type { ValueWriteTarget } from './value_slots';

const TABLE_MAX_ARRAY_INDEX = 0x7fffffff;
const TABLE_STRING_HIT_BASE_NODES = 64;
const TABLE_HASH_SLOT_BUDGET_BYTES = 10;
// A fixed-string Store carries an unprobed, absent (-1), or matched hash node,
// including a matched tombstone.
export const TABLE_HASH_UNPROBED = -2;
export const HASH_STORE_DECLINED = -3;
// Declined guest stores return this base minus the resolved placement:
// -2 array, -1 unmatched hash, or the nonnegative matched hash node.
export const TABLE_STORE_FIRMWARE = -5;
export const TABLE_INDEX_CHAIN_LIMIT = 32;
export const enum TableLookupStatus { Resolved, ChainExhausted, Invoke, Forward, Store }
type TableLookupSlot = { value: Value; slot: number };
export type TableLookupResult = TableLookupSlot & { extraVisits: number; status: TableLookupStatus; receiver: number };
type StoredEntryVisitor = (key: Value, value: Value) => void;
export interface TableStringProbe extends TableLookupSlot { node: number; remaining: number }

export const enum TableHeader {
	Kind = 0, NewIndexAbsent = 2, Gray = 4, Metatable = 8, HashStorage = 12, Array = 16, Hash = 20, Length = 24, Free = 28, ArrayStorage = 32,
}
export class TableRecords {
	static readonly HEADER_BYTES = 36;
	static readonly HEADER_CHARGE = 32;
	public constructor(private readonly memory: Memory, private readonly cop0: Uint32Array) {}
	public static hashCapacity(size: number): number { return size > 0 ? nextPowerOfTwo(size) : 0; }
	// Two word lanes, two tag lanes and a signed chain cursor per node.
	// A byte covers -1 and every index of a power-of-two table up to 128.
	public static readonly HASH_CENSUS_LIMIT = 64;
	protected static readonly HASH_BAND_CAPACITY = 1024;
	protected static hashNodeBytes(hash: number): number { return hash * (hash <= 128 ? 11 : 14); }
	public static hashStorageBytes(hash: number): number { return TableRecords.hashNodeBytes(hash) + (hash > TableRecords.HASH_CENSUS_LIMIT ? 4 : 0) + (hash >= TableRecords.HASH_BAND_CAPACITY ? 32 * 4 : 0); }
	protected adjustIntegerBand(words: number, hash: number, tag: ValueTag, word: number, delta: number): void {
		if (hash < TableRecords.HASH_BAND_CAPACITY || tag !== ValueTag.Integer || (word | 0) <= 0) return;
		const bin = 32 - Math.clz32(word - 1);
		const address = words + TableRecords.hashNodeBytes(hash) + 4 * (1 + bin), memory = this.memory;
		memory.writeRamRecordWord(address, memory.readRamRecordWord(address) + delta);
	}
	protected adjustHashLive(words: number, hash: number, delta: number): void {
		if (hash <= TableRecords.HASH_CENSUS_LIMIT) return;
		const memory = this.memory, address = words + TableRecords.hashNodeBytes(hash);
		memory.writeRamRecordWord(address, memory.readRamRecordWord(address) + delta);
	}
	protected hashNext(links: number, count: number, node: number): number {
		return count <= 128 ? (this.memory.readRamRecordByte(links + node) << 24) >> 24
			: this.memory.readRamRecordWord(links + node * 4) | 0;
	}
	public static storageBytes(array: number, hash: number): number { return 5 * array + TableRecords.hashStorageBytes(hash); }
	public static allocationCharge(array: number, hash: number): number { return 5 * array + TABLE_HASH_SLOT_BUDGET_BYTES * hash; }
	protected readHeader(record: number, field: TableHeader): number { return this.memory.readRamRecordWord(record + field); }
	protected writeHeader(record: number, field: TableHeader, word: number): void { this.memory.writeRamRecordWord(record + field, word); }
	public metatableAddress(record: number): number { return this.readHeader(record, TableHeader.Metatable); }
	// The producer's absence proof describes the metatable's own mapping for the current assignment key.
	private newIndexMetatable(record: number): number {
		const meta = this.metatableAddress(record);
		return meta !== 0 && this.memory.readRamRecordByte(meta + TableHeader.NewIndexAbsent) === 1 ? 0 : meta;
	}
	public arrayCapacity(record: number): number { return this.readHeader(record, TableHeader.Array); }
	public hashSize(record: number): number { return this.readHeader(record, TableHeader.Hash); }
	private lengthHint(record: number): number { return this.readHeader(record, TableHeader.Length); }
	public arrayAddress(record: number): number { return this.readHeader(record, TableHeader.ArrayStorage); }
	public hashAddress(record: number): number { return this.readHeader(record, TableHeader.HashStorage); }
	private tags(record: number): number { return this.hashAddress(record) + 8 * this.hashSize(record); }
	protected wordAt(record: number, slot: number): number { return this.memory.readRamRecordWord(this.hashAddress(record) + slot * 4); }
	protected tagAt(record: number, slot: number): ValueTag { return this.memory.readRamRecordByte(this.tags(record) + slot); }
	private setEncoded(record: number, slot: number, tag: ValueTag, word: number): void {
		const words = this.hashAddress(record), tags = words + 8 * this.hashSize(record);
		this.writeSlot(words, tags, slot, tag, word);
	}
	protected writeSlot(words: number, tags: number, slot: number, tag: ValueTag, word: number): void {
		this.memory.writeRamRecordWord(words + slot * 4, word);
		this.memory.writeRamRecordByte(tags + slot, tag);
	}
	protected hashValueSlot(record: number, index: number): number { return this.hashSize(record) + index; }
	// Callers normalize the key once before lookup/insertion. Integral Float
	// keys are Integer keys, including -0. Nil and NaN cannot name entries.
	protected getArrayIndex(key: Value): number {
		return valueTag(key) === ValueTag.Integer ? this.integerArrayIndex(asInteger(key)) : -1;
	}
	private integerArrayIndex(key: number): number { return key > 0 ? key - 1 : -1; }
	protected findNodeIndex(record: number, key: Value, matchDead = false): number {
		const hash = this.hashSize(record);
		if (hash === 0) return -1;
		const words = this.hashAddress(record);
		const home = hashCanonicalTableKey(key) & (hash - 1);
		return this.probeHash(key, home, hash, words, words + 8 * hash, matchDead);
	}
	protected probeHash(key: Value, home: number, hash: number, words: number, tags: number, matchDead: boolean): number {
		const memory = this.memory, links = tags + hash * 2;
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
	protected findStringNodeIndex(key: StringId, home: number, hash: number, words: number, tags: number): number {
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
		return valueFromTag(this.memory.readRamRecordByte(tags + slot), this.memory.readRamRecordWord(words + slot * 4));
	}
	private arrayValue(record: number, slot: number): Value {
		const words = this.arrayAddress(record), memory = this.memory;
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
		const memory = this.memory, words = this.arrayAddress(record);
		const tags = words + array * 4;
		const tag = memory.readRamRecordByte(tags + slot);
		if (tag === ValueTag.Nil && this.metatableAddress(record) !== 0) return false;
		target.setEncoded(destination, tag, memory.readRamRecordWord(words + slot * 4)); return true;
	}
	public storeIntegerArrayKey(record: number, index: number, tag: ValueTag, word: number): boolean {
		if (valueTagHasGcEdge(tag)) return false;
		const slot = this.integerArrayIndex(index), array = this.arrayCapacity(record);
		if (slot < 0 || slot >= array) return false;
		const words = this.arrayAddress(record), tags = words + array * 4;
		if (this.memory.readRamRecordByte(tags + slot) === ValueTag.Nil) {
			const meta = this.newIndexMetatable(record);
			if (meta !== 0 && !isNil(this.getStringKey(meta, this.cop0[COP0_TABLE_ASSIGN_KEY]))) return false;
		}
		this.writeSlot(words, tags, slot, tag, word);
		this.updateLengthHint(record, slot, tag !== ValueTag.Nil);
		return true;
	}
	public getStringKey(record: number, key: StringId): Value {
		const hash = this.hashSize(record);
		if (hash === 0) return valueNil();
		const words = this.hashAddress(record);
		const tags = words + 8 * hash;
		const index = this.findStringNodeIndex(key, hashCanonicalTableKey(valueString(key)) & (hash - 1), hash, words, tags);
		if (index < 0) return valueNil();
		const memory = this.memory, slot = hash + index;
		return valueFromTag(memory.readRamRecordByte(tags + slot), memory.readRamRecordWord(words + slot * 4));
	}
	public loadStringKey(record: number, key: StringId, target: ValueWriteTarget, destination: number): void {
		const hash = this.hashSize(record);
		if (hash !== 0) {
			const words = this.hashAddress(record);
			const tags = words + 8 * hash;
			const index = this.findStringNodeIndex(key, hashCanonicalTableKey(valueString(key)) & (hash - 1), hash, words, tags);
			if (index >= 0) {
				const memory = this.memory, slot = hash + index;
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
		const memory = this.memory, links = tags + hash * 2;
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
		const memory = this.memory;
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
		const memory = this.memory, tag = memory.readRamRecordByte(tags + slot);
		if (tag === ValueTag.Nil) return false;
		target.setEncoded(destination, tag, memory.readRamRecordWord(words + slot * 4));
		return true;
	}

	public getStringKeyCached(record: number, key: StringId, predicted: number, result: TableLookupSlot): number {
		const hash = this.hashSize(record);
		if (hash !== 0) {
			const words = this.hashAddress(record);
			const tags = words + 8 * hash, memory = this.memory;
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
	public resolveIndex(record: number, rawKey: Value, result: TableLookupResult,
		visitLimit = TABLE_INDEX_CHAIN_LIMIT): number {
		if (valueTag(rawKey) === ValueTag.String) return this.resolveStringIndexCached(record, valuePayload(rawKey), -1, result, visitLimit);
		const validKey = !isNil(rawKey) && !valueIsNaN(rawKey);
		const key = canonicalTableKey(rawKey);
		const arrayIndex = this.getArrayIndex(key);
		result.value = validKey ? this.getCanonical(record, key, arrayIndex) : valueNil();
		result.slot = -1;
		if (!isNil(result.value)) {
			result.extraVisits = 0; result.status = TableLookupStatus.Resolved; return 0;
		}
		return this.resolveIndexMiss(record, key, validKey, arrayIndex, result, visitLimit, 0);
	}
	public resolveIntegerIndex(record: number, key: number, result: TableLookupResult): void {
		this.resolveIndex(record, valueInteger(key), result);
	}
	public resolveStringIndex(record: number, key: StringId, result: TableLookupResult): void {
		this.resolveStringIndexCached(record, key, -1, result);
	}
	/** A table-valued __index can be inspected without executing a guest function. */
	public indexParentTable(record: number): number {
		const field = this.metafield(record, COP0_TABLE_LOOKUP_KEY);
		return valueTag(field) === ValueTag.Table ? valuePayload(field) : 0;
	}
	public lengthMetamethod(record: number): Value {
		return this.metafield(record, COP0_TABLE_LENGTH_KEY);
	}
	private metafield(record: number, register: typeof COP0_TABLE_LOOKUP_KEY | typeof COP0_TABLE_LENGTH_KEY): Value {
		const meta = this.metatableAddress(record);
		return meta !== 0 ? this.getStringKey(meta, this.cop0[register]) : valueNil();
	}
	public resolveStringIndexCached(record: number, key: StringId, predicted: number, result: TableLookupResult, visitLimit = TABLE_INDEX_CHAIN_LIMIT): number {
		const links = this.getStringKeyCached(record, key, predicted, result);
		if (result.slot >= 0) {
			result.extraVisits = 0; result.status = TableLookupStatus.Resolved; return links;
		}
		return this.resolveIndexMiss(record, valueString(key), true, -1, result, visitLimit, links);
	}
	private resolveIndexMiss(current: number, key: Value, validKey: boolean, arrayIndex: number,
		result: TableLookupResult, visitLimit: number, links: number): number {
		let meta = this.metatableAddress(current);
		if (meta === 0) {
			result.extraVisits = 0; result.status = TableLookupStatus.Resolved; return links;
		}
		const indexKey = this.cop0[COP0_TABLE_LOOKUP_KEY];
		const stringKey = valueTag(key) === ValueTag.String;
		let depth = 0, anchor = 0, anchorDepth = 0, anchorLinks = 0;
		for (;;) {
			links += this.getStringKeyCached(meta, indexKey, -1, result);
			const next = result.value;
			result.slot = -1;
			const tag = valueTag(next);
			if (tag !== ValueTag.Table) {
				result.extraVisits = depth;
				if (tag === ValueTag.Closure || tag === ValueTag.BuiltinFunction || tag === ValueTag.CodeFunction) {
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
			meta = this.metatableAddress(current);
			if (meta === 0) {
				result.value = valueNil();
				result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return links;
			}
		}
	}
	public resolveAssignment(record: number, key: Value, result: TableLookupResult,
		fixedString = false): void {
		const validKey = fixedString || (!isNil(key) && !valueIsNaN(key));
		const stringKey = fixedString || valueTag(key) === ValueTag.String;
		const arrayIndex = fixedString ? -1 : this.getArrayIndex(key);
		const memory = this.memory;
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			const meta = this.newIndexMetatable(record);
			let slot = meta === 0 ? TABLE_HASH_UNPROBED : -1;
			let next = valueNil();
			if (meta !== 0) {
				let own = false;
				if (validKey) {
					const array = arrayIndex >= 0 ? this.arrayCapacity(record) : 0;
					if (arrayIndex >= 0 && arrayIndex < array) {
						const tags = this.arrayAddress(record) + 4 * array;
						own = memory.readRamRecordByte(tags + arrayIndex) !== ValueTag.Nil;
					} else {
						const hash = this.hashSize(record);
						if (hash !== 0) {
							const words = this.hashAddress(record), tags = words + 8 * hash;
							const home = hashCanonicalTableKey(key) & (hash - 1);
							slot = stringKey ? this.findStringNodeIndex(valuePayload(key), home, hash, words, tags)
								: this.probeHash(key, home, hash, words, tags, true);
							if (slot >= 0) {
								const prior = memory.readRamRecordByte(tags + hash + slot);
								own = prior !== ValueTag.Nil && prior !== ValueTag.DeadKey;
							}
						}
					}
				}
				if (!own) next = this.getStringKey(meta, this.cop0[COP0_TABLE_ASSIGN_KEY]);
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
				: tag === ValueTag.Closure || tag === ValueTag.BuiltinFunction || tag === ValueTag.CodeFunction
					? TableLookupStatus.Invoke
				: TableLookupStatus.Forward;
			result.slot = tag === ValueTag.Nil ? slot : -1;
			return;
		}
		result.slot = -1; result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1; result.status = TableLookupStatus.ChainExhausted;
	}
	public tryStore(record: number, key: Value, value: Value, resolved = TABLE_HASH_UNPROBED): number {
		if (isNil(key)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		if (valueIsNaN(key)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NAN);
		const tag = valueTag(value);
		const slot = this.getArrayIndex(key), array = this.arrayCapacity(record);
		if (slot >= 0 && slot < array) {
			const word = valuePayload(value);
			if (valueTagHasGcEdge(tag)) return TABLE_STORE_FIRMWARE + 2;
			const words = this.arrayAddress(record);
			this.writeSlot(words, words + array * 4, slot, tag, word); this.updateLengthHint(record, slot, tag !== ValueTag.Nil); return -1;
		}
		const node = this.setHash(record, key, value, resolved);
		if (node >= -1 && slot >= 0) this.updateLengthHint(record, slot, tag !== ValueTag.Nil);
		return node;
	}
	protected setHash(record: number, key: Value, value: Value, resolved: number): number {
		const tag = valueTag(value), word = valuePayload(value);
		if (tag === ValueTag.Nil) return this.removeFromHash(record, key, resolved);
		const keyTag = valueTag(key), keyWord = valuePayload(key);
		const hash = this.hashSize(record), words = this.hashAddress(record), tags = words + 8 * hash;
		const memory = this.memory;
		let home = 0;
		let index = resolved;
		if (index === TABLE_HASH_UNPROBED) {
			if (hash === 0) index = -1;
			else {
				home = hashCanonicalTableKey(key) & (hash - 1);
				index = keyTag === ValueTag.String ? this.findStringNodeIndex(keyWord, home, hash, words, tags)
					: this.probeHash(key, home, hash, words, tags, true);
			}
		}
		if (index >= 0) {
			const valueSlot = index + hash, prior = memory.readRamRecordByte(tags + valueSlot);
			if (prior !== ValueTag.Nil && prior !== ValueTag.DeadKey) {
				if (valueTagHasGcEdge(tag)) return TABLE_STORE_FIRMWARE - index;
				this.writeSlot(words, tags, valueSlot, tag, word);
				return index;
			}
		}
		return TABLE_STORE_FIRMWARE - index;
	}
	public storePredictedStringKey(record: number, key: StringId, predicted: number, tag: ValueTag, word: number): boolean {
		if (tag === ValueTag.Nil || valueTagHasGcEdge(tag) || predicted < 0) return false;
		const hash = this.hashSize(record);
		if (predicted >= hash) return false;
		const memory = this.memory, words = this.hashAddress(record);
		const tags = words + 8 * hash, keySlot = predicted, valueSlot = keySlot + hash;
		if (memory.readRamRecordByte(tags + keySlot) !== ValueTag.String || memory.readRamRecordWord(words + keySlot * 4) !== key
			|| memory.readRamRecordByte(tags + valueSlot) === ValueTag.Nil) return false;
		this.writeSlot(words, tags, valueSlot, tag, word); return true;
	}
	protected eraseHashNode(record: number, index: number): ValueTag {
		const words = this.hashAddress(record), hash = this.hashSize(record);
		this.adjustHashLive(words, hash, -1);
		const keySlot = index, valueSlot = hash + index, tag = this.tagAt(record, keySlot);
		if (hash >= TableRecords.HASH_BAND_CAPACITY && tag === ValueTag.Integer)
			this.adjustIntegerBand(words, hash, tag, this.memory.readRamRecordWord(words + 4 * keySlot), -1);
		if (tag === ValueTag.Table || tag === ValueTag.Thread || tag === ValueTag.Closure) {
			const hashId = this.wordAt(record, keySlot);
			this.setEncoded(record, keySlot, ValueTag.Nil, tag); this.setEncoded(record, valueSlot, ValueTag.DeadKey, hashId);
		} else {
			this.setEncoded(record, valueSlot, ValueTag.Nil, 0);
		}
		return tag;
	}
	protected removeFromHash(record: number, key: Value, resolved: number): number {
		const index = resolved === TABLE_HASH_UNPROBED ? this.findNodeIndex(record, key) : resolved;
		if (index < 0) return -1;
		const tag = this.tagAt(record, this.hashValueSlot(record, index));
		if (tag === ValueTag.Nil || tag === ValueTag.DeadKey) return -1;
		// Only firmware compares the method key when the owner has no absence proof.
		if (valueTag(key) === ValueTag.String
			&& this.memory.readRamRecordByte(record + TableHeader.NewIndexAbsent) !== 1) return TABLE_STORE_FIRMWARE - index;
		this.eraseHashNode(record, index);
		return -1;
	}
	protected updateLengthHint(record: number, slot: number, present: boolean): void {
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
		const memory = this.memory;
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
}
