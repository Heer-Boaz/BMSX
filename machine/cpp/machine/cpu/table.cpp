#include "machine/cpu/table.h"

#include <algorithm>
#include <array>

#include "machine/common/numeric.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/gc_heap.h"

namespace bmsx {

namespace {
constexpr size_t kTableHeapBytes = 32;
constexpr size_t kTableArraySlotHeapBytes = 5;
constexpr size_t kTableHashSlotHeapBytes = 14;
constexpr int32_t kTableHashNextEnd = -1;
} // namespace
Table::Table(GcHeap& heap, size_t arrayCapacity, size_t hashCapacity)
	: m_heap(heap) {
	allocateStorage(arrayCapacity, hashCapacity);
}

Table::~Table() {
	if (m_values.words()) m_heap.tableStorage.deallocate(m_values.words(), trackedHeapBytes() - kTableHeapBytes);
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
		offsetof(Table, m_values) + ValueSpan::wordsOffset(), offsetof(Table, m_values) + ValueSpan::tagsOffset(),
		offsetof(Table, m_arraySize), offsetof(Table, m_lengthHint), offsetof(Table, metatable)};
}
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
#endif

bool Table::getArrayIndex(const Value& key, int& outIndex) const {
	i32 integer;
	if (!valueToInteger(key, integer) || integer <= 0) return false;
	outIndex = integer - 1;
	return true;
}

Table* Table::metatableIndexTable(StringId indexKey) const {
	if (!metatable) return nullptr;
	const Value indexer = metatable->getStringKey(indexKey);
	return valueIsTable(indexer) ? asTable(indexer, m_heap) : nullptr;
}

bool Table::hasIntegerKey(u32 key) const {
	if (key <= m_arraySize) {
		return !isNil(m_values.get(static_cast<size_t>(key - 1)));
	}
	const int nodeIndex = findNodeIndex(valueInteger(static_cast<i32>(key)));
	return nodeIndex >= 0 && !isNil(m_values.get(hashValueSlot(static_cast<size_t>(nodeIndex))));
}

size_t Table::hashValue(const Value& key) const {
	return m_heap.hash(key);
}

bool Table::keyEquals(const Value& a, const Value& b) const {
	return ValueEq{}(a, b);
}

int Table::findNodeIndex(const Value& key, bool matchDead) const {
	if (m_hashSize == 0) {
		return -1;
	}
	const bool collectableKey = matchDead && (valueIsTable(key) || valueIsClosure(key) || valueIsThread(key));
	const uint32_t deadKeyHashId = collectableKey ? valueObjectHashId(key, m_heap) : 0;
	const size_t mask = m_hashSize - 1;
	int index = static_cast<int>(hashValue(key) & mask);
	while (index >= 0) {
		const size_t slot = static_cast<size_t>(index);
		const Value nodeKey = m_values.get(hashKeySlot(slot));
		if ((!isNil(nodeKey) && keyEquals(nodeKey, key))
			|| (isNil(nodeKey)
				&& collectableKey
				&& valueTag(m_values.get(hashValueSlot(slot))) == ValueTag::DeadKey
				&& valuePayload(m_values.get(hashValueSlot(slot))) == deadKeyHashId)) {
			return index;
		}
		index = m_hashNext[slot];
	}
	return -1;
}

int Table::findNextLiveHashIndex(size_t start) const {
	for (size_t index = start; index < m_hashSize; ++index) {
		if (!isNil(m_values.get(hashKeySlot(index))) && !isNil(m_values.get(hashValueSlot(index)))) {
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
		if (m_values.get(hashKeySlot(slot)) == keyValue) {
			return index;
		}
		index = m_hashNext[slot];
	}
	return -1;
}

int Table::getFreeIndex() {
	for (int i = m_hashFree; i >= 0; --i) {
		if (isNil(m_values.get(hashKeySlot(static_cast<size_t>(i))))
			&& isNil(m_values.get(hashValueSlot(static_cast<size_t>(i))))) {
			m_hashFree = i - 1;
			return i;
		}
	}
	m_hashFree = -1;
	return -1;
}

void Table::rehash(const Value& key, const Value& value) {
	size_t totalKeys = 0;
	std::array<u32, 32> counts{};
	size_t countBins = 0;

	auto countIntegerKey = [&counts, &countBins](size_t index) {
		const size_t log = ceilLog2(index);
		while (countBins <= log) {
			counts[countBins] = 0;
			++countBins;
		}
		counts[log] += 1;
	};

	for (size_t i = 0; i < m_arraySize; ++i) {
		if (!isNil(m_values.get(i))) {
			totalKeys += 1;
			countIntegerKey(i + 1);
		}
	}
	for (size_t i = 0; i < m_hashSize; ++i) {
		const Value key = m_values.get(hashKeySlot(i));
		if (!isNil(key) && !isNil(m_values.get(hashValueSlot(i)))) {
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
	m_heap.budget.accountTableStorageWork(m_arraySize + 2 * m_hashSize);
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
		m_heap.budget.reserve(resizedBytes - previousBytes, valueTable(m_heap.reference(this)), key, value);
	}
	const ValueSpan oldValues = m_values;
	const size_t oldArraySize = m_arraySize;
	const auto releaseOld = [this, previousBytes](void* storage) {
		m_heap.tableStorage.deallocate(storage, previousBytes - kTableHeapBytes);
	};
	std::unique_ptr<void, decltype(releaseOld)> oldStorage(m_values.words(), releaseOld);
	m_values = {};
	const size_t oldHashSize = m_hashSize;

	allocateStorage(newArraySize, newHashSize);
	m_heap.budget.accountTableStorageWork(newArraySize + 2 * newHashSize);

	size_t relocatedSlots = 0;
	for (size_t i = 0; i < oldArraySize; ++i) {
		if (!isNil(oldValues.get(i))) {
			const int destination = rawSet(valueInteger(static_cast<i32>(i + 1)), oldValues.get(i));
			relocatedSlots += destination < 0 ? 1u : 2u;
		}
	}
	for (size_t i = 0; i < oldHashSize; ++i) {
		const Value key = oldValues.get(oldArraySize + i);
		if (!isNil(key) && !isNil(oldValues.get(oldArraySize + oldHashSize + i))) {
			const int destination = rawSet(key, oldValues.get(oldArraySize + oldHashSize + i));
			relocatedSlots += destination < 0 ? 1u : 2u;
		}
	}
	m_heap.budget.accountTableStorageWork(oldArraySize + 2 * oldHashSize + relocatedSlots);
	oldStorage.reset();
	if (resizedBytes < previousBytes) {
		m_heap.budget.release(previousBytes - resizedBytes);
	}
}

void Table::allocateStorage(size_t arraySize, size_t hashSize) {
	const size_t valueCount = arraySize + hashSize * 2;
	const size_t byteCount = valueCount * 5 + hashSize * sizeof(i32);
	void* storage = byteCount == 0 ? nullptr : m_heap.tableStorage.allocate(byteCount);
	if (m_values.words()) m_heap.tableStorage.deallocate(m_values.words(), trackedHeapBytes() - kTableHeapBytes);
	auto* words = static_cast<u32*>(storage);
	m_hashNext = hashSize == 0 ? nullptr : reinterpret_cast<i32*>(words + valueCount);
	auto* tags = valueCount == 0 ? nullptr : reinterpret_cast<uint8_t*>(words + valueCount + hashSize);
	m_values = {words, tags, valueCount};
	m_arraySize = arraySize;
	m_hashSize = hashSize;
	m_hashFree = hashSize == 0 ? -1 : static_cast<int>(hashSize) - 1;
	if (valueCount != 0) {
		std::fill_n(words, valueCount, u32{0});
		std::fill_n(tags, valueCount, uint8_t{0});
	}
	std::fill_n(m_hashNext, hashSize, kTableHashNextEnd);
}

// Storage redistribution must not change the logical boundary hint.
int Table::rawSet(const Value& key, const Value& value) {
	writeBarrier();
	int index = 0;
	if (getArrayIndex(key, index) && static_cast<size_t>(index) < m_arraySize) {
		m_values.set(static_cast<size_t>(index), value);
		return -1;
	}
	return insertHash(key, value);
}

int Table::insertHash(const Value& key, const Value& value) {
	const int nodeIndex = insertHashWithoutGrowth(key, value);
	if (nodeIndex >= 0) return nodeIndex;
	// Growth may collect and relocate a source Thread's register storage.
	const Value pendingKey = key, pendingValue = value;
	rehash(pendingKey, pendingValue);
	return rawSet(pendingKey, pendingValue);
}

int Table::insertHashWithoutGrowth(const Value& key, const Value& value) noexcept {
	if (m_hashSize == 0) {
		return -1;
	}
	size_t mask = m_hashSize - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	const size_t mainSlot = static_cast<size_t>(mainIndex);
	const Value mainKey = m_values.get(hashKeySlot(mainSlot));
	if (isNil(mainKey) || isNil(m_values.get(hashValueSlot(mainSlot)))) {
		m_values.set(hashKeySlot(mainSlot), key);
		m_values.set(hashValueSlot(mainSlot), value);
		return mainIndex;
	}
	int freeIndex = getFreeIndex();
	if (freeIndex < 0) {
		return -1;
	}
	const size_t freeSlot = static_cast<size_t>(freeIndex);
	int mainIndexOfOccupied = static_cast<int>(hashValue(mainKey) & mask);
	if (mainIndexOfOccupied != mainIndex) {
		m_values.set(hashKeySlot(freeSlot), mainKey);
		m_values.set(hashValueSlot(freeSlot), m_values.get(hashValueSlot(mainSlot)));
		m_hashNext[freeSlot] = m_hashNext[mainSlot];
		int prev = mainIndexOfOccupied;
		while (m_hashNext[static_cast<size_t>(prev)] != mainIndex) {
			prev = m_hashNext[static_cast<size_t>(prev)];
		}
		m_hashNext[static_cast<size_t>(prev)] = freeIndex;
		m_values.set(hashKeySlot(mainSlot), key);
		m_values.set(hashValueSlot(mainSlot), value);
		m_hashNext[mainSlot] = kTableHashNextEnd;
		return mainIndex;
	}
	m_values.set(hashKeySlot(freeSlot), key);
	m_values.set(hashValueSlot(freeSlot), value);
	m_hashNext[freeSlot] = m_hashNext[mainSlot];
	m_hashNext[mainSlot] = freeIndex;
	return freeIndex;
}

void Table::removeFromHash(const Value& key) {
	const int existingIndex = findNodeIndex(key);
	if (existingIndex < 0 || isNil(m_values.get(hashValueSlot(static_cast<size_t>(existingIndex))))) {
		return;
	}
	markHashNodeDead(static_cast<size_t>(existingIndex));
}

void Table::markHashNodeDead(size_t index) {
	if (valueIsTable(m_values.get(hashKeySlot(index)))
		|| valueIsThread(m_values.get(hashKeySlot(index)))
		|| valueIsClosure(m_values.get(hashKeySlot(index)))) {
		const uint32_t hashId = valueObjectHashId(m_values.get(hashKeySlot(index)), m_heap);
		m_values.set(hashKeySlot(index), valueNil());
		m_values.set(hashValueSlot(index), valueFromTag(ValueTag::DeadKey, hashId));
	} else {
		m_values.set(hashValueSlot(index), valueNil());
	}
}

Value Table::get(const Value& rawKey) const {
	const Value key = canonicalTableKey(rawKey);
	if (isNil(key)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
	}
	int index = 0;
	if (getArrayIndex(key, index)) {
		if (index < static_cast<int>(m_arraySize)) {
			return m_values.get(static_cast<size_t>(index));
		}
	}

	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		return m_values.get(hashValueSlot(static_cast<size_t>(nodeIndex)));
	}
	return valueNil();
}

void Table::set(const Value& rawKey, const Value& value) {
	const Value key = canonicalTableKey(rawKey);
	if (isNil(key)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NIL);
	}
	writeBarrier();
	int index = 0;
	bool isArrayKey = getArrayIndex(key, index);
	if (isArrayKey) {
		const size_t idx = static_cast<size_t>(index);
		if (idx < m_arraySize) {
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
		if (isNil(m_values.get(hashKeySlot(slot)))) {
			m_values.set(hashKeySlot(slot), key);
		}
		m_values.set(hashValueSlot(slot), value);
		if (isArrayKey) updateLengthHint(static_cast<size_t>(index), true);
		return;
	}
	rawSet(key, value);
	if (isArrayKey) updateLengthHint(static_cast<size_t>(index), true);
}

Value Table::getInteger(int indexValue) const {
	const u32 index = static_cast<u32>(indexValue) - 1u;
	if (index < m_arraySize) {
		return m_values.get(static_cast<size_t>(index));
	}
	const int nodeIndex = findNodeIndex(valueInteger(indexValue));
	if (nodeIndex >= 0) {
		return m_values.get(hashValueSlot(static_cast<size_t>(nodeIndex)));
	}
	return valueNil();
}

void Table::setInteger(int indexValue, const Value& value) {
	writeBarrier();
	const u32 index = static_cast<u32>(indexValue) - 1u;
	if (index < m_arraySize) {
		setArraySlot(static_cast<size_t>(index), value);
		return;
	}
	const Value key = valueInteger(indexValue);
	if (isNil(value)) {
		removeFromHash(key);
		if (indexValue > 0) updateLengthHint(static_cast<size_t>(index), false);
		return;
	}
	const int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		m_values.set(hashValueSlot(static_cast<size_t>(nodeIndex)), value);
		if (indexValue > 0) updateLengthHint(static_cast<size_t>(index), true);
		return;
	}
	rawSet(key, value);
	if (indexValue > 0) updateLengthHint(static_cast<size_t>(index), true);
}

Value Table::getStringKey(StringId key) const {
	const int nodeIndex = findStringNodeIndex(key);
	if (nodeIndex >= 0) {
		return m_values.get(hashValueSlot(static_cast<size_t>(nodeIndex)));
	}
	return valueNil();
}

Value Table::getStringKeyCached(StringId key, int& predictedSlot) const {
	if (predictedSlot >= 0 && static_cast<size_t>(predictedSlot) < m_hashSize) {
		const size_t slot = static_cast<size_t>(predictedSlot);
		if (valueIsString(m_values.get(hashKeySlot(slot)))
			&& asStringId(m_values.get(hashKeySlot(slot))) == key
			&& !isNil(m_values.get(hashValueSlot(slot)))) {
			return m_values.get(hashValueSlot(slot));
		}
	}
	const int nodeIndex = findStringNodeIndex(key);
	if (nodeIndex >= 0 && !isNil(m_values.get(hashValueSlot(static_cast<size_t>(nodeIndex))))) {
		predictedSlot = nodeIndex;
		return m_values.get(hashValueSlot(static_cast<size_t>(nodeIndex)));
	}
	predictedSlot = -1;
	return valueNil();
}

void Table::loadStringIndex(const Table* table, StringId indexKey, StringId key, TableLookupResult& result) noexcept {
	table->resolveStringIndexCached(indexKey, key, -1, result);
}

int Table::setStringKey(StringId key, const Value& value) {
	const int nodeIndex = storeStringKeyWithoutGrowth(this, key, value);
	if (nodeIndex != TABLE_STORE_REQUIRES_GROWTH) return nodeIndex;
	const Value keyValue = valueString(key);
	const Value pendingValue = value;
	rehash(keyValue, pendingValue);
	return rawSet(keyValue, pendingValue);
}

int Table::storeStringKeyWithoutGrowth(Table* table, StringId key, const Value& value) noexcept {
	table->writeBarrier();
	const Value keyValue = valueString(key);
	if (isNil(value)) {
		table->removeFromHash(keyValue);
		return -1;
	}
	const int nodeIndex = table->findStringNodeIndex(key);
	if (nodeIndex >= 0) {
		table->m_values.set(table->hashValueSlot(static_cast<size_t>(nodeIndex)), value);
		return nodeIndex;
	}
	const int inserted = table->insertHashWithoutGrowth(keyValue, value);
	return inserted >= 0 ? inserted : TABLE_STORE_REQUIRES_GROWTH;
}

void Table::setStringKeyCached(StringId key, const Value& value, int& predictedSlot) {
	writeBarrier();
	if (!isNil(value)
		&& predictedSlot >= 0
		&& static_cast<size_t>(predictedSlot) < m_hashSize) {
		const size_t slot = static_cast<size_t>(predictedSlot);
		if (valueIsString(m_values.get(hashKeySlot(slot)))
			&& asStringId(m_values.get(hashKeySlot(slot))) == key
			&& !isNil(m_values.get(hashValueSlot(slot)))) {
			m_values.set(hashValueSlot(slot), value);
			return;
		}
	}
	predictedSlot = setStringKey(key, value);
}

i32 Table::length(const Table* table, u32* work) noexcept {
	constexpr u32 maxBoundary = 0x7fffffffu;
	u32 low = table->m_lengthHint, high;
	u32 probes = low == 0 ? 0 : 1;
	if (low != 0 && !table->hasIntegerKey(low)) {
		high = low;
		low = 0;
	} else if (low == maxBoundary) {
		if (work) *work = probes;
		return static_cast<i32>(low);
	} else {
		++probes;
		if (!table->hasIntegerKey(low + 1)) {
			if (work) *work = probes;
			return static_cast<i32>(low);
		}
		++low;
		if (low == maxBoundary) {
			if (work) *work = probes;
			return static_cast<i32>(low);
		}
		high = std::min(low * 2, maxBoundary);
		for (;;) {
			++probes;
			if (!table->hasIntegerKey(high)) break;
			low = high;
			if (low == maxBoundary) {
				if (work) *work = probes;
				return static_cast<i32>(low);
			}
			high = std::min(low * 2, maxBoundary);
		}
	}
	while (high - low > 1) {
		const u32 middle = low + ((high - low) >> 1);
		++probes;
		if (table->hasIntegerKey(middle)) low = middle;
		else high = middle;
	}
	if (work) *work = probes;
	return static_cast<i32>(low);
}

void Table::clear() {
	const size_t previousBytes = trackedHeapBytes();
	m_lengthHint = 0;
	allocateStorage(0, 0);
	m_heap.budget.release(previousBytes - trackedHeapBytes());
}

bool Table::loadStoredEntry(size_t slot, Value& key, Value& value) const {
	if (slot < m_arraySize) {
		if (isNil(m_values.get(slot))) return false;
		key = valueInteger(static_cast<i32>(slot + 1));
		value = m_values.get(slot);
		return true;
	}
	const size_t hashIndex = slot - m_arraySize;
	if (isNil(m_values.get(hashKeySlot(hashIndex))) || isNil(m_values.get(hashValueSlot(hashIndex)))) return false;
	key = m_values.get(hashKeySlot(hashIndex));
	value = m_values.get(hashValueSlot(hashIndex));
	return true;
}

size_t Table::nextEntry(const Value& rawAfter, Value& key, Value& value) const {
	const Value after = canonicalTableKey(rawAfter);
	size_t arrayStart = 0;
	size_t hashStart = 0;
	if (!isNil(after)) {
		int index = 0;
		if (getArrayIndex(after, index)
			&& index < static_cast<int>(m_arraySize)) {
			arrayStart = static_cast<size_t>(index + 1);
		} else {
			const int nodeIndex = findNodeIndex(after, true);
			if (nodeIndex < 0) {
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_NEXT_KEY);
			}
			arrayStart = m_arraySize;
			hashStart = static_cast<size_t>(nodeIndex + 1);
		}
	}
	for (size_t i = arrayStart; i < m_arraySize; ++i) {
		if (!isNil(m_values.get(i))) {
			key = valueInteger(static_cast<i32>(i + 1));
			value = m_values.get(i);
			return i - arrayStart + 1;
		}
	}
	const size_t arraySlots = m_arraySize - arrayStart;
	const int hashIndex = findNextLiveHashIndex(hashStart);
	if (hashIndex >= 0) {
		const size_t slot = static_cast<size_t>(hashIndex);
		key = m_values.get(hashKeySlot(slot));
		value = m_values.get(hashValueSlot(slot));
		return arraySlots + 2 * (slot - hashStart + 1);
	}
	key = valueNil();
	return arraySlots + 2 * (m_hashSize - hashStart);
}

u32 Table::captureSnapshot(CpuSnapshot& snapshot, const CpuSnapshotValueWriter& writeValue) const {
	const u32 arrayCapacity = static_cast<u32>(m_arraySize);
	const u32 hashSize = static_cast<u32>(m_hashSize);
	const u32 offset = snapshot.reserveWords(SNAP_TABLE_DATA + arrayCapacity * CPU_SNAPSHOT_VALUE_WORDS + hashSize * (2 * CPU_SNAPSHOT_VALUE_WORDS + 1));
	snapshot.setWord(offset + SNAP_TABLE_KIND, static_cast<u32>(CpuSnapshotObjectKind::Table));
	snapshot.setWord(offset + SNAP_TABLE_HASH_ID, hashId);
	snapshot.setWord(offset + SNAP_TABLE_LENGTH_HINT, static_cast<u32>(m_lengthHint));
	snapshot.setWord(offset + SNAP_TABLE_ARRAY_CAPACITY, arrayCapacity);
	snapshot.setWord(offset + SNAP_TABLE_HASH_SIZE, hashSize);
	snapshot.setWord(offset + SNAP_TABLE_HASH_FREE, static_cast<u32>(m_hashFree));
	writeValue(offset + SNAP_TABLE_METATABLE, metatable ? valueTable(m_heap.reference(metatable)) : valueNil());
	u32 cursor = offset + SNAP_TABLE_DATA;
	for (size_t index = 0; index < m_arraySize; ++index) {
		writeValue(cursor, m_values.get(index));
		cursor += CPU_SNAPSHOT_VALUE_WORDS;
	}
	for (size_t index = 0; index < m_hashSize; ++index) {
		writeValue(cursor, m_values.get(hashKeySlot(index)));
		writeValue(cursor + CPU_SNAPSHOT_VALUE_WORDS, m_values.get(hashValueSlot(index)));
		snapshot.setWord(cursor + 2 * CPU_SNAPSHOT_VALUE_WORDS, static_cast<u32>(m_hashNext[index]));
		cursor += 2 * CPU_SNAPSHOT_VALUE_WORDS + 1;
	}
	return offset;
}

void Table::restoreSnapshot(const CpuSnapshotReader& reader, u32 offset) {
	const auto& snapshot = reader.snapshot;
	const u32 arrayCapacity = snapshot.word(offset + SNAP_TABLE_ARRAY_CAPACITY);
	const u32 hashSize = snapshot.word(offset + SNAP_TABLE_HASH_SIZE);
	if (m_arraySize != arrayCapacity || m_hashSize != hashSize) prepareRestoreStorage(arrayCapacity, hashSize);
	m_lengthHint = snapshot.word(offset + SNAP_TABLE_LENGTH_HINT);
	m_hashFree = snapshot.integer(offset + SNAP_TABLE_HASH_FREE);
	const Value savedMetatable = reader.readValue(offset + SNAP_TABLE_METATABLE);
	metatable = isNil(savedMetatable) ? nullptr : asTable(savedMetatable, m_heap);
	u32 cursor = offset + SNAP_TABLE_DATA;
	for (size_t index = 0; index < m_arraySize; ++index) {
		m_values.set(index, reader.readValue(cursor));
		cursor += CPU_SNAPSHOT_VALUE_WORDS;
	}
	for (size_t index = 0; index < m_hashSize; ++index) {
		m_values.set(hashKeySlot(index), reader.readValue(cursor));
		m_values.set(hashValueSlot(index), reader.readValue(cursor + CPU_SNAPSHOT_VALUE_WORDS));
		m_hashNext[index] = snapshot.integer(cursor + 2 * CPU_SNAPSHOT_VALUE_WORDS);
		cursor += 2 * CPU_SNAPSHOT_VALUE_WORDS + 1;
	}
}

size_t Table::trackedHeapBytes() const {
	return trackedHeapBytesForCapacities(m_arraySize, m_hashSize);
}

void Table::prepareRestoreStorage(size_t arrayCapacity, size_t hashCapacity) {
	const size_t previousBytes = trackedHeapBytes();
	m_lengthHint = 0;
	allocateStorage(arrayCapacity, hashCapacity);
	m_heap.budget.adjustForRestore(previousBytes, trackedHeapBytes());
}


} // namespace bmsx
