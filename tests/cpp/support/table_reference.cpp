#include "machine/cpu/table.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cstring>

#include "common/count_nonzero.h"
#include "machine/common/numeric.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/table_hash_lookup.inl"

namespace bmsx {

namespace {
constexpr int32_t kTableHashNextEnd = -1;
// A reserved hash slot charges two language Values, not its collision link.
constexpr u32 kHashSlotBudgetBytes = 10u;
} // namespace

void TableRecord::setMetatableAddress(u32 address) {
	m_heap->writeBarrier(m_address, GC_RECORD_LINK);
	writeHeader(TableHeader::Metatable, address);
}

void TableRecord::removeFromHash(const Value& key, int slot) {
	const int existingIndex = slot == TABLE_HASH_UNPROBED ? findNodeIndex(key) : slot;
	if (existingIndex < 0) return;
	const u32 count = hashSlots();
	const auto tag = hashBody(count).slots.tag(count + static_cast<u32>(existingIndex));
	if (tag == ValueTag::Nil || tag == ValueTag::DeadKey) return;
	markHashNodeDead(static_cast<size_t>(existingIndex));
}

void TableRecord::markHashNodeDead(size_t index) {
	const auto body = hashBody(hashSlots());
	const Value key = body.slots.get(index);
	eraseHashNode(body, index, key);
	if (valueIsString(key) && valuePayload(key) == m_heap->diagnosticWord(GcDiagnosticField::NewIndex))
		m_memory->writeRamRecordByte(m_address + TABLE_NEW_INDEX_ABSENT_BYTE, 1u);
}

u32 TableRecord::storageBytes(size_t arraySize, size_t hashSize) {
	return static_cast<u32>(5u * arraySize + hashStorageBytes(hashSize));
}

u32 TableRecord::allocationCharge(size_t arraySize, size_t hashSize) {
	return static_cast<u32>(5u * arraySize + kHashSlotBudgetBytes * hashSize);
}

size_t TableRecord::hashCapacity(int hashSize) {
	return hashSize > 0
		? nextPowerOfTwo(static_cast<size_t>(hashSize))
		: 0;
}

template<bool BulkWrite>
int TableRecord::HashStorage<BulkWrite>::findFreeIndex(int first) const {
	for (int i = first; i >= 0; --i) {
		const u32 keySlot = static_cast<u32>(i);
		if (slots.tag(keySlot) == ValueTag::Nil && slots.tag(keySlot + count) == ValueTag::Nil) {
			return i;
		}
	}
	return -1;
}

TableRecord::ResizePlan TableRecord::planRehash(Value key, u8 extraHashSlots) const {
	const auto body = hashBody(hashSlots());
	const auto& slots = body.slots;
	const u32 added = valueIsInteger(key) ? arraySlot(asInteger(key)) : NO_ARRAY_SLOT;
	if (added == NO_ARRAY_SLOT) {
		// A hash-only addition never repartitions the reserved array.
		if (body.count > HASH_CENSUS_LIMIT)
			return {arrayCapacity(), nextPowerOfTwo(body.live() + 1u + extraHashSlots), false};
		size_t live = 1u + extraHashSlots;
		for (u32 i = 0; i < body.count; ++i) {
			if (slots.tag(i) != ValueTag::Nil && slots.tag(i + body.count) != ValueTag::Nil) ++live;
		}
		return {arrayCapacity(), nextPowerOfTwo(live), false};
	}
	const u32 capacity = arrayCapacity();
	if (!capacity && !body.count) {
		// Only index 1 is dense enough by itself to select an array.
		return added == 0 ? ResizePlan{1, 0, true} : ResizePlan{0, 1, false};
	}
	// Only keys beyond the current array can enter it from the hash.
	// Below that boundary the largest dense power and its population are final.
	const auto tags = values().tags;
	static_assert(static_cast<u8>(ValueTag::Nil) == 0);
	u32 denseSlots = 0u, denseKeys = 0u, live = 0u;
	for (u32 cursor = 0u; cursor < capacity;) {
		const u32 power = 1u << std::bit_width(cursor), stop = std::min(capacity, power);
		live += countNonzeroBytes(tags + cursor, stop - cursor);
		cursor = stop;
		if (stop == power && live > power / 2u) { denseSlots = power; denseKeys = live; }
	}
	size_t totalKeys = live;
	u32 firstHashArraySlot = NO_ARRAY_SLOT;
	std::array<u32, 32> counts{};
	size_t countBins = capacity ? 1u + std::bit_width(capacity - 1u) : 0u;
	auto countIntegerKey = [&counts, &countBins](size_t index) {
		const size_t log = ceilLog2(index);
		countBins = std::max(countBins, log + 1);
		++counts[log];
	};
	if (body.count >= HASH_BAND_CAPACITY) {
		totalKeys += body.live();
		for (u32 bin = 0; bin < counts.size(); ++bin) {
			const u32 n = m_memory->readRamRecordWord(body.liveAddress() + 4u * (1u + bin));
			if (!n) continue;
			counts[bin] += n;
			countBins = std::max(countBins, size_t(bin + 1u));
			// Plans choose power-of-two boundaries, so the band's lower edge suffices.
			firstHashArraySlot = std::min(firstHashArraySlot, bin ? 1u << (bin - 1u) : 0u);
		}
	} else for (u32 i = 0; i < body.count; ++i) {
		const u32 slot = i;
		const auto tag = slots.tag(slot);
		if (tag != ValueTag::Nil && slots.tag(slot + body.count) != ValueTag::Nil) {
			totalKeys += 1;
			if (tag == ValueTag::Integer) {
				const u32 index = arraySlot(static_cast<i32>(slots.word(slot)));
				if (index != NO_ARRAY_SLOT) {
					firstHashArraySlot = std::min(firstHashArraySlot, index);
					countIntegerKey(index + 1u);
				}
			}
		}
	}
	totalKeys += 1;
	countIntegerKey(added + 1u);

	size_t arraySize = denseSlots, arrayKeys = denseKeys, total = live;
	const size_t firstBin = std::bit_width(capacity);
	size_t power = size_t{1} << firstBin;
	for (size_t i = firstBin; i < countBins; ++i) {
		total += counts[i];
		if (total > power / 2) {
			arraySize = power;
			arrayKeys = total;
		}
		power <<= 1;
	}

	size_t hashKeys = totalKeys - arrayKeys;
	size_t hashSize = hashKeys > 0 ? nextPowerOfTwo(hashKeys) : 0;
	return {arraySize, hashSize, arraySize > arrayCapacity() && added < arraySize
		&& hashSize == body.count && firstHashArraySlot >= arraySize};
}

int TableRecord::commitHashPlan(const ResizePlan& plan, Value key, Value value, u32 previous, u32 requested) {
	const u32 oldArray = arrayCapacity(), oldBase = arrayAddress();
	if (GcHeap::pacedPhase(m_heap->phase()))
		m_heap->assistBeforeReservation(storageBytes(plan.array > oldArray ? plan.array : 0u, plan.keepHash ? 0u : plan.hash),
			valueTable(m_address), key, value);
	const u32 storage = plan.keepHash ? hashAddress() : plan.hash ? m_heap->arena.allocate(hashStorageBytes(plan.hash), true) : 0u;
	if (plan.hash && !storage) return HASH_STORE_DECLINED;
	u32 base = oldBase;
	if (plan.array > oldArray) {
		const u32 bytes = 5u * plan.array;
		base = !oldBase ? m_heap->arena.allocate(bytes, true) : m_heap->arena.resizeBacking(oldBase, bytes);
		if (!base) {
			if (storage && !plan.keepHash) m_heap->arena.free(storage);
			return HASH_STORE_DECLINED;
		}
	}
	return resize(plan, base, storage, key, value, previous, requested);
}

int TableRecord::insertHashWithAdmission(Value key, Value value, u8 extraHashSlots) {
	auto& budget = m_heap->budget;
	const u32 array = arrayCapacity(), hash = hashSlots();
	const u32 previous = allocationCharge(array, hash);
	const Value owner = valueTable(m_address);
	auto recovery = LuaAllocationRecovery::CurrentOrFresh;
	for (;;) {
		const auto plan = planRehash(key, extraHashSlots);
		const u32 requested = allocationCharge(plan.array, plan.hash);
		const bool admitted = requested <= previous || (recovery != LuaAllocationRecovery::CurrentOrFresh
			? budget.usedBytes() + requested - previous <= budget.capacity()
			: budget.prepareAllocation(requested - previous, owner, key, value));
		if (admitted) {
			const int slot = commitHashPlan(plan, key, value, previous, requested);
			if (slot != HASH_STORE_DECLINED) return slot;
		}
		if (extraHashSlots) {
			extraHashSlots = 0;
			continue;
		}
		recovery = m_heap->recoverAllocation(recovery, owner, key, value);
		if (hash != 0u) {
			const auto body = hashBody(hash);
			const u32 home = hashCanonicalTableKey(key) & (hash - 1u);
			const int slot = insertHashWithoutGrowth(body, home, key, value);
			if (slot >= 0) return slot;
		}
	}
}

int TableRecord::resize(const ResizePlan& plan, u32 base, u32 storage, Value key, Value value, u32 previous, u32 requested) {
	const auto [newArraySize, newHashSize, keepHash] = plan;
	const size_t oldArraySize = arrayCapacity(), oldHashSize = hashSlots();
	m_heap->tableEntriesMoved(m_address);
	const u32 oldStorage = hashAddress();
	const auto oldValues = hashBodyAt(oldStorage, oldHashSize).slots;
	const auto body = hashBodyAt<true>(storage, newHashSize);
	writeHeader(TableHeader::Array, newArraySize);
	if (!keepHash) bindHash(newHashSize, storage);
	writeHeader(TableHeader::ArrayStorage, base);
	if (!keepHash) initializeHash(storage, newHashSize);
	if (oldHashSize > 64 && oldArraySize == newArraySize && !keepHash) {
		const int slot = rebuildHashOnly(hashBodyAt<true>(oldStorage, oldHashSize), body, key, value);
		m_heap->budget.replaceRecord(oldStorage, previous, requested);
		return slot;
	}
	const int firstFree = static_cast<int>(newHashSize) - 1;
	int nextFree = firstFree;
	u32 live = 0;
	if (oldArraySize != newArraySize) {
		u8* words = m_memory->ramData() + (base & RAM_RECORD_WORD_MASK);
		const ValueSlots<false> oldArray{m_memory, words, words + oldArraySize * 4u};
		for (size_t i = newArraySize; i < oldArraySize; ++i) {
			const Value prior = oldArray.get(i);
			if (!isNil(prior)) live += reinsertMapping(body, nextFree, valueInteger(static_cast<i32>(i + 1)), prior) >= 0;
		}
		const size_t keep = std::min(oldArraySize, newArraySize);
		std::memmove(words + newArraySize * 4u, oldArray.tags, keep);
		if (newArraySize) {
			initializeArray(base, newArraySize, keep);
			if (newArraySize < oldArraySize) m_heap->arena.resizeBacking(base, newArraySize * 5u);
		} else {
			m_heap->arena.free(base);
			writeHeader(TableHeader::ArrayStorage, 0u);
		}
	}
	for (size_t i = 0, n = keepHash ? 0 : oldHashSize; i < n; ++i) {
		const Value priorKey = oldValues.get(i), prior = oldValues.get(oldHashSize + i);
		if (!isNil(priorKey) && !isNil(prior)) live += reinsertMapping(body, nextFree, priorKey, prior) >= 0;
	}
	const int slot = reinsertMapping(body, nextFree, key, value);
	if (!keepHash && newHashSize > HASH_CENSUS_LIMIT) body.setLive(live + (slot >= 0));
	if (nextFree != firstFree) writeHeader(TableHeader::Free, static_cast<u32>(nextFree));
	m_heap->budget.replaceRecord(keepHash ? 0 : oldStorage, previous, requested);
	return slot;
}

// Reserve all chain heads before placing collisions. No displaced entry
// needs a predecessor search, and each free candidate is visited at most once.
int TableRecord::rebuildHashOnly(const RebuildBody& source, const RebuildBody& body, Value key, Value value) {
	const int firstFree = static_cast<int>(body.count) - 1;
	int nextFree = firstFree;
	const u32 mask = body.count - 1u;
	const u32 trigger = hashCanonicalTableKey(key) & mask;
	body.slots.set(trigger, key);
	body.slots.set(body.count + trigger, value);
	// The source links are retired; the slot planes alone describe the
	// mappings. Reuse that lane as a compact list of collided source slots.
	const u32 array = arrayCapacity();
	const auto arrayValues = values();
	u32 collisions = 0, live = 1;
	body.adjustIntegerBand(key, 1);
	for (u32 i = 0; i < source.count; ++i) {
		const Value k = source.slots.get(i), v = source.slots.get(source.count + i);
		if (isNil(k) || isNil(v)) continue;
		if (valueIsInteger(k) && arraySlot(asInteger(k)) < array) {
			arrayValues.set(arraySlot(asInteger(k)), v);
			continue;
		}
		++live;
		body.adjustIntegerBand(k, 1);
		const u32 home = hashCanonicalTableKey(k) & mask;
		if (body.slots.tag(home) == ValueTag::Nil) {
			body.slots.set(home, k);
			body.slots.set(body.count + home, v);
		} else {
			source.setNext(collisions++, i);
		}
	}
	if (collisions) m_memory->invalidateRamWrite(source.links & RAM_RECORD_WORD_MASK,
		collisions * (source.count <= BYTE_LINK_CAPACITY ? 1u : 4u));
	for (u32 c = 0; c < collisions; ++c) {
		const u32 i = source.next(c);
		const Value k = source.slots.get(i);
		const u32 home = hashCanonicalTableKey(k) & mask;
		while (body.slots.tag(nextFree) != ValueTag::Nil) --nextFree;
		const u32 dst = static_cast<u32>(nextFree--);
		body.slots.set(dst, k);
		body.slots.set(body.count + dst, source.slots.get(source.count + i));
		body.setNext(dst, body.next(home));
		body.setNext(home, dst);
	}
	if (nextFree != firstFree) writeHeader(TableHeader::Free, static_cast<u32>(nextFree));
	if (body.count > HASH_CENSUS_LIMIT) body.setLive(live);
	return static_cast<int>(trigger);
}

void TableRecord::bindHash(size_t hashSize, u32 address) {
	writeHeader(TableHeader::HashStorage, address);
	writeHeader(TableHeader::Hash, static_cast<u32>(hashSize));
	writeHeader(TableHeader::Free, static_cast<u32>(hashSize) - 1u);
}

void TableRecord::initializeArray(u32 address, u32 capacity, u32 retained) {
	if (!capacity) return;
	const u32 base = address & RAM_RECORD_WORD_MASK, first = base + retained * 4u;
	u8* ram = m_memory->ramData();
	std::fill(ram + first, ram + base + capacity * 4u, u8{0});
	std::fill(ram + base + capacity * 4u + retained, ram + base + capacity * 5u, u8{0});
	// The retained tags have already moved behind the resized payload plane.
	m_memory->invalidateRamWrite(first, capacity * 5u - retained * 4u);
}

void TableRecord::initializeHash(u32 address, u32 count) {
	if (!count) return;
	const u32 base = address & RAM_RECORD_WORD_MASK;
	u8* words = m_memory->ramData() + base;
	const u32 bytes = hashNodeBytes(count);
	std::fill(words, words + count * 10u, u8{0});
	std::fill(words + count * 10u, words + bytes, u8{0xff});
	u32 total = bytes;
	if (count > HASH_CENSUS_LIMIT) {
		total = hashStorageBytes(count);
		std::fill(words + bytes, words + total, u8{0});
	}
	m_memory->invalidateRamWrite(base, total);
}

void TableRecord::freeStorage() {
	const u32 storage = hashAddress();
	if (storage) m_heap->budget.releaseRecord(storage, allocationCharge(0, hashSlots()));
	if (const u32 base = arrayAddress()) m_heap->budget.releaseRecord(base, 5u * arrayCapacity());
}

void TableRecord::freeRecord() {
	freeStorage();
	m_heap->budget.releaseObject(m_address, HEADER_CHARGE);
}

namespace {
// Lua's chained hash insertion is shared by actual writes and by placing the
// fixed keys of a future fresh table. Both get exactly the same relocation,
// links and free cursor, including when two keys have the same home.
template <typename Body, typename TakeFree, typename Move>
int insertAbsentHashKey(const Body& body, u32 mainSlot, const Value& key, const Value& value,
	TakeFree takeFree, Move move) noexcept {
	const auto& slots = body.slots;
	const u32 count = body.count;
	const int mainIndex = static_cast<int>(mainSlot);
	const u32 keySlot = mainSlot, valueSlot = keySlot + count;
	const auto tag = slots.tag(keySlot);
	if (tag == ValueTag::Nil || slots.tag(valueSlot) == ValueTag::Nil) {
		slots.set(keySlot, key);
		slots.set(valueSlot, value);
		return mainIndex;
	}
	const Value mainKey = valueFromTag(tag, slots.word(keySlot));
	const int freeIndex = takeFree();
	if (freeIndex < 0) return -1;
	const u32 freeSlot = static_cast<u32>(freeIndex), freeKey = freeSlot;
	const int mainIndexOfOccupied = static_cast<int>(hashCanonicalTableKey(mainKey) & (count - 1u));
	if (mainIndexOfOccupied != mainIndex) {
		move();
		slots.set(freeKey, mainKey);
		slots.set(freeKey + count, slots.get(valueSlot));
		body.setNext(freeSlot, body.next(mainSlot));
		int prev = mainIndexOfOccupied;
		for (u32 remaining = count; remaining != 0u; --remaining) {
			const int next = body.next(static_cast<u32>(prev));
			if (next == mainIndex || next < 0) break;
			prev = next;
		}
		body.setNext(static_cast<u32>(prev), freeIndex);
		slots.set(keySlot, key);
		slots.set(valueSlot, value);
		body.setNext(mainSlot, kTableHashNextEnd);
		return mainIndex;
	}
	slots.set(freeKey, key);
	slots.set(freeKey + count, value);
	body.setNext(freeSlot, body.next(mainSlot));
	body.setNext(mainSlot, freeIndex);
	return freeIndex;
}

struct ConstructorScratch {
	struct Slots {
		mutable std::array<Value, 2 * TABLE_RECORD_FIELDS_MAX> data{};
		ValueTag tag(u32 index) const { return valueTag(data[index]); }
		u32 word(u32 index) const { return valuePayload(data[index]); }
		Value get(u32 index) const { return data[index]; }
		void set(u32 index, Value value) const { data[index] = value; }
	};
	Slots slots;
	u32 count;
	TableConstructorLayout& layout;

	i32 next(u32 index) const { return layout.nodes[index].next; }
	void setNext(u32 index, i32 next) const { layout.nodes[index].next = static_cast<i8>(next); }
};
} // namespace

// The resize owns the destination layout and has already invalidated the
// collector's scan cursor. Only the triggering assignment installs new edges.
int TableRecord::reinsertMapping(const RebuildBody& body, int& nextFree, Value key, Value value) noexcept {
	if (valueIsInteger(key)) {
		const u32 index = arraySlot(asInteger(key));
		if (index < arrayCapacity()) {
			values().set(index, value);
			return -1;
		}
		body.adjustIntegerBand(key, 1);
	}
	const u32 home = hashCanonicalTableKey(key) & (body.count - 1u);
	return insertAbsentHashKey(body, home, key, value, [&] {
		const int free = body.findFreeIndex(nextFree);
		nextFree = free - (free >= 0);
		return free;
	}, [] {});
}

int TableRecord::insertHashWithoutGrowth(const HashBody& body, u32 home, const Value& key, const Value& value) noexcept {
	const int slot = insertAbsentHashKey(body, home, key, value, [&] {
		if (body.count > HASH_CENSUS_LIMIT && body.live() == body.count) return -1;
		const int available = body.findFreeIndex(hashFree());
		if (available >= 0) writeHeader(TableHeader::Free, static_cast<u32>(available - 1));
		return available;
	},
		[this] { m_heap->tableEntriesMoved(m_address); });
	if (slot >= 0 && body.count > HASH_CENSUS_LIMIT) { body.setLive(body.live() + 1u); body.adjustIntegerBand(key, 1); }
	return slot;
}

TableConstructorLayout TableRecord::planStringRecord(std::span<const StringId> keys, u32 present) noexcept {
	const u32 count = static_cast<u32>(hashCapacity(static_cast<int>(keys.size())));
	TableConstructorLayout layout;
	layout.free = static_cast<i8>(count - 1u);
	const ConstructorScratch scratch{.slots = {}, .count = count, .layout = layout};
	for (u32 field = 0; field < keys.size(); ++field) {
		if ((present & (1u << field)) == 0u) continue;
		const Value key = valueString(keys[field]);
		const u32 home = hashCanonicalTableKey(key) & (count - 1u);
		insertAbsentHashKey(scratch, home, key, valueInteger(static_cast<i32>(field)), [&] {
				for (int free = layout.free; free >= 0; --free) {
					if (scratch.slots.tag(static_cast<u32>(free)) != ValueTag::Nil) continue;
					layout.free = static_cast<i8>(free - 1);
					return free;
				}
				return -1;
				}, [] {});
	}
	for (u32 slot = 0; slot < count; ++slot) {
		if (scratch.slots.tag(slot) != ValueTag::Nil)
			layout.nodes[slot].field = static_cast<i8>(scratch.slots.word(count + slot));
	}
	return layout;
}

void TableRecord::fillStringRecord(const TableConstructorLayout& layout, std::span<const StringId> keys,
	std::span<const Value> values) noexcept {
	const auto body = hashBody(hashSlots());
	const StringId newIndexKey = m_heap->diagnosticWord(GcDiagnosticField::NewIndex);
	for (u32 slot = 0; slot < body.count; ++slot) {
		const auto& node = layout.nodes[slot];
		if (node.field < 0) continue;
		const auto field = static_cast<u32>(node.field);
		const StringId key = keys[field];
		body.slots.set(slot, valueString(key));
		body.slots.set(slot + body.count, values[field]);
		if (key == newIndexKey) m_memory->writeRamRecordByte(m_address + TABLE_NEW_INDEX_ABSENT_BYTE, 0u);
		if (node.next >= 0) body.setNext(slot, node.next);
	}
	if (layout.free != static_cast<i8>(body.count - 1u)) writeHeader(TableHeader::Free, static_cast<u32>(layout.free));
	m_heap->writeBarrier(m_address, GC_RECORD_LINK);
}

int TableRecord::set(const Value& rawKey, const Value& value) {
	if (isNil(rawKey)) throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
	if (valueIsNaN(rawKey)) throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NAN);
	const Value key = canonicalTableKey(rawKey);
	const u32 index = arraySlot(key);
	if (index < arrayCapacity()) {
		m_heap->writeTableValue(m_address, value);
		setArraySlot(index, value);
		return -1;
	}
	const bool present = !isNil(value);
	const int slot = setHash(key, value);
	if (index != NO_ARRAY_SLOT) updateLengthHint(index, present);
	return slot;
}

int TableRecord::setHash(Value key, Value value, int nodeIndex, u8 extraHashSlots) {
	if (isNil(value)) {
		removeFromHash(key, nodeIndex);
		return -1;
	}
	const u32 count = hashSlots();
	const auto body = hashBody(count);
	const u32 home = hashCanonicalTableKey(key) & (count - 1u);
	if (nodeIndex == TABLE_HASH_UNPROBED) {
		nodeIndex = -1;
		if (count != 0u)
			nodeIndex = valueIsString(key) ? body.findString(asStringId(key), home) : body.findNode(key, home, true);
	}
	if (nodeIndex >= 0) {
		const u32 valueSlot = static_cast<u32>(nodeIndex) + count;
		const auto prior = body.slots.tag(valueSlot);
		if (prior != ValueTag::Nil && prior != ValueTag::DeadKey) {
			m_heap->writeTableValue(m_address, value);
			body.slots.set(valueSlot, value);
			return nodeIndex;
		}
	}
	if (count != 0u) {
		if (nodeIndex >= 0) {
			const u32 slot = static_cast<u32>(nodeIndex);
			if (count > HASH_CENSUS_LIMIT) { body.setLive(body.live() + 1u); body.adjustIntegerBand(key, 1); }
			body.slots.set(slot, key);
			body.slots.set(slot + count, value);
		} else nodeIndex = insertHashWithoutGrowth(body, home, key, value);
		if (nodeIndex >= 0) {
			publishHashInsertion(key, value);
			return nodeIndex;
		}
	}
	nodeIndex = insertHashWithAdmission(key, value, extraHashSlots);
	publishHashInsertion(key, value);
	return nodeIndex;
}

bool TableRecord::setIntegerArrayKey(int key, const Value& value) {
	const u32 slot = arraySlot(key);
	if (slot >= arrayCapacity()) {
		return false;
	}
	m_heap->writeTableValue(m_address, value);
	setArraySlot(slot, value);
	return true;
}

void TableRecord::publishHashInsertion(Value key, Value value) {
	if (valueIsString(key) && valuePayload(key) == m_heap->diagnosticWord(GcDiagnosticField::NewIndex)) m_memory->writeRamRecordByte(m_address + TABLE_NEW_INDEX_ABSENT_BYTE, 0u);
	m_heap->writeTableEntry(m_address, key, value);
}

void TableRecord::setInteger(int indexValue, const Value& value) {
	const u32 index = arraySlot(indexValue), array = arrayCapacity();
	if (index < array) {
		m_heap->writeTableValue(m_address, value);
		setArraySlot(index, value);
		return;
	}
	const bool present = !isNil(value);
	setHash(valueInteger(indexValue), value);
	if (index != NO_ARRAY_SLOT) updateLengthHint(index, present);
}

int TableRecord::setStringKey(StringId key, const Value& value, int slot, u8 extraHashSlots) {
	return setHash(valueString(key), value, slot, extraHashSlots);
}

void TableRecord::clear() {
	m_heap->tableEntriesMoved(m_address);
	writeHeader(TableHeader::Length, 0);
	freeStorage();
	bindHash(0, 0);
	writeHeader(TableHeader::Array, 0);
	writeHeader(TableHeader::ArrayStorage, 0u);
	m_memory->writeRamRecordByte(m_address + TABLE_NEW_INDEX_ABSENT_BYTE, 1u);
}

size_t TableRecord::trackedHeapBytes() const {
	const u32 storage = hashAddress();
	return m_heap->arena.allocationBytes(m_address - GC_OBJECT_PREFIX)
		+ (arrayAddress() ? m_heap->arena.allocationBytes(arrayAddress()) : 0u)
		+ (storage != 0u ? m_heap->arena.allocationBytes(storage) : 0u);
}

} // namespace bmsx
