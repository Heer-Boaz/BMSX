#include "machine/cpu/table.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cstring>

#include "machine/common/numeric.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/gc_heap.h"

namespace bmsx {

namespace {
constexpr int32_t kTableHashNextEnd = -1;
// A reserved hash slot charges two language Values, not its collision link.
constexpr u32 kHashSlotBudgetBytes = 10u;
} // namespace

TableRecord::TableRecord(GcHeap& heap, u32 address)
	: m_heap(&heap), m_memory(&heap.memory), m_address(address) {
}

void TableRecord::initialize(size_t array, size_t hash) {
	const u32 kind = static_cast<u32>(ValueTag::Table) | (static_cast<u32>(m_heap->white()) << 8u)
		| (1u << (8u * TABLE_NEW_INDEX_ABSENT_BYTE));
	m_memory->writeRamRecordPair(m_address + static_cast<u32>(TableHeader::Kind), kind, 0u);
	writeHeader(TableHeader::Metatable, 0u);
	m_memory->writeRamRecordPair(m_address + static_cast<u32>(TableHeader::Array), array, hash);
	m_memory->writeRamRecordPair(m_address + static_cast<u32>(TableHeader::Length), 0u, static_cast<u32>(hash) - 1u);
	if (array || hash) initializeStorage(storageAddress(), array, hash);
}

TableRecord TableRecord::copyOwn() const {
	const u32 array = arrayCapacity(), hash = hashSlots();
	const u32 target = m_heap->budget.allocateRecord(HEADER_BYTES, true, storageBytes(array, hash),
		static_cast<u32>(TableHeader::Storage), valueTable(m_address), valueNil(), valueNil(), allocationCharge(array, hash));
	TableRecord copy(*m_heap, target);
	const u32 storage = copy.storageAddress();
	const u32 bytes = array * 5u + hash * 14u;
	if (bytes != 0u) {
		const u32 dst = storage & RAM_RECORD_WORD_MASK, src = storageAddress() & RAM_RECORD_WORD_MASK;
		std::memcpy(m_memory->ramData() + dst, m_memory->ramData() + src, bytes);
		m_memory->invalidateRamWrite(dst, bytes);
	}
	const u32 absent = m_memory->readRamRecordByte(m_address + TABLE_NEW_INDEX_ABSENT_BYTE);
	const u32 kind = static_cast<u32>(ValueTag::Table) | (u32{m_heap->white()} << 8u)
		| (absent << (8u * TABLE_NEW_INDEX_ABSENT_BYTE));
	m_memory->writeRamRecordPair(target + static_cast<u32>(TableHeader::Kind), kind, 0u);
	copy.writeHeader(TableHeader::Metatable, 0u);
	m_memory->writeRamRecordPair(target + static_cast<u32>(TableHeader::Array), array, hash);
	m_memory->writeRamRecordPair(target + static_cast<u32>(TableHeader::Length), lengthHint(), readHeader(TableHeader::Free));
	m_heap->publishObject(target);
	return copy;
}

void TableRecord::setMetatableAddress(u32 address) {
	m_heap->writeBarrier(m_address, GC_RECORD_LINK);
	writeHeader(TableHeader::Metatable, address);
}

void TableRecord::setArraySlot(size_t slot, const Value& value) {
	m_heap->writeTableValue(m_address, value);
	values().set(slot, value);
	updateLengthHint(slot, !isNil(value));
}

u32 TableRecord::storageBytes(size_t arraySize, size_t hashSize) {
	return static_cast<u32>(5u * arraySize + 14u * hashSize);
}

u32 TableRecord::allocationCharge(size_t arraySize, size_t hashSize) {
	return static_cast<u32>(5u * arraySize + kHashSlotBudgetBytes * hashSize);
}

size_t TableRecord::hashCapacity(int hashSize) {
	return hashSize > 0
		? nextPowerOfTwo(static_cast<size_t>(hashSize))
		: 0;
}

u32 TableRecord::arraySlot(const Value& key) {
	i32 integer;
	return valueToInteger(key, integer) ? arraySlot(integer) : NO_ARRAY_SLOT;
}

bool TableRecord::hasIntegerKey(u32 key) const {
	if (key <= arrayCapacity()) {
		return !isNil(values().get(static_cast<size_t>(key - 1)));
	}
	const int nodeIndex = findNodeIndex(valueInteger(static_cast<i32>(key)));
	return nodeIndex >= 0 && !isNil(values().get(hashValueSlot(static_cast<size_t>(nodeIndex))));
}

int TableRecord::findNodeIndex(const Value& key, bool matchDead) const {
	const u32 count = hashSlots();
	return count == 0u ? -1
		: hashBody(count, arrayCapacity()).findNode(key, hashCanonicalTableKey(key) & (count - 1u), matchDead);
}

template<bool BulkWrite>
int TableRecord::HashStorage<BulkWrite>::findNode(const Value& key, u32 home, bool matchDead) const {
	const auto tag = valueTag(key);
	const u32 payload = valuePayload(key);
	const bool collectableKey = matchDead && (tag == ValueTag::Table || tag == ValueTag::Closure || tag == ValueTag::Thread);
	int index = static_cast<int>(home);
	for (u32 remaining = count; index >= 0 && remaining != 0u; --remaining) {
		const u32 slot = static_cast<u32>(index);
		const u32 keySlot = array + slot;
		const auto nodeTag = slots.tag(keySlot);
		if (nodeTag == tag) {
			if (slots.word(keySlot) == payload) return index;
		} else if (collectableKey && nodeTag == ValueTag::Nil && slots.word(keySlot) == valueTagHeader(tag)) {
			const u32 valueSlot = keySlot + count;
			if (slots.tag(valueSlot) == ValueTag::DeadKey && slots.word(valueSlot) == payload) return index;
		}
		index = next(slot);
	}
	return -1;
}

int TableRecord::findNextLiveHashIndex(size_t start) const {
	for (size_t index = start; index < hashSlots(); ++index) {
		if (!isNil(values().get(hashKeySlot(index))) && !isNil(values().get(hashValueSlot(index)))) {
			return static_cast<int>(index);
		}
	}
	return -1;
}

template<bool BulkWrite>
inline int TableRecord::HashStorage<BulkWrite>::findString(StringId key, u32 home) const {
	int index = static_cast<int>(home);
	for (u32 remaining = count; index >= 0 && remaining != 0u; --remaining) {
		const u32 slot = static_cast<u32>(index);
		if (matchesString(slot, key)) return index;
		index = next(slot);
	}
	return -1;
}

template<bool BulkWrite>
Value TableRecord::HashStorage<BulkWrite>::predictedString(i32 node, StringId key) const {
	if (node < 0 || static_cast<u32>(node) >= count || !matchesString(node, key)) return valueNil();
	const u32 slot = array + count + static_cast<u32>(node);
	const auto tag = slots.tag(slot);
	return tag == ValueTag::Nil ? valueNil() : valueFromTag(tag, slots.word(slot));
}

template<bool BulkWrite>
int TableRecord::HashStorage<BulkWrite>::findFreeIndex(int first) const {
	for (int i = first; i >= 0; --i) {
		const u32 keySlot = array + static_cast<u32>(i);
		if (slots.tag(keySlot) == ValueTag::Nil && slots.tag(keySlot + count) == ValueTag::Nil) {
			return i;
		}
	}
	return -1;
}

TableRecord::ResizePlan TableRecord::planRehash(Value key, u8 extraHashSlots) const {
	const auto body = hashBody(hashSlots(), arrayCapacity());
	const auto& slots = body.slots;
	const u32 added = valueIsInteger(key) ? arraySlot(asInteger(key)) : NO_ARRAY_SLOT;
	if (added == NO_ARRAY_SLOT) {
		// A hash-only addition never repartitions the reserved array.
		size_t live = 1u + extraHashSlots;
		for (u32 i = body.array; i < body.array + body.count; ++i) {
			if (slots.tag(i) != ValueTag::Nil && slots.tag(i + body.count) != ValueTag::Nil) ++live;
		}
		return {body.array, nextPowerOfTwo(live)};
	}
	size_t totalKeys = 0;
	std::array<u32, 32> counts{};
	size_t countBins = 0;

	auto countIntegerKey = [&counts, &countBins](size_t index) {
		const size_t log = ceilLog2(index);
		while (countBins <= log) {
			counts[countBins] = 0;
			++countBins;
		}
		counts[log] += 1;
	};

	for (u32 i = 0; i < body.array; ++i) {
		if (slots.tag(i) != ValueTag::Nil) {
			totalKeys += 1;
			countIntegerKey(i + 1);
		}
	}
	for (u32 i = 0; i < body.count; ++i) {
		const u32 slot = body.array + i;
		const auto tag = slots.tag(slot);
		if (tag != ValueTag::Nil && slots.tag(slot + body.count) != ValueTag::Nil) {
			totalKeys += 1;
			if (tag == ValueTag::Integer) {
				const u32 index = arraySlot(static_cast<i32>(slots.word(slot)));
				if (index != NO_ARRAY_SLOT) countIntegerKey(index + 1u);
			}
		}
	}
	totalKeys += 1;
	countIntegerKey(added + 1u);

	size_t arraySize = 0;
	size_t arrayKeys = 0;
	size_t total = 0;
	size_t power = 1;
	for (size_t i = 0; i < countBins; ++i) {
		total += counts[i];
		if (total > power / 2) {
			arraySize = power;
			arrayKeys = total;
		}
		power <<= 1;
	}

	size_t hashKeys = totalKeys - arrayKeys;
	size_t hashSize = hashKeys > 0 ? nextPowerOfTwo(hashKeys) : 0;
	return {arraySize, hashSize};
}

template <TableRecord::HashStore Policy>
int TableRecord::commitHashPlan(const ResizePlan& plan, Value key, Value value, u32 previous, u32 requested)
	noexcept(Policy == HashStore::ReturningIndex || Policy == HashStore::ReturningField) {
	const u32 bytes = storageBytes(plan.array, plan.hash);
	if constexpr (Policy == HashStore::Scheduled || Policy == HashStore::General) {
		if (m_heap->phase() >= GcPhase::Sweep) m_heap->assistSweepBeforeReservation(bytes);
	}
	if (const u32 storage = m_heap->arena.allocate(bytes, true))
		return resize(plan, storage, key, value, previous, requested);
	return HASH_STORE_DECLINED;
}

template <TableRecord::HashStore Policy>
int TableRecord::insertHashWithAdmission(Value key, Value value, u8 extraHashSlots)
	noexcept(Policy == HashStore::ReturningIndex || Policy == HashStore::ReturningField) {
	auto& budget = m_heap->budget;
	const u32 array = arrayCapacity(), hash = hashSlots();
	const u32 previous = allocationCharge(array, hash);
	const Value owner = valueTable(m_address);
	auto recovery = LuaAllocationRecovery::CurrentOrFresh;
	for (;;) {
		const auto plan = planRehash(key, extraHashSlots);
		const u32 requested = allocationCharge(plan.array, plan.hash);
		bool admitted = true;
		if constexpr (Policy == HashStore::ReturningIndex || Policy == HashStore::ReturningField) {
			if (requested > previous && !budget.canAdmitWithoutAssist(requested - previous)) {
				// Only a hard budget refusal rejects the preference. If GC
				// work is due, the published path decides the same request.
				if (!extraHashSlots || budget.usedBytes() + requested - previous <= budget.capacity())
					return HASH_STORE_DECLINED;
				admitted = false;
			}
			if (admitted && m_heap->sweepDueForReservation(storageBytes(plan.array, plan.hash)))
				return HASH_STORE_DECLINED;
		} else if (requested > previous) {
			admitted = Policy == HashStore::Resume || recovery != LuaAllocationRecovery::CurrentOrFresh
				? budget.usedBytes() + requested - previous <= budget.capacity()
				: budget.prepareAllocation(requested - previous, owner, key, value);
		}
		if (admitted) {
			const int slot = commitHashPlan<Policy>(plan, key, value, previous, requested);
			if (slot != HASH_STORE_DECLINED) return slot;
		}
		if (extraHashSlots) {
			extraHashSlots = 0;
			continue;
		}
		if constexpr (Policy == HashStore::ReturningIndex || Policy == HashStore::ReturningField || Policy == HashStore::Resume) {
			return HASH_STORE_DECLINED;
		} else {
			if constexpr (Policy == HashStore::Scheduled)
				if (admitted && recovery == LuaAllocationRecovery::CurrentOrFresh) return HASH_STORE_DECLINED;
			recovery = m_heap->recoverAllocation(recovery, owner, key, value);
			// Weak clearing can make an existing slot available.
			if (hash != 0u) {
				const auto body = hashBody(hash, array);
				const u32 home = hashCanonicalTableKey(key) & (hash - 1u);
				const bool vacant = body.vacantHome(home);
				const int available = vacant ? -1 : body.findFreeIndex(hashFree());
				if (vacant || available >= 0) return insertHashWithoutGrowth(body, home, key, value, available);
			}
		}
	}
}

int TableRecord::resize(const ResizePlan& plan, u32 storage, Value key, Value value, u32 previous, u32 requested) {
	const auto [newArraySize, newHashSize] = plan;
	const size_t oldArraySize = arrayCapacity(), oldHashSize = hashSlots();
	// Restart any collector scan against the complete, redistributed body.
	m_heap->tableEntriesMoved(m_address);
	const u32 oldStorage = storageAddress();
	const auto oldValues = values();
	bindStorage(newArraySize, newHashSize, storage);
	const size_t retainedArray = std::min(oldArraySize, newArraySize);
	if (retainedArray != 0) {
		const auto newValues = values();
		std::memcpy(newValues.words, oldValues.words, retainedArray * sizeof(u32));
		std::memcpy(newValues.tags, oldValues.tags, retainedArray);
	}
	initializeStorage(storage, newArraySize, newHashSize, retainedArray);

	// initializeStorage marked every destination page. No guest or collector
	// execution intervenes before the rebuilt table is complete.
	const auto body = hashBody<true>(newHashSize, newArraySize);
	const int firstFree = static_cast<int>(newHashSize) - 1;
	int nextFree = firstFree;
	for (size_t i = retainedArray; i < oldArraySize; ++i) {
		const Value prior = oldValues.get(i);
		if (!isNil(prior)) reinsertMapping(body, nextFree, valueInteger(static_cast<i32>(i + 1)), prior);
	}
	for (size_t i = 0; i < oldHashSize; ++i) {
		const Value priorKey = oldValues.get(oldArraySize + i), prior = oldValues.get(oldArraySize + oldHashSize + i);
		if (!isNil(priorKey) && !isNil(prior)) reinsertMapping(body, nextFree, priorKey, prior);
	}
	const int slot = reinsertMapping(body, nextFree, key, value);
	if (nextFree != firstFree) writeHeader(TableHeader::Free, static_cast<u32>(nextFree));
	m_heap->budget.replaceRecord(oldStorage, previous, requested);
	return slot;
}

void TableRecord::bindStorage(size_t arraySize, size_t hashSize, u32 address) {
	writeHeader(TableHeader::Storage, address);
	writeHeader(TableHeader::Array, static_cast<u32>(arraySize));
	writeHeader(TableHeader::Hash, static_cast<u32>(hashSize));
	writeHeader(TableHeader::Free, static_cast<u32>(hashSize) - 1u);
}

void TableRecord::initializeStorage(u32 storage, u32 array, u32 hash, size_t retainedArray) {
	const u32 bytes = storageBytes(array, hash);
	if (bytes == 0) return;
	const u32 words = storage & RAM_RECORD_WORD_MASK;
	const u32 links = words + (array + 2u * hash) * 4u;
	const u32 tags = links + hash * 4u;
	u8* ram = m_memory->ramData();
	std::fill(ram + words + retainedArray * sizeof(u32), ram + links, u8{0});
	std::fill(ram + links, ram + tags, u8{0xff});
	std::fill(ram + tags + retainedArray, ram + words + bytes, u8{0});
	m_memory->invalidateRamWrite(words, bytes);
}

void TableRecord::freeStorage() {
	const u32 storage = storageAddress();
	if (storage != 0) m_heap->budget.releaseRecord(storage, allocationCharge(arrayCapacity(), hashSlots()));
}

void TableRecord::freeRecord() {
	freeStorage();
	m_heap->budget.releaseObject(m_address, HEADER_BYTES);
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
	const u32 keySlot = body.array + mainSlot, valueSlot = keySlot + count;
	const auto tag = slots.tag(keySlot);
	if (tag == ValueTag::Nil || slots.tag(valueSlot) == ValueTag::Nil) {
		slots.set(keySlot, key);
		slots.set(valueSlot, value);
		return mainIndex;
	}
	const Value mainKey = valueFromTag(tag, slots.word(keySlot));
	const int freeIndex = takeFree();
	if (freeIndex < 0) return -1;
	const u32 freeSlot = static_cast<u32>(freeIndex), freeKey = body.array + freeSlot;
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
	const u32 array = 0;
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
		if (index < body.array) {
			body.slots.set(index, value);
			return -1;
		}
	}
	const u32 home = hashCanonicalTableKey(key) & (body.count - 1u);
	return insertAbsentHashKey(body, home, key, value, [&] {
		const int free = body.findFreeIndex(nextFree);
		nextFree = free - (free >= 0);
		return free;
	}, [] {});
}

int TableRecord::insertHashWithoutGrowth(const HashBody& body, u32 home, const Value& key, const Value& value, int available) noexcept {
	return insertAbsentHashKey(body, home, key, value, [this, available] {
		writeHeader(TableHeader::Free, static_cast<u32>(available - (available >= 0)));
		return available;
	},
		[this] { m_heap->tableEntriesMoved(m_address); });
}

int TableRecord::placeHashMapping(const HashBody& body, u32 home, Value key, Value value, int existing, int available) noexcept {
	if (existing < 0) return insertHashWithoutGrowth(body, home, key, value, available);
	const u32 slot = body.array + static_cast<u32>(existing);
	body.slots.set(slot, key);
	body.slots.set(slot + body.count, value);
	return existing;
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
	const auto body = hashBody(hashSlots(), arrayCapacity());
	for (u32 slot = 0; slot < body.count; ++slot) {
		const auto& node = layout.nodes[slot];
		if (node.field < 0) continue;
		const auto field = static_cast<u32>(node.field);
		const StringId key = keys[field];
		body.slots.set(slot, valueString(key));
		body.slots.set(slot + body.count, values[field]);
		if (key == m_heap->newIndexKey) m_memory->writeRamRecordByte(m_address + TABLE_NEW_INDEX_ABSENT_BYTE, 0u);
		if (node.next >= 0) body.setNext(slot, node.next);
	}
	if (layout.free != static_cast<i8>(body.count - 1u)) writeHeader(TableHeader::Free, static_cast<u32>(layout.free));
	m_heap->writeBarrier(m_address, GC_RECORD_LINK);
}

void TableRecord::removeFromHash(const Value& key, int slot) {
	const int existingIndex = slot == TABLE_HASH_UNPROBED ? findNodeIndex(key) : slot;
	if (existingIndex < 0 || values().tag(static_cast<u32>(hashValueSlot(existingIndex))) == ValueTag::Nil) {
		return;
	}
	markHashNodeDead(static_cast<size_t>(existingIndex));
}

void TableRecord::markHashNodeDead(size_t index) {
	const Value key = values().get(hashKeySlot(index));
	if (valueIsTable(key) || valueIsThread(key) || valueIsClosure(key)) {
		const uint32_t hashId = valuePayload(key);
		values().set(hashKeySlot(index), valueFromTag(ValueTag::Nil, valueHeader(key)));
		values().set(hashValueSlot(index), valueFromTag(ValueTag::DeadKey, hashId));
	} else {
		values().set(hashValueSlot(index), valueNil());
		if (key == valueString(m_heap->newIndexKey)) m_memory->writeRamRecordByte(m_address + TABLE_NEW_INDEX_ABSENT_BYTE, 1u);
	}
}

Value TableRecord::get(const Value& rawKey) const {
	if (isNil(rawKey) || valueIsNaN(rawKey)) return valueNil();
	const Value key = canonicalTableKey(rawKey);
	return getCanonical(key);
}

Value TableRecord::getCanonical(const Value& key) const {
	const u32 index = arraySlot(key);
	if (index < arrayCapacity()) return values().get(index);
	return getHash(key);
}

Value TableRecord::getHash(const Value& key) const {
	const u32 count = hashSlots();
	if (count == 0u) return valueNil();
	const auto body = hashBody(count, arrayCapacity());
	const int index = body.findNode(key, hashCanonicalTableKey(key) & (count - 1u));
	return index < 0 ? valueNil() : body.slots.get(body.array + count + static_cast<u32>(index));
}

void TableRecord::set(const Value& key, const Value& value) {
	setOwn<HashStore::General>(key, value);
}

int TableRecord::assignScheduled(Value key, Value value, int slot, u8 extraHashSlots) {
	return setOwn<HashStore::Scheduled>(key, value, slot, extraHashSlots);
}

bool TableRecord::resumeAssignment(Value key, Value value, u8 extraHashSlots) {
	return setOwn<HashStore::Resume>(key, value, TABLE_HASH_UNPROBED, extraHashSlots) != HASH_STORE_DECLINED;
}

template <TableRecord::HashStore Policy>
int TableRecord::setOwn(Value rawKey, Value value, int slot, u8 extraHashSlots) {
	if (isNil(rawKey)) throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
	if (valueIsNaN(rawKey)) throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NAN);
	const Value key = canonicalTableKey(rawKey);
	const u32 index = arraySlot(key);
	const u32 array = arrayCapacity();
	if (index < array) {
		setArraySlot(index, value);
		return -1;
	}
	const bool present = !isNil(value);
	if (!present) {
		removeFromHash(key, slot);
		slot = -1;
	} else {
		slot = assignHash<Policy>(array, key, value, slot, extraHashSlots);
		if constexpr (Policy != HashStore::General)
			if (slot == HASH_STORE_DECLINED) return slot;
	}
	if (index != NO_ARRAY_SLOT) updateLengthHint(index, present);
	return slot;
}

int TableRecord::setHash(u32 array, Value key, Value value, int slot, u8 extraHashSlots) {
	if (isNil(value)) {
		removeFromHash(key, slot);
		return -1;
	}
	return assignHash<HashStore::General>(array, key, value, slot, extraHashSlots);
}

void TableRecord::publishHashInsertion(Value key, Value value) {
	if (key == valueString(m_heap->newIndexKey)) m_memory->writeRamRecordByte(m_address + TABLE_NEW_INDEX_ABSENT_BYTE, 0u);
	m_heap->writeTableEntry(m_address, key, value);
}

template <TableRecord::HashStore Policy>
int TableRecord::assignHash(u32 array, Value key, Value value, int nodeIndex, u8 extraHashSlots)
	noexcept(Policy == HashStore::ReturningIndex || Policy == HashStore::ReturningField) {
	constexpr bool returning = Policy == HashStore::ReturningIndex || Policy == HashStore::ReturningField;
	const auto tag = valueTag(value);
	const bool erase = returning && tag == ValueTag::Nil;
	const u32 count = hashSlots();
	const auto body = hashBody(count, array);
	const u32 home = hashCanonicalTableKey(key) & (count - 1u);
	if (nodeIndex == TABLE_HASH_UNPROBED) {
		nodeIndex = -1;
		if (count != 0u) {
			if constexpr (Policy == HashStore::ReturningIndex) nodeIndex = body.findNode(key, home, true);
			else if constexpr (Policy == HashStore::ReturningField) nodeIndex = body.findString(asStringId(key), home);
			else nodeIndex = valueIsString(key) ? body.findString(asStringId(key), home) : body.findNode(key, home, true);
		}
	}
	if (nodeIndex >= 0) {
		const u32 valueSlot = array + static_cast<u32>(nodeIndex) + count;
		const auto prior = body.slots.tag(valueSlot);
		if (prior != ValueTag::Nil && prior != ValueTag::DeadKey) {
			if (erase) {
				markHashNodeDead(nodeIndex);
				return -1;
			}
			m_heap->writeTableValue(m_address, value);
			body.slots.set(valueSlot, value);
			return nodeIndex;
		}
	}
	// Only an absent own field can trigger __newindex. Keep the probe's
	// slot (including a tombstone) for the insertion below.
	if constexpr (returning) {
		const u32 meta = newIndexMetatable();
		if (meta != 0u && !isNil(TableRecord(*m_heap, meta).getStringKey(m_heap->newIndexKey))) return HASH_STORE_DECLINED;
		if (erase) return -1;
	}
	if (count != 0u) {
		const bool vacant = body.vacantHome(home);
		const int available = nodeIndex >= 0 || vacant ? -1 : body.findFreeIndex(hashFree());
		if (nodeIndex >= 0 || vacant || available >= 0) {
			nodeIndex = placeHashMapping(body, home, key, value, nodeIndex, available);
			publishHashInsertion(key, value);
			return nodeIndex;
		}
	}
	nodeIndex = insertHashWithAdmission<Policy>(key, value, extraHashSlots);
	if constexpr (Policy != HashStore::General)
		if (nodeIndex == HASH_STORE_DECLINED) return nodeIndex;
	// Relocation invalidates a suspended collector cursor in resize().
	// Already visited edges retain their colors; only the insertion is new.
	publishHashInsertion(key, value);
	return nodeIndex;
}

bool TableRecord::tryAssignIdentityHash(Value key, Value value) noexcept {
	return assignHash<HashStore::ReturningIndex>(arrayCapacity(), key, value) != HASH_STORE_DECLINED;
}

bool TableRecord::tryAssignIntegerHash(i32 key, Value value) noexcept {
	if (assignHash<HashStore::ReturningIndex>(arrayCapacity(), valueInteger(key), value) == HASH_STORE_DECLINED) return false;
	const u32 slot = arraySlot(key);
	if (slot != NO_ARRAY_SLOT) updateLengthHint(slot, !isNil(value));
	return true;
}

int TableRecord::tryAssignStringField(StringId key, Value value, u8 extraHashSlots) noexcept {
	return assignHash<HashStore::ReturningField>(arrayCapacity(), valueString(key), value, TABLE_HASH_UNPROBED, extraHashSlots);
}

Value TableRecord::getInteger(int indexValue) const {
	const u32 index = arraySlot(indexValue);
	if (index < arrayCapacity()) return values().get(index);
	return getHash(valueInteger(indexValue));
}

void TableRecord::setInteger(int indexValue, const Value& value) {
	const u32 index = arraySlot(indexValue), array = arrayCapacity();
	if (index < array) {
		setArraySlot(index, value);
		return;
	}
	const bool present = !isNil(value);
	setHash(array, valueInteger(indexValue), value);
	if (index != NO_ARRAY_SLOT) updateLengthHint(index, present);
}

Value TableRecord::getStringKey(StringId key) const {
	const u32 count = hashSlots();
	if (count == 0u) return valueNil();
	const auto body = hashBody(count, arrayCapacity());
	const int nodeIndex = body.findString(key, hashCanonicalTableKey(valueString(key)) & (count - 1u));
	return nodeIndex < 0 ? valueNil() : body.slots.get(body.array + count + static_cast<u32>(nodeIndex));
}

TableStringProbe TableRecord::beginStringProbe(StringId key) const {
	const u32 count = hashSlots();
	return {count == 0u ? -1 : static_cast<i32>(hashCanonicalTableKey(valueString(key)) & (count - 1u)), count};
}

size_t TableRecord::advanceStringProbe(StringId key, TableStringProbe& probe, size_t limit) const {
	const auto body = hashBody(hashSlots(), arrayCapacity());
	const auto available = std::min<size_t>(probe.remaining, limit);
	size_t inspected = 0;
	while (probe.node >= 0 && inspected < available) {
		const u32 slot = static_cast<u32>(probe.node);
		++inspected;
		if (body.matchesString(slot, key)) {
			probe.value = body.slots.get(body.array + body.count + slot);
			probe.node = -1;
			break;
		}
		probe.node = body.next(slot);
	}
	probe.remaining -= static_cast<u32>(inspected);
	return inspected;
}

Value TableRecord::getStringKeyCached(StringId key, int& predictedSlot) const {
	const u32 count = hashSlots();
	if (count != 0u) {
		const auto body = hashBody(count, arrayCapacity());
		const auto& slots = body.slots;
		const Value predicted = body.predictedString(predictedSlot, key);
		if (!isNil(predicted)) return predicted;
		const int nodeIndex = body.findString(key, hashCanonicalTableKey(valueString(key)) & (count - 1u));
		if (nodeIndex >= 0) {
			const u32 valueSlot = body.array + count + static_cast<u32>(nodeIndex);
			const auto tag = slots.tag(valueSlot);
			if (tag != ValueTag::Nil) {
				predictedSlot = nodeIndex;
				return valueFromTag(tag, slots.word(valueSlot));
			}
		}
	}
	predictedSlot = -1;
	return valueNil();
}

Value TableRecord::metatableField(StringId key) const {
	const u32 address = metatableAddress();
	return address != 0u ? TableRecord(*m_heap, address).getStringKey(key) : valueNil();
}

u32 TableRecord::newIndexMetatable() const {
	const u32 meta = metatableAddress();
	return meta != 0u && m_memory->readRamRecordByte(meta + TABLE_NEW_INDEX_ABSENT_BYTE) == 1u ? 0u : meta;
}

template <bool Assignment, typename Lookup>
void TableRecord::resolveIndexChain(int slot, TableLookupResult& result, Lookup&& lookup,
	u32 visitLimit) const {
	TableRecord current = *this;
	for (u32 depth = 0; depth < visitLimit; ++depth) {
		const u32 receiver = current.address();
		u32 metatable;
		if constexpr (Assignment) {
			metatable = current.newIndexMetatable();
			if (metatable == 0u) {
				result = {valueNil(), TABLE_HASH_UNPROBED, depth, TableLookupStatus::Store, receiver};
				return;
			}
		}
		const auto own = lookup(current, slot);
		if constexpr (Assignment) {
			if (own) {
				result = {valueNil(), slot, depth, TableLookupStatus::Store, receiver};
				return;
			}
		} else if (!isNil(own)) {
			result = {own, slot, depth, TableLookupStatus::Resolved};
			return;
		}
		if constexpr (!Assignment) {
			metatable = current.metatableAddress();
			if (metatable == 0u) {
				result = {depth == 0u ? own : valueNil(), -1, depth, TableLookupStatus::Resolved};
				return;
			}
		}
		current.m_address = metatable;
		Value parent;
		if constexpr (Assignment) {
			parent = current.getStringKey(m_heap->newIndexKey);
		} else parent = current.getStringKey(m_heap->indexKey);
		if (!valueIsTable(parent)) {
			if (valueIsClosure(parent) || valueIsBuiltinFunction(parent))
				result = {parent, -1, depth, TableLookupStatus::Invoke, receiver};
			else if (!isNil(parent)) result = {parent, -1, depth, TableLookupStatus::Forward};
			else if constexpr (Assignment) result = {valueNil(), slot, depth, TableLookupStatus::Store, receiver};
			else result = {valueNil(), -1, depth, TableLookupStatus::Resolved};
			return;
		}
		current.m_address = valuePayload(parent);
		slot = -1;
	}
	result = {valueNil(), -1, visitLimit - 1, TableLookupStatus::ChainExhausted};
}

void TableRecord::resolveIndex(const Value& rawKey, TableLookupResult& result, u32 visitLimit) const {
	const Value key = canonicalTableKey(rawKey);
	const bool miss = isNil(key) || valueIsNaN(key);
	resolveIndexChain(-1, result, [key, miss](const TableRecord& table, int&) {
		return miss ? valueNil() : table.getCanonical(key);
	}, visitLimit);
}

void TableRecord::resolveIntegerIndex(int key, TableLookupResult& result) const {
	resolveIndexChain(-1, result, [key](const TableRecord& table, int&) { return table.getInteger(key); });
}

void TableRecord::resolveStringIndex(StringId key, TableLookupResult& result) const {
	resolveIndexChain(-1, result, [key](const TableRecord& table, int&) { return table.getStringKey(key); });
}

void TableRecord::resolveStringIndexCached(StringId key, int predictedSlot, TableLookupResult& result) const {
	resolveIndexChain(predictedSlot, result, [key](const TableRecord& table, int& slot) { return table.getStringKeyCached(key, slot); });
}

void TableRecord::resolveAssignment(Value rawKey, TableLookupResult& result) const {
	const Value key = canonicalTableKey(rawKey);
	const bool miss = isNil(key) || valueIsNaN(key);
	resolveIndexChain<true>(-1, result, [key, miss](const TableRecord& table, int&) {
		return !miss && !isNil(table.getCanonical(key));
	});
}

void TableRecord::resolveIntegerAssignment(int key, TableLookupResult& result) const {
	resolveIndexChain<true>(-1, result, [key](const TableRecord& table, int&) { return !isNil(table.getInteger(key)); });
}

void TableRecord::resolveStringAssignment(StringId key, TableLookupResult& result) const {
	resolveIndexChain<true>(-1, result, [key](const TableRecord& table, int& slot) {
		const u32 count = table.hashSlots();
		if (count == 0u) return false;
		const auto body = table.hashBody(count, table.arrayCapacity());
		slot = body.findString(key, hashCanonicalTableKey(valueString(key)) & (count - 1u));
		return slot >= 0 && body.slots.tag(body.array + body.count + static_cast<u32>(slot)) != ValueTag::Nil;
	});
}

int TableRecord::setStringKey(StringId key, const Value& value, int slot, u8 extraHashSlots) {
	return setHash(arrayCapacity(), valueString(key), value, slot, extraHashSlots);
}

bool TableRecord::storePredictedStringKey(StringId key, Value value, int predicted) noexcept {
	if (isNil(value) || predicted < 0) return false;
	const u32 count = hashSlots();
	if (static_cast<u32>(predicted) >= count) return false;
	const auto body = hashBody(count, arrayCapacity());
	const u32 node = static_cast<u32>(predicted), valueSlot = body.array + node + count;
	if (!body.matchesString(node, key) || body.slots.tag(valueSlot) == ValueTag::Nil) return false;
	m_heap->writeTableValue(m_address, value);
	body.slots.set(valueSlot, value);
	return true;
}

i32 TableRecord::length(TableRecord* table) noexcept {
	constexpr u32 maxBoundary = 0x7fffffffu;
	u32 low = table->lengthHint(), high;
	if (low != 0 && !table->hasIntegerKey(low)) {
		high = low;
		low = 0;
	} else if (low == maxBoundary) {
		return static_cast<i32>(low);
	} else {
		if (!table->hasIntegerKey(low + 1)) {
			return static_cast<i32>(low);
		}
		++low;
		high = std::min(low * 2, maxBoundary);
		while (low != maxBoundary && table->hasIntegerKey(high)) {
			low = high;
			high = std::min(low * 2, maxBoundary);
		}
	}
	while (high - low > 1) {
		const u32 middle = low + ((high - low) >> 1);
		if (table->hasIntegerKey(middle)) low = middle;
		else high = middle;
	}
	table->writeHeader(TableHeader::Length, low);
	return static_cast<i32>(low);
}

void TableRecord::clear() {
	m_heap->tableEntriesMoved(m_address);
	writeHeader(TableHeader::Length, 0);
	freeStorage();
	bindStorage(0, 0, 0);
	m_memory->writeRamRecordByte(m_address + TABLE_NEW_INDEX_ABSENT_BYTE, 1u);
}

bool TableRecord::loadStoredEntry(size_t slot, Value& key, Value& value) const {
	if (slot < arrayCapacity()) {
		if (isNil(values().get(slot))) return false;
		key = valueInteger(static_cast<i32>(slot + 1));
		value = values().get(slot);
		return true;
	}
	const size_t hashIndex = slot - arrayCapacity();
	if (isNil(values().get(hashKeySlot(hashIndex))) || isNil(values().get(hashValueSlot(hashIndex)))) return false;
	key = values().get(hashKeySlot(hashIndex));
	value = values().get(hashValueSlot(hashIndex));
	return true;
}

void TableRecord::nextEntry(const Value& rawAfter, Value& key, Value& value) const {
	if (valueIsNaN(rawAfter)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
	const Value after = canonicalTableKey(rawAfter);
	const auto arraySize = arrayCapacity();
	u32 position = 0;
	if (!isNil(after)) {
		const u32 index = arraySlot(after);
		if (index < arraySize) {
			position = index + 1u;
		} else {
			const int nodeIndex = findNodeIndex(after, true);
			if (nodeIndex < 0) {
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
			}
			position = arraySize + static_cast<u32>(nodeIndex) + 1u;
		}
	}
	(void)nextStoredEntry(position, key, value);
}

u32 TableRecord::nextStoredEntry(u32 position, Value& key, Value& value) const {
	const u32 arraySize = arrayCapacity();
	const auto slots = values();
	for (; position < arraySize; ++position) {
		const Value entry = slots.get(position);
		if (!isNil(entry)) {
			key = valueInteger(static_cast<i32>(position + 1u));
			value = entry;
			return position + 1u;
		}
	}
	const int hashIndex = findNextLiveHashIndex(position - arraySize);
	if (hashIndex >= 0) {
		const size_t slot = static_cast<size_t>(hashIndex);
		key = slots.get(hashKeySlot(slot));
		value = slots.get(hashValueSlot(slot));
		return arraySize + static_cast<u32>(hashIndex) + 1u;
	}
	key = valueNil();
	return 0;
}


size_t TableRecord::trackedHeapBytes() const {
	const u32 storage = storageAddress();
	return m_heap->arena.allocationBytes(m_address - GC_OBJECT_PREFIX)
		+ (storage != 0u ? m_heap->arena.allocationBytes(storage) : 0u);
}

} // namespace bmsx
