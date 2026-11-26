#include "machine/cpu/cpu.h"

namespace bmsx {

// The old header and links remain readable until retirement. The destination
// is owned by the pending instruction, not by the collector or guest table.
void TableRecord::advanceRebuild(CPU& cpu) {
	int& cycles = cpu.instructionBudgetRemaining;
	if (cycles <= 0) return;
	auto& j = cpu.tableRebuild;
	const auto src = hashBodyAt(j.source, j.count), dst = hashBodyAt(j.storage, j.capacity);
	const u32 mask = j.capacity - 1u, bytes = hashNodeBytes(j.capacity);
	const u32 oldArray = arrayCapacity(), array = j.arrayStorage ? j.arraySlots : oldArray;
	u8* words = m_memory->ramData() + ((j.arrayStorage ? j.arrayStorage : arrayAddress()) & RAM_RECORD_WORD_MASK);
	const ValueSlots<false> arr{m_memory, words, words + 4u * array};
	const u32 trigger = arraySlot(j.key);
	if (j.arrayCleared < 5u * j.arraySlots) {
		const u32 left = 5u * j.arraySlots - j.arrayCleared;
		const u32 n = std::min(left, 16u * std::min(static_cast<u32>(cycles), (left + 15u) / 16u));
		const u32 end = j.arrayCleared + n;
		if (!oldArray) std::fill_n(words + j.arrayCleared, n, u8{0});
		else {
			const auto old = values();
			for (u32 at = j.arrayCleared; at < end;) {
				const u32 next = std::min(end, at < oldArray * 4u ? oldArray * 4u : at < array * 4u ? array * 4u
					: at < array * 4u + oldArray ? array * 4u + oldArray : 5u * array);
				if (at < oldArray * 4u) std::copy_n(old.words + at, next - at, words + at);
				else if (at >= array * 4u && at < array * 4u + oldArray)
					std::copy_n(old.tags + (at - array * 4u), next - at, words + at);
				else std::fill_n(words + at, next - at, u8{0});
				at = next;
			}
		}
		m_memory->invalidateRamWrite((j.arrayStorage & RAM_RECORD_WORD_MASK) + j.arrayCleared, n);
		j.arrayCleared += n;
		cycles -= static_cast<int>((n + 15u) / 16u);
		if (j.arrayCleared < 5u * j.arraySlots || (cycles == 0 && j.cleared < bytes)) return;
	}
	if (j.cleared < bytes) {
		const u32 n = std::min(bytes - j.cleared, 16u * std::min(static_cast<u32>(cycles), (bytes + 15u) / 16u));
		const u32 end = j.cleared + n;
		const u32 split = std::clamp(10u * j.capacity, j.cleared, end);
		std::fill(dst.slots.words + j.cleared, dst.slots.words + split, u8{0});
		std::fill(dst.slots.words + split, dst.slots.words + end, u8{0xff});
		m_memory->invalidateRamWrite((j.storage & RAM_RECORD_WORD_MASK) + j.cleared, n);
		j.cleared = end;
		cycles -= static_cast<int>((n + 15u) / 16u);
		if (end < bytes) return;
		const u32 home = hashCanonicalTableKey(j.key) & mask;
		if (j.capacity > HASH_CENSUS_LIMIT) {
			dst.setLive((j.count > HASH_CENSUS_LIMIT ? src.live() : 0u) + (trigger >= array));
			if (j.capacity >= HASH_BAND_CAPACITY) {
				const u32 target = (dst.liveAddress() + 4u) & RAM_RECORD_WORD_MASK;
				std::fill_n(m_memory->ramData() + target, 32u * 4u, u8{0});
				m_memory->invalidateRamWrite(target, 32u * 4u);
				if (trigger >= array) dst.adjustIntegerBand(j.key, 1);
			}
		}
		if (trigger >= array) {
			dst.slots.set(home, j.key);
			dst.slots.set(j.capacity + home, j.value);
		}
	}
	while (j.homes < j.count && cycles > 0) {
		const u32 i = j.homes++;
		cycles -= 8;
		const Value k = src.slots.get(i), v = src.slots.get(j.count + i);
		if (isNil(k) || isNil(v)) continue;
		if (valueIsInteger(k) && arraySlot(asInteger(k)) < array) {
			arr.set(arraySlot(asInteger(k)), v);
			if (j.count > HASH_CENSUS_LIMIT && j.capacity > HASH_CENSUS_LIMIT) dst.setLive(dst.live() - 1u);
			continue;
		}
		if (j.count <= HASH_CENSUS_LIMIT && j.capacity > HASH_CENSUS_LIMIT) dst.setLive(dst.live() + 1u);
		dst.adjustIntegerBand(k, 1);
		const u32 home = hashCanonicalTableKey(k) & mask;
		if (dst.slots.tag(home) == ValueTag::Nil) {
			dst.slots.set(home, k);
			dst.slots.set(j.capacity + home, v);
		} else ++j.collisions;
	}
	if (j.homes < j.count) return;
	while (j.collisions && j.cursor < j.count && cycles > 0) {
		cycles -= 8;
		const u32 i = j.cursor;
		const Value k = src.slots.get(i), v = src.slots.get(j.count + i);
		if (!isNil(k) && !isNil(v) && !(valueIsInteger(k) && arraySlot(asInteger(k)) < array)) {
			const u32 home = hashCanonicalTableKey(k) & mask;
			if (dst.slots.get(home) != k) {
				const u32 free = j.free-- & mask;
				if (dst.slots.tag(free) != ValueTag::Nil) continue;
				dst.slots.set(free, k);
				dst.slots.set(j.capacity + free, v);
				dst.setNext(free, dst.next(home));
				dst.setNext(home, free);
				--j.collisions;
			}
		}
		++j.cursor;
	}
	if (j.collisions && j.cursor < j.count) return;
	m_heap->tableEntriesMoved(m_address);
	const u32 oldHash = hashSlots();
	if (j.arrayStorage) {
		if (oldArray) m_heap->arena.free(arrayAddress());
		writeHeader(TableHeader::ArrayStorage, j.arrayStorage);
		writeHeader(TableHeader::Array, array);
	}
	if (trigger < array) arr.set(trigger, j.value);
	if (j.source || j.storage) {
		bindHash(j.capacity, j.storage);
		if (j.free != mask) writeHeader(TableHeader::Free, j.free);
	}
	m_heap->budget.replaceRecord(j.source, allocationCharge(oldArray, oldHash), allocationCharge(array, hashSlots()));
	publishHashInsertion(j.key, j.value);
	const u32 index = arraySlot(j.key);
	if (index != NO_ARRAY_SLOT) updateLengthHint(index, true);
	j.record = 0;
}
} // namespace bmsx
