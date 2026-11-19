#pragma once

#include "machine/cpu/gc_object.h"

#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <new>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "machine/memory/memory.h"
#include "machine/cpu/snapshot.h"

namespace bmsx {
class GcHeap;

inline constexpr int TABLE_INDEX_CHAIN_LIMIT = 32;
inline constexpr int TABLE_STORE_REQUIRES_GROWTH = -2;

enum class TableLookupStatus : u32 { Resolved, ChainExhausted };

// Transient semantic result, not a guest allocation or a predicted-probe counter.
struct TableLookupResult {
	Value value;
	i32 slot;
	u32 extraVisits;
	TableLookupStatus status;
};

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
struct TableNativeFieldOffsets {
	size_t hashSize;
	size_t words, tags;
	size_t arraySize;
	size_t lengthHint;
	size_t metatable;
};
#endif

class Table : public GCObject {
public:
	Table(GcHeap& heap, size_t arrayCapacity, size_t hashCapacity, u32 storage);
	static constexpr u32 HEADER_BYTES = 32;
	static u32 storageBytes(size_t arraySize, size_t hashSize);
	void initializeStorage();
	void freeStorage();
	u32 storageAddress() const { return m_values.words ? RAM_BASE + m_values.words : 0; }
	Table(const Table&) = delete;
	Table& operator=(const Table&) = delete;
	static size_t hashCapacity(int hashSize);
	static size_t trackedHeapBytesForCapacities(size_t arrayCapacity, size_t hashCapacity);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	static TableNativeFieldOffsets nativeFieldOffsets();
#endif

	Value get(const Value& key) const;
	void set(const Value& key, const Value& value);
	bool getIntegerArrayKey(int key, Value& value) const {
		return getArraySlot(static_cast<size_t>(key) - 1u, value);
	}
	bool setIntegerArrayKey(int key, const Value& value) {
		const size_t slot = static_cast<size_t>(static_cast<u32>(key) - 1u);
		if (slot >= m_arraySize) {
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
	static int storeStringKeyWithoutGrowth(Table* table, StringId key, const Value& value) noexcept;
	static int storeStringKeyInNative(Table* table, StringId key, const Value& value) noexcept;
	void setStringKeyCached(StringId key, const Value& value, int& predictedSlot);
	Table* metatableIndexTable(StringId indexKey) const;
	void resolveIndex(StringId indexKey, const Value& key, TableLookupResult& result) const {
		resolveIndexChain(indexKey, result, [&key](const Table& table) {
			return table.get(key);
		});
	}
	void resolveIntegerIndex(StringId indexKey, int key, TableLookupResult& result) const {
		resolveIndexChain(indexKey, result, [key](const Table& table) {
			return table.getInteger(key);
		});
	}
	void resolveStringIndex(StringId indexKey, StringId key, TableLookupResult& result) const {
		resolveIndexChain(indexKey, result, [key](const Table& table) {
			return table.getStringKey(key);
		});
	}
	void resolveStringIndexCached(StringId indexKey, StringId key, int predictedSlot, TableLookupResult& result) const {
		const Table* current = this;
		for (int depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			const Value value = current->getStringKeyCached(key, predictedSlot);
			if (!isNil(value)) {
				result = {value, predictedSlot, static_cast<u32>(depth), TableLookupStatus::Resolved};
				return;
			}
			current = current->metatableIndexTable(indexKey);
			if (!current) {
				result = {valueNil(), -1, static_cast<u32>(depth), TableLookupStatus::Resolved};
				return;
			}
		}
		result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1;
		result.status = TableLookupStatus::ChainExhausted;
	}
	// Generated-code leaf: no allocation, guest callback or architectural write.
	// The caller commits result only when the returned chain status succeeds.
	static void loadStringIndex(const Table* table, StringId indexKey, StringId key, TableLookupResult& result) noexcept;
	// Pure boundary search; also the generated-code entry point.
	static i32 length(const Table* table, u32* probes = nullptr) noexcept;
	void clear();
	// Physical array positions followed by hash nodes, including vacant/dead slots.
	size_t storedSlotCount() const { return m_arraySize + m_hashSize; }
	// Constant-work inspection. Slot is in [0, storedSlotCount()); mutation invalidates
	// positions. False leaves key/value untouched. Does not invoke guest code.
	bool loadStoredEntry(size_t slot, Value& key, Value& value) const;
	template <typename Fn>
	void forEachEntry(Fn&& fn) const {
		for (size_t i = 0; i < m_arraySize; ++i) {
			if (!isNil(m_values.get(i))) {
				fn(valueInteger(static_cast<i32>(i + 1)), m_values.get(i));
			}
		}
		for (size_t i = 0; i < m_hashSize; ++i) {
			if (!isNil(m_values.get(hashKeySlot(i))) && !isNil(m_values.get(hashValueSlot(i)))) {
				fn(m_values.get(hashKeySlot(i)), m_values.get(hashValueSlot(i)));
			}
		}
	}
	template <typename ValueIsAlive>
	void clearWeakEntries(bool weakKeys, bool weakValues, ValueIsAlive&& valueIsAlive) {
		if (weakValues) {
			for (size_t i = 0; i < m_arraySize; ++i) {
				if (isNil(m_values.get(i)) || valueIsAlive(m_values.get(i))) {
					continue;
				}
				m_values.set(i, valueNil());
			}
		}
		for (size_t i = 0; i < m_hashSize; ++i) {
			const Value key = m_values.get(hashKeySlot(i));
			const Value value = m_values.get(hashValueSlot(i));
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
	u32 captureSnapshot(CpuSnapshot& snapshot, const CpuSnapshotValueWriter& writeValue) const;
	void restoreSnapshot(const CpuSnapshotReader& reader, u32 offset);
	size_t trackedHeapBytes() const;

	Table* metatable = nullptr;
	bool gcWeakListed = false;

private:
	bool getArraySlot(size_t slot, Value& value) const {
		if (slot >= m_arraySize) return false;
		const Value own = m_values.get(slot);
		if (isNil(own) && metatable) return false;
		value = own;
		return true;
	}

	void updateLengthHint(size_t slot, bool present) {
		if (present) {
			if (slot == m_lengthHint) ++m_lengthHint;
		} else if (slot + 1 == m_lengthHint) {
			--m_lengthHint;
		}
	}
	void setArraySlot(size_t slot, const Value& value) {
		writeBarrier();
		m_values.set(slot, value);
		updateLengthHint(slot, !isNil(value));
	}

	size_t hashKeySlot(size_t index) const { return m_arraySize + index; }
	size_t hashValueSlot(size_t index) const { return m_arraySize + m_hashSize + index; }
	bool getArrayIndex(const Value& key, int& outIndex) const;
	bool hasIntegerKey(u32 key) const;
	size_t hashValue(const Value& key) const;
	bool keyEquals(const Value& a, const Value& b) const;
	int findNodeIndex(const Value& key, bool matchDead = false) const;
	int findStringNodeIndex(StringId key) const;
	int findNextLiveHashIndex(size_t start) const;
	int getFreeIndex();
	void rehash(const Value& key, const Value& value);
	void resize(size_t newArraySize, size_t newHashSize, const Value& key, const Value& value);
	void bindStorage(size_t arraySize, size_t hashSize, u32 address);
	struct TableValues {
		Memory* memory;
		u32 words, tags;
		Value get(size_t index) const {
			return valueFromTag(static_cast<ValueTag>(memory->readRamRecordByte(tags + static_cast<u32>(index))),
				memory->readRamRecordWord(words + static_cast<u32>(index) * 4u));
		}
		void set(size_t index, Value value) const {
			memory->writeRamRecordWord(words + static_cast<u32>(index) * 4u, valuePayload(value));
			memory->writeRamRecordByte(tags + static_cast<u32>(index), static_cast<u8>(valueTag(value)));
		}
	};
	i32 hashNext(size_t index) const {
		return static_cast<i32>(m_values.memory->readRamRecordWord(m_hashLinks + static_cast<u32>(index) * 4u));
	}
	void setHashNext(size_t index, i32 next) {
		m_values.memory->writeRamRecordWord(m_hashLinks + static_cast<u32>(index) * 4u, static_cast<u32>(next));
	}
	int rawSet(const Value& key, const Value& value);
	int insertHash(const Value& key, const Value& value);
	int insertHashWithoutGrowth(const Value& key, const Value& value) noexcept;
	void removeFromHash(const Value& key);
	void markHashNodeDead(size_t index);
	template <typename Lookup>
	void resolveIndexChain(StringId indexKey, TableLookupResult& result, Lookup&& lookup) const {
		const Table* current = this;
		for (int depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			const Value value = lookup(*current);
			if (!isNil(value)) {
				result = {value, -1, static_cast<u32>(depth), TableLookupStatus::Resolved};
				return;
			}
			current = current->metatableIndexTable(indexKey);
			if (!current) {
				result = {valueNil(), -1, static_cast<u32>(depth), TableLookupStatus::Resolved};
				return;
			}
		}
		result.extraVisits = TABLE_INDEX_CHAIN_LIMIT - 1;
		result.status = TableLookupStatus::ChainExhausted;
	}

	GcHeap& m_heap;
	TableValues m_values;
	size_t m_arraySize = 0;
	u32 m_lengthHint = 0;
	u32 m_hashLinks = 0;
	size_t m_hashSize = 0;
	int m_hashFree = -1;
};


} // namespace bmsx
