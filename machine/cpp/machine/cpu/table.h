#pragma once

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
inline constexpr int TABLE_INDEX_CHAIN_EXHAUSTED = -2;
inline constexpr int TABLE_STORE_REQUIRES_GROWTH = -2;

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
	bool resolveIndex(
		StringId indexKey,
		const Value& key,
		Value& value
	) const {
		return resolveIndexChain(indexKey, value, [&key](const Table& table) {
			return table.get(key);
		});
	}
	bool resolveIntegerIndex(StringId indexKey, int key, Value& value) const {
		return resolveIndexChain(indexKey, value, [key](const Table& table) {
			return table.getInteger(key);
		});
	}
	bool resolveStringIndex(StringId indexKey, StringId key, Value& value) const {
		return resolveIndexChain(indexKey, value, [key](const Table& table) {
			return table.getStringKey(key);
		});
	}
	int resolveStringIndexCached(
		StringId indexKey,
		StringId key,
		int predictedSlot,
		Value& value
	) const {
		const Table* current = this;
		for (int depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			value = current->getStringKeyCached(key, predictedSlot);
			if (!isNil(value)) {
				return predictedSlot;
			}
			current = current->metatableIndexTable(indexKey);
			if (!current) {
				return -1;
			}
		}
		return TABLE_INDEX_CHAIN_EXHAUSTED;
	}
	// Pure boundary search; also the generated-code entry point.
	static double length(const Table* table) noexcept;
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
	bool nextEntry(const Value& after, Value& key, Value& value) const;
	u32 captureSnapshot(CpuSnapshot& snapshot, const CpuSnapshotValueWriter& writeValue) const;
	void restoreSnapshot(const CpuSnapshotReader& reader, u32 offset);
	size_t trackedHeapBytes() const;
	void prepareRestoreStorage(size_t arrayCapacity, size_t hashCapacity);

	Table* metatable = nullptr;

private:
	bool getArraySlot(size_t slot, Value& value) const {
		if (slot >= m_array.size()) return false;
		const Value own = m_array[slot];
		if (isNil(own) && metatable) return false;
		value = own;
		return true;
	}

	struct StorageDeleter {
		void operator()(void* ptr) const noexcept { ::operator delete(ptr); }
	};

	void updateLengthHint(size_t slot, bool present) {
		if (present) {
			if (slot == m_lengthHint) ++m_lengthHint;
		} else if (slot + 1 == m_lengthHint) {
			--m_lengthHint;
		}
	}
	void setArraySlot(size_t slot, const Value& value) {
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
	bool resolveIndexChain(StringId indexKey, Value& value, Lookup&& lookup) const {
		const Table* current = this;
		for (int depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; ++depth) {
			value = lookup(*current);
			if (!isNil(value)) {
				return true;
			}
			current = current->metatableIndexTable(indexKey);
			if (!current) {
				return true;
			}
		}
		return false;
	}

	LuaHeap& m_luaHeap;
	Span<Value> m_array;
	u32 m_lengthHint = 0;
	std::unique_ptr<void, StorageDeleter> m_storage;
	Value* m_hashKeys = nullptr;
	Value* m_hashValues = nullptr;
	int32_t* m_hashNext = nullptr;
	size_t m_hashSize = 0;
	int m_hashFree = -1;
};


} // namespace bmsx
