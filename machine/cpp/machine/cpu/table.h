#pragma once

#include <algorithm>
#include <bit>
#include <cstddef>
#include <optional>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "machine/cpu/table_lookup.h"
#include "machine/memory/memory.h"

namespace bmsx {

namespace test { class NativeTableReference; }

inline constexpr u32 TABLE_STRING_HIT_BASE_NODES = 64;
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
	i32 slot = -1;
};

class TableRecord {
public:
	TableRecord(Memory& memory, u32 address) : m_memory(&memory), m_address(address) {}
	static constexpr u32 HEADER_BYTES = 36;
	static constexpr u32 BYTE_LINK_CAPACITY = 128;
	static constexpr u32 HASH_CENSUS_LIMIT = 64;
	static constexpr u32 HASH_BAND_CAPACITY = 1024;
	static constexpr u32 hashNodeBytes(size_t hash) { return static_cast<u32>(hash * (hash <= BYTE_LINK_CAPACITY ? 11u : 14u)); }
	static constexpr u32 hashStorageBytes(size_t hash) { return hashNodeBytes(hash) + (hash > HASH_CENSUS_LIMIT ? 4u : 0u) + (hash >= HASH_BAND_CAPACITY ? 32u * 4u : 0u); }
	u32 address() const { return m_address; }
	u32 hashAddress() const { return readHeader(TableHeader::HashStorage); }
	u32 arrayAddress() const { return readHeader(TableHeader::ArrayStorage); }
	u32 arrayCapacity() const { return readHeader(TableHeader::Array); }
	u32 hashSlots() const { return readHeader(TableHeader::Hash); }
	u32 lengthHint() const { return readHeader(TableHeader::Length); }
	i32 hashFree() const { return static_cast<i32>(readHeader(TableHeader::Free)); }
	Value get(const Value& key) const;
	// Resolve once on the owner. A false result leaves every table lane
	// untouched and returns the position for the System vector.
	bool tryAssignOwn(Value key, Value value, int& position);
	static constexpr i32 ARRAY_STORE_POSITION = -2;
	// Returning probes also defer __newindex to the instruction owner.
	bool tryAssignIdentityHash(Value key, Value value, const StringId& assignKey) noexcept;
	bool tryAssignIntegerHash(i32 key, Value value, const StringId& assignKey) noexcept;
	static constexpr i32 HASH_STORE_DECLINED = -2;
	int tryAssignStringField(StringId key, Value value, const StringId& assignKey) noexcept;
	int tryAssignCachedStringField(StringId key, Value value, int predicted, const StringId& assignKey) noexcept;
	bool getIntegerArrayKey(int key, Value& value) const {
		return getArraySlot(arraySlot(key), value);
	}
	bool tryAssignIntegerArrayKey(int key, const Value& value) {
		const u32 slot = arraySlot(key);
		if (valueTagHasGcEdge(valueTag(value)) || slot >= arrayCapacity()
			|| (metatableAddress() != 0u && values().tag(slot) == ValueTag::Nil)) return false;
		setArraySlot(slot, value);
		return true;
	}
	Value getInteger(int index) const;
	Value getStringKey(StringId key, u32* linkCycles = nullptr) const;
	TableStringProbe beginStringProbe(StringId key) const;
	size_t advanceStringProbe(StringId key, TableStringProbe& probe, size_t limit) const;
	Value getStringKeyCached(StringId key, int& predictedSlot, u32* linkCycles = nullptr) const;
	// A plain table resolves even an absent field. An unresolved lookup
	// must visit the live metatable; it must not train the receiver's slot.
	std::optional<Value> readOwnStringField(StringId key, int& predicted, u32* linkCycles = nullptr) const {
		const u32 count = hashSlots();
		if (count) {
			const auto body = hashBody(count);
			if (count <= TABLE_STRING_HIT_BASE_NODES && predicted >= 0 && static_cast<u32>(predicted) < count) {
				const auto own = body.predictedString(predicted, key);
				if (!isNil(own)) return own;
			}
			int slot;
			const auto own = findStringField(body, key, slot, linkCycles);
			if (slot >= 0) {
				predicted = slot;
				return own;
			}
		}
		if (metatableAddress()) return std::nullopt;
		return valueNil();
	}
	bool storePredictedStringKey(StringId key, Value value, int predicted) noexcept;
	Value metatableField(const StringId& key) const;
	u32 resolveIndex(const Value& key, const StringId& lookupKey, TableLookupResult& result, u32 visitLimit = TABLE_INDEX_CHAIN_LIMIT) const;
	u32 resolveIntegerIndex(int key, const StringId& lookupKey, TableLookupResult& result) const;
	void resolveStringIndex(StringId key, const StringId& lookupKey, TableLookupResult& result) const;
	u32 resolveMissingStringIndex(StringId key, const StringId& lookupKey, TableLookupResult& result) const;
	u32 resolveStringIndexCached(StringId key, const StringId& lookupKey, int predictedSlot, TableLookupResult& result, u32 visitLimit = TABLE_INDEX_CHAIN_LIMIT) const;
	void resolveAssignment(Value key, const StringId& assignKey, TableLookupResult& result) const;
	void resolveIntegerAssignment(int key, const StringId& assignKey, TableLookupResult& result) const;
	void resolveStringAssignment(StringId key, const StringId& assignKey, TableLookupResult& result, int predicted = -1) const;
	// Find a boundary and remember it after a search.
	static i32 length(TableRecord* table) noexcept;
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
	// Returns inspected Value slots; a nil output key denotes exhaustion.
	void nextEntry(const Value& after, Value& key, Value& value) const;
	[[nodiscard]] u32 nextStoredEntry(u32 position, Value& key, Value& value) const;
	u32 metatableAddress() const { return readHeader(TableHeader::Metatable); }

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

	int findNodeIndex(const Value& key, bool matchDead = false) const;
	bool probeAssignment(const Value& key, int& position) const;
	friend class test::NativeTableReference;
	enum class HashStore : u8 { ReturningIndex, ReturningField };
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
		u32 liveAddress() const { return links + count * (count <= BYTE_LINK_CAPACITY ? 1u : 4u); }
		u32 live() const { return slots.memory->readRamRecordWord(liveAddress()); }
		void setLive(u32 n) const { slots.memory->writeRamRecordWord(liveAddress(), n); }
		void adjustIntegerBand(Value key, int delta) const {
			if (count < HASH_BAND_CAPACITY || !valueIsInteger(key) || asInteger(key) <= 0) return;
			const u32 bin = 32u - std::countl_zero(static_cast<u32>(asInteger(key) - 1));
			const u32 address = liveAddress() + 4u * (bin + 1u);
			slots.memory->writeRamRecordWord(address, slots.memory->readRamRecordWord(address) + delta);
		}
		i32 next(u32 index) const {
			const u8* lane = slots.tags + 2u * count;
			if (count <= BYTE_LINK_CAPACITY) return static_cast<i8>(lane[index]);
			return static_cast<i32>(readLE32(lane + index * 4u));
		}
		void setNext(u32 index, i32 next) const {
			if (count <= BYTE_LINK_CAPACITY) {
				if constexpr (BulkWrite) slots.tags[2u * count + index] = static_cast<u8>(next);
				else slots.memory->writeRamRecordByte(links + index, static_cast<u8>(next));
			} else {
				if constexpr (BulkWrite) writeLE32(slots.tags + 2u * count + index * 4u, static_cast<u32>(next));
				else slots.memory->writeRamRecordWord(links + index * 4u, static_cast<u32>(next));
			}
		}
		int findNode(const Value& key, u32 home, bool matchDead = false) const;
		int scanStringNodes(StringId key, i32& node, u32& available) const;
		int findString(StringId key, u32 home, u32* linkCycles = nullptr) const;
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
	template<bool BulkWrite = false>
	HashStorage<BulkWrite> hashBody(u32 count) const {
		return hashBodyAt<BulkWrite>(hashAddress(), count);
	}
	template<bool BulkWrite = false>
	HashStorage<BulkWrite> hashBodyAt(u32 storage, u32 count) const {
		u8* words = m_memory->ramData() + (storage & RAM_RECORD_WORD_MASK);
		return {{m_memory, words, words + 8u * count}, count, storage + 10u * count};
	}
	static Value findStringField(const HashBody& body, StringId key, int& slot, u32* linkCycles);
	static bool loadHashEntry(const HashBody& body, u32 slot, Value& key, Value& value);
	u32 nextStoredEntry(const HashBody& body, u32 position, Value& key, Value& value) const;
	template <HashStore Policy>
	int assignHash(Value key, Value value, const StringId& assignKey, int slot = TABLE_HASH_UNPROBED) noexcept;
	int assignProbedHash(const HashBody& body, int nodeIndex, Value value, const StringId& assignKey) noexcept;
	u32 newIndexMetatable() const;
	void eraseHashNode(const HashBody& body, size_t index, Value key);
	Value getCanonical(const Value& key) const;
	Value getHash(const Value& key) const;
	template <bool Assignment = false, bool OwnMiss = false, typename Lookup>
	void resolveIndexChain(int slot, const StringId& methodKey, TableLookupResult& result, Lookup&& lookup,
		u32 visitLimit = TABLE_INDEX_CHAIN_LIMIT, u32* linkCycles = nullptr) const;

	ValueSlots<false> values() const { u8* words = m_memory->ramData() + (arrayAddress() & RAM_RECORD_WORD_MASK);
		return {m_memory, words, words + arrayCapacity() * 4u}; }

	Memory* m_memory;
	u32 m_address;
};

} // namespace bmsx
