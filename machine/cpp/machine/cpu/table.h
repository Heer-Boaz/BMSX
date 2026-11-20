#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <new>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "machine/cpu/table_lookup.h"
#include "machine/memory/memory.h"

namespace bmsx {
class GcHeap;

inline constexpr int TABLE_INDEX_CHAIN_LIMIT = 32;
inline constexpr int TABLE_STORE_REQUIRES_GROWTH = -2;

enum class TableHeader : u32 {
	Kind = 0, Gray = 4, Metatable = 8, Storage = 12, Array = 16, Hash = 20, Length = 24, Free = 28,
};

class TableRecord {
public:
	TableRecord(GcHeap& heap, u32 address);
	static constexpr u32 HEADER_BYTES = 32;
	static u32 storageBytes(size_t arraySize, size_t hashSize);
	void initialize(size_t arrayCapacity, size_t hashCapacity);
	void freeRecord();
	u32 address() const { return m_address; }
	u32 storageAddress() const { return readHeader(TableHeader::Storage); }
	u32 arrayCapacity() const { return readHeader(TableHeader::Array); }
	u32 hashSlots() const { return readHeader(TableHeader::Hash); }
	u32 lengthHint() const { return readHeader(TableHeader::Length); }
	i32 hashFree() const { return static_cast<i32>(readHeader(TableHeader::Free)); }
	static size_t hashCapacity(int hashSize);
	static size_t trackedHeapBytesForCapacities(size_t arrayCapacity, size_t hashCapacity);

	Value get(const Value& key) const;
	void set(const Value& key, const Value& value);
	bool getIntegerArrayKey(int key, Value& value) const {
		return getArraySlot(static_cast<size_t>(key) - 1u, value);
	}
	bool setIntegerArrayKey(int key, const Value& value) {
		const size_t slot = static_cast<size_t>(static_cast<u32>(key) - 1u);
		if (slot >= arrayCapacity()) {
			return false;
		}
		setArraySlot(slot, value);
		return true;
	}
	Value getInteger(int index) const;
	void setInteger(int index, const Value& value);
	Value getStringKey(StringId key) const;
	Value getStringKeyCached(StringId key, int& predictedSlot) const;
	int setStringKey(StringId key, const Value& value);
	// Completes mutations within allocated storage; growth leaves the mapping unchanged.
	static int storeStringKeyWithoutGrowth(TableRecord* table, StringId key, const Value& value) noexcept;
	static int storeStringKeyInNative(GcHeap* heap, u32 address, StringId key, const Value& value) noexcept;
	void setStringKeyCached(StringId key, const Value& value, int& predictedSlot);
	void resolveIndex(StringId indexKey, const Value& key, TableLookupResult& result) const;
	void resolveIntegerIndex(StringId indexKey, int key, TableLookupResult& result) const;
	void resolveStringIndex(StringId indexKey, StringId key, TableLookupResult& result) const;
	void resolveStringIndexCached(StringId indexKey, StringId key, int predictedSlot, TableLookupResult& result) const;
	void resolveStringIndexPath(StringId indexKey, StringId key, int receiverPrediction,
		TableLookupResult& result, TableStringReadCache& cache) const;
	// Generated-code leaf: no allocation, guest callback or architectural write.
	// The caller commits result only when the returned chain status succeeds.
	static void loadStringIndex(const TableRecord* table, StringId indexKey, StringId key, TableLookupResult& result) noexcept;
	static void loadStringIndexInNative(GcHeap* heap, const TableReadRequest& request, TableLookupResult& result, TableStringReadCache& cache) noexcept;
	static void loadIndexInNative(GcHeap* heap, const TableReadRequest& request, TableLookupResult& result, TableStringReadCache& cache) noexcept;
	// Pure boundary search; also the generated-code entry point.
	static i32 length(const TableRecord* table, u32* probes = nullptr) noexcept;
	void clear();
	// Physical array positions followed by hash nodes, including vacant/dead slots.
	size_t storedSlotCount() const { return arrayCapacity() + hashSlots(); }
	// Constant-work inspection. Slot is in [0, storedSlotCount()); mutation invalidates
	// positions. False leaves key/value untouched. Does not invoke guest code.
	bool loadStoredEntry(size_t slot, Value& key, Value& value) const;
	size_t scanSlots() const { return arrayCapacity() + 2u * hashSlots(); }
	template <typename Fn>
	void forEachEntry(Fn&& fn) const {
		const u32 array = arrayCapacity(), hash = hashSlots(), words = storageAddress();
		const TableValues slots{m_memory, words, words + (array + 3u * hash) * 4u};
		for (u32 i = 0; i < array; ++i) {
			const Value value = slots.get(i);
			if (!isNil(value)) fn(valueInteger(static_cast<i32>(i + 1)), value);
		}
		for (u32 i = 0; i < hash; ++i) {
			const Value key = slots.get(array + i);
			if (isNil(key)) continue;
			const Value value = slots.get(array + hash + i);
			if (!isNil(value)) fn(key, value);
		}
	}
	template <typename ValueIsAlive>
	void clearWeakEntries(bool weakKeys, bool weakValues, ValueIsAlive&& valueIsAlive) {
		if (weakValues) {
			for (size_t i = 0; i < arrayCapacity(); ++i) {
				if (isNil(values().get(i)) || valueIsAlive(values().get(i))) {
					continue;
				}
				values().set(i, valueNil());
			}
		}
		for (size_t i = 0; i < hashSlots(); ++i) {
			const Value key = values().get(hashKeySlot(i));
			const Value value = values().get(hashValueSlot(i));
			if (isNil(key) || isNil(value)) {
				continue;
			}
			const bool keyIsAlive = !weakKeys || valueIsAlive(key);
			const bool valueIsStillAlive = !weakValues || valueIsAlive(value);
			if (keyIsAlive && valueIsStillAlive) {
				continue;
			}
			markHashNodeDead(i);
		}
	}
	// Returns inspected Value slots; a nil output key denotes exhaustion.
	size_t nextEntry(const Value& after, Value& key, Value& value) const;
	size_t trackedHeapBytes() const;
	u32 metatableAddress() const { return readHeader(TableHeader::Metatable); }
	void setMetatableAddress(u32 address);

private:

	bool getArraySlot(size_t slot, Value& value) const {
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

	size_t hashKeySlot(size_t index) const { return arrayCapacity() + index; }
	size_t hashValueSlot(size_t index) const { return arrayCapacity() + hashSlots() + index; }
	bool getArrayIndex(const Value& key, int& outIndex) const;
	bool hasIntegerKey(u32 key) const;
	size_t hashValue(const Value& key) const;
	int findNodeIndex(const Value& key, bool matchDead = false) const;
	int findNextLiveHashIndex(size_t start) const;
	void rehash(const Value& key, const Value& value);
	void resize(size_t newArraySize, size_t newHashSize, const Value& key, const Value& value);
	void bindStorage(size_t arraySize, size_t hashSize, u32 address);
	void initializeStorage();
	void freeStorage();
	u32 readHeader(TableHeader field) const { return m_memory->readRamRecordWord(m_address + static_cast<u32>(field)); }
	void writeHeader(TableHeader field, u32 word) { m_memory->writeRamRecordWord(m_address + static_cast<u32>(field), word); }
	struct TableValues {
		Memory* memory;
		u32 words, tags;
		ValueTag tag(u32 index) const {
			return static_cast<ValueTag>(memory->readRamRecordByte(tags + index));
		}
		u32 word(u32 index) const { return memory->readRamRecordWord(words + index * 4u); }
		Value get(size_t index) const {
			const auto slot = static_cast<u32>(index);
			return valueFromTag(tag(slot), word(slot));
		}
		void set(size_t index, Value value) const {
			memory->writeRamRecordWord(words + static_cast<u32>(index) * 4u, valuePayload(value));
			memory->writeRamRecordByte(tags + static_cast<u32>(index), static_cast<u8>(valueTag(value)));
		}
	};
	struct HashBody {
		TableValues slots;
		u32 array, count, links;
		int findString(StringId key) const;
		i32 next(u32 index) const {
			return static_cast<i32>(slots.memory->readRamRecordWord(links + index * 4u));
		}
		void setNext(u32 index, i32 next) const {
			slots.memory->writeRamRecordWord(links + index * 4u, static_cast<u32>(next));
		}
	};
	HashBody hashBody(u32 count) const {
		const u32 array = arrayCapacity(), words = storageAddress();
		const u32 links = words + (array + 2u * count) * 4u;
		return {{m_memory, words, links + count * 4u}, array, count, links};
	}
	int getFreeIndex(const HashBody& body);
	int rawSet(const Value& key, const Value& value);
	int insertHash(const Value& key, const Value& value);
	int insertHashWithoutGrowth(const HashBody& body, const Value& key, const Value& value) noexcept;
	void removeFromHash(const Value& key);
	void markHashNodeDead(size_t index);
	Value getCanonical(const Value& key) const;
	Value getHash(const Value& key) const;
	int findNodeIndex(const HashBody& body, const Value& key, bool matchDead = false) const;
	template <bool RememberPath = false, typename Lookup>
	void resolveIndexChain(StringId indexKey, int slot, TableLookupResult& result, Lookup&& lookup,
		TableStringReadCache* cache = nullptr) const;

	TableValues values() const {
		const u32 words = storageAddress();
		return {m_memory, words, words + (arrayCapacity() + 3u * hashSlots()) * 4u};
	}

	GcHeap* m_heap;
	Memory* m_memory;
	u32 m_address;
};

inline TableRecord asTable(Value value, GcHeap& heap) { return TableRecord(heap, valuePayload(value)); }

} // namespace bmsx
