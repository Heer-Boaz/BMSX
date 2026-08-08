#include "machine/cpu/table.h"

#include <algorithm>
#include <array>
#include <cmath>

#include "machine/common/numeric.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/lua_heap.h"

namespace bmsx {

namespace {
constexpr size_t kTableHeapBytes = 32;
constexpr size_t kTableArraySlotHeapBytes = 8;
constexpr size_t kTableHashSlotHeapBytes = 20;
constexpr int32_t kTableHashNextEnd = -1;
} // namespace
Table::Table(LuaHeap& luaHeap, size_t arrayCapacity, size_t hashCapacity)
	: m_luaHeap(luaHeap) {
	if (arrayCapacity > 0) {
		m_array.resize(arrayCapacity, valueNil());
	}
	if (hashCapacity > 0) {
		allocateHash(hashCapacity);
		m_hashFree = static_cast<int>(hashCapacity) - 1;
	}
}

size_t Table::hashCapacity(int hashSize) {
	return hashSize > 0
		? nextPowerOfTwo(static_cast<size_t>(hashSize))
		: 0;
}

size_t Table::trackedHeapBytesForCapacities(size_t arrayCapacity, size_t hashCapacity) {
	return kTableHeapBytes
		+ (arrayCapacity * kTableArraySlotHeapBytes)
		+ (hashCapacity * kTableHashSlotHeapBytes);
}

bool Table::getArrayIndex(const Value& key, int& outIndex) const {
	if (!valueIsNumber(key)) {
		return false;
	}
	return getNumberArrayIndex(asNumber(key), outIndex);
}

bool Table::hasArrayIndex(size_t index) const {
	if (index < m_array.size()) {
		return !isNil(m_array[index]);
	}
	if (m_hashSize == 0) {
		return false;
	}
	Value key = valueNumber(static_cast<double>(index + 1));
	const int nodeIndex = findNodeIndex(key);
	return nodeIndex >= 0 && !isNil(m_hashValues[static_cast<size_t>(nodeIndex)]);
}

void Table::updateArrayLengthFrom(size_t startIndex) {
	size_t newLength = startIndex;
	while (hasArrayIndex(newLength)) {
		++newLength;
	}
	m_arrayLength = newLength;
}

size_t Table::hashValue(const Value& key) const {
	return ValueHash{}(key);
}

bool Table::keyEquals(const Value& a, const Value& b) const {
	return ValueEq{}(a, b);
}

int Table::findNodeIndex(const Value& key) const {
	if (m_hashSize == 0) {
		return -1;
	}
	size_t mask = m_hashSize - 1;
	int index = static_cast<int>(hashValue(key) & mask);
	while (index >= 0) {
		const Value nodeKey = m_hashKeys[static_cast<size_t>(index)];
		if (!isNil(nodeKey) && keyEquals(nodeKey, key)) {
			return index;
		}
		index = m_hashNext[static_cast<size_t>(index)];
	}
	return -1;
}

int Table::findNextLiveHashIndex(size_t start) const {
	for (size_t index = start; index < m_hashSize; ++index) {
		if (!isNil(m_hashKeys[index]) && !isNil(m_hashValues[index])) {
			return static_cast<int>(index);
		}
	}
	return -1;
}

int Table::findNodeIndexForNext(const Value& key) const {
	if (m_hashSize == 0) {
		return -1;
	}
	uint32_t deadKeyHashId = 0;
	if (valueIsTable(key) || valueIsClosure(key)) {
		deadKeyHashId = valueObjectHashId(key);
	}
	const size_t mask = m_hashSize - 1;
	int index = static_cast<int>(hashValue(key) & mask);
	while (index >= 0) {
		const size_t slot = static_cast<size_t>(index);
		const Value nodeKey = m_hashKeys[slot];
		if ((!isNil(nodeKey) && keyEquals(nodeKey, key))
			|| (isNil(nodeKey)
				&& deadKeyHashId != 0
				&& valueIsNumber(m_hashValues[slot])
				&& asNumber(m_hashValues[slot]) == static_cast<double>(deadKeyHashId))) {
			return index;
		}
		index = m_hashNext[slot];
	}
	return -1;
}

int Table::getFreeIndex() {
	int start = m_hashFree >= 0 ? m_hashFree : static_cast<int>(m_hashSize) - 1;
	for (int i = start; i >= 0; --i) {
		if (isNil(m_hashKeys[static_cast<size_t>(i)])
			&& isNil(m_hashValues[static_cast<size_t>(i)])) {
			m_hashFree = i - 1;
			return i;
		}
	}
	m_hashFree = -1;
	return -1;
}

void Table::rehash(const Value& key, const Value& value) {
	size_t totalKeys = 0;
	std::array<size_t, sizeof(size_t) * 8u> counts{};
	size_t countBins = 0;

	auto countIntegerKey = [&counts, &countBins](size_t index) {
		const size_t log = ceilLog2(index);
		while (countBins <= log) {
			counts[countBins] = 0;
			++countBins;
		}
		counts[log] += 1;
	};

	for (size_t i = 0; i < m_array.size(); ++i) {
		if (!isNil(m_array[i])) {
			totalKeys += 1;
			countIntegerKey(i + 1);
		}
	}
	for (size_t i = 0; i < m_hashSize; ++i) {
		const Value key = m_hashKeys[i];
		if (!isNil(key) && !isNil(m_hashValues[i])) {
			totalKeys += 1;
			int index = 0;
			if (getArrayIndex(key, index)) {
				countIntegerKey(static_cast<size_t>(index) + 1);
			}
		}
	}
	if (!isNil(key)) {
		totalKeys += 1;
		int index = 0;
		if (getArrayIndex(key, index)) {
			countIntegerKey(static_cast<size_t>(index) + 1);
		}
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
	resize(arraySize, hashSize, key, value);
}

void Table::resize(
	size_t newArraySize,
	size_t newHashSize,
	const Value& key,
	const Value& value
) {
	const size_t previousBytes = trackedHeapBytes();
	const size_t resizedBytes = trackedHeapBytesForCapacities(newArraySize, newHashSize);
	if (resizedBytes > previousBytes) {
		m_luaHeap.reserve(resizedBytes - previousBytes, valueTable(this), key, value);
	}
	std::vector<Value> oldArray = std::move(m_array);
	std::unique_ptr<void, HashStorageDeleter> oldHashStorage = std::move(m_hashStorage);
	Value* oldHashKeys = m_hashKeys;
	Value* oldHashValues = m_hashValues;
	const size_t oldHashSize = m_hashSize;

	m_array.assign(newArraySize, valueNil());
	m_arrayLength = 0;
	allocateHash(newHashSize);
	m_hashFree = newHashSize > 0 ? static_cast<int>(newHashSize) - 1 : -1;

	for (size_t i = 0; i < oldArray.size(); ++i) {
		if (!isNil(oldArray[i])) {
			rawSet(valueNumber(static_cast<double>(i + 1)), oldArray[i]);
		}
	}
	for (size_t i = 0; i < oldHashSize; ++i) {
		const Value key = oldHashKeys[i];
		if (!isNil(key) && !isNil(oldHashValues[i])) {
			rawSet(key, oldHashValues[i]);
		}
	}
	oldHashStorage.reset();
	if (resizedBytes < previousBytes) {
		m_luaHeap.release(previousBytes - resizedBytes);
	}
}

void Table::allocateHash(size_t size) {
	m_hashSize = size;
	m_hashDeadCount = 0;
	if (size == 0) {
		m_hashStorage.reset();
		m_hashKeys = nullptr;
		m_hashValues = nullptr;
		m_hashNext = nullptr;
		return;
	}
	const size_t byteCount = (size * sizeof(Value) * 2) + (size * sizeof(int32_t));
	m_hashStorage.reset(::operator new(byteCount));
	m_hashKeys = static_cast<Value*>(m_hashStorage.get());
	m_hashValues = m_hashKeys + size;
	m_hashNext = reinterpret_cast<int32_t*>(m_hashValues + size);
	std::fill(m_hashKeys, m_hashKeys + size, valueNil());
	std::fill(m_hashValues, m_hashValues + size, valueNil());
	std::fill(m_hashNext, m_hashNext + size, kTableHashNextEnd);
}

int Table::rawSet(const Value& key, const Value& value) {
	int index = 0;
	bool isArrayKey = getArrayIndex(key, index);
	if (isArrayKey) {
		size_t idx = static_cast<size_t>(index);
		if (idx < m_array.size()) {
			setArraySlot(idx, value);
			return -1;
		}
	}
	const int nodeIndex = insertHash(key, value);
	if (isArrayKey && static_cast<size_t>(index) == m_arrayLength) {
		updateArrayLengthFrom(m_arrayLength);
	}
	return nodeIndex;
}

int Table::insertHash(const Value& key, const Value& value) {
	if (m_hashDeadCount > 0) {
		rehash(key, value);
		return rawSet(key, value);
	}
	if (m_hashSize == 0) {
		rehash(key, value);
		return rawSet(key, value);
	}
	size_t mask = m_hashSize - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	const size_t mainSlot = static_cast<size_t>(mainIndex);
	const Value mainKey = m_hashKeys[mainSlot];
	if (isNil(mainKey)) {
		m_hashKeys[mainSlot] = key;
		m_hashValues[mainSlot] = value;
		m_hashNext[mainSlot] = kTableHashNextEnd;
		return mainIndex;
	}
	int freeIndex = getFreeIndex();
	if (freeIndex < 0) {
		rehash(key, value);
		return rawSet(key, value);
	}
	const size_t freeSlot = static_cast<size_t>(freeIndex);
	int mainIndexOfOccupied = static_cast<int>(hashValue(mainKey) & mask);
	if (mainIndexOfOccupied != mainIndex) {
		m_hashKeys[freeSlot] = mainKey;
		m_hashValues[freeSlot] = m_hashValues[mainSlot];
		m_hashNext[freeSlot] = m_hashNext[mainSlot];
		int prev = mainIndexOfOccupied;
		while (m_hashNext[static_cast<size_t>(prev)] != mainIndex) {
			prev = m_hashNext[static_cast<size_t>(prev)];
		}
		m_hashNext[static_cast<size_t>(prev)] = freeIndex;
		m_hashKeys[mainSlot] = key;
		m_hashValues[mainSlot] = value;
		m_hashNext[mainSlot] = kTableHashNextEnd;
		return mainIndex;
	}
	m_hashKeys[freeSlot] = key;
	m_hashValues[freeSlot] = value;
	m_hashNext[freeSlot] = m_hashNext[mainSlot];
	m_hashNext[mainSlot] = freeIndex;
	return freeIndex;
}

void Table::removeFromHash(const Value& key) {
	const int existingIndex = findNodeIndex(key);
	if (existingIndex < 0 || isNil(m_hashValues[static_cast<size_t>(existingIndex)])) {
		return;
	}
	if (m_hashDeadCount > 0) {
		rehash(valueNil(), valueNil());
		int arrayIndex = 0;
		if (getArrayIndex(key, arrayIndex)
			&& static_cast<size_t>(arrayIndex) < m_array.size()) {
			m_array[static_cast<size_t>(arrayIndex)] = valueNil();
			return;
		}
	}
	if (m_hashSize == 0) {
		return;
	}
	size_t mask = m_hashSize - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	int prev = -1;
	int index = mainIndex;
	while (index >= 0) {
		const size_t slot = static_cast<size_t>(index);
		const Value nodeKey = m_hashKeys[slot];
		if (!isNil(nodeKey) && keyEquals(nodeKey, key)) {
			int next = m_hashNext[slot];
			if (prev >= 0) {
				m_hashNext[static_cast<size_t>(prev)] = next;
				m_hashKeys[slot] = valueNil();
				m_hashValues[slot] = valueNil();
				m_hashNext[slot] = kTableHashNextEnd;
				if (index > m_hashFree) {
					m_hashFree = index;
				}
				return;
			}
			if (next >= 0) {
				const size_t nextSlot = static_cast<size_t>(next);
				m_hashKeys[slot] = m_hashKeys[nextSlot];
				m_hashValues[slot] = m_hashValues[nextSlot];
				m_hashNext[slot] = m_hashNext[nextSlot];
				m_hashKeys[nextSlot] = valueNil();
				m_hashValues[nextSlot] = valueNil();
				m_hashNext[nextSlot] = kTableHashNextEnd;
				if (next > m_hashFree) {
					m_hashFree = next;
				}
				return;
			}
			m_hashKeys[slot] = valueNil();
			m_hashValues[slot] = valueNil();
			m_hashNext[slot] = kTableHashNextEnd;
			if (index > m_hashFree) {
				m_hashFree = index;
			}
			return;
		}
		prev = index;
		index = m_hashNext[slot];
	}
}

void Table::markHashNodeDead(size_t index) {
	if (valueIsTable(m_hashKeys[index])
		|| valueIsClosure(m_hashKeys[index])) {
		const uint32_t hashId = valueObjectHashId(m_hashKeys[index]);
		m_hashKeys[index] = valueNil();
		m_hashValues[index] = valueNumber(static_cast<double>(hashId));
	} else {
		m_hashValues[index] = valueNil();
	}
	++m_hashDeadCount;
}

Value Table::get(const Value& key) const {
	if (isNil(key)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
	}
	int index = 0;
	if (getArrayIndex(key, index)) {
		if (index < static_cast<int>(m_array.size())) {
			return m_array[static_cast<size_t>(index)];
		}
	}

	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		return m_hashValues[static_cast<size_t>(nodeIndex)];
	}
	return valueNil();
}

void Table::set(const Value& key, const Value& value) {
	if (isNil(key)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
	}
	int index = 0;
	bool isArrayKey = getArrayIndex(key, index);
	if (isArrayKey) {
		const size_t idx = static_cast<size_t>(index);
		if (idx < m_array.size()) {
			setArraySlot(idx, value);
			return;
		}
	}

	if (isNil(value)) {
		removeFromHash(key);
		if (isArrayKey && static_cast<size_t>(index) < m_arrayLength) {
			m_arrayLength = static_cast<size_t>(index);
		}
		return;
	}
	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		if (isNil(m_hashValues[static_cast<size_t>(nodeIndex)])) {
			--m_hashDeadCount;
		}
		m_hashValues[static_cast<size_t>(nodeIndex)] = value;
		return;
	}
	if (m_hashSize == 0 || m_hashFree < 0) {
		rehash(key, value);
	}
	rawSet(key, value);
}

Value Table::getInteger(int indexValue) const {
	const int index = indexValue - 1;
	if (index >= 0 && index < static_cast<int>(m_array.size())) {
		return m_array[static_cast<size_t>(index)];
	}
	const int nodeIndex = findNodeIndex(valueNumber(static_cast<double>(indexValue)));
	if (nodeIndex >= 0) {
		return m_hashValues[static_cast<size_t>(nodeIndex)];
	}
	return valueNil();
}

void Table::setInteger(int indexValue, const Value& value) {
	const int index = indexValue - 1;
	if (index >= 0 && index < static_cast<int>(m_array.size())) {
		const size_t idx = static_cast<size_t>(index);
		if (isNil(value)) {
			m_array[idx] = value;
			if (idx < m_arrayLength) {
				m_arrayLength = idx;
			}
			return;
		}
		m_array[idx] = value;
		if (idx == m_arrayLength) {
			updateArrayLengthFrom(m_arrayLength);
		}
		return;
	}
	const Value key = valueNumber(static_cast<double>(indexValue));
	if (isNil(value)) {
		removeFromHash(key);
		if (index >= 0 && static_cast<size_t>(index) < m_arrayLength) {
			m_arrayLength = static_cast<size_t>(index);
		}
		return;
	}
	const int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		if (isNil(m_hashValues[static_cast<size_t>(nodeIndex)])) {
			--m_hashDeadCount;
		}
		m_hashValues[static_cast<size_t>(nodeIndex)] = value;
		return;
	}
	if (m_hashSize == 0 || m_hashFree < 0) {
		rehash(key, value);
	}
	rawSet(key, value);
}

Value Table::getStringKey(StringId key) const {
	const int nodeIndex = findNodeIndex(valueString(key));
	if (nodeIndex >= 0) {
		return m_hashValues[static_cast<size_t>(nodeIndex)];
	}
	return valueNil();
}

Value Table::getStringKeyCached(StringId key, int& predictedSlot) const {
	if (predictedSlot >= 0 && static_cast<size_t>(predictedSlot) < m_hashSize) {
		const size_t slot = static_cast<size_t>(predictedSlot);
		if (valueIsString(m_hashKeys[slot])
			&& asStringId(m_hashKeys[slot]) == key
			&& !isNil(m_hashValues[slot])) {
			return m_hashValues[slot];
		}
	}
	const int nodeIndex = findNodeIndex(valueString(key));
	if (nodeIndex >= 0 && !isNil(m_hashValues[static_cast<size_t>(nodeIndex)])) {
		predictedSlot = nodeIndex;
		return m_hashValues[static_cast<size_t>(nodeIndex)];
	}
	predictedSlot = -1;
	return valueNil();
}

int Table::setStringKey(StringId key, const Value& value) {
	const Value keyValue = valueString(key);
	if (isNil(value)) {
		removeFromHash(keyValue);
		return -1;
	}
	const int nodeIndex = findNodeIndex(keyValue);
	if (nodeIndex >= 0) {
		if (isNil(m_hashValues[static_cast<size_t>(nodeIndex)])) {
			--m_hashDeadCount;
		}
		m_hashValues[static_cast<size_t>(nodeIndex)] = value;
		return nodeIndex;
	}
	if (m_hashSize == 0 || m_hashFree < 0) {
		rehash(keyValue, value);
	}
	return rawSet(keyValue, value);
}

void Table::setStringKeyCached(StringId key, const Value& value, int& predictedSlot) {
	if (!isNil(value)
		&& predictedSlot >= 0
		&& static_cast<size_t>(predictedSlot) < m_hashSize) {
		const size_t slot = static_cast<size_t>(predictedSlot);
		if (valueIsString(m_hashKeys[slot])
			&& asStringId(m_hashKeys[slot]) == key
			&& !isNil(m_hashValues[slot])) {
			m_hashValues[slot] = value;
			return;
		}
	}
	predictedSlot = setStringKey(key, value);
}

int Table::length() const {
	return static_cast<int>(m_arrayLength);
}

void Table::clear() {
	const size_t previousBytes = trackedHeapBytes();
	m_array.clear();
	m_arrayLength = 0;
	allocateHash(0);
	m_hashFree = -1;
	m_luaHeap.release(previousBytes - trackedHeapBytes());
}

bool Table::nextEntry(const Value& after, Value& key, Value& value) const {
	int hashIndex = -1;
	if (isNil(after)) {
		for (size_t i = 0; i < m_array.size(); ++i) {
			if (!isNil(m_array[i])) {
				key = valueNumber(static_cast<double>(i + 1));
				value = m_array[i];
				return true;
			}
		}
		hashIndex = findNextLiveHashIndex(0);
	} else {
		int index = 0;
		if (getArrayIndex(after, index)
			&& index < static_cast<int>(m_array.size())) {
			const int startIndex = index + 1;
			for (int i = startIndex; i < static_cast<int>(m_array.size()); ++i) {
				if (!isNil(m_array[static_cast<size_t>(i)])) {
					key = valueNumber(static_cast<double>(i + 1));
					value = m_array[static_cast<size_t>(i)];
					return true;
				}
			}
			hashIndex = findNextLiveHashIndex(0);
		} else {
			const int nodeIndex = findNodeIndexForNext(after);
			if (nodeIndex < 0) {
				return false;
			}
			hashIndex = findNextLiveHashIndex(static_cast<size_t>(nodeIndex + 1));
		}
	}
	if (hashIndex >= 0) {
		const size_t slot = static_cast<size_t>(hashIndex);
		key = m_hashKeys[slot];
		value = m_hashValues[slot];
		return true;
	}
	return false;
}

TableRuntimeState Table::captureRuntimeState() const {
	TableRuntimeState state;
	state.array = m_array;
	state.arrayLength = m_arrayLength;
	state.hash.reserve(m_hashSize);
	for (size_t index = 0; index < m_hashSize; ++index) {
		state.hash.push_back(TableHashNodeState{ m_hashKeys[index], m_hashValues[index], m_hashNext[index] });
	}
	state.hashFree = m_hashFree;
	state.metatable = metatable;
	return state;
}

uint32_t Table::restoreRuntimeState(const TableRuntimeState& state) {
	const size_t previousBytes = trackedHeapBytes();
	m_array = state.array;
	m_arrayLength = state.arrayLength;
	allocateHash(state.hash.size());
	uint32_t maxDeadKeyHashId = 0;
	for (size_t index = 0; index < state.hash.size(); ++index) {
		const TableHashNodeState& node = state.hash[index];
		m_hashKeys[index] = node.key;
		m_hashValues[index] = node.value;
		m_hashNext[index] = node.next;
		if (isNil(node.key) != isNil(node.value)) {
			++m_hashDeadCount;
			if (isNil(node.key)) {
				const uint32_t hashId = static_cast<uint32_t>(asNumber(node.value));
				if (hashId > maxDeadKeyHashId) {
					maxDeadKeyHashId = hashId;
				}
			}
		}
	}
	m_hashFree = state.hashFree;
	metatable = state.metatable;
	m_luaHeap.adjustForRestore(previousBytes, trackedHeapBytes());
	return maxDeadKeyHashId;
}

size_t Table::trackedHeapBytes() const {
	return trackedHeapBytesForCapacities(m_array.size(), m_hashSize);
}

void Table::prepareRestoreStorage(size_t arrayCapacity, size_t hashCapacity) {
	const size_t previousBytes = trackedHeapBytes();
	m_array.assign(arrayCapacity, valueNil());
	m_arrayLength = 0;
	allocateHash(hashCapacity);
	m_hashFree = hashCapacity > 0 ? static_cast<int>(hashCapacity) - 1 : -1;
	m_luaHeap.adjustForRestore(previousBytes, trackedHeapBytes());
}


} // namespace bmsx
