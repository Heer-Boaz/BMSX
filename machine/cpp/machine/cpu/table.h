#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
#include <vector>

#include "machine/cpu/value.h"

namespace bmsx {
class LuaHeap;

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
	Value getInteger(int index) const;
	void setInteger(int index, const Value& value);
	Value getStringKey(StringId key) const;
	void setStringKey(StringId key, const Value& value);
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
		bool changed = false;
		if (weakValues) {
			for (size_t i = 0; i < m_array.size(); ++i) {
				if (isNil(m_array[i]) || valueIsAlive(m_array[i])) {
					continue;
				}
				m_array[i] = valueNil();
				if (i < m_arrayLength) {
					m_arrayLength = i;
				}
				changed = true;
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
			changed = true;
		}
		if (changed) {
			bumpVersion();
		}
	}
	bool nextEntry(const Value& after, Value& key, Value& value) const;
	TableRuntimeState captureRuntimeState() const;
	uint32_t restoreRuntimeState(const TableRuntimeState& state);
	size_t trackedHeapBytes() const;
	void prepareRestoreStorage(size_t arrayCapacity, size_t hashCapacity);

	Table* metatable = nullptr;
	uint32_t version() const { return m_version; }
	void bumpVersion() {
		++m_version;
		if (m_version == 0) {
			m_version = 1;
		}
	}

private:
	struct HashStorageDeleter {
		void operator()(void* ptr) const noexcept { ::operator delete(ptr); }
	};

	bool getArrayIndex(const Value& key, int& outIndex) const;
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
	void rawSet(const Value& key, const Value& value);
	void insertHash(const Value& key, const Value& value);
	void removeFromHash(const Value& key);
	void markHashNodeDead(size_t index);

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
	uint32_t m_version = 1;
};


} // namespace bmsx
