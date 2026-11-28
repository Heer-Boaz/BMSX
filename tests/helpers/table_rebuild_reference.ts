import { RAM_RECORD_WORD_MASK } from '../../machine/ts/spec/bmsx/memory_map';
import { type GcHeap, GcDiagnosticField } from './native_heap/gc_heap';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { ValueTag, hashCanonicalTableKey, valueFromTag, valueNil, valuePayload, valueTag } from '../../machine/ts/machine/cpu/value';

// Frozen host oracle for the original staged growth loop. The CPU no longer
// owns a resize job, its admission, or any of this progress in production.
export class TableRebuildReference {
	scanned = 0; live = 0; slots = 0; kept = 0;
	record = 0; source = 0; count = 0; storage = 0; capacity = 0;
	arrayStorage = 0; arraySlots = 0; arrayCleared = 0;
	cleared = 0; homes = 0; cursor = 0; free = 0; collisions = 0;
	key = valueNil(); value = valueNil();
}

// Pinned native spendCensusGrant, 3c4f901cbd0343dfcce3e0c3c0ea78486a56a481:table.ts:685–689.
export function spendTableCensusReference(heap: GcHeap, record: number, capacity: number, density: TableRebuildReference, cycles: number): number {
	const paidStart = Math.max(density.scanned, 64), n = Math.min(capacity - paidStart, 4 * Math.max(0, cycles));
	heap.tables['countArrayRange'](record, capacity, density, paidStart + n);
	return cycles - ((n + 3) >>> 2);
}

function emptyTailSlots(ram: Uint8Array, tagOffset: number, remaining: number, cycles: number): number {
	const limit = Math.min(remaining, cycles * 4);
	let n = 0;
	while (n < limit && !ram[tagOffset + n]) ++n;
	return n;
}

export function advanceTableRebuildReference(heap: GcHeap, j: TableRebuildReference, cycles: number): number {
	if (cycles <= 0) return cycles;
	const { memory, tables } = heap;
	const tags = j.storage + 8 * j.capacity, oldTags = j.source + 8 * j.count;
	const mask = j.capacity - 1, bytes = TableRecords['hashNodeBytes'](j.capacity);
	const oldArray = tables.arrayCapacity(j.record), array = j.arrayStorage ? j.arraySlots : oldArray;
	const oldBase = tables.arrayAddress(j.record), base = j.arrayStorage || oldBase, trigger = tables['getArrayIndex'](j.key) >>> 0;
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
			const source = tables.arrayAddress(j.record) & RAM_RECORD_WORD_MASK;
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
				if (trigger >= array) tables['adjustIntegerBand'](j.storage, j.capacity, valueTag(j.key), valuePayload(j.key), 1);
			}
		}
		const home = hashCanonicalTableKey(j.key) & mask;
		if (trigger >= array) {
			tables['writeSlot'](j.storage, tags, home, valueTag(j.key), valuePayload(j.key));
			tables['writeSlot'](j.storage, tags, j.capacity + home, valueTag(j.value), valuePayload(j.value));
		}
	}
	while (j.homes < sources && cycles > 0) {
		const slot = array + j.homes - j.count;
		if (j.homes >= j.count) {
			const n = emptyTailSlots(memory.ramData(), (oldBase & RAM_RECORD_WORD_MASK) + 4 * oldArray + slot, sources - j.homes, cycles);
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
			tables['writeSlot'](base, base + 4 * array, index, vt, vw);
			if (j.count > TableRecords.HASH_CENSUS_LIMIT) tables['adjustHashLive'](j.storage, j.capacity, -1);
			continue;
		}
		if (tail || j.count <= TableRecords.HASH_CENSUS_LIMIT) tables['adjustHashLive'](j.storage, j.capacity, 1);
		tables['adjustIntegerBand'](j.storage, j.capacity, kt, kw, 1);
		const home = hashCanonicalTableKey(valueFromTag(kt, kw)) & mask;
		if (memory.readRamRecordByte(tags + home) === ValueTag.Nil) {
			tables['writeSlot'](j.storage, tags, home, kt, kw);
			tables['writeSlot'](j.storage, tags, j.capacity + home, vt, vw);
		} else ++j.collisions;
	}
	if (j.homes < sources) return cycles;
	const links = tags + 2 * j.capacity;
	while (j.collisions && j.cursor < sources && cycles > 0) {
		const slot = array + j.cursor - j.count;
		if (j.cursor >= j.count) {
			const n = emptyTailSlots(memory.ramData(), (oldBase & RAM_RECORD_WORD_MASK) + 4 * oldArray + slot, sources - j.cursor, cycles);
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
				tables['writeSlot'](j.storage, tags, free, kt, kw);
				tables['writeSlot'](j.storage, tags, j.capacity + free, vt, memory.readRamRecordWord(valueAddress));
				tables['setHashNext'](links, j.capacity, free, tables['hashNext'](links, j.capacity, home));
				tables['setHashNext'](links, j.capacity, home, free);
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
	heap.tableEntriesMoved(j.record);
	const oldHash = tables.hashSize(j.record);
	if (j.arrayStorage) {
		if (shrinking && array) heap.arena.shrinkBacking(oldBase, 5 * array);
		else if (!array || (oldArray && !inPlace)) heap.arena.free(oldBase);
		tables['writeHeader'](j.record, TableHeader.ArrayStorage, array ? base : 0);
		tables['writeHeader'](j.record, TableHeader.Array, array);
	}
	if (trigger < array) tables['writeSlot'](base, base + 4 * array, trigger, valueTag(j.value), valuePayload(j.value));
	if (j.source || j.storage) {
		tables['bindHash'](j.record, j.capacity, j.storage);
		if (j.free !== mask) tables['writeHeader'](j.record, TableHeader.Free, j.free);
	}
	heap.budget.replaceRecord(j.source, TableRecords.allocationCharge(oldArray, oldHash), TableRecords.allocationCharge(array, tables.hashSize(j.record)));
	if (valueTag(j.key) === ValueTag.String && valuePayload(j.key) === heap.diagnosticWord(GcDiagnosticField.NewIndex)) memory.writeRamRecordByte(j.record + TableHeader.NewIndexAbsent, 0);
	heap.writeTableAssignment(j.record, valueTag(j.value), valuePayload(j.value), j.key);
	const index = tables['getArrayIndex'](j.key);
	if (index >= 0) tables['updateLengthHint'](j.record, index, true);
	j.record = 0;
	return cycles;
}
