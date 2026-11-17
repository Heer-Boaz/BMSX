import { GcObject, GcKind } from './gc_object';
import { ceilLog2, nextPowerOfTwo } from '../common/numeric';
import { LUA_FAULT_REASON_INDEX_NIL, LUA_FAULT_REASON_INVALID_NEXT_KEY } from '../../spec/blua32/cop0';
import { LuaExecutionError } from './errors';
import type { GcHeap } from './gc_heap';
import type { StringId } from './string_pool';
import {
	ValueTag, asTable, canonicalTableKey, isNil, valueFromTag, valueInteger,
	valueNil, valuePayload, valueString, valueTable, valueTag, type Value,
} from './value';
import { type CpuSnapshotWriter, CpuSnapshotObjectKind, CpuSnapshotTable, CPU_SNAPSHOT_VALUE_WORDS, type CpuSnapshotValueWriter, type CpuSnapshotReader } from './snapshot';
import { ValueSlots, type ValueWriteTarget } from './value_slots';

const TABLE_HEAP_BYTES = 32;
const TABLE_ARRAY_SLOT_HEAP_BYTES = 5;
const TABLE_HASH_SLOT_HEAP_BYTES = 14;
const TABLE_HASH_NEXT_END = -1;
const TABLE_MAX_ARRAY_INDEX = 0x7fffffff;
const EMPTY_WORDS = new Uint32Array(0);
const EMPTY_TAGS = new Uint8Array(0);
const EMPTY_NEXT = new Int32Array(0);
export const TABLE_INDEX_CHAIN_LIMIT = 32;
export const TABLE_STORE_REQUIRES_GROWTH = -2;
export type TableLengthWork = { probes: number };
export const enum TableLookupStatus { Resolved, ChainExhausted }
export type TableLookupResult = { values: ValueSlots; slot: number; extraVisits: number; status: TableLookupStatus };
type StoredEntryVisitor = (key: Value, value: Value) => void;
type StoredValuePredicate = (value: Value) => boolean;

export class Table extends GcObject {
	private lengthHint = 0;
	private words = EMPTY_WORDS;
	private tags = EMPTY_TAGS;
	private hashNext = EMPTY_NEXT;
	private arrayCapacity = 0;
	private hashSize = 0;
	private hashFree = -1;
	public gcWeakListed = false;
	private tableMetatable: Table | null = null;
	private static readonly rehashIntegerCounts = new Uint32Array(32);

	constructor(private readonly heap: GcHeap, arraySize: number, hashCapacity: number) {
		super(GcKind.Table);
		this.allocateStorage(arraySize, hashCapacity);
	}
	public static hashCapacity(size: number): number { return size > 0 ? nextPowerOfTwo(size) : 0; }
	public static trackedHeapBytesForCapacities(array: number, hash: number): number {
		return TABLE_HEAP_BYTES + TABLE_ARRAY_SLOT_HEAP_BYTES * array + TABLE_HASH_SLOT_HEAP_BYTES * hash;
	}
	public get metatable(): Table | null { return this.tableMetatable; }
	public set metatable(table: Table | null) { this.writeBarrier(); this.tableMetatable = table; }

	// Packed Values are temporary scalar transport; only these u32/u8 planes
	// retain guest values. All views are made together, at allocation time.
	private allocateStorage(array: number, hash: number): void {
		const slots = array + 2 * hash;
		if (slots === 0) {
			this.words = EMPTY_WORDS; this.tags = EMPTY_TAGS; this.hashNext = EMPTY_NEXT;
		} else {
			const buffer = new ArrayBuffer(slots * 5 + hash * 4);
			this.words = new Uint32Array(buffer, 0, slots);
			this.hashNext = new Int32Array(buffer, slots * 4, hash);
			this.tags = new Uint8Array(buffer, (slots + hash) * 4, slots);
			this.hashNext.fill(TABLE_HASH_NEXT_END);
		}
		this.arrayCapacity = array; this.hashSize = hash; this.hashFree = hash - 1;
	}
	private valueAt(slot: number): Value { return valueFromTag(this.tags[slot], this.words[slot]); }
	private setEncoded(slot: number, tag: ValueTag, word: number): void { this.words[slot] = word; this.tags[slot] = tag; }
	private setValue(slot: number, value: Value): void { this.setEncoded(slot, valueTag(value), valuePayload(value)); }
	private hashKeySlot(index: number): number { return this.arrayCapacity + index; }
	private hashValueSlot(index: number): number { return this.arrayCapacity + this.hashSize + index; }
	// Callers normalize the key once before lookup/insertion. Integral Float
	// keys are Integer keys, including -0; every NaN key has one canonical word.
	private getArrayIndex(key: Value): number {
		return valueTag(key) === ValueTag.Integer && (valuePayload(key) | 0) > 0 ? valuePayload(key) - 1 : -1;
	}
	private findNodeIndex(key: Value, matchDead = false): number {
		if (this.hashSize === 0) return -1;
		const tag = valueTag(key);
		const collectable = matchDead && (tag === ValueTag.Table || tag === ValueTag.Closure || tag === ValueTag.Thread);
		const hashId = collectable ? this.heap.object(valuePayload(key)).hashId : 0;
		let index = this.heap.hash(key) & (this.hashSize - 1);
		while (index >= 0) {
			const keySlot = this.hashKeySlot(index), valueSlot = this.hashValueSlot(index);
			if ((this.tags[keySlot] !== ValueTag.Nil && this.valueAt(keySlot) === key)
				|| (this.tags[keySlot] === ValueTag.Nil && collectable
					&& this.tags[valueSlot] === ValueTag.DeadKey && this.words[valueSlot] === hashId)) return index;
			index = this.hashNext[index];
		}
		return -1;
	}
	private findStringNodeIndex(key: StringId): number {
		if (this.hashSize === 0) return -1;
		let index = this.heap.hash(valueString(key)) & (this.hashSize - 1);
		while (index >= 0) {
			const slot = this.hashKeySlot(index);
			if (this.tags[slot] === ValueTag.String && this.words[slot] === key) return index;
			index = this.hashNext[index];
		}
		return -1;
	}
	public get(rawKey: Value): Value {
		const key = canonicalTableKey(rawKey);
		if (isNil(key)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		const array = this.getArrayIndex(key);
		if (array >= 0 && array < this.arrayCapacity) return this.valueAt(array);
		const index = this.findNodeIndex(key);
		return index >= 0 ? this.valueAt(this.hashValueSlot(index)) : valueNil();
	}
	public load(keyTag: ValueTag, keyWord: number, target: ValueWriteTarget, destination: number): void {
		const value = this.get(valueFromTag(keyTag, keyWord));
		target.setEncoded(destination, valueTag(value), valuePayload(value));
	}
	public getInteger(index: number): Value {
		const array = (index >>> 0) - 1;
		if (array >= 0 && array < this.arrayCapacity) return this.valueAt(array);
		const slot = this.findNodeIndex(valueInteger(index));
		return slot >= 0 ? this.valueAt(this.hashValueSlot(slot)) : valueNil();
	}
	public loadInteger(index: number, target: ValueWriteTarget, destination: number): void {
		const array = (index >>> 0) - 1;
		if (array >= 0 && array < this.arrayCapacity) {
			target.setEncoded(destination, this.tags[array], this.words[array]); return;
		}
		const value = this.getInteger(index);
		target.setEncoded(destination, valueTag(value), valuePayload(value));
	}
	public loadIntegerArrayKey(index: number, target: ValueWriteTarget, destination: number): boolean {
		const slot = (index >>> 0) - 1;
		if (slot < 0 || slot >= this.arrayCapacity || (this.tableMetatable !== null && this.tags[slot] === ValueTag.Nil)) return false;
		target.setEncoded(destination, this.tags[slot], this.words[slot]); return true;
	}
	public storeIntegerArrayKey(index: number, tag: ValueTag, word: number): boolean {
		const slot = (index >>> 0) - 1;
		if (slot < 0 || slot >= this.arrayCapacity) return false;
		this.writeBarrier(); this.setEncoded(slot, tag, word); this.updateLengthHint(slot, tag !== ValueTag.Nil); return true;
	}
	public setInteger(index: number, value: Value): void { this.set(valueInteger(index), value); }
	public storeInteger(index: number, tag: ValueTag, word: number): void { this.set(valueInteger(index), valueFromTag(tag, word)); }
	public getStringKey(key: StringId): Value {
		const index = this.findStringNodeIndex(key);
		return index >= 0 ? this.valueAt(this.hashValueSlot(index)) : valueNil();
	}
	public loadStringKey(key: StringId, target: ValueWriteTarget, destination: number): void {
		const index = this.findStringNodeIndex(key);
		if (index < 0) { target.setNil(destination); return; }
		const slot = this.hashValueSlot(index);
		target.setEncoded(destination, this.tags[slot], this.words[slot]);
	}
	public loadPredictedStringKey(key: StringId, predicted: number, target: ValueWriteTarget, destination: number): boolean {
		if (predicted < 0 || predicted >= this.hashSize) return false;
		const keySlot = this.hashKeySlot(predicted), valueSlot = this.hashValueSlot(predicted);
		if (this.tags[keySlot] !== ValueTag.String || this.words[keySlot] !== key || this.tags[valueSlot] === ValueTag.Nil) return false;
		target.setEncoded(destination, this.tags[valueSlot], this.words[valueSlot]); return true;
	}
	public loadStringKeyCached(key: StringId, predicted: number, target: ValueWriteTarget, destination: number): number {
		if (this.loadPredictedStringKey(key, predicted, target, destination)) return predicted;
		const index = this.findStringNodeIndex(key);
		if (index >= 0) {
			const slot = this.hashValueSlot(index);
			if (this.tags[slot] !== ValueTag.Nil) { target.setEncoded(destination, this.tags[slot], this.words[slot]); return index; }
		}
		target.setNil(destination); return -1;
	}
	public metatableIndexTable(indexKey: StringId): Table | null {
		if (this.tableMetatable === null) return null;
		const value = this.tableMetatable.getStringKey(indexKey);
		return valueTag(value) === ValueTag.Table ? asTable(value, this.heap) : null;
	}
	public resolveIndex(indexKey: StringId, keyTag: ValueTag, keyWord: number, result: TableLookupResult): void {
		const key = canonicalTableKey(valueFromTag(keyTag, keyWord));
		if (isNil(key)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		const arrayIndex = this.getArrayIndex(key);
		let current: Table = this;
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			let slot = arrayIndex;
			if (slot < 0 || slot >= current.arrayCapacity) {
				const index = current.findNodeIndex(key); slot = index >= 0 ? current.hashValueSlot(index) : -1;
			}
			if (slot >= 0 && current.tags[slot] !== ValueTag.Nil) {
				result.values.setEncoded(0, current.tags[slot], current.words[slot]);
				result.slot = -1; result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return;
			}
			const next = current.metatableIndexTable(indexKey);
			if (next === null) {
				result.values.setNil(0); result.slot = -1; result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return;
			}
			current = next;
		}
		result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1; result.status = TableLookupStatus.ChainExhausted;
	}
	public resolveIntegerIndex(indexKey: StringId, key: number, result: TableLookupResult): void {
		this.resolveIndex(indexKey, ValueTag.Integer, key >>> 0, result);
	}
	public resolveStringIndex(indexKey: StringId, key: StringId, result: TableLookupResult): void {
		this.resolveStringIndexCached(indexKey, key, -1, result);
	}
	public resolveStringIndexCached(indexKey: StringId, key: StringId, predicted: number, result: TableLookupResult): void {
		let current: Table = this;
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			const index = current.loadStringKeyCached(key, predicted, result.values, 0);
			if (result.values.getTag(0) !== ValueTag.Nil) {
				result.slot = index; result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return;
			}
			predicted = -1;
			const next = current.metatableIndexTable(indexKey);
			if (next === null) {
				result.slot = -1; result.extraVisits = depth; result.status = TableLookupStatus.Resolved; return;
			}
			current = next;
		}
		result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1; result.status = TableLookupStatus.ChainExhausted;
	}
	public set(rawKey: Value, value: Value): void {
		const key = canonicalTableKey(rawKey);
		if (isNil(key)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		this.writeBarrier();
		const array = this.getArrayIndex(key);
		if (array >= 0 && array < this.arrayCapacity) {
			this.setValue(array, value); this.updateLengthHint(array, !isNil(value)); return;
		}
		if (isNil(value)) {
			this.removeFromHash(key); if (array >= 0) this.updateLengthHint(array, false); return;
		}
		const index = this.findNodeIndex(key, true);
		if (index >= 0) {
			const keySlot = this.hashKeySlot(index);
			if (this.tags[keySlot] === ValueTag.Nil) this.setValue(keySlot, key);
			this.setValue(this.hashValueSlot(index), value);
		} else this.rawSet(key, value);
		if (array >= 0) this.updateLengthHint(array, true);
	}
	public store(keyTag: ValueTag, keyWord: number, tag: ValueTag, word: number): void {
		this.set(valueFromTag(keyTag, keyWord), valueFromTag(tag, word));
	}
	public setStringKey(key: StringId, value: Value): void { this.storeStringKey(key, valueTag(value), valuePayload(value)); }
	public storeStringKey(key: StringId, tag: ValueTag, word: number): number {
		const index = this.storeStringKeyWithoutGrowth(key, tag, word);
		if (index !== TABLE_STORE_REQUIRES_GROWTH) return index;
		const k = valueString(key), value = valueFromTag(tag, word);
		this.rehash(k, value); return this.rawSet(k, value);
	}
	public storeStringKeyWithoutGrowth(key: StringId, tag: ValueTag, word: number): number {
		this.writeBarrier();
		const k = valueString(key);
		if (tag === ValueTag.Nil) { this.removeFromHash(k); return -1; }
		const index = this.findStringNodeIndex(key);
		if (index >= 0) { this.setEncoded(this.hashValueSlot(index), tag, word); return index; }
		const inserted = this.insertHashWithoutGrowth(k, valueFromTag(tag, word));
		return inserted >= 0 ? inserted : TABLE_STORE_REQUIRES_GROWTH;
	}
	public storePredictedStringKey(key: StringId, predicted: number, tag: ValueTag, word: number): boolean {
		this.writeBarrier();
		if (tag === ValueTag.Nil || predicted < 0 || predicted >= this.hashSize) return false;
		const keySlot = this.hashKeySlot(predicted), valueSlot = this.hashValueSlot(predicted);
		if (this.tags[keySlot] !== ValueTag.String || this.words[keySlot] !== key || this.tags[valueSlot] === ValueTag.Nil) return false;
		this.setEncoded(valueSlot, tag, word); return true;
	}
	public storeStringKeyCached(key: StringId, predicted: number, tag: ValueTag, word: number): number {
		return this.storePredictedStringKey(key, predicted, tag, word) ? predicted : this.storeStringKey(key, tag, word);
	}
	private getFreeIndex(): number {
		for (let index = this.hashFree; index >= 0; --index) {
			if (this.tags[this.hashKeySlot(index)] === ValueTag.Nil && this.tags[this.hashValueSlot(index)] === ValueTag.Nil) {
				this.hashFree = index - 1; return index;
			}
		}
		this.hashFree = -1; return -1;
	}
	private insertHashWithoutGrowth(key: Value, value: Value): number {
		if (this.hashSize === 0) return -1;
		const mask = this.hashSize - 1, main = this.heap.hash(key) & mask;
		const keySlot = this.hashKeySlot(main), valueSlot = this.hashValueSlot(main);
		if (this.tags[keySlot] === ValueTag.Nil || this.tags[valueSlot] === ValueTag.Nil) {
			this.setValue(keySlot, key); this.setValue(valueSlot, value); return main;
		}
		const free = this.getFreeIndex();
		if (free < 0) return -1;
		const freeKey = this.hashKeySlot(free), freeValue = this.hashValueSlot(free);
		const mainKey = this.valueAt(keySlot), occupiedMain = this.heap.hash(mainKey) & mask;
		this.setValue(freeKey, occupiedMain !== main ? mainKey : key);
		this.setValue(freeValue, occupiedMain !== main ? this.valueAt(valueSlot) : value);
		this.hashNext[free] = this.hashNext[main];
		if (occupiedMain !== main) {
			let previous = occupiedMain;
			while (this.hashNext[previous] !== main) previous = this.hashNext[previous];
			this.hashNext[previous] = free;
			this.setValue(keySlot, key); this.setValue(valueSlot, value); this.hashNext[main] = TABLE_HASH_NEXT_END; return main;
		}
		this.hashNext[main] = free; return free;
	}
	private rawSet(key: Value, value: Value): number {
		this.writeBarrier();
		const array = this.getArrayIndex(key);
		if (array >= 0 && array < this.arrayCapacity) { this.setValue(array, value); return -1; }
		const index = this.insertHashWithoutGrowth(key, value);
		if (index >= 0) return index;
		this.rehash(key, value); return this.rawSet(key, value);
	}
	private markHashNodeDead(index: number): void {
		const keySlot = this.hashKeySlot(index), valueSlot = this.hashValueSlot(index), tag = this.tags[keySlot];
		if (tag === ValueTag.Table || tag === ValueTag.Thread || tag === ValueTag.Closure) {
			const hashId = this.heap.object(this.words[keySlot]).hashId;
			this.setEncoded(keySlot, ValueTag.Nil, 0); this.setEncoded(valueSlot, ValueTag.DeadKey, hashId);
		} else this.setEncoded(valueSlot, ValueTag.Nil, 0);
	}
	private removeFromHash(key: Value): void {
		const index = this.findNodeIndex(key);
		if (index >= 0 && this.tags[this.hashValueSlot(index)] !== ValueTag.Nil) this.markHashNodeDead(index);
	}
	private static countIntegerKey(counts: Uint32Array, bins: number, index: number): number {
		const log = ceilLog2(index);
		while (bins <= log) counts[bins++] = 0;
		++counts[log]; return bins;
	}
	private rehash(key: Value, value: Value): void {
		const counts = Table.rehashIntegerCounts;
		let bins = 0, totalKeys = 0;
		for (let slot = 0; slot < this.arrayCapacity; ++slot) {
			if (this.tags[slot] === ValueTag.Nil) continue;
			++totalKeys; bins = Table.countIntegerKey(counts, bins, slot + 1);
		}
		for (let index = 0; index < this.hashSize; ++index) {
			if (this.tags[this.hashKeySlot(index)] === ValueTag.Nil || this.tags[this.hashValueSlot(index)] === ValueTag.Nil) continue;
			++totalKeys; const array = this.getArrayIndex(this.valueAt(this.hashKeySlot(index)));
			if (array >= 0) bins = Table.countIntegerKey(counts, bins, array + 1);
		}
		++totalKeys; const added = this.getArrayIndex(key);
		if (added >= 0) bins = Table.countIntegerKey(counts, bins, added + 1);
		let arraySize = 0, arrayKeys = 0, total = 0, power = 1;
		for (let bin = 0; bin < bins; ++bin) {
			total += counts[bin];
			if (total > power / 2) { arraySize = power; arrayKeys = total; }
			power *= 2;
		}
		const hashKeys = totalKeys - arrayKeys;
		this.heap.budget.accountTableStorageWork(this.arrayCapacity + 2 * this.hashSize);
		this.resize(arraySize, hashKeys > 0 ? nextPowerOfTwo(hashKeys) : 0, key, value);
	}
	private resize(array: number, hash: number, key: Value, value: Value): void {
		const previousBytes = this.getTrackedHeapBytes(), resizedBytes = Table.trackedHeapBytesForCapacities(array, hash);
		if (resizedBytes > previousBytes) this.heap.budget.reserve(resizedBytes - previousBytes, valueTable(this.heap.reference(this)), key, value);
		const oldWords = this.words, oldTags = this.tags, oldArray = this.arrayCapacity, oldHash = this.hashSize;
		this.allocateStorage(array, hash);
		this.heap.budget.accountTableStorageWork(array + 2 * hash);
		let relocated = 0;
		for (let slot = 0; slot < oldArray; ++slot) {
			if (oldTags[slot] !== ValueTag.Nil) {
				const destination = this.rawSet(valueInteger(slot + 1), valueFromTag(oldTags[slot], oldWords[slot]));
				relocated += destination < 0 ? 1 : 2;
			}
		}
		for (let index = 0; index < oldHash; ++index) {
			const oldKey = oldArray + index, oldValue = oldArray + oldHash + index;
			if (oldTags[oldKey] !== ValueTag.Nil && oldTags[oldValue] !== ValueTag.Nil) {
				const destination = this.rawSet(valueFromTag(oldTags[oldKey], oldWords[oldKey]), valueFromTag(oldTags[oldValue], oldWords[oldValue]));
				relocated += destination < 0 ? 1 : 2;
			}
		}
		this.heap.budget.accountTableStorageWork(oldArray + 2 * oldHash + relocated);
		if (resizedBytes < previousBytes) this.heap.budget.release(previousBytes - resizedBytes);
	}
	private updateLengthHint(slot: number, present: boolean): void {
		if (present) { if (slot === this.lengthHint) ++this.lengthHint; }
		else if (slot + 1 === this.lengthHint) --this.lengthHint;
	}
	private hasIntegerKey(key: number): boolean {
		if (key <= this.arrayCapacity) return this.tags[key - 1] !== ValueTag.Nil;
		const index = this.findNodeIndex(valueInteger(key));
		return index >= 0 && this.tags[this.hashValueSlot(index)] !== ValueTag.Nil;
	}
	public length(work?: TableLengthWork): number {
		let low = this.lengthHint, high: number, probes = low === 0 ? 0 : 1;
		if (low !== 0 && !this.hasIntegerKey(low)) { high = low; low = 0; }
		else if (low === TABLE_MAX_ARRAY_INDEX) { if (work) work.probes = probes; return low; }
		else {
			++probes;
			if (!this.hasIntegerKey(low + 1)) { if (work) work.probes = probes; return low; }
			++low;
			if (low === TABLE_MAX_ARRAY_INDEX) { if (work) work.probes = probes; return low; }
			high = Math.min(low * 2, TABLE_MAX_ARRAY_INDEX);
			for (;;) {
				++probes; if (!this.hasIntegerKey(high)) break;
				low = high;
				if (low === TABLE_MAX_ARRAY_INDEX) { if (work) work.probes = probes; return low; }
				high = Math.min(low * 2, TABLE_MAX_ARRAY_INDEX);
			}
		}
		while (high - low > 1) {
			const middle = low + ((high - low) >>> 1); ++probes;
			if (this.hasIntegerKey(middle)) low = middle; else high = middle;
		}
		if (work) work.probes = probes; return low;
	}
	public clear(): void {
		const bytes = this.getTrackedHeapBytes(); this.lengthHint = 0; this.allocateStorage(0, 0);
		this.heap.budget.release(bytes - this.getTrackedHeapBytes());
	}
	public get storedSlotCount(): number { return this.arrayCapacity + this.hashSize; }
	public loadStoredEntry(slot: number, target: ValueWriteTarget, destination: number): boolean {
		if (slot < this.arrayCapacity) {
			if (this.tags[slot] === ValueTag.Nil) return false;
			target.setEncoded(destination, ValueTag.Integer, slot + 1);
			target.setEncoded(destination + 1, this.tags[slot], this.words[slot]); return true;
		}
		const index = slot - this.arrayCapacity, key = this.hashKeySlot(index), value = this.hashValueSlot(index);
		if (this.tags[key] === ValueTag.Nil || this.tags[value] === ValueTag.Nil) return false;
		target.setEncoded(destination, this.tags[key], this.words[key]); target.setEncoded(destination + 1, this.tags[value], this.words[value]); return true;
	}
	public forEachStoredEntry(visitor: StoredEntryVisitor): void {
		for (let slot = 0; slot < this.arrayCapacity; ++slot)
			if (this.tags[slot] !== ValueTag.Nil) visitor(valueInteger(slot + 1), this.valueAt(slot));
		for (let index = 0; index < this.hashSize; ++index) {
			const key = this.hashKeySlot(index), value = this.hashValueSlot(index);
			if (this.tags[key] !== ValueTag.Nil && this.tags[value] !== ValueTag.Nil) visitor(this.valueAt(key), this.valueAt(value));
		}
	}
	public clearWeakEntries(weakKeys: boolean, weakValues: boolean, isAlive: StoredValuePredicate): void {
		if (weakValues) for (let slot = 0; slot < this.arrayCapacity; ++slot)
			if (this.tags[slot] !== ValueTag.Nil && !isAlive(this.valueAt(slot))) this.setEncoded(slot, ValueTag.Nil, 0);
		for (let index = 0; index < this.hashSize; ++index) {
			const key = this.hashKeySlot(index), value = this.hashValueSlot(index);
			if (this.tags[key] === ValueTag.Nil || this.tags[value] === ValueTag.Nil) continue;
			if ((weakKeys && !isAlive(this.valueAt(key))) || (weakValues && !isAlive(this.valueAt(value)))) this.markHashNodeDead(index);
		}
	}
	public next(rawAfter: Value, target: ValueWriteTarget, destination: number): number {
		const after = canonicalTableKey(rawAfter);
		let arrayStart = 0, hashStart = 0;
		if (!isNil(after)) {
			const array = this.getArrayIndex(after);
			if (array >= 0 && array < this.arrayCapacity) arrayStart = array + 1;
			else {
				const index = this.findNodeIndex(after, true);
				if (index < 0) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
				arrayStart = this.arrayCapacity; hashStart = index + 1;
			}
		}
		for (let slot = arrayStart; slot < this.arrayCapacity; ++slot) if (this.tags[slot] !== ValueTag.Nil) {
			target.setEncoded(destination, ValueTag.Integer, slot + 1); target.setEncoded(destination + 1, this.tags[slot], this.words[slot]); return slot - arrayStart + 1;
		}
		const arrayWork = this.arrayCapacity - arrayStart;
		for (let index = hashStart; index < this.hashSize; ++index) {
			const key = this.hashKeySlot(index), value = this.hashValueSlot(index);
			if (this.tags[key] === ValueTag.Nil || this.tags[value] === ValueTag.Nil) continue;
			target.setEncoded(destination, this.tags[key], this.words[key]); target.setEncoded(destination + 1, this.tags[value], this.words[value]); return arrayWork + 2 * (index - hashStart + 1);
		}
		target.setNil(destination); return arrayWork + 2 * (this.hashSize - hashStart);
	}
	public captureSnapshot(snapshot: CpuSnapshotWriter, writeValue: CpuSnapshotValueWriter): number {
		const offset = snapshot.reserveWords(CpuSnapshotTable.Data + this.arrayCapacity * CPU_SNAPSHOT_VALUE_WORDS + this.hashSize * (2 * CPU_SNAPSHOT_VALUE_WORDS + 1));
		snapshot.setWord(offset + CpuSnapshotTable.Kind, CpuSnapshotObjectKind.Table); snapshot.setWord(offset + CpuSnapshotTable.HashId, this.hashId);
		snapshot.setWord(offset + CpuSnapshotTable.LengthHint, this.lengthHint); snapshot.setWord(offset + CpuSnapshotTable.ArrayCapacity, this.arrayCapacity);
		snapshot.setWord(offset + CpuSnapshotTable.HashSize, this.hashSize); snapshot.setWord(offset + CpuSnapshotTable.HashFree, this.hashFree);
		writeValue(offset + CpuSnapshotTable.Metatable, this.tableMetatable === null ? valueNil() : valueTable(this.heap.reference(this.tableMetatable)));
		let cursor = offset + CpuSnapshotTable.Data;
		for (let slot = 0; slot < this.arrayCapacity; ++slot) { writeValue(cursor, this.valueAt(slot)); cursor += CPU_SNAPSHOT_VALUE_WORDS; }
		for (let index = 0; index < this.hashSize; ++index) {
			writeValue(cursor, this.valueAt(this.hashKeySlot(index))); writeValue(cursor + CPU_SNAPSHOT_VALUE_WORDS, this.valueAt(this.hashValueSlot(index)));
			snapshot.setWord(cursor + 2 * CPU_SNAPSHOT_VALUE_WORDS, this.hashNext[index]); cursor += 2 * CPU_SNAPSHOT_VALUE_WORDS + 1;
		}
		return offset;
	}
	public restoreSnapshot(reader: CpuSnapshotReader, offset: number): void {
		const snapshot = reader.snapshot, array = snapshot.word(offset + CpuSnapshotTable.ArrayCapacity), hash = snapshot.word(offset + CpuSnapshotTable.HashSize);
		if (array !== this.arrayCapacity || hash !== this.hashSize) this.prepareRestoreStorage(array, hash);
		this.lengthHint = snapshot.word(offset + CpuSnapshotTable.LengthHint); this.hashFree = snapshot.int(offset + CpuSnapshotTable.HashFree);
		reader.readValue(offset + CpuSnapshotTable.Metatable);
		this.tableMetatable = reader.tag === ValueTag.Nil ? null : asTable(reader.value(), this.heap);
		let cursor = offset + CpuSnapshotTable.Data;
		for (let slot = 0; slot < this.arrayCapacity; ++slot) {
			reader.readValue(cursor); this.setEncoded(slot, reader.tag, reader.payload); cursor += CPU_SNAPSHOT_VALUE_WORDS;
		}
		for (let index = 0; index < this.hashSize; ++index) {
			reader.readValue(cursor); this.setEncoded(this.hashKeySlot(index), reader.tag, reader.payload);
			reader.readValue(cursor + CPU_SNAPSHOT_VALUE_WORDS); this.setEncoded(this.hashValueSlot(index), reader.tag, reader.payload);
			this.hashNext[index] = snapshot.int(cursor + 2 * CPU_SNAPSHOT_VALUE_WORDS); cursor += 2 * CPU_SNAPSHOT_VALUE_WORDS + 1;
		}
	}
	public getTrackedHeapBytes(): number { return Table.trackedHeapBytesForCapacities(this.arrayCapacity, this.hashSize); }
	public prepareRestoreStorage(array: number, hash: number): void {
		const bytes = this.getTrackedHeapBytes(); this.lengthHint = 0; this.allocateStorage(array, hash);
		this.heap.budget.adjustForRestore(bytes, this.getTrackedHeapBytes());
	}
}
