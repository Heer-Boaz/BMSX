#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <new>
#include <optional>
#include <span>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "machine/cpu/gc_heap.h"
#include "machine/cpu/table_lookup.h"
#include "machine/cpu/table_constructor_layout.h"
#include "machine/memory/memory.h"

namespace bmsx {

inline constexpr int TABLE_INDEX_CHAIN_LIMIT = 32;

enum class TableHeader : u32 {
	Kind = 0, Gray = 4, Metatable = 8, HashStorage = 12, Array = 16, Hash = 20, Length = 24, Free = 28, ArrayStorage = 32,
};
// Method absence belongs to the table holding the own mapping. Byte +1
// is the GC color, and byte +3 belongs to the collector visit list.
inline constexpr u32 TABLE_NEW_INDEX_ABSENT_BYTE = 2u;

struct TableStringProbe {
	i32 node;
	u32 remaining;
	Value value = valueNil();
};

class TableRecord {
public:
	TableRecord(GcHeap& heap, u32 address) : m_heap(&heap), m_memory(&heap.memory), m_address(address) {}
	static constexpr u32 HEADER_BYTES = 36, HEADER_CHARGE = 32;
	static u32 storageBytes(size_t arraySize, size_t hashSize);
	static u32 allocationCharge(size_t arraySize, size_t hashSize);
	void initialize(size_t arrayCapacity, size_t hashCapacity);
	TableRecord copyOwn() const;
	void freeRecord();
	u32 address() const { return m_address; }
	u32 hashAddress() const { return readHeader(TableHeader::HashStorage); }
	u32 arrayAddress() const { return readHeader(TableHeader::ArrayStorage); }
	u32 arrayCapacity() const { return readHeader(TableHeader::Array); }
	u32 hashSlots() const { return readHeader(TableHeader::Hash); }
	u32 lengthHint() const { return readHeader(TableHeader::Length); }
	i32 hashFree() const { return static_cast<i32>(readHeader(TableHeader::Free)); }
	static size_t hashCapacity(int hashSize);
	// Fixed string keys, selected by a presence mask in source order. The
	// constructor owns the new empty table and its complete field set.
	static TableConstructorLayout planStringRecord(std::span<const StringId> keys, u32 present) noexcept;
	void fillStringRecord(const TableConstructorLayout& layout, std::span<const StringId> keys,
		std::span<const Value> values) noexcept;

	Value get(const Value& key) const;
	void set(const Value& key, const Value& value);
	// A resolved opcode write may suspend only on a physical backing refusal.
	int assignScheduled(Value key, Value value, int slot = TABLE_HASH_UNPROBED, u8 extraHashSlots = 0);
	bool resumeAssignment(Value key, Value value, u8 extraHashSlots);
	// The caller supplies a Table key. An absent mapping checks __newindex.
	// Growth returns in place when no collection is required. Declining leaves the table and collector unchanged.
	bool tryAssignIdentityHash(Value key, Value value) noexcept;
	// The Integer key is outside the current array. Growth can move it into the new array.
	bool tryAssignIntegerHash(i32 key, Value value) noexcept;
	// A field write may complete without a VM handoff. Return the actual
	// slot (-1 for completed nil), or HASH_STORE_DECLINED before mutation.
	static constexpr i32 HASH_STORE_DECLINED = -2;
	int tryAssignStringField(StringId key, Value value, u8 extraHashSlots = 0) noexcept;
	int tryAssignCachedStringField(StringId key, Value value, int predicted, u8 extraHashSlots) noexcept;
	bool getIntegerArrayKey(int key, Value& value) const {
		return getArraySlot(arraySlot(key), value);
	}
	bool setIntegerArrayKey(int key, const Value& value) {
		const u32 slot = arraySlot(key);
		if (slot >= arrayCapacity()) {
			return false;
		}
		setArraySlot(slot, value);
		return true;
	}
	bool tryAssignIntegerArrayKey(int key, const Value& value) {
		const u32 slot = arraySlot(key);
		if (slot >= arrayCapacity() || (metatableAddress() != 0u && values().tag(slot) == ValueTag::Nil)) return false;
		setArraySlot(slot, value);
		return true;
	}
	Value getInteger(int index) const;
	void setInteger(int index, const Value& value);
	Value getStringKey(StringId key) const;
	TableStringProbe beginStringProbe(StringId key) const;
	size_t advanceStringProbe(StringId key, TableStringProbe& probe, size_t limit) const;
	Value getStringKeyCached(StringId key, int& predictedSlot) const;
	// A plain table resolves even an absent field. An unresolved lookup
	// must visit the live metatable; it must not train the receiver's slot.
	std::optional<Value> readOwnStringField(StringId key, int& predicted) const {
		const u32 count = hashSlots();
		if (count) {
			const auto body = hashBody(count);
			if (predicted >= 0 && static_cast<u32>(predicted) < count) {
				const auto own = body.predictedString(predicted, key);
				if (!isNil(own)) return own;
			}
			int slot;
			const auto own = findStringField(body, key, slot);
			if (slot >= 0) {
				predicted = slot;
				return own;
			}
		}
		if (metatableAddress()) return std::nullopt;
		return valueNil();
	}
	int setStringKey(StringId key, const Value& value, int slot = TABLE_HASH_UNPROBED, u8 extraHashSlots = 0);
	bool storePredictedStringKey(StringId key, Value value, int predicted) noexcept;
	Value metatableField(StringId key) const;
	void resolveIndex(const Value& key, TableLookupResult& result, u32 visitLimit = TABLE_INDEX_CHAIN_LIMIT) const;
	void resolveIntegerIndex(int key, TableLookupResult& result) const;
	void resolveStringIndex(StringId key, TableLookupResult& result) const;
	void resolveMissingStringIndex(StringId key, TableLookupResult& result) const;
	void resolveStringIndexCached(StringId key, int predictedSlot, TableLookupResult& result) const;
	void resolveAssignment(Value key, TableLookupResult& result) const;
	void resolveIntegerAssignment(int key, TableLookupResult& result) const;
	void resolveStringAssignment(StringId key, TableLookupResult& result) const;
	// Find a boundary and remember it after a search.
	static i32 length(TableRecord* table) noexcept;
	void clear();
	// Physical array positions followed by hash nodes, including vacant/dead slots.
	size_t storedSlotCount() const { return arrayCapacity() + hashSlots(); }
	// Constant-work inspection. Slot is in [0, storedSlotCount()); mutation invalidates
	// positions. False leaves key/value untouched. Does not invoke guest code.
	bool loadStoredEntry(size_t slot, Value& key, Value& value) const;
	size_t scanSlots() const { return arrayCapacity() + 2u * hashSlots(); }
	template <typename Fn>
	void forEachEntry(Fn&& fn, u32 first = 0u, u32 end = UINT32_MAX) const {
		const u32 array = arrayCapacity(), hash = hashSlots();
		const auto arrayValues = values();
		const auto slots = hashBody(hash).slots;
		for (u32 i = first; i < std::min(array, end); ++i) {
			const Value value = arrayValues.get(i);
			if (!isNil(value)) fn(valueInteger(static_cast<i32>(i + 1)), value);
		}
		for (u32 i = std::max(first, array); i < std::min(array + hash, end); ++i) {
			const Value key = slots.get(i - array);
			if (isNil(key)) continue;
			const Value value = slots.get(i - array + hash);
			if (!isNil(value)) fn(key, value);
		}
	}
	template <typename ValueIsAlive>
	void clearWeakEntries(bool weakKeys, bool weakValues, ValueIsAlive&& valueIsAlive,
		u32 first = 0u, u32 end = UINT32_MAX) {
		const u32 array = arrayCapacity(), hash = hashSlots();
		const auto slots = values();
		if (weakValues) {
			for (u32 slot = first; slot < std::min(array, end); ++slot) {
				const Value value = slots.get(slot);
				if (!isNil(value) && !valueIsAlive(value)) slots.set(slot, valueNil());
			}
		}
		const auto nodes = hashBody(hash).slots;
		for (u32 slot = std::max(first, array); slot < std::min(array + hash, end); ++slot) {
			const Value key = nodes.get(slot - array);
			const Value value = nodes.get(slot - array + hash);
			if (isNil(key) || isNil(value)) {
				continue;
			}
			const bool keyIsAlive = !weakKeys || valueIsAlive(key);
			const bool valueIsStillAlive = !weakValues || valueIsAlive(value);
			if (keyIsAlive && valueIsStillAlive) {
				continue;
			}
			markHashNodeDead(slot - array);
		}
	}
	// Returns inspected Value slots; a nil output key denotes exhaustion.
	void nextEntry(const Value& after, Value& key, Value& value) const;
	[[nodiscard]] u32 nextStoredEntry(u32 position, Value& key, Value& value) const;
	size_t trackedHeapBytes() const;
	u32 metatableAddress() const { return readHeader(TableHeader::Metatable); }
	void setMetatableAddress(u32 address);

private:
	static constexpr u32 NO_ARRAY_SLOT = UINT32_MAX;
	static constexpr u32 arraySlot(i32 key) { return key > 0 ? static_cast<u32>(key) - 1u : NO_ARRAY_SLOT; }
	static u32 arraySlot(const Value& key);

	bool getArraySlot(u32 slot, Value& value) const {
		if (slot >= arrayCapacity()) return false;
		const Value own = values().get(slot);
		if (isNil(own) && readHeader(TableHeader::Metatable) != 0) return false;
		value = own;
		return true;
	}

	void updateLengthHint(size_t slot, bool present) {
		const u32 hint = lengthHint();
		if (present ? slot == hint : slot + 1 == hint)
			writeHeader(TableHeader::Length, present ? hint + 1 : hint - 1);
	}
	void setArraySlot(size_t slot, const Value& value);


	size_t hashValueSlot(size_t index) const { return hashSlots() + index; }
	int findNodeIndex(const Value& key, bool matchDead = false) const;
	struct ResizePlan { size_t array, hash; bool keepHash; };
	ResizePlan planRehash(Value key, u8 extraHashSlots) const;
	enum class HashStore : u8 { General, Scheduled, Resume, ReturningIndex, ReturningField };
	template <HashStore Policy>
	int insertHashWithAdmission(Value key, Value value, u8 extraHashSlots)
		noexcept(Policy == HashStore::ReturningIndex || Policy == HashStore::ReturningField);
	template <HashStore Policy>
	int setOwn(Value key, Value value, int slot = TABLE_HASH_UNPROBED, u8 extraHashSlots = 0);
	template <HashStore Policy>
	int commitHashPlan(const ResizePlan&, Value key, Value value, u32 previous, u32 requested)
		noexcept(Policy == HashStore::ReturningIndex || Policy == HashStore::ReturningField);
	int resize(const ResizePlan&, u32 storage, Value key, Value value, u32 previous, u32 requested);
	void bindHash(size_t hashSize, u32 address);
	void initializeArray(u32 address, u32 capacity, u32 retained);
	void initializeHash(u32 address, u32 count);
	void freeStorage();
	u32 readHeader(TableHeader field) const { return m_memory->readRamRecordWord(m_address + static_cast<u32>(field)); }
	void writeHeader(TableHeader field, u32 word) { m_memory->writeRamRecordWord(m_address + static_cast<u32>(field), word); }
	template<bool BulkWrite> struct ValueSlots {
		Memory* memory;
		// Both planes are in the same owned, contiguous allocation.
		u8 *words, *tags;
		ValueTag tag(u32 index) const { return static_cast<ValueTag>(tags[index]); }
		u32 word(u32 index) const { return readLE32(words + index * sizeof(u32)); }
		Value get(size_t index) const {
			return valueFromTag(static_cast<ValueTag>(tags[index]), readLE32(words + index * sizeof(u32)));
		}
		void set(size_t index, Value value) const {
			u8* payload = words + index * sizeof(u32);
			writeLE32(payload, valuePayload(value));
			tags[index] = static_cast<u8>(valueTag(value));
			if constexpr (!BulkWrite) memory->invalidateRamValueSlot(payload, tags + index);
		}
	};
	template<bool BulkWrite> struct HashStorage {
		ValueSlots<BulkWrite> slots;
		u32 count, links;
		int findFreeIndex(int first) const;
		i32 next(u32 index) const {
			return static_cast<i32>(slots.memory->readRamRecordWord(links + index * 4u));
		}
		void setNext(u32 index, i32 next) const {
			if constexpr (BulkWrite)
				writeLE32(slots.words + (2u * count + index) * sizeof(u32), static_cast<u32>(next));
			else
				slots.memory->writeRamRecordWord(links + index * 4u, static_cast<u32>(next));
		}
		int findNode(const Value& key, u32 home, bool matchDead = false) const;
		int findString(StringId key, u32 home) const;
		bool matchesString(u32 node, StringId key) const {
			const u32 slot = node;
			return slots.tag(slot) == ValueTag::String && slots.word(slot) == key;
		}
		Value predictedString(u32 node, StringId key) const {
			if (!matchesString(node, key)) return valueNil();
			return slots.get(count + node);
		}
	};
	using HashBody = HashStorage<false>;
	using RebuildBody = HashStorage<true>;
	template<bool BulkWrite = false>
	HashStorage<BulkWrite> hashBody(u32 count) const {
		return hashBodyAt<BulkWrite>(hashAddress(), count);
	}
	template<bool BulkWrite = false>
	HashStorage<BulkWrite> hashBodyAt(u32 storage, u32 count) const {
		u8* words = m_memory->ramData() + (storage & RAM_RECORD_WORD_MASK);
		return {{m_memory, words, words + 12u * count}, count, storage + 8u * count};
	}
	static Value findStringField(const HashBody& body, StringId key, int& slot);
	static bool loadHashEntry(const HashBody& body, u32 slot, Value& key, Value& value);
	u32 nextStoredEntry(const HashBody& body, u32 position, Value& key, Value& value) const;
	int reinsertMapping(const RebuildBody& body, int& nextFree, Value key, Value value) noexcept;
	int insertHashWithoutGrowth(const HashBody& body, u32 home, const Value& key, const Value& value) noexcept;
	int setHash(Value key, Value value, int slot = TABLE_HASH_UNPROBED, u8 extraHashSlots = 0);
	template <HashStore Policy>
	int assignHash(Value key, Value value, int slot = TABLE_HASH_UNPROBED, u8 extraHashSlots = 0)
		noexcept(Policy == HashStore::ReturningIndex || Policy == HashStore::ReturningField);
	template <HashStore Policy>
	int assignProbedHash(const HashBody& body, u32 home, int nodeIndex, Value key, Value value, u8 extraHashSlots)
		noexcept(Policy == HashStore::ReturningIndex || Policy == HashStore::ReturningField);
	void publishHashInsertion(Value key, Value value);
	u32 newIndexMetatable() const;
	void removeFromHash(const Value& key, int slot);
	void markHashNodeDead(size_t index);
	Value getCanonical(const Value& key) const;
	Value getHash(const Value& key) const;
	template <bool Assignment = false, bool OwnMiss = false, typename Lookup>
	void resolveIndexChain(int slot, TableLookupResult& result, Lookup&& lookup,
		u32 visitLimit = TABLE_INDEX_CHAIN_LIMIT) const;

	ValueSlots<false> values() const { u8* words = m_memory->ramData() + (arrayAddress() & RAM_RECORD_WORD_MASK);
		return {m_memory, words, words + arrayCapacity() * 4u}; }

	GcHeap* m_heap;
	Memory* m_memory;
	u32 m_address;
};

inline TableRecord asTable(Value value, GcHeap& heap) { return TableRecord(heap, valuePayload(value)); }

} // namespace bmsx
