#include "machine/cpu/cpu.h"
#include <cstring>

namespace bmsx {

int TableRecord::advanceRebuild(TableRebuild& j, int cycles) {
	if (cycles <= 0) return cycles;
	const auto src = hashBodyAt(j.source, j.count), dst = hashBodyAt(j.storage, j.capacity);
	const u32 mask = j.capacity - 1u, bytes = hashNodeBytes(j.capacity);
	const u32 oldArray = arrayCapacity(), array = j.arrayStorage ? j.arraySlots : oldArray;
	u8* words = m_memory->ramData() + ((j.arrayStorage ? j.arrayStorage : arrayAddress()) & RAM_RECORD_WORD_MASK);
	const ValueSlots<false> arr{m_memory, words, words + 4u * array};
	const u32 trigger = arraySlot(j.key);
	const u32 oldBase = arrayAddress();
	const bool inPlace = j.arrayStorage && j.arrayStorage == oldBase;
	const bool shrinking = array < oldArray;
	const u32 sources = j.count + (shrinking ? oldArray - array : 0u);
	const u32 transfer = shrinking ? 0u : 5u * j.arraySlots - (inPlace ? 4u * oldArray : 0u);
	if (j.arrayCleared < transfer) {
		const u32 left = transfer - j.arrayCleared;
		const u32 n = std::min(left, 16u * std::min(static_cast<u32>(cycles), (left + 15u) / 16u));
		const u32 end = j.arrayCleared + n;
		if (inPlace) {
			// The tag planes can overlap. Move from the high end first, then clear the two extensions.
			const u32 payloadEnd = transfer - (array - oldArray);
			for (u32 at = j.arrayCleared; at < end;) {
				const u32 next = std::min(end, at < oldArray ? oldArray : at < payloadEnd ? payloadEnd : transfer);
				const u32 dest = at < oldArray ? 4u * array + oldArray - next :
					at < payloadEnd ? 4u * oldArray + at - oldArray : 4u * array + oldArray + at - payloadEnd;
				if (at < oldArray) std::memmove(words + dest, words + 4u * oldArray + oldArray - next, next - at);
				else std::fill_n(words + dest, next - at, u8{0});
				m_memory->invalidateRamWrite((oldBase & RAM_RECORD_WORD_MASK) + dest, next - at);
				at = next;
			}
		} else if (!oldArray) std::fill_n(words + j.arrayCleared, n, u8{0});
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
		if (!inPlace) m_memory->invalidateRamWrite((j.arrayStorage & RAM_RECORD_WORD_MASK) + j.arrayCleared, n);
		j.arrayCleared += n;
		cycles -= static_cast<int>((n + 15u) / 16u);
		if (j.arrayCleared < transfer || (cycles == 0 && j.cleared < bytes)) return cycles;
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
		if (end < bytes) return cycles;
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
	// Hash slots precede the vanishing array slice in both placement passes.
	const ValueSlots<false> oldValues{m_memory, words, words + 4u * oldArray};
	const auto source = [&](u32 i) -> std::pair<Value, Value> {
		if (i < j.count) return {src.slots.get(i), src.slots.get(j.count + i)};
		const u32 slot = array + (i - j.count);
		return {valueInteger(static_cast<i32>(slot + 1)), oldValues.get(slot)};
	};
	const auto skipEmptyTail = [&](u32& i) {
		const u32 left = sources - i;
		const u32 limit = std::min(left, 4u * std::min(static_cast<u32>(cycles), (left + 3u) / 4u));
		const u8* tags = oldValues.tags + (array + i - j.count);
		u32 n = 0;
		while (n < limit && !tags[n]) ++n;
		i += n; cycles -= static_cast<int>((n + 3u) / 4u);
		return n != 0;
	};
	while (j.homes < sources && cycles > 0) {
		if (j.homes >= j.count && skipEmptyTail(j.homes)) continue;
		const u32 i = j.homes++;
		cycles -= 8;
		const auto [k, v] = source(i);
		if (isNil(k) || isNil(v)) continue;
		if (valueIsInteger(k) && arraySlot(asInteger(k)) < array) {
			arr.set(arraySlot(asInteger(k)), v);
			if (j.count > HASH_CENSUS_LIMIT && j.capacity > HASH_CENSUS_LIMIT) dst.setLive(dst.live() - 1u);
			continue;
		}
		if ((i >= j.count || j.count <= HASH_CENSUS_LIMIT) && j.capacity > HASH_CENSUS_LIMIT) dst.setLive(dst.live() + 1u);
		dst.adjustIntegerBand(k, 1);
		const u32 home = hashCanonicalTableKey(k) & mask;
		if (dst.slots.tag(home) == ValueTag::Nil) {
			dst.slots.set(home, k);
			dst.slots.set(j.capacity + home, v);
		} else ++j.collisions;
	}
	if (j.homes < sources) return cycles;
	while (j.collisions && j.cursor < sources && cycles > 0) {
		if (j.cursor >= j.count && skipEmptyTail(j.cursor)) continue;
		cycles -= 8;
		const u32 i = j.cursor;
		const auto [k, v] = source(i);
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
	if (j.collisions && j.cursor < sources) return cycles;
	if (shrinking && j.arrayCleared < array) {
		if (cycles <= 0) return cycles;
		const u32 left = array - j.arrayCleared;
		const u32 n = std::min(left, 16u * std::min(static_cast<u32>(cycles), (left + 15u) / 16u));
		const u32 dest = 4u * array + j.arrayCleared;
		std::memmove(words + dest, oldValues.tags + j.arrayCleared, n);
		m_memory->invalidateRamWrite((oldBase & RAM_RECORD_WORD_MASK) + dest, n);
		j.arrayCleared += n;
		cycles -= static_cast<int>((n + 15u) / 16u);
		if (j.arrayCleared < array) return cycles;
	}
	m_heap->tableEntriesMoved(m_address);
	const u32 oldHash = hashSlots();
	if (j.arrayStorage) {
		if (shrinking && array) m_heap->arena.shrinkBacking(oldBase, 5u * array);
		else if (!array || (oldArray && !inPlace)) m_heap->arena.free(oldBase);
		writeHeader(TableHeader::ArrayStorage, array ? j.arrayStorage : 0u);
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
	return cycles;
}
} // namespace bmsx
