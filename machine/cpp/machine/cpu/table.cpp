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
// An explicit reservation can outlive its physical hash, for example when
// all its integer keys move to the array. The record-pair trailer is cold.
constexpr u32 kExplicitHashReserve = 1u << 16;
constexpr u32 kHashWatermarkShift = 17u, kHashWatermarkMask = 31u << kHashWatermarkShift;
constexpr u32 kHashMappingBytes = 10u;

constexpr u32 hashMetadataOffset(size_t array, size_t hash) {
	return (static_cast<u32>(5u * array + 14u * hash) + 7u) & ~7u;
}
} // namespace

TableRecord::TableRecord(GcHeap& heap, u32 address)
	: m_heap(&heap), m_memory(&heap.memory), m_address(address) {
}

void TableRecord::initialize(size_t array, size_t hash, u32 reserve) {
	writeHeader(TableHeader::Kind, static_cast<u32>(ValueTag::Table) | (static_cast<u32>(m_heap->white()) << 8u)
		| (reserve != 0u ? kExplicitHashReserve : 0u));
	writeHeader(TableHeader::Gray, 0);
	writeHeader(TableHeader::Metatable, 0);
	writeHeader(TableHeader::Length, 0);
	bindStorage(array, hash, storageAddress());
	initializeStorage();
	if (hash != 0u || reserve != 0u) m_memory->writeRamRecordPair(hashMetadata(), reserve, 0u);
}

TableRecord TableRecord::copyOwn() const {
	const u32 array = arrayCapacity(), hash = hashSlots();
	const u32 reserve = std::max(hashReserve(), hashMembers());
	const u32 target = m_heap->budget.allocateRecord(HEADER_BYTES, false, storageBytes(array, hash, reserve),
		static_cast<u32>(TableHeader::Storage), valueTable(m_address), valueNil(), valueNil(), allocationCharge(array, reserve));
	TableRecord copy(*m_heap, target);
	const u32 storage = copy.storageAddress();
	const u32 bytes = array * 5u + hash * 14u;
	if (bytes != 0u) {
		const u32 dst = storage & RAM_RECORD_WORD_MASK, src = storageAddress() & RAM_RECORD_WORD_MASK;
		std::memcpy(m_memory->ramData() + dst, m_memory->ramData() + src, bytes);
		m_memory->invalidateRamWrite(dst, bytes);
	}
	// Allocation can clear weak entries on the source but cannot resize it.
	// Copy the current membership, not the pre-allocation reservation estimate.
	if (hash != 0u || reserve != 0u)
		m_memory->writeRamRecordPair(storage + hashMetadataOffset(array, hash), reserve, hashMembers());
	const u32 kind = static_cast<u32>(ValueTag::Table) | (u32{m_heap->white()} << 8u)
		| (readHeader(TableHeader::Kind) & kHashWatermarkMask) | (reserve != 0u ? kExplicitHashReserve : 0u);
	m_memory->writeRamRecordPair(target + static_cast<u32>(TableHeader::Kind), kind, 0u);
	copy.writeHeader(TableHeader::Metatable, 0u);
	m_memory->writeRamRecordPair(target + static_cast<u32>(TableHeader::Array), array, hash);
	m_memory->writeRamRecordPair(target + static_cast<u32>(TableHeader::Length), lengthHint(), readHeader(TableHeader::Free));
	return copy;
}

void TableRecord::setMetatableAddress(u32 address) {
	m_heap->writeBarrier(m_address, GC_RECORD_LINK);
	writeHeader(TableHeader::Metatable, address);
}

void TableRecord::setArraySlot(size_t slot, const Value& value) {
	m_heap->writeValueBarrier(m_address, GC_RECORD_LINK, valueTag(value));
	values().set(slot, value);
	updateLengthHint(slot, !isNil(value));
}

u32 TableRecord::storageBytes(size_t arraySize, size_t hashSize, u32 reserve) {
	return hashSize != 0u || reserve != 0u ? hashMetadataOffset(arraySize, hashSize) + 8u : static_cast<u32>(arraySize) * 5u;
}

u32 TableRecord::allocationCharge(size_t arraySize, u32 hashEntries) {
	return static_cast<u32>(arraySize) * 5u + hashEntries * kHashMappingBytes;
}

u32 TableRecord::hashMetadata() const {
	return storageAddress() + hashMetadataOffset(arrayCapacity(), hashSlots());
}

u32 TableRecord::hashReserve() const {
	return (readHeader(TableHeader::Kind) & kExplicitHashReserve) != 0u ? m_memory->readRamRecordWord(hashMetadata()) : 0u;
}

u32 TableRecord::hashMembers() const {
	return hashSlots() != 0u ? m_memory->readRamRecordWord(hashMetadata() + 4u) : 0u;
}

u32 TableRecord::hashWatermark() const {
	const u32 exponent = (readHeader(TableHeader::Kind) & kHashWatermarkMask) >> kHashWatermarkShift;
	return exponent != 0u ? 1u << (exponent - 1u) : 0u;
}

void TableRecord::publishHashWatermark(u32 watermark) {
	const u32 kind = readHeader(TableHeader::Kind);
	const u32 next = (kind & ~kHashWatermarkMask) | (std::bit_width(watermark) << kHashWatermarkShift);
	if (next != kind) writeHeader(TableHeader::Kind, next);
}

void TableRecord::publishHashMembers(u32 previous, u32 members, u32 reserve) {
	m_memory->writeRamRecordWord(hashMetadata() + 4u, members);
	m_heap->budget.replaceRecord(0u, std::max(reserve, previous) * kHashMappingBytes, std::max(reserve, members) * kHashMappingBytes);
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

int TableRecord::HashBody::findNode(const Value& key, u32 home, bool matchDead) const {
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

inline int TableRecord::HashBody::findString(StringId key, u32 home) const {
	int index = static_cast<int>(home);
	for (u32 remaining = count; index >= 0 && remaining != 0u; --remaining) {
		const u32 slot = static_cast<u32>(index);
		if (matchesString(slot, key)) return index;
		index = next(slot);
	}
	return -1;
}

Value TableRecord::HashBody::predictedString(i32 node, StringId key) const {
	if (node < 0 || static_cast<u32>(node) >= count || !matchesString(node, key)) return valueNil();
	const u32 slot = array + count + static_cast<u32>(node);
	const auto tag = slots.tag(slot);
	return tag == ValueTag::Nil ? valueNil() : valueFromTag(tag, slots.word(slot));
}

int TableRecord::findFreeIndex(const HashBody& body) const {
	for (int i = hashFree(); i >= 0; --i) {
		const u32 keySlot = body.array + static_cast<u32>(i);
		if (body.slots.tag(keySlot) == ValueTag::Nil && body.slots.tag(keySlot + body.count) == ValueTag::Nil) {
			return i;
		}
	}
	return -1;
}

TableRecord::ResizePlan TableRecord::planRehash(Value key, u32 reserve, u32 members, u32 watermark) const {
	// Physical tombstones can require a fresh layout even when the logical
	// hash has not reached the occupancy frontier that reconsiders the array.
	if (members + 1u <= std::max(reserve, watermark))
		return {arrayCapacity(), hashCapacity(static_cast<int>(members + 1u)), members + 1u, watermark};
	const auto body = hashBody(hashSlots(), arrayCapacity());
	const auto& slots = body.slots;
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
			if (tag == ValueTag::Integer || tag == ValueTag::Float) {
				const u32 index = arraySlot(valueFromTag(tag, slots.word(slot)));
				if (index != NO_ARRAY_SLOT) countIntegerKey(index + 1u);
			}
		}
	}
	if (!isNil(key)) {
		totalKeys += 1;
		const u32 index = arraySlot(key);
		if (index != NO_ARRAY_SLOT) countIntegerKey(index + 1u);
	}

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
	const u32 nextWatermark = static_cast<u32>(arraySize == body.array ? hashCapacity(static_cast<int>(members + 1u)) : hashSize);
	return {arraySize, hashSize, static_cast<u32>(hashKeys), nextWatermark};
}

int TableRecord::insertHashWithAdmission(Value key, Value value, u32 reserve, u32 members, u32 watermark, int existing) {
	auto& budget = m_heap->budget;
	const Value owner = valueTable(m_address);
	auto plan = planRehash(key, reserve, members, watermark);
	u32 previous = allocationCharge(arrayCapacity(), std::max(reserve, members));
	u32 requested = allocationCharge(plan.array, std::max(reserve, plan.members));
	const auto assist = requested > previous ? budget.prepareAllocation(requested - previous, owner, key, value) : LuaAllocationAssist::None;
	bool replan = assist == LuaAllocationAssist::Full;
	for (int attempt = assist == LuaAllocationAssist::Full ? 1 : 0; attempt != 2; ++attempt) {
		if (replan) {
			members = hashMembers();
			plan = planRehash(key, reserve, members, watermark);
			previous = allocationCharge(arrayCapacity(), std::max(reserve, members));
			requested = allocationCharge(plan.array, std::max(reserve, plan.members));
		}
		if (requested <= previous || budget.usedBytes() + requested - previous <= budget.capacity()) {
			// A new logical frontier does not require new physical storage.
			const u32 count = hashSlots(), array = arrayCapacity();
			if (plan.array == array && count != 0u) {
				const auto body = hashBody(count, array);
				const u32 home = hashCanonicalTableKey(key) & (count - 1u);
				const bool vacant = body.vacantHome(home);
				const int available = existing >= 0 || vacant ? -1 : findFreeIndex(body);
				if (existing >= 0 || vacant || available >= 0) {
					const int slot = placeHashMapping(body, home, key, value, existing, available);
					publishHashMembers(members, plan.members, reserve);
					publishHashWatermark(plan.watermark);
					return slot;
				}
			}
			if (const u32 storage = m_heap->arena.allocate(storageBytes(plan.array, plan.hash, reserve), true))
				return resize(plan, storage, key, value, reserve);
		}
		if (attempt == 0) {
			budget.collectRuntime(owner, key, value);
			replan = true;
		}
	}
	throw LuaOutOfMemorySignal{};
}

int TableRecord::resize(const ResizePlan& plan, u32 storage, Value key, Value value, u32 reserve) {
	const auto [newArraySize, newHashSize, wantedMembers, watermark] = plan;
	const size_t oldArraySize = arrayCapacity(), oldHashSize = hashSlots();
	// Restart any collector scan against the complete, redistributed body.
	m_heap->tableEntriesMoved(m_address);
	const auto oldValues = values();
	const u32 retained = allocationCharge(oldArraySize, std::max(reserve, hashMembers()));
	bindStorage(newArraySize, newHashSize, storage);
	const size_t retainedArray = std::min(oldArraySize, newArraySize);
	if (retainedArray != 0) {
		const auto newValues = values();
		u8* ram = m_memory->ramData();
		std::memcpy(ram + (newValues.words & RAM_RECORD_WORD_MASK),
			ram + (oldValues.words & RAM_RECORD_WORD_MASK), retainedArray * sizeof(u32));
		std::memcpy(ram + (newValues.tags & RAM_RECORD_WORD_MASK),
			ram + (oldValues.tags & RAM_RECORD_WORD_MASK), retainedArray);
	}
	initializeStorage(retainedArray);

	for (size_t i = retainedArray; i < oldArraySize; ++i) {
		const Value prior = oldValues.get(i);
		if (!isNil(prior)) rawSet(valueInteger(static_cast<i32>(i + 1)), prior);
	}
	for (size_t i = 0; i < oldHashSize; ++i) {
		const Value priorKey = oldValues.get(oldArraySize + i), prior = oldValues.get(oldArraySize + oldHashSize + i);
		if (!isNil(priorKey) && !isNil(prior)) rawSet(priorKey, prior);
	}
	const int slot = rawSet(key, value);
	if (newHashSize != 0u || reserve != 0u) m_memory->writeRamRecordPair(hashMetadata(), reserve, wantedMembers);
	publishHashWatermark(watermark);
	m_heap->budget.replaceRecord(oldValues.words, retained, allocationCharge(newArraySize, std::max(reserve, wantedMembers)));
	return slot;
}

void TableRecord::bindStorage(size_t arraySize, size_t hashSize, u32 address) {
	writeHeader(TableHeader::Storage, address);
	writeHeader(TableHeader::Array, static_cast<u32>(arraySize));
	writeHeader(TableHeader::Hash, static_cast<u32>(hashSize));
	writeHeader(TableHeader::Free, static_cast<u32>(hashSize) - 1u);
}

void TableRecord::initializeStorage(size_t retainedArray) {
	const u32 bytes = static_cast<u32>(arrayCapacity()) * 5u + static_cast<u32>(hashSlots()) * 14u;
	if (bytes == 0) return;
	const u32 words = storageAddress() & RAM_RECORD_WORD_MASK;
	const u32 links = words + (arrayCapacity() + 2u * hashSlots()) * 4u;
	const u32 tags = links + hashSlots() * 4u;
	u8* ram = m_memory->ramData();
	std::fill(ram + words + retainedArray * sizeof(u32), ram + links, u8{0});
	std::fill(ram + links, ram + tags, u8{0xff});
	std::fill(ram + tags + retainedArray, ram + words + bytes, u8{0});
	m_memory->invalidateRamWrite(words, bytes);
}

void TableRecord::freeStorage() {
	const u32 storage = storageAddress();
	if (storage != 0) m_heap->budget.releaseRecord(storage, allocationCharge(arrayCapacity(), std::max(hashReserve(), hashMembers())));
}

void TableRecord::freeRecord() {
	freeStorage();
	m_heap->budget.releaseRecord(m_address, HEADER_BYTES);
}

// Storage redistribution transfers existing edges and leaves the boundary hint alone.
int TableRecord::rawSet(const Value& key, const Value& value) {
	const u32 array = arrayCapacity(), count = hashSlots();
	const auto body = hashBody(count, array);
	const u32 index = arraySlot(key);
	if (index < array) {
		body.slots.set(index, value);
		return -1;
	}
	const u32 home = hashCanonicalTableKey(key) & (count - 1u);
	return insertHashWithoutGrowth(body, home, key, value, body.vacantHome(home) ? -1 : findFreeIndex(body));
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
	const int mainIndexOfOccupied = static_cast<int>(hashCanonicalTableKey(canonicalTableKey(mainKey)) & (count - 1u));
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
	u32 members = 0;
	for (u32 slot = 0; slot < body.count; ++slot) {
		const auto& node = layout.nodes[slot];
		if (node.field < 0) continue;
		const auto field = static_cast<u32>(node.field);
		body.slots.set(slot, valueString(keys[field]));
		body.slots.set(slot + body.count, values[field]);
		++members;
		if (node.next >= 0) body.setNext(slot, node.next);
	}
	m_memory->writeRamRecordWord(hashMetadata() + 4u, members);
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
	const u32 members = hashMembers();
	publishHashMembers(members, members - 1u, hashReserve());
	const Value key = values().get(hashKeySlot(index));
	if (valueIsTable(key) || valueIsThread(key) || valueIsClosure(key)) {
		const uint32_t hashId = valuePayload(key);
		values().set(hashKeySlot(index), valueFromTag(ValueTag::Nil, valueHeader(key)));
		values().set(hashValueSlot(index), valueFromTag(ValueTag::DeadKey, hashId));
	} else {
		values().set(hashValueSlot(index), valueNil());
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

void TableRecord::set(const Value& rawKey, const Value& value) {
	if (isNil(rawKey)) throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
	if (valueIsNaN(rawKey)) throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NAN);
	const Value key = canonicalTableKey(rawKey);
	const u32 index = arraySlot(key);
	const u32 array = arrayCapacity();
	if (index < array) {
		setArraySlot(index, value);
		return;
	}
	const bool present = !isNil(value);
	setHash(array, key, value);
	if (index != NO_ARRAY_SLOT) updateLengthHint(index, present);
}

int TableRecord::setHash(u32 array, Value key, Value value, int slot) {
	if (isNil(value)) {
		removeFromHash(key, slot);
		return -1;
	}
	return assignHash<HashStore::General>(array, key, value, slot);
}

template <TableRecord::HashStore Policy>
int TableRecord::assignHash(u32 array, Value key, Value value, int nodeIndex, StringId newIndexKey) noexcept(Policy != HashStore::General) {
	constexpr bool inPlaceOnly = Policy != HashStore::General;
	const auto tag = valueTag(value);
	const bool erase = Policy == HashStore::FieldInPlace && tag == ValueTag::Nil;
	const bool valueHasEdge = valueTagHasGcEdge(tag);
	const u32 count = hashSlots();
	const auto body = hashBody(count, array);
	const u32 home = hashCanonicalTableKey(key) & (count - 1u);
	if (nodeIndex == TABLE_HASH_UNPROBED) {
		nodeIndex = -1;
		if (count != 0u) {
			if constexpr (Policy == HashStore::IdentityInPlace) nodeIndex = body.findNode(key, home, true);
			else if constexpr (Policy == HashStore::FieldInPlace) nodeIndex = body.findString(asStringId(key), home);
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
			if (valueHasEdge) m_heap->writeBarrier(m_address, GC_RECORD_LINK);
			body.slots.set(valueSlot, value);
			return nodeIndex;
		}
	}
	// Only an absent own field can trigger __newindex. Keep the probe's
	// slot (including a tombstone) for the insertion below.
	if constexpr (Policy == HashStore::FieldInPlace) {
		if (!isNil(metatableField(newIndexKey))) return HASH_STORE_DECLINED;
		if (erase) return -1;
	}
	const u32 reserve = hashReserve(), members = hashMembers(), watermark = hashWatermark();
	bool placeInCurrent = false;
	int available = -1;
	if (count != 0u && members + 1u <= std::max(reserve, watermark)) {
		placeInCurrent = nodeIndex >= 0 || body.vacantHome(home);
		if (!placeInCurrent) {
			available = findFreeIndex(body);
			placeInCurrent = available >= 0;
		}
	}
	if (placeInCurrent) {
		if (members >= reserve) {
			if constexpr (inPlaceOnly) {
				if (!m_heap->budget.canAdmitWithoutAssist(kHashMappingBytes)) return HASH_STORE_DECLINED;
			} else {
				m_heap->budget.admit(kHashMappingBytes, valueTable(m_address), key, value);
			}
		}
		nodeIndex = placeHashMapping(body, home, key, value, nodeIndex, available);
		const u32 retained = inPlaceOnly ? members : hashMembers();
		publishHashMembers(retained, retained + 1u, reserve);
	} else {
		if constexpr (inPlaceOnly) return HASH_STORE_DECLINED;
		else nodeIndex = insertHashWithAdmission(key, value, reserve, members, watermark, nodeIndex);
	}
	if (inPlaceOnly || valueTagHasGcEdge(valueTag(key)) || valueHasEdge) m_heap->writeBarrier(m_address, GC_RECORD_LINK);
	return nodeIndex;
}

bool TableRecord::tryAssignIdentityHash(Value key, Value value) noexcept {
	return assignHash<HashStore::IdentityInPlace>(arrayCapacity(), key, value) >= 0;
}

int TableRecord::tryAssignStringField(StringId key, Value value, StringId newIndexKey) noexcept {
	return assignHash<HashStore::FieldInPlace>(arrayCapacity(), valueString(key), value, TABLE_HASH_UNPROBED, newIndexKey);
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

template <bool Assignment, bool RememberPath, typename Lookup>
void TableRecord::resolveIndexChain(StringId indexKey, int slot, TableLookupResult& result, Lookup&& lookup,
	TableStringPathCache* cache, u32 visitLimit) const {
	TableRecord current = *this;
	for (u32 depth = 0; depth < visitLimit; ++depth) {
		const u32 receiver = current.address();
		u32 metatable;
		if constexpr (Assignment) {
			metatable = current.metatableAddress();
			if (metatable == 0u) {
				result = {valueNil(), TABLE_HASH_UNPROBED, depth, TableLookupStatus::Store, receiver};
				return;
			}
		}
		if constexpr (RememberPath) {
			if (depth != 0 && depth == cache->holderDepth) slot = cache->holderSlot;
		}
		const auto own = lookup(current, slot);
		if constexpr (Assignment) {
			if (own) {
				result = {valueNil(), slot, depth, TableLookupStatus::Store, receiver};
				return;
			}
		} else if (!isNil(own)) {
			if constexpr (RememberPath) {
				if (depth != 0) {
					cache->holderDepth = depth;
					cache->holderSlot = slot;
				}
			}
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
		if constexpr (RememberPath) {
			parent = depth < cache->indexSlots.size() ? current.getStringKeyCached(indexKey, cache->indexSlots[depth])
				: current.getStringKey(indexKey);
		} else parent = current.getStringKey(indexKey);
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

void TableRecord::resolveIndex(StringId indexKey, const Value& rawKey, TableLookupResult& result, u32 visitLimit) const {
	const Value key = canonicalTableKey(rawKey);
	const bool miss = isNil(key) || valueIsNaN(key);
	resolveIndexChain(indexKey, -1, result, [key, miss](const TableRecord& table, int&) {
		return miss ? valueNil() : table.getCanonical(key);
	}, nullptr, visitLimit);
}

void TableRecord::resolveIntegerIndex(StringId indexKey, int key, TableLookupResult& result) const {
	resolveIndexChain(indexKey, -1, result, [key](const TableRecord& table, int&) { return table.getInteger(key); });
}

void TableRecord::resolveStringIndex(StringId indexKey, StringId key, TableLookupResult& result) const {
	resolveIndexChain(indexKey, -1, result, [key](const TableRecord& table, int&) { return table.getStringKey(key); });
}

void TableRecord::resolveStringIndexCached(StringId indexKey, StringId key, int predictedSlot, TableLookupResult& result) const {
	resolveIndexChain(indexKey, predictedSlot, result, [key](const TableRecord& table, int& slot) { return table.getStringKeyCached(key, slot); });
}

void TableRecord::resolveStringIndexPath(StringId indexKey, StringId key, int& receiverSlot,
	TableLookupResult& result, TableStringPathCache& cache) const {
	resolveIndexChain<false, true>(indexKey, receiverSlot, result,
		[key](const TableRecord& table, int& slot) { return table.getStringKeyCached(key, slot); }, &cache);
	if (result.extraVisits == 0u && result.slot >= 0) receiverSlot = result.slot;
}

void TableRecord::resolveAssignment(StringId newIndexKey, Value rawKey, TableLookupResult& result) const {
	const Value key = canonicalTableKey(rawKey);
	const bool miss = isNil(key) || valueIsNaN(key);
	resolveIndexChain<true>(newIndexKey, -1, result, [key, miss](const TableRecord& table, int&) {
		return !miss && !isNil(table.getCanonical(key));
	});
}

void TableRecord::resolveIntegerAssignment(StringId newIndexKey, int key, TableLookupResult& result) const {
	resolveIndexChain<true>(newIndexKey, -1, result, [key](const TableRecord& table, int&) { return !isNil(table.getInteger(key)); });
}

void TableRecord::resolveStringAssignment(StringId newIndexKey, StringId key, TableLookupResult& result) const {
	resolveIndexChain<true>(newIndexKey, -1, result, [key](const TableRecord& table, int& slot) {
		const u32 count = table.hashSlots();
		if (count == 0u) return false;
		const auto body = table.hashBody(count, table.arrayCapacity());
		slot = body.findString(key, hashCanonicalTableKey(valueString(key)) & (count - 1u));
		return slot >= 0 && body.slots.tag(body.array + body.count + static_cast<u32>(slot)) != ValueTag::Nil;
	});
}

int TableRecord::setStringKey(StringId key, const Value& value, int slot) {
	return setHash(arrayCapacity(), valueString(key), value, slot);
}

bool TableRecord::storePredictedStringKey(StringId key, Value value, int predicted) noexcept {
	if (isNil(value) || predicted < 0) return false;
	const u32 count = hashSlots();
	if (static_cast<u32>(predicted) >= count) return false;
	const auto body = hashBody(count, arrayCapacity());
	const u32 node = static_cast<u32>(predicted), valueSlot = body.array + node + count;
	if (!body.matchesString(node, key) || body.slots.tag(valueSlot) == ValueTag::Nil) return false;
	m_heap->writeValueBarrier(m_address, GC_RECORD_LINK, valueTag(value));
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
	writeHeader(TableHeader::Kind, readHeader(TableHeader::Kind) & ~(kExplicitHashReserve | kHashWatermarkMask));
	bindStorage(0, 0, 0);

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
	size_t arrayStart = 0;
	size_t hashStart = 0;
	if (!isNil(after)) {
		const u32 index = arraySlot(after);
		if (index < arraySize) {
			arrayStart = index + 1u;
		} else {
			const int nodeIndex = findNodeIndex(after, true);
			if (nodeIndex < 0) {
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
			}
			arrayStart = arraySize;
			hashStart = static_cast<size_t>(nodeIndex + 1);
		}
	}
	const auto slots = values();
	for (size_t i = arrayStart; i < arraySize; ++i) {
		const Value entry = slots.get(i);
		if (!isNil(entry)) {
			key = valueInteger(static_cast<i32>(i + 1));
			value = entry;
			return;
		}
	}
	const int hashIndex = findNextLiveHashIndex(hashStart);
	if (hashIndex >= 0) {
		const size_t slot = static_cast<size_t>(hashIndex);
		key = slots.get(hashKeySlot(slot));
		value = slots.get(hashValueSlot(slot));
		return;
	}
	key = valueNil();
}



size_t TableRecord::trackedHeapBytes() const {
	const u32 bytes = storageBytes(arrayCapacity(), hashSlots(), hashReserve());
	return HEADER_BYTES + (bytes ? heapAllocationBytes(bytes) : 0u);
}


} // namespace bmsx
