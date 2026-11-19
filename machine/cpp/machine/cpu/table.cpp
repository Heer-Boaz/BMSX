#include "machine/cpu/table.h"

#include <algorithm>
#include <array>

#include "machine/common/numeric.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/gc_heap.h"

namespace bmsx {

namespace {
constexpr int32_t kTableHashNextEnd = -1;
} // namespace

Table::Table(GcHeap& heap, size_t arrayCapacity, size_t hashCapacity, u32 storage)
	: m_heap(heap), m_values{&heap.memory, 0, 0} {
	bindStorage(arrayCapacity, hashCapacity, storage);
}

u32 Table::storageBytes(size_t arraySize, size_t hashSize) {
	return static_cast<u32>(arraySize * 5 + hashSize * 14);
}

size_t Table::hashCapacity(int hashSize) {
	return hashSize > 0
		? nextPowerOfTwo(static_cast<size_t>(hashSize))
		: 0;
}

size_t Table::trackedHeapBytesForCapacities(size_t arrayCapacity, size_t hashCapacity) {
	const u32 bytes = storageBytes(arrayCapacity, hashCapacity);
	return HEADER_BYTES + (bytes ? heapAllocationBytes(bytes) : 0u);
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
		offsetof(Table, m_values) + offsetof(TableValues, words), offsetof(Table, m_values) + offsetof(TableValues, tags),
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
	for (size_t remaining = m_hashSize; index >= 0 && remaining != 0; --remaining) {
		const size_t slot = static_cast<size_t>(index);
		const Value nodeKey = m_values.get(hashKeySlot(slot));
		if ((!isNil(nodeKey) && keyEquals(nodeKey, key))
			|| (isNil(nodeKey)
				&& collectableKey
				&& valueTag(m_values.get(hashValueSlot(slot))) == ValueTag::DeadKey
				&& valuePayload(m_values.get(hashValueSlot(slot))) == deadKeyHashId)) {
			return index;
		}
		index = hashNext(slot);
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
	for (size_t remaining = m_hashSize; index >= 0 && remaining != 0; --remaining) {
		const size_t slot = static_cast<size_t>(index);
		if (m_values.get(hashKeySlot(slot)) == keyValue) {
			return index;
		}
		index = hashNext(slot);
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
	const u32 storage = m_heap.budget.allocateRecord(storageBytes(newArraySize, newHashSize), true, 0,
		valueTable(m_heap.reference(this)), key, value);
	const auto oldValues = m_values;
	const size_t oldArraySize = m_arraySize, oldHashSize = m_hashSize;
	const size_t oldBytes = trackedHeapBytes() - HEADER_BYTES;
	bindStorage(newArraySize, newHashSize, storage);
	initializeStorage();
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
	if (oldValues.words != 0) m_heap.arena.free(RAM_BASE + oldValues.words);
	m_heap.budget.release(oldBytes);
}

void Table::bindStorage(size_t arraySize, size_t hashSize, u32 address) {
	const u32 slots = static_cast<u32>(arraySize + hashSize * 2);
	m_values.words = address & RAM_RECORD_WORD_MASK;
	m_hashLinks = m_values.words + slots * 4u;
	m_values.tags = m_hashLinks + static_cast<u32>(hashSize) * 4u;
	m_arraySize = arraySize;
	m_hashSize = hashSize;
	m_hashFree = static_cast<int>(hashSize) - 1;
}

void Table::initializeStorage() {
	const u32 bytes = storageBytes(m_arraySize, m_hashSize);
	if (bytes == 0) return;
	u8* ram = m_heap.memory.ramData();
	std::fill(ram + m_values.words, ram + m_hashLinks, u8{0});
	std::fill(ram + m_hashLinks, ram + m_values.tags, u8{0xff});
	std::fill(ram + m_values.tags, ram + m_values.words + bytes, u8{0});
	m_heap.memory.invalidateRamWrite(m_values.words, bytes);
}

void Table::freeStorage() {
	if (m_values.words != 0) m_heap.arena.free(RAM_BASE + m_values.words);
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
		setHashNext(freeSlot, hashNext(mainSlot));
		int prev = mainIndexOfOccupied;
		for (size_t remaining = m_hashSize; remaining != 0; --remaining) {
			const int next = hashNext(static_cast<size_t>(prev));
			if (next == mainIndex || next < 0) break;
			prev = next;
		}
		setHashNext(static_cast<size_t>(prev), freeIndex);
		m_values.set(hashKeySlot(mainSlot), key);
		m_values.set(hashValueSlot(mainSlot), value);
		setHashNext(mainSlot, kTableHashNextEnd);
		return mainIndex;
	}
	m_values.set(hashKeySlot(freeSlot), key);
	m_values.set(hashValueSlot(freeSlot), value);
	setHashNext(freeSlot, hashNext(mainSlot));
	setHashNext(mainSlot, freeIndex);
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

int Table::storeStringKeyInNative(Table* table, StringId key, const Value& value) noexcept {
	// Hash maintenance can write any linked record word. Never invalidate code
	// from a returning native leaf: the dispatcher owns that instruction then.
	if (table->m_heap.memory.ramWriteWatches().anyWatched()) return TABLE_STORE_REQUIRES_GROWTH;
	return storeStringKeyWithoutGrowth(table, key, value);
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
	freeStorage();
	bindStorage(0, 0, 0);
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
	const u32 offset = snapshot.reserveWords(SNAP_TABLE_SIZE);
	snapshot.setWord(offset + SNAP_TABLE_KIND, static_cast<u32>(CpuSnapshotObjectKind::Table));
	snapshot.setWord(offset + SNAP_TABLE_HASH_ID, hashId);
	snapshot.setWord(offset + SNAP_TABLE_LENGTH_HINT, m_lengthHint);
	snapshot.setWord(offset + SNAP_TABLE_ARRAY_CAPACITY, static_cast<u32>(m_arraySize));
	snapshot.setWord(offset + SNAP_TABLE_HASH_SIZE, static_cast<u32>(m_hashSize));
	snapshot.setWord(offset + SNAP_TABLE_HASH_FREE, static_cast<u32>(m_hashFree));
	snapshot.setWord(offset + SNAP_TABLE_STORAGE, storageAddress());
	writeValue(offset + SNAP_TABLE_METATABLE, metatable ? valueTable(m_heap.reference(metatable)) : valueNil());
	return offset;
}

void Table::restoreSnapshot(const CpuSnapshotReader& reader, u32 offset) {
	m_lengthHint = reader.snapshot.word(offset + SNAP_TABLE_LENGTH_HINT);
	m_hashFree = reader.snapshot.integer(offset + SNAP_TABLE_HASH_FREE);
	const Value savedMetatable = reader.readValue(offset + SNAP_TABLE_METATABLE);
	metatable = isNil(savedMetatable) ? nullptr : asTable(savedMetatable, m_heap);
}

size_t Table::trackedHeapBytes() const {
	return trackedHeapBytesForCapacities(m_arraySize, m_hashSize);
}


} // namespace bmsx
