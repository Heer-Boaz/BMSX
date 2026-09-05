#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <new>
#include <vector>

#include "machine/cpu/value.h"

namespace bmsx {
class LuaHeap;

inline constexpr int TABLE_INDEX_CHAIN_LIMIT = 32;
inline constexpr int TABLE_INDEX_CHAIN_EXHAUSTED = -2;

struct TableHashNodeState {
	Value key = valueNil();
	Value value = valueNil();
	int next = -1;
};

struct TableRuntimeState {
	std::vector<Value> array;
	size_t arrayLength = 0;
	std::vector<TableHashNodeState> hash;
	int hashFree = -1;
	Table* metatable = nullptr;
};

class Table : public GCObject {
public:
	Table(LuaHeap& luaHeap, size_t arrayCapacity = 0, size_t hashCapacity = 0);
	static size_t hashCapacity(int hashSize);
	static size_t trackedHeapBytesForCapacities(size_t arrayCapacity, size_t hashCapacity);

	Value get(const Value& key) const;
	void set(const Value& key, const Value& value);
	bool getNumberArrayKey(double key, Value& value) const {
		int index = 0;
		if (!getNumberArrayIndex(key, index)
			|| index >= static_cast<int>(m_array.size())) {
			return false;
		}
		value = m_array[static_cast<size_t>(index)];
		return true;
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
		const size_t slot = static_cast<size_t>(key - 1);
		if (slot >= m_array.size()) {
			return false;
		}
		value = m_array[slot];
		return true;
	}
	bool setIntegerArrayKey(int key, const Value& value) {
		const size_t slot = static_cast<size_t>(key - 1);
		if (slot >= m_array.size()) {
			return false;
		}
		setIntegerArraySlot(slot, value);
		return true;
	}
	Value getInteger(int index) const;
	void setInteger(int index, const Value& value);
	Value getStringKey(StringId key) const;
	Value getStringKeyCached(StringId key, int& predictedSlot) const;
	int setStringKey(StringId key, const Value& value);
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
	int length() const;
	void clear();
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
				if (i < m_arrayLength) {
					m_arrayLength = i;
				}
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
	TableRuntimeState captureRuntimeState() const;
	void restoreRuntimeState(const TableRuntimeState& state);
	size_t trackedHeapBytes() const;
	void prepareRestoreStorage(size_t arrayCapacity, size_t hashCapacity);

	Table* metatable = nullptr;

private:
	struct HashStorageDeleter {
		void operator()(void* ptr) const noexcept { ::operator delete(ptr); }
	};

	void setArraySlot(size_t slot, const Value& value) {
		m_array[slot] = value;
		if (isNil(value)) {
			if (slot < m_arrayLength) {
				m_arrayLength = slot;
			}
		} else if (slot == m_arrayLength) {
			size_t newLength = m_arrayLength;
			while (newLength < m_array.size() && !isNil(m_array[newLength])) {
				++newLength;
			}
			m_arrayLength = newLength;
		}
	}
	void setIntegerArraySlot(size_t slot, const Value& value) {
		m_array[slot] = value;
		if (isNil(value)) {
			if (slot < m_arrayLength) {
				m_arrayLength = slot;
			}
		} else if (slot == m_arrayLength) {
			updateArrayLengthFrom(m_arrayLength);
		}
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
	bool hasArrayIndex(size_t index) const;
	void updateArrayLengthFrom(size_t startIndex);
	size_t hashValue(const Value& key) const;
	bool keyEquals(const Value& a, const Value& b) const;
	int findNodeIndex(const Value& key) const;
	int findNextLiveHashIndex(size_t start) const;
	int findNodeIndexForNext(const Value& key) const;
	int getFreeIndex();
	void rehash(const Value& key, const Value& value);
	void resize(size_t newArraySize, size_t newHashSize, const Value& key, const Value& value);
	void allocateHash(size_t size);
	int rawSet(const Value& key, const Value& value);
	int insertHash(const Value& key, const Value& value);
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
	std::vector<Value> m_array;
	size_t m_arrayLength = 0;
	std::unique_ptr<void, HashStorageDeleter> m_hashStorage;
	Value* m_hashKeys = nullptr;
	Value* m_hashValues = nullptr;
	int32_t* m_hashNext = nullptr;
	size_t m_hashSize = 0;
	int m_hashFree = -1;
	size_t m_hashDeadCount = 0;
};


} // namespace bmsx
