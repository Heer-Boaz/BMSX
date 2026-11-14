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
	allocateStorage(arrayCapacity, hashCapacity);
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

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
// Generated accesses use this compiler's inherited GC-object layout, not a
// mirrored ABI or the implementation-specific layout of std::vector.
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
TableNativeFieldOffsets Table::nativeFieldOffsets() {
	return {offsetof(Table, m_hashSize),
		offsetof(Table, m_hashKeys), offsetof(Table, m_hashValues),
		offsetof(Table, m_array) + offsetof(Span<Value>, data_),
		offsetof(Table, m_array) + offsetof(Span<Value>, size_),
		offsetof(Table, m_lengthHint), offsetof(Table, metatable)};
}
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
#endif

bool Table::getArrayIndex(const Value& key, int& outIndex) const {
	if (!valueIsNumber(key)) {
		return false;
	}
	return getNumberArrayIndex(asNumber(key), outIndex);
}

bool Table::hasIntegerKey(uint64_t key) const {
	if (key <= m_array.size()) {
		return !isNil(m_array[static_cast<size_t>(key - 1)]);
	}
	const int nodeIndex = findNodeIndex(valueNumber(static_cast<double>(key)));
	return nodeIndex >= 0 && !isNil(m_hashValues[static_cast<size_t>(nodeIndex)]);
}

size_t Table::hashValue(const Value& key) const {
	return ValueHash{}(key);
}

bool Table::keyEquals(const Value& a, const Value& b) const {
	return ValueEq{}(a, b);
}

int Table::findNodeIndex(const Value& key, bool matchDead) const {
	if (m_hashSize == 0) {
		return -1;
	}
	const bool collectableKey = matchDead && (valueIsTable(key) || valueIsClosure(key) || valueIsThread(key));
	const uint32_t deadKeyHashId = collectableKey ? valueObjectHashId(key) : 0;
	const size_t mask = m_hashSize - 1;
	int index = static_cast<int>(hashValue(key) & mask);
	while (index >= 0) {
		const size_t slot = static_cast<size_t>(index);
		const Value nodeKey = m_hashKeys[slot];
		if ((!isNil(nodeKey) && keyEquals(nodeKey, key))
			|| (isNil(nodeKey)
				&& collectableKey
				&& valueIsNumber(m_hashValues[slot])
				&& asNumber(m_hashValues[slot]) == static_cast<double>(deadKeyHashId))) {
			return index;
		}
		index = m_hashNext[slot];
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

int Table::findStringNodeIndex(StringId key) const {
	if (m_hashSize == 0) {
		return -1;
	}
	const Value keyValue = valueString(key);
	int index = static_cast<int>(hashValue(keyValue) & (m_hashSize - 1u));
	while (index >= 0) {
		const size_t slot = static_cast<size_t>(index);
		if (m_hashKeys[slot] == keyValue) {
			return index;
		}
		index = m_hashNext[slot];
	}
	return -1;
}

int Table::getFreeIndex() {
	for (int i = m_hashFree; i >= 0; --i) {
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
	m_luaHeap.accountTableStorageWork(m_array.size() + 2 * m_hashSize);
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
	const Span<Value> oldArray = m_array;
	std::unique_ptr<void, StorageDeleter> oldStorage = std::move(m_storage);
	Value* oldHashKeys = m_hashKeys;
	Value* oldHashValues = m_hashValues;
	const size_t oldHashSize = m_hashSize;

	allocateStorage(newArraySize, newHashSize);
	m_luaHeap.accountTableStorageWork(newArraySize + 2 * newHashSize);

	size_t relocatedSlots = 0;
	for (size_t i = 0; i < oldArray.size(); ++i) {
		if (!isNil(oldArray[i])) {
			const int destination = rawSet(valueNumber(static_cast<double>(i + 1)), oldArray[i]);
			relocatedSlots += destination < 0 ? 1u : 2u;
		}
	}
	for (size_t i = 0; i < oldHashSize; ++i) {
		const Value key = oldHashKeys[i];
		if (!isNil(key) && !isNil(oldHashValues[i])) {
			const int destination = rawSet(key, oldHashValues[i]);
			relocatedSlots += destination < 0 ? 1u : 2u;
		}
	}
	m_luaHeap.accountTableStorageWork(oldArray.size() + 2 * oldHashSize + relocatedSlots);
	oldStorage.reset();
	if (resizedBytes < previousBytes) {
		m_luaHeap.release(previousBytes - resizedBytes);
	}
}

void Table::allocateStorage(size_t arraySize, size_t hashSize) {
	const size_t valueCount = arraySize + hashSize * 2;
	const size_t byteCount = valueCount * sizeof(Value) + hashSize * sizeof(int32_t);
	m_storage.reset(byteCount == 0 ? nullptr : ::operator new(byteCount));
	Value* values = static_cast<Value*>(m_storage.get());
	m_array = {values, arraySize};
	m_hashSize = hashSize;
	m_hashKeys = hashSize == 0 ? nullptr : values + arraySize;
	m_hashValues = hashSize == 0 ? nullptr : m_hashKeys + hashSize;
	m_hashNext = hashSize == 0 ? nullptr : reinterpret_cast<int32_t*>(m_hashValues + hashSize);
	m_hashFree = hashSize == 0 ? -1 : static_cast<int>(hashSize) - 1;
	std::fill_n(values, valueCount, valueNil());
	std::fill_n(m_hashNext, hashSize, kTableHashNextEnd);
}

// Storage redistribution must not change the logical boundary hint.
int Table::rawSet(const Value& key, const Value& value) {
	int index = 0;
	if (getArrayIndex(key, index) && static_cast<size_t>(index) < m_array.size()) {
		m_array[static_cast<size_t>(index)] = value;
		return -1;
	}
	return insertHash(key, value);
}

int Table::insertHash(const Value& key, const Value& value) {
	const int nodeIndex = insertHashWithoutGrowth(key, value);
	if (nodeIndex >= 0) return nodeIndex;
	rehash(key, value);
	return rawSet(key, value);
}

int Table::insertHashWithoutGrowth(const Value& key, const Value& value) noexcept {
	if (m_hashSize == 0) {
		return -1;
	}
	size_t mask = m_hashSize - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	const size_t mainSlot = static_cast<size_t>(mainIndex);
	const Value mainKey = m_hashKeys[mainSlot];
	if (isNil(mainKey) || isNil(m_hashValues[mainSlot])) {
		m_hashKeys[mainSlot] = key;
		m_hashValues[mainSlot] = value;
		return mainIndex;
	}
	int freeIndex = getFreeIndex();
	if (freeIndex < 0) {
		return -1;
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
	markHashNodeDead(static_cast<size_t>(existingIndex));
}

void Table::markHashNodeDead(size_t index) {
	if (valueIsTable(m_hashKeys[index])
		|| valueIsThread(m_hashKeys[index])
		|| valueIsClosure(m_hashKeys[index])) {
		const uint32_t hashId = valueObjectHashId(m_hashKeys[index]);
		m_hashKeys[index] = valueNil();
		m_hashValues[index] = valueNumber(static_cast<double>(hashId));
	} else {
		m_hashValues[index] = valueNil();
	}
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
		if (isArrayKey) updateLengthHint(static_cast<size_t>(index), false);
		return;
	}
	int nodeIndex = findNodeIndex(key, true);
	if (nodeIndex >= 0) {
		const size_t slot = static_cast<size_t>(nodeIndex);
		if (isNil(m_hashKeys[slot])) {
			m_hashKeys[slot] = key;
		}
		m_hashValues[slot] = value;
		if (isArrayKey) updateLengthHint(static_cast<size_t>(index), true);
		return;
	}
	rawSet(key, value);
	if (isArrayKey) updateLengthHint(static_cast<size_t>(index), true);
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
		setArraySlot(static_cast<size_t>(index), value);
		return;
	}
	const Value key = valueNumber(static_cast<double>(indexValue));
	if (isNil(value)) {
		removeFromHash(key);
		if (index >= 0) updateLengthHint(static_cast<size_t>(index), false);
		return;
	}
	const int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		m_hashValues[static_cast<size_t>(nodeIndex)] = value;
		if (index >= 0) updateLengthHint(static_cast<size_t>(index), true);
		return;
	}
	rawSet(key, value);
	if (index >= 0) updateLengthHint(static_cast<size_t>(index), true);
}

Value Table::getStringKey(StringId key) const {
	const int nodeIndex = findStringNodeIndex(key);
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
	const int nodeIndex = findStringNodeIndex(key);
	if (nodeIndex >= 0 && !isNil(m_hashValues[static_cast<size_t>(nodeIndex)])) {
		predictedSlot = nodeIndex;
		return m_hashValues[static_cast<size_t>(nodeIndex)];
	}
	predictedSlot = -1;
	return valueNil();
}

int Table::setStringKey(StringId key, const Value& value) {
	const int nodeIndex = storeStringKeyWithoutGrowth(this, key, value);
	if (nodeIndex != TABLE_STORE_REQUIRES_GROWTH) return nodeIndex;
	const Value keyValue = valueString(key);
	rehash(keyValue, value);
	return rawSet(keyValue, value);
}

int Table::storeStringKeyWithoutGrowth(Table* table, StringId key, const Value& value) noexcept {
	const Value keyValue = valueString(key);
	if (isNil(value)) {
		table->removeFromHash(keyValue);
		return -1;
	}
	const int nodeIndex = table->findStringNodeIndex(key);
	if (nodeIndex >= 0) {
		table->m_hashValues[static_cast<size_t>(nodeIndex)] = value;
		return nodeIndex;
	}
	const int inserted = table->insertHashWithoutGrowth(keyValue, value);
	return inserted >= 0 ? inserted : TABLE_STORE_REQUIRES_GROWTH;
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

double Table::length(const Table* table) noexcept {
	// Binary64's largest integer with a distinct, exactly representable successor.
	constexpr uint64_t maxBoundary = (uint64_t{1} << 53) - 1;
	uint64_t low = table->m_lengthHint;
	uint64_t high;
	if (low != 0 && !table->hasIntegerKey(low)) {
		high = low;
		low = 0;
	} else {
		if (!table->hasIntegerKey(low + 1)) return static_cast<double>(low);
		++low;
		high = low * 2;
		while (table->hasIntegerKey(high)) {
			low = high;
			if (low == maxBoundary) return static_cast<double>(low);
			high = std::min(low * 2, maxBoundary);
		}
	}
	while (high - low > 1) {
		const uint64_t middle = low + (high - low) / 2;
		if (table->hasIntegerKey(middle)) low = middle;
		else high = middle;
	}
	return static_cast<double>(low);
}

void Table::clear() {
	const size_t previousBytes = trackedHeapBytes();
	m_lengthHint = 0;
	allocateStorage(0, 0);
	m_luaHeap.release(previousBytes - trackedHeapBytes());
}

bool Table::loadStoredEntry(size_t slot, Value& key, Value& value) const {
	if (slot < m_array.size()) {
		if (isNil(m_array[slot])) return false;
		key = valueNumber(static_cast<double>(slot + 1));
		value = m_array[slot];
		return true;
	}
	const size_t hashIndex = slot - m_array.size();
	if (isNil(m_hashKeys[hashIndex]) || isNil(m_hashValues[hashIndex])) return false;
	key = m_hashKeys[hashIndex];
	value = m_hashValues[hashIndex];
	return true;
}

size_t Table::nextEntry(const Value& after, Value& key, Value& value) const {
	size_t arrayStart = 0;
	size_t hashStart = 0;
	if (!isNil(after)) {
		int index = 0;
		if (getArrayIndex(after, index)
			&& index < static_cast<int>(m_array.size())) {
			arrayStart = static_cast<size_t>(index + 1);
		} else {
			const int nodeIndex = findNodeIndex(after, true);
			if (nodeIndex < 0) {
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
			}
			arrayStart = m_array.size();
			hashStart = static_cast<size_t>(nodeIndex + 1);
		}
	}
	for (size_t i = arrayStart; i < m_array.size(); ++i) {
		if (!isNil(m_array[i])) {
			key = valueNumber(static_cast<double>(i + 1));
			value = m_array[i];
			return i - arrayStart + 1;
		}
	}
	const size_t arraySlots = m_array.size() - arrayStart;
	const int hashIndex = findNextLiveHashIndex(hashStart);
	if (hashIndex >= 0) {
		const size_t slot = static_cast<size_t>(hashIndex);
		key = m_hashKeys[slot];
		value = m_hashValues[slot];
		return arraySlots + 2 * (slot - hashStart + 1);
	}
	key = valueNil();
	return arraySlots + 2 * (m_hashSize - hashStart);
}

u32 Table::captureSnapshot(CpuSnapshot& snapshot, const CpuSnapshotValueWriter& writeValue) const {
	const u32 arrayCapacity = static_cast<u32>(m_array.size());
	const u32 hashSize = static_cast<u32>(m_hashSize);
	const u32 offset = snapshot.reserveWords(SNAP_TABLE_DATA + arrayCapacity * CPU_SNAPSHOT_VALUE_WORDS + hashSize * (2 * CPU_SNAPSHOT_VALUE_WORDS + 1));
	snapshot.setWord(offset + SNAP_TABLE_KIND, static_cast<u32>(CpuSnapshotObjectKind::Table));
	snapshot.setWord(offset + SNAP_TABLE_HASH_ID, hashId);
	snapshot.setWord(offset + SNAP_TABLE_LENGTH_HINT, static_cast<u32>(m_lengthHint));
	snapshot.setWord(offset + SNAP_TABLE_ARRAY_CAPACITY, arrayCapacity);
	snapshot.setWord(offset + SNAP_TABLE_HASH_SIZE, hashSize);
	snapshot.setWord(offset + SNAP_TABLE_HASH_FREE, static_cast<u32>(m_hashFree));
	writeValue(offset + SNAP_TABLE_METATABLE, metatable ? valueTable(metatable) : valueNil());
	u32 cursor = offset + SNAP_TABLE_DATA;
	for (Value value : m_array) {
		writeValue(cursor, value);
		cursor += CPU_SNAPSHOT_VALUE_WORDS;
	}
	for (size_t index = 0; index < m_hashSize; ++index) {
		writeValue(cursor, m_hashKeys[index]);
		writeValue(cursor + CPU_SNAPSHOT_VALUE_WORDS, m_hashValues[index]);
		snapshot.setWord(cursor + 2 * CPU_SNAPSHOT_VALUE_WORDS, static_cast<u32>(m_hashNext[index]));
		cursor += 2 * CPU_SNAPSHOT_VALUE_WORDS + 1;
	}
	return offset;
}

void Table::restoreSnapshot(const CpuSnapshotReader& reader, u32 offset) {
	const auto& snapshot = reader.snapshot;
	const u32 arrayCapacity = snapshot.word(offset + SNAP_TABLE_ARRAY_CAPACITY);
	const u32 hashSize = snapshot.word(offset + SNAP_TABLE_HASH_SIZE);
	if (m_array.size() != arrayCapacity || m_hashSize != hashSize) prepareRestoreStorage(arrayCapacity, hashSize);
	m_lengthHint = snapshot.word(offset + SNAP_TABLE_LENGTH_HINT);
	m_hashFree = snapshot.integer(offset + SNAP_TABLE_HASH_FREE);
	const Value savedMetatable = reader.readValue(offset + SNAP_TABLE_METATABLE);
	metatable = isNil(savedMetatable) ? nullptr : asTable(savedMetatable);
	u32 cursor = offset + SNAP_TABLE_DATA;
	for (Value& value : m_array) {
		value = reader.readValue(cursor);
		cursor += CPU_SNAPSHOT_VALUE_WORDS;
	}
	for (size_t index = 0; index < m_hashSize; ++index) {
		m_hashKeys[index] = reader.readValue(cursor);
		m_hashValues[index] = reader.readValue(cursor + CPU_SNAPSHOT_VALUE_WORDS);
		m_hashNext[index] = snapshot.integer(cursor + 2 * CPU_SNAPSHOT_VALUE_WORDS);
		cursor += 2 * CPU_SNAPSHOT_VALUE_WORDS + 1;
	}
}

size_t Table::trackedHeapBytes() const {
	return trackedHeapBytesForCapacities(m_array.size(), m_hashSize);
}

void Table::prepareRestoreStorage(size_t arrayCapacity, size_t hashCapacity) {
	const size_t previousBytes = trackedHeapBytes();
	m_lengthHint = 0;
	allocateStorage(arrayCapacity, hashCapacity);
	m_luaHeap.adjustForRestore(previousBytes, trackedHeapBytes());
}


} // namespace bmsx
