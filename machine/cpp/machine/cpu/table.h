#pragma once

#include "machine/cpu/gc_object.h"

#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <new>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "machine/cpu/snapshot.h"

namespace bmsx {
class LuaHeap;

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
	size_t keys;
	size_t values;
	size_t arrayData;
	size_t arraySize;
	size_t lengthHint;
	size_t metatable;
};
#endif

class Table : public GCObject {
public:
	Table(LuaHeap& luaHeap, size_t arrayCapacity = 0, size_t hashCapacity = 0);
	~Table();
	Table(const Table&) = delete;
	Table& operator=(const Table&) = delete;
	static size_t hashCapacity(int hashSize);
	static size_t trackedHeapBytesForCapacities(size_t arrayCapacity, size_t hashCapacity);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	static TableNativeFieldOffsets nativeFieldOffsets();
#endif

	Value get(const Value& key) const;
	void set(const Value& key, const Value& value);
	bool getNumberArrayKey(double key, Value& value) const {
		int index = 0;
		return getNumberArrayIndex(key, index) && getArraySlot(static_cast<size_t>(index), value);
	}
	bool setNumberArrayKey(double key, const Value& value) {
		int index = 0;
		if (!getNumberArrayIndex(key, index)
			|| index >= static_cast<int>(m_array.size())) {
			return false;
		}
		setArraySlot(static_cast<size_t>(index), value);
		return true;
	}
	bool getIntegerArrayKey(int key, Value& value) const {
		return getArraySlot(static_cast<size_t>(key) - 1u, value);
	}
	bool setIntegerArrayKey(int key, const Value& value) {
		const size_t slot = static_cast<size_t>(key - 1);
		if (slot >= m_array.size()) {
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
	void setStringKeyCached(StringId key, const Value& value, int& predictedSlot);
	Table* metatableIndexTable(StringId indexKey) const {
		if (!metatable) {
			return nullptr;
		}
		const Value indexer = metatable->getStringKey(indexKey);
		return valueIsTable(indexer) ? asTable(indexer) : nullptr;
	}
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
	static double length(const Table* table, u32* probes = nullptr) noexcept;
	void clear();
	// Physical array positions followed by hash nodes, including vacant/dead slots.
	size_t storedSlotCount() const { return m_array.size() + m_hashSize; }
	// Constant-work inspection. Slot is in [0, storedSlotCount()); mutation invalidates
	// positions. False leaves key/value untouched. Does not invoke guest code.
	bool loadStoredEntry(size_t slot, Value& key, Value& value) const;
	template <typename Fn>
	void forEachEntry(Fn&& fn) const {
		for (size_t i = 0; i < m_array.size(); ++i) {
			if (!isNil(m_array[i])) {
				fn(valueNumber(static_cast<double>(i + 1)), m_array[i]);
			}
		}
		for (size_t i = 0; i < m_hashSize; ++i) {
			if (!isNil(m_hashKeys[i]) && !isNil(m_hashValues[i])) {
				fn(m_hashKeys[i], m_hashValues[i]);
			}
		}
	}
	template <typename ValueIsAlive>
	void clearWeakEntries(bool weakKeys, bool weakValues, ValueIsAlive&& valueIsAlive) {
		if (weakValues) {
			for (size_t i = 0; i < m_array.size(); ++i) {
				if (isNil(m_array[i]) || valueIsAlive(m_array[i])) {
					continue;
				}
				m_array[i] = valueNil();
			}
		}
		for (size_t i = 0; i < m_hashSize; ++i) {
			const Value key = m_hashKeys[i];
			const Value value = m_hashValues[i];
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
	void prepareRestoreStorage(size_t arrayCapacity, size_t hashCapacity);

	Table* metatable = nullptr;
	bool gcWeakListed = false;

private:
	bool getArraySlot(size_t slot, Value& value) const {
		if (slot >= m_array.size()) return false;
		const Value own = m_array[slot];
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
		m_array[slot] = value;
		updateLengthHint(slot, !isNil(value));
	}

	bool getArrayIndex(const Value& key, int& outIndex) const;
	bool getNumberArrayIndex(double key, int& outIndex) const {
		if (!(key >= 1.0
			&& key <= static_cast<double>(std::numeric_limits<int>::max()))) {
			return false;
		}
		const int index = static_cast<int>(key);
		if (static_cast<double>(index) != key) {
			return false;
		}
		outIndex = index - 1;
		return true;
	}
	bool hasIntegerKey(uint64_t key) const;
	size_t hashValue(const Value& key) const;
	bool keyEquals(const Value& a, const Value& b) const;
	int findNodeIndex(const Value& key, bool matchDead = false) const;
	int findStringNodeIndex(StringId key) const;
	int findNextLiveHashIndex(size_t start) const;
	int getFreeIndex();
	void rehash(const Value& key, const Value& value);
	void resize(size_t newArraySize, size_t newHashSize, const Value& key, const Value& value);
	void allocateStorage(size_t arraySize, size_t hashSize);
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

	LuaHeap& m_luaHeap;
	Span<Value> m_array;
	u32 m_lengthHint = 0;
	void* m_storage = nullptr;
	Value* m_hashKeys = nullptr;
	Value* m_hashValues = nullptr;
	int32_t* m_hashNext = nullptr;
	size_t m_hashSize = 0;
	int m_hashFree = -1;
};


} // namespace bmsx
