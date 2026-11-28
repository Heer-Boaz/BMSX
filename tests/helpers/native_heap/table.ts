import { TableHeader, TableLookupStatus } from '../../../machine/ts/machine/cpu/table';
export { TableHeader, TableLookupStatus };
import { TableRecords as PhysicalTableRecords } from '../../../machine/ts/machine/cpu/table';
import { RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { GC_OBJECT_PREFIX, GC_RECORD_LINK } from '../../../toolchain/ts/firmware/stock_object_layout';
import { ceilLog2, nextPowerOfTwo } from '../../../machine/ts/machine/common/numeric';
import { LUA_FAULT_REASON_INDEX_NAN, LUA_FAULT_REASON_INDEX_NIL } from '../../../machine/ts/spec/blua32/cop0';
import { LuaExecutionError } from '../../../machine/ts/machine/cpu/errors';
import { LuaAllocationRecovery } from './lua_heap';
import { GcDiagnosticField, gcPacedPhase, type GcHeap } from './gc_heap';
import type { StringId } from './string_pool';
import {
	ValueTag, asInteger, canonicalTableKey, isNil, hashCanonicalTableKey, valueFromTag, valueInteger,
	valueIsNaN, valuePayload, valueString, valueTable, valueTag, valueTagIsStorageReference, type Value,
} from '../../../machine/ts/machine/cpu/value';

const TABLE_HASH_NEXT_END = -1;
const TABLE_MAX_ARRAY_INDEX = 0x7fffffff;
const TABLE_HASH_SLOT_BUDGET_BYTES = 10;
// A fixed-string Store carries an unprobed, absent (-1), or matched hash node,
// including a matched tombstone.
export const TABLE_HASH_UNPROBED = -2;
export const HASH_STORE_DECLINED = -3;
// Declined guest stores return this base minus the resolved placement:
// -2 array, -1 unmatched hash, or the nonnegative matched hash node.
export const TABLE_STORE_FIRMWARE = -5;
export const TABLE_INDEX_CHAIN_LIMIT = 32;
type TableLookupSlot = { value: Value; slot: number };
export type TableLookupResult = TableLookupSlot & { extraVisits: number; status: TableLookupStatus; receiver: number };
type StoredValuePredicate = (value: Value) => boolean;
export interface TableStringProbe extends TableLookupSlot { node: number; remaining: number }
class ArrayDensity { scanned = 0; live = 0; slots = 0; kept = 0; }
export class TableRecords extends PhysicalTableRecords {
	private readonly directDensity = new ArrayDensity();
	private readonly resizePlan = { array: 0, hash: 0, keepHash: false };
	private static readonly rehashIntegerCounts = new Uint32Array(32);
	public constructor(protected readonly heap: GcHeap, cop0: Uint32Array) { super(heap.memory, cop0); }
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
	private setHashNext(links: number, count: number, node: number, next: number): void {
		if (count <= 128) this.heap.memory.writeRamRecordByte(links + node, next);
		else this.heap.memory.writeRamRecordWord(links + node * 4, next);
	}
	public setMetatableAddress(record: number, address: number): void {
		this.heap.writeBarrier(record, GC_RECORD_LINK);
		this.writeHeader(record, TableHeader.Metatable, address);
	}
	private hashFree(record: number): number { return this.readHeader(record, TableHeader.Free) | 0; }
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
	public setInteger(record: number, index: number, value: Value): void { this.set(record, valueInteger(index), value); }
	public storeInteger(record: number, index: number, tag: ValueTag, word: number): void { this.set(record, valueInteger(index), valueFromTag(tag, word)); }
	public set(record: number, key: Value, value: Value): number {
		return this.setOwn(record, canonicalTableKey(key), value, TABLE_HASH_UNPROBED, false);
	}
	private setOwn(record: number, key: Value, value: Value, resolved: number, directOnly: boolean): number {
		if (isNil(key)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
		if (valueIsNaN(key)) throw new LuaExecutionError(LUA_FAULT_REASON_INDEX_NAN);
		const tag = valueTag(value);
		const slot = this.getArrayIndex(key), array = this.arrayCapacity(record);
		if (slot >= 0 && slot < array) {
			const word = valuePayload(value);
			if (valueTagIsStorageReference(tag)) {
				if (directOnly) return TABLE_STORE_FIRMWARE + 2;
				this.heap.writeTableAssignment(record, tag, word);
			}
			const words = this.arrayAddress(record);
			this.writeSlot(words, words + array * 4, slot, tag, word); this.updateLengthHint(record, slot, tag !== ValueTag.Nil); return -1;
		}
		const node = this.setHashReference(record, key, value, resolved, directOnly);
		if (node >= -1 && slot >= 0) this.updateLengthHint(record, slot, tag !== ValueTag.Nil);
		return node;
	}
	private setHashReference(record: number, key: Value, value: Value, resolved = TABLE_HASH_UNPROBED,
		directOnly = false, extraHashSlots = 0): number {
		const tag = valueTag(value), word = valuePayload(value);
		if (tag === ValueTag.Nil) return this.removeFromHashReference(record, key, resolved, directOnly);
		const keyTag = valueTag(key), keyWord = valuePayload(key);
		const hash = this.hashSize(record), words = this.hashAddress(record), tags = words + 8 * hash;
		const memory = this.heap.memory;
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
				if (valueTagIsStorageReference(tag)) {
					if (directOnly) return TABLE_STORE_FIRMWARE - index;
					this.heap.writeTableAssignment(record, tag, word);
				}
				this.writeSlot(words, tags, valueSlot, tag, word);
				return index;
			}
		}
		if (directOnly) return TABLE_STORE_FIRMWARE - index;
		if (hash !== 0) {
			if (index >= 0) {
				this.writeSlot(words, tags, index, keyTag, keyWord);
				this.writeSlot(words, tags, index + hash, tag, word);
			} else {
				if (resolved !== TABLE_HASH_UNPROBED) home = hashCanonicalTableKey(key) & (hash - 1);
				index = this.insertHashWithoutGrowth(record, home, key, value, hash, words, tags, false);
			}
			if (index >= 0) {
				this.adjustHashLive(words, hash, 1);
				this.adjustIntegerBand(words, hash, keyTag, keyWord, 1);
				this.publishHashInsertion(record, key, tag, word);
				return index;
			}
		}
		index = this.insertHashWithAdmission(record, key, value, extraHashSlots);
		// resize() invalidates an outstanding scan; relocated old edges keep their marks.
		this.publishHashInsertion(record, key, tag, word);
		return index;
	}
	private publishHashInsertion(record: number, key: Value, tag: ValueTag, word: number): void {
		if (valueTag(key) === ValueTag.String && valuePayload(key) === this.heap.diagnosticWord(GcDiagnosticField.NewIndex)) this.heap.memory.writeRamRecordByte(record + TableHeader.NewIndexAbsent, 0);
		this.heap.writeTableAssignment(record, tag, word, key);
	}
	public store(record: number, keyTag: ValueTag, keyWord: number, tag: ValueTag, word: number): void {
		this.set(record, valueFromTag(keyTag, keyWord), valueFromTag(tag, word));
	}
	public setStringKey(record: number, key: StringId, value: Value): void { this.setHashReference(record, valueString(key), value); }
	public storeStringKey(record: number, key: StringId, tag: ValueTag, word: number,
		resolved = TABLE_HASH_UNPROBED, extraHashSlots = 0): number {
		return this.setHashReference(record, valueString(key), valueFromTag(tag, word), resolved, false, extraHashSlots);
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
		const tag = this.eraseHashNode(record, index);
		if (tag === ValueTag.String && this.wordAt(record, index) === this.heap.diagnosticWord(GcDiagnosticField.NewIndex))
			this.heap.memory.writeRamRecordByte(record + TableHeader.NewIndexAbsent, 1);
	}
	private removeFromHashReference(record: number, key: Value, resolved: number, directOnly: boolean): number {
		const index = resolved === TABLE_HASH_UNPROBED ? this.findNodeIndex(record, key) : resolved;
		if (index < 0) return -1;
		const tag = this.tagAt(record, this.hashValueSlot(record, index));
		if (tag === ValueTag.Nil || tag === ValueTag.DeadKey) return -1;
		// Only firmware compares the method key when the owner has no absence proof.
		if (directOnly && valueTag(key) === ValueTag.String
			&& this.heap.memory.readRamRecordByte(record + TableHeader.NewIndexAbsent) !== 1) return TABLE_STORE_FIRMWARE - index;
		if (directOnly) this.eraseHashNode(record, index);
		else this.markHashNodeDead(record, index);
		return -1;
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
	private insertHashWithAdmission(record: number, key: Value, value: Value, extraHashSlots: number): number {
		const budget = this.heap.budget, owner = valueTable(record), plan = this.resizePlan;
		const array = this.arrayCapacity(record), hash = this.hashSize(record);
		const previous = TableRecords.allocationCharge(array, hash);
		let recovery = LuaAllocationRecovery.CurrentOrFresh;
		for (;;) {
			this.planRehash(record, key, extraHashSlots);
			const requested = TableRecords.allocationCharge(plan.array, plan.hash);
			const admitted = requested <= previous || (recovery !== LuaAllocationRecovery.CurrentOrFresh
				? budget.usedBytes() + requested - previous <= budget.capacity()
				: budget.prepareAllocation(requested - previous, owner, key, value));
			if (admitted) {
				const bytes = TableRecords.storageBytes(plan.array > array ? plan.array : 0, plan.keepHash ? 0 : plan.hash);
				if (gcPacedPhase(this.heap.phase())) this.heap.assistBeforeReservation(bytes, owner, key, value);
				const slot = this.resize(record, key, value, previous, requested);
				if (slot !== HASH_STORE_DECLINED) return slot;
			}
			if (extraHashSlots) {
				extraHashSlots = 0;
				continue;
			}
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
	private resize(record: number, key: Value, value: Value, previous: number, requested: number): number {
		const { array, hash, keepHash } = this.resizePlan;
		const oldArray = this.arrayCapacity(record), oldHash = this.hashSize(record);
		const oldWords = this.hashAddress(record), oldTags = oldWords + oldHash * 8;
		const memory = this.heap.memory, arena = this.heap.arena;
		const oldBase = this.arrayAddress(record);
		const storage = keepHash ? oldWords : hash ? arena.allocate(TableRecords.hashStorageBytes(hash), true) : 0;
		if (hash && !storage) return HASH_STORE_DECLINED;
		let base = oldBase;
		if (array > oldArray) {
			base = !oldBase ? arena.allocate(array * 5, true) : arena.resizeBacking(oldBase, array * 5);
			if (!base) {
				if (storage && !keepHash) arena.free(storage);
				return HASH_STORE_DECLINED;
			}
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
	public clear(record: number): void {
		this.heap.tableEntriesMoved(record);
		this.writeHeader(record, TableHeader.Length, 0);
		this.heap.memory.writeRamRecordByte(record + TableHeader.NewIndexAbsent, 1);
		this.freeStorage(record);
		this.bindHash(record, 0, 0);
		this.writeHeader(record, TableHeader.Array, 0);
		this.writeHeader(record, TableHeader.ArrayStorage, 0);

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
	public getTrackedHeapBytes(record: number): number {
		const storage = this.hashAddress(record), array = this.arrayAddress(record);
		return (array ? this.heap.arena.allocationBytes(array) : 0) + this.heap.arena.allocationBytes(record - GC_OBJECT_PREFIX)
			+ (storage !== 0 ? this.heap.arena.allocationBytes(storage) : 0);
	}
}
